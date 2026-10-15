import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ActiveTarget, PlanCardState, Target, TargetState } from '../types'

/**
 * The tenantree band above the prompt (decision of the operator, 15.10.2026): always visible,
 * it shows organization -> landscape -> subaccount of the active target and the signed-in
 * account, and switches the target with a picker -- so no step runs in the wrong subaccount.
 *
 * The band calls the plugin's own MCP server "tenantree" (read-only tools for the band, the
 * landscape use tool for the picker).
 */
const target = atom({ plugin: 'tenantree', key: 'target' } as const, { status: 'unknown' } as TargetState)
const server = atom({ plugin: 'tenantree', key: 'server' } as const, null as string | null)
const message = atom({ plugin: 'tenantree', key: 'message' } as const, null as string | null)
const plans = atom({ plugin: 'tenantree', key: 'plans' } as const, {} as Record<string, PlanCardState>)

const LEVEL: Record<string, string> = { structure: 'Structure', landscape: 'Landscape', account: 'Account' }
/** The plan id in a plan answer: the approval page link names it. */
const PLAN_LINK = /\/plan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
const textOf = (r: unknown): string => {
  if (typeof r === 'string') return r
  if (Array.isArray(r)) return r.map(textOf).join('\n')
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if ('content' in o) return textOf(o.content)
    if ('result' in o) return textOf(o.result)
  }
  return ''
}

/** mcp__<server>__<tool> of a tenantree server: a server whose name ends with "tenantree". */
const TENANTREE_TOOL = /^mcp__plugin_tenantree_tenantree__([a-z0-9_]+)$/
const KIND: Record<ActiveTarget['kind'], string> = { production: 'Production', quality: 'Quality', development: 'Development', other: 'Other' }

/** Finds a field of the structured content in whatever shape a tool result arrives. */
function fieldOf(value: unknown, name: string, depth = 0): unknown {
  // Measured 15.10.2026: Claude Code hands a plugin server's structured content over as JSON text.
  if (typeof value === 'string' && value.startsWith('{') && depth <= 4) {
    try {
      return fieldOf(JSON.parse(value), name, depth + 1)
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  const v = value as Record<string, unknown>
  const sc = v.structuredContent as Record<string, unknown> | undefined
  if (sc && typeof sc === 'object' && name in sc) return sc[name]
  if (name in v) return v[name]
  for (const child of Object.values(v)) {
    const found = fieldOf(child, name, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** Keeps the active target, the account and the choosable targets from a tenantree result. */
async function remember($: EngineInterface, result: unknown) {
  const found = fieldOf(result, 'activeTarget') as ActiveTarget | null | undefined
  if (found === undefined) return
  const account = fieldOf(result, 'signedInAs') as string | undefined
  const targets = fieldOf(result, 'targets') as Target[] | undefined
  const at = await $.clock.now()
  await update($, target, (prev): TargetState => {
    const before = prev.status === 'known' ? prev : undefined
    return { status: 'known', target: found, account: account ?? before?.account, targets: targets ?? before?.targets, at }
  })
}

/** The plugin's tenantree server as the engine names it, connected on first use. */
async function serverOf($: EngineInterface): Promise<string | null> {
  const known = await read($, server)
  if (known) return known
  const connected = await $.mcp.connect('tenantree')
  if (!connected.isConnected) return null
  await update($, server, () => connected.server)
  return connected.server
}

/** Reads account, active target and choosable targets (read-only tools). */
async function refresh($: EngineInterface) {
  const name = await serverOf($)
  if (!name) return
  const profile = await $.mcp.call(name, 'tenantree_profile_read', {})
  if (!profile.isError) await remember($, profile)
  const landscapes = await $.mcp.call(name, 'tenantree_landscape_query', {})
  if (!landscapes.isError) await remember($, landscapes)
}

/** Reads what the card shows for a plan (the server keeps the plan; the approval code never comes here). */
async function loadCard($: EngineInterface, toolUseId: string, planId: string) {
  const name = await serverOf($)
  if (!name) return
  const r = await $.mcp.call(name, 'tenantree_plan_status', { planId, details: true })
  const status = String(fieldOf(r, 'status') ?? 'unknown')
  const get = <T,>(k: string) => fieldOf(r, k) as T | undefined
  const now = await $.clock.now()
  await update($, plans, all => ({
    ...all,
    [toolUseId]: {
      ...all[toolUseId],
      planId,
      status: (['open', 'decided', 'closed'].includes(status) ? status : 'unknown') as PlanCardState['status'],
      title: get<string>('title') ?? all[toolUseId]?.title,
      level: get<string>('level') ?? all[toolUseId]?.level,
      parts: get<PlanCardState['parts']>('parts') ?? all[toolUseId]?.parts,
      expiresAt: get<number>('expiresAt') ?? all[toolUseId]?.expiresAt,
      url: get<string | null>('url') ?? all[toolUseId]?.url ?? null,
      decision: get<'approve' | 'reject'>('decision'),
      by: get<string | null>('by'),
      channel: get<string>('channel'),
      ok: get<boolean>('ok'),
      at: get<number>('at'),
      first: get<string>('first'),
      checkedAt: now,
    },
  }))
}

const path = (t: { organization: string; landscape: string; system: string }) => `${t.organization} → ${t.landscape} → ${t.system}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'tenantree', description: 'Show the tenantree account and the organizations, landscapes and subaccounts available to it' })
    void refresh($).catch(() => {})
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const m = typeof e.tool === 'string' ? TENANTREE_TOOL.exec(e.tool) : null
    if (m) {
      // The band and the card must never disturb the tool call itself.
      await remember($, result).catch(() => {})
      if ((await read($, target).catch(() => null))?.status === 'unknown') void refresh($).catch(() => {})
      const planId = PLAN_LINK.exec(textOf(result))?.[1]
      const id = e.tool_use_id
      if (planId && id) {
        const at = await $.clock.now()
        await update($, plans, all => ({ ...all, [id]: { planId, status: 'loading' as const, checkedAt: at } })).catch(() => {})
        void loadCard($, id, planId).catch(() => {})
      }
    }
    return result
  })

  // Open cards learn their decision when the person comes back to the chat.
  on('prompt.submit', async ($, e, next) => {
    // The first read at session start may come before the server is connected: try again.
    if ((await read($, target).catch(() => null))?.status === 'unknown') void refresh($).catch(() => {})
    const all = await read($, plans).catch(() => ({} as Record<string, PlanCardState>))
    for (const [id, c] of Object.entries(all)) if (c.status === 'open' || c.status === 'loading') void loadCard($, id, c.planId).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'tenantree' }, async $ => {
    await refresh($).catch(() => {})
    const state = await read($, target)
    if (state.status === 'unknown') return { text: 'tenantree is not connected in this session. Run /mcp, select the server tenantree and sign in.' }
    const lines = [`Signed in to tenantree as ${state.account ?? 'unknown'}.`, '', 'Available subaccounts:']
    for (const t of state.targets ?? []) lines.push(`${t.active ? '▶' : ' '} ${path(t)} (${KIND[t.kind]})`)
    if (!state.targets?.length) lines.push('  none assigned')
    return { text: lines.join('\n') }
  })

  // THE PLAN CARD (15.10.2026, option 1 of the operator): Claude Code draws no MCP Apps views for a
  // plugin's server and passes it no _meta, so the mod draws the card itself under the tool call.
  // It shows the plan and its status; approving stays on the approval page (personal sign-in), so the
  // model can still not approve on its own.
  // Drawn with the call's row itself (ToolUse): the Code tab folds a call's result away, so a card under
  // the result (ToolResult) would stay hidden until the person unfolds it (15.10.2026).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!TENANTREE_TOOL.test(String(e.props.tool)) || e.props.isErrored) return next(e)
    const card = (await read($, plans))[e.props.tool_use_id]
    if (!card) return next(e)
    const row = await next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const p = card.parts
    const t = await read($, target)
    const where = t.status === 'known' && t.target ? path(t.target) : null
    const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
    const rows = (list: Array<{ label: string; value: string }>) =>
      list.map(f => (
        <Box key={f.label}>
          <Box width={24}><Text dimColor>{f.label}</Text></Box>
          <Text>{f.value}</Text>
        </Box>
      ))
    const refresh = () => void loadCard($, e.props.tool_use_id, card.planId).catch(() => {})
    const decided =
      card.status === 'decided'
        ? `${card.decision === 'approve' ? (card.ok === false ? 'Approved, but not carried out' : 'Approved and carried out') : 'Rejected. Nothing was changed.'}${card.by ? ` by ${card.by}` : ''}${card.at ? ` at ${time(card.at)}` : ''}${card.channel === 'page' ? ' on the approval page' : ''}.`
        : null
    return (
      <Box flexDirection="column">
      {row}
      <Box flexDirection="column" borderStyle="round" borderColor={card.status === 'open' ? 'suggestion' : undefined} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold>{card.title ?? 'Plan'}</Text>
          {card.level ? <Text dimColor>Write level: {LEVEL[card.level] ?? card.level}</Text> : null}
        </Box>
        {where ? <Text dimColor>Target: {where}</Text> : null}
        {card.status === 'loading' ? <Text dimColor>Loading the plan …</Text> : null}
        {p?.headline ? <Text>{p.headline}</Text> : null}
        {p?.facts.length ? <Box flexDirection="column" marginTop={1}>{rows(p.facts)}</Box> : null}
        {p?.values.length ? <Box flexDirection="column" marginTop={1}><Text dimColor>Values</Text>{rows(p.values)}</Box> : null}
        {p?.cost ? <Box flexDirection="column" marginTop={1}><Text dimColor>Cost</Text>{rows(p.cost.rows)}{p.cost.traps.map(x => <Text key={x} color="warning">{x}</Text>)}</Box> : null}
        {p?.warnings.map(w => <Text key={w} color="warning">{w}</Text>)}
        <Box marginTop={1} gap={2} alignItems="center">
          {card.status === 'open' && card.url ? <Link href={card.url} label="Approve or reject on the approval page" /> : null}
          {card.status === 'open' ? <Text dimColor>Valid until {time(card.expiresAt)}. Nothing is changed until you approve.</Text> : null}
          {decided ? <Text color={card.decision === 'approve' && card.ok !== false ? 'success' : card.ok === false ? 'error' : undefined} bold>{decided}</Text> : null}
          {card.status === 'closed' ? <Text dimColor>This plan is no longer open (expired or superseded).</Text> : null}
          {card.status !== 'loading' ? <Button key={`refresh-${card.planId}`} label="Update status" onPress={refresh} /> : null}
        </Box>
        {decided && card.first ? <Text dimColor>{card.first}</Text> : null}
        {decided && card.url ? <Link href={card.url} label="Show the decision in the browser" /> : null}
      </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, target)
    // OPEN APPROVALS IN THE BAND (15.10.2026): the Code tab folds tool calls ("2 tools used"), so the
    // card under a call stays hidden; the band above the prompt is always in view.
    const now = await $.clock.now()
    const cards = Object.entries(await read($, plans)).filter(([, c]) =>
      c.status === 'open' || c.status === 'loading' || (c.status === 'decided' && c.at !== undefined && now - c.at < 10 * 60 * 1000),
    )
    if (state.status === 'unknown' && cards.length === 0) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Link, Button } = els
    // The picker where the surface draws one (terminal and desktop; not the mobile app).
    const Select = 'Select' in els ? els.Select : null
    const t = state.status === 'known' ? state.target : null
    const note = await read($, message)
    const account = state.status === 'known' && state.account ? <Text dimColor>{state.account}</Text> : null
    const targets = state.status === 'known' ? state.targets ?? [] : []
    const active = targets.find(x => x.active)
    const choose = async (id: string) => {
      const name = await serverOf($)
      if (!name || id === active?.id) return
      await update($, message, () => 'Switching target …')
      const r = await $.mcp.call(name, 'tenantree_landscape_use', { systemId: id })
      await remember($, r)
      await refresh($).catch(() => {})
      await update($, message, () => (r.isError ? 'The target could not be switched.' : null))
    }
    const isProduction = t?.kind === 'production'
    const picker =
      Select && targets.length > 0 ? (
        <Select key="target" options={targets.map(x => ({ value: x.id, label: `${path(x)} · ${KIND[x.kind]}` }))} value={active?.id} onSelect={(v: string) => void choose(v)} />
      ) : (
        <Text bold>{t ? path(t) : 'No active target'}</Text>
      )
    const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
    const updateAll = () => {
      for (const [id, c] of cards) void loadCard($, id, c.planId).catch(() => {})
    }
    const approvals = cards.length ? (
      <Box flexDirection="column" marginTop={1}>
        {cards.map(([id, c]) => (
          <Box key={id} gap={1}>
            {c.status === 'decided' ? (
              <Text color={c.decision === 'approve' && c.ok !== false ? 'success' : c.ok === false ? 'error' : undefined}>
                {c.decision === 'approve' ? (c.ok === false ? '✗ Not carried out:' : '✓ Approved:') : '– Rejected:'}
              </Text>
            ) : (
              <Text color="warning">◆ Approval pending:</Text>
            )}
            <Text bold>{c.title ?? 'Plan'}</Text>
            {c.status === 'open' ? <Text dimColor>until {time(c.expiresAt)}</Text> : null}
            {c.status === 'decided' && c.first ? <Text dimColor>{c.first}</Text> : null}
            {c.status === 'open' && c.url ? <Link href={c.url} label="Approve or reject" /> : null}
          </Box>
        ))}
        {cards.some(([, c]) => c.status !== 'decided') ? <Box><Button key="approvals-update" label="Update status" onPress={updateAll} /></Box> : null}
      </Box>
    ) : null
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Box>
            <Text color={isProduction ? 'error' : 'success'} bold>{isProduction ? '● ' : '○ '}</Text>
            <Text bold>tenantree </Text>
            {state.status === 'unknown' ? <Text dimColor>reading the target …</Text> : picker}
            {state.status === 'known' && !t ? <Text dimColor> · please choose a subaccount</Text> : null}
            {note ? <Text dimColor> · {note}</Text> : null}
          </Box>
          {account}
        </Box>
        {approvals}
      </Box>
    )
  })
}
