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
const probe = atom({ plugin: 'tenantree', key: 'probe' } as const, null as string | null)

/** The plan of a writing tool as the server attaches it (_meta.tenantreePlan); never shown to the model. */
type Plan = {
  id?: string
  code?: string
  preview?: boolean
  level: string
  tool: string
  title: string
  expiresAt?: number
  parts?: {
    headline: string
    facts: Array<{ label: string; value: string }>
    values: Array<{ label: string; value: string }>
    cost: { rows: Array<{ label: string; value: string }>; notes: string[]; traps: string[] } | null
    warnings: string[]
    notes: string[]
  }
}
const LEVEL: Record<string, string> = { structure: 'Structure', landscape: 'Landscape', account: 'Account' }
const textOf = (r: { content?: Array<{ type: string; text?: string }> }) => (r.content ?? []).map(c => c.text ?? '').join('\n')
const HANDOVER = /https:\/\/[^\s"<>]+\/secret\/[A-Za-z0-9_-]+/

/** mcp__<server>__<tool> of a tenantree server: a server whose name ends with "tenantree". */
const TENANTREE_TOOL = /^mcp__plugin_tenantree_tenantree__([a-z0-9_]+)$/
const KIND: Record<ActiveTarget['kind'], string> = { production: 'Production', quality: 'Quality', development: 'Development', other: 'Other' }
const RIGHT: Record<ActiveTarget['right'], string> = { admin: 'use and administration', user: 'use', none: 'not admitted' }

/** Finds a field of the structured content in whatever shape a tool result arrives. */
function fieldOf(value: unknown, name: string, depth = 0): unknown {
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
      // The band must never disturb the tool call itself.
      await remember($, result).catch(() => {})
    }
    return result
  })

  on('command.run', { command: 'tenantree' }, async $ => {
    await refresh($).catch(() => {})
    const state = await read($, target)
    if (state.status === 'unknown') return { text: 'tenantree is not connected in this session. Run /mcp, select the server tenantree and sign in.' }
    const lines = [`Signed in to tenantree as ${state.account ?? 'unknown'}.`, '', 'Available subaccounts:']
    for (const t of state.targets ?? []) lines.push(`${t.active ? '▶' : ' '} ${path(t)} (${KIND[t.kind]})`)
    if (!state.targets?.length) lines.push('  none assigned')
    const seen = await read($, probe)
    if (seen) lines.push('', `Diagnostics: ${seen}`)
    return { text: lines.join('\n') }
  })

  // THE PLAN CARD (15.10.2026): Claude Code draws no MCP Apps views for a plugin's server, so the
  // mod draws the card itself under the tool call -- facts, values, cost, warnings and the buttons.
  // The approval code comes from _meta, which the model does not see; the press is the person's.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const m = TENANTREE_TOOL.exec(String(e.props.tool))
    if (!m || e.props.isErrored) return next(e)
    if ((await read($, probe)) === null) {
      const o = e.props.output as Record<string, unknown> | undefined
      const keys = o && typeof o === 'object' ? Object.keys(o).join(', ') : typeof o
      await update($, probe, () => `${m[1]}: output keys [${keys}], _meta ${fieldOf(o, '_meta') !== undefined ? 'present' : 'absent'}, plan ${fieldOf(o, 'tenantreePlan') !== undefined ? 'present' : 'absent'}`)
    }
    const plan = fieldOf(e.props.output, 'tenantreePlan') as Plan | undefined
    if (!plan?.parts) return next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const state = plan.id ? (await read($, plans))[plan.id] : undefined
    const p = plan.parts
    const t = await read($, target)
    const where = t.status === 'known' && t.target ? path(t.target) : null
    const set = (id: string, next: PlanCardState) => update($, plans, all => ({ ...all, [id]: next }))
    const decide = async (approve: boolean) => {
      if (!plan.id || !plan.code) return
      const id = plan.id
      await set(id, { status: 'busy', text: approve ? 'Carrying out …' : 'Rejecting …', handover: null })
      try {
        const name = await serverOf($)
        if (!name) throw new Error('tenantree is not connected.')
        const r = await $.mcp.call(name, approve ? 'tenantree_plan_approve' : 'tenantree_plan_reject', { planId: id, code: plan.code })
        const body = textOf(r)
        const handover = (HANDOVER.exec(body) ?? [])[0] ?? null
        const closed = r.isError && /no longer open/.test(body)
        await set(id, { status: closed ? 'closed' : r.isError ? 'failed' : approve ? 'approved' : 'rejected', text: body.split('\n')[0] ?? '', handover })
      } catch (err) {
        await set(id, { status: 'failed', text: String((err as Error)?.message ?? err), handover: null })
      }
    }
    const rows = (list: Array<{ label: string; value: string }>) =>
      list.map(f => (
        <Box key={f.label}>
          <Box width={22}><Text dimColor>{f.label}</Text></Box>
          <Text>{f.value}</Text>
        </Box>
      ))
    const STATUS: Record<PlanCardState['status'], { label: string; color: 'success' | 'error' | 'warning' | undefined }> = {
      busy: { label: 'In progress', color: undefined },
      approved: { label: 'Approved and carried out', color: 'success' },
      rejected: { label: 'Rejected. Nothing was changed.', color: undefined },
      failed: { label: 'Not carried out', color: 'error' },
      closed: { label: 'This plan is no longer open', color: undefined },
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={plan.preview ? undefined : 'suggestion'} paddingX={1} gap={0}>
        <Box justifyContent="space-between">
          <Text bold>{plan.title}</Text>
          <Text dimColor>{plan.preview ? 'Preview -- cannot be approved' : `Write level: ${LEVEL[plan.level] ?? plan.level}`}</Text>
        </Box>
        {where ? <Text dimColor>Target: {where}</Text> : null}
        {p.headline ? <Text>{p.headline}</Text> : null}
        {p.facts.length ? <Box flexDirection="column" marginTop={1}>{rows(p.facts)}</Box> : null}
        {p.values.length ? <Box flexDirection="column" marginTop={1}><Text dimColor>Values</Text>{rows(p.values)}</Box> : null}
        {p.cost ? <Box flexDirection="column" marginTop={1}><Text dimColor>Cost</Text>{rows(p.cost.rows)}{p.cost.traps.map(x => <Text key={x} color="warning">{x}</Text>)}</Box> : null}
        {p.warnings.map(w => <Text key={w} color="warning">{w}</Text>)}
        {plan.preview || !plan.id ? null : state ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={STATUS[state.status].color} bold>{STATUS[state.status].label}</Text>
            {state.text && state.status !== 'busy' ? <Text dimColor>{state.text}</Text> : null}
            {state.handover ? <Link href={state.handover} label="Open the secure one-time link" /> : null}
          </Box>
        ) : (
          <Box marginTop={1} gap={2}>
            <Button key={`approve-${plan.id}`} label="Approve" variant="primary" onPress={() => void decide(true)} />
            <Button key={`reject-${plan.id}`} label="Reject" onPress={() => void decide(false)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, target)
    if (state.status === 'unknown') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // The picker where the surface draws one (terminal and desktop; not the mobile app).
    const Select = 'Select' in els ? els.Select : null
    const t = state.target
    const note = await read($, message)
    const account = state.account ? <Text dimColor>{state.account}</Text> : null
    const targets = state.targets ?? []
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
    return (
      <Box justifyContent="space-between">
        <Box>
          <Text color={isProduction ? 'error' : 'success'} bold>{isProduction ? '● ' : '○ '}</Text>
          <Text bold>tenantree </Text>
          {picker}
          {t ? (
            <Text color={isProduction ? 'error' : undefined} bold={isProduction} dimColor={!isProduction}>
              {' '}· {KIND[t.kind]} · {t.region} · {t.signedIn ? RIGHT[t.right] : 'not signed in at the IAS'}
            </Text>
          ) : (
            <Text dimColor> · please choose a subaccount</Text>
          )}
          {note ? <Text dimColor> · {note}</Text> : null}
        </Box>
        {account}
      </Box>
    )
  })
}
