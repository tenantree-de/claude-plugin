import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ActiveTarget, Attached, PlanTile, Row, Target, TargetState } from '../types'

/**
 * tenantree in Claude Code (operator, 15./16.10.2026):
 *
 * THE BAND above the prompt shows organization -> landscape -> subaccount of the active target, a
 * picker to switch it, the sign-in at the IAS and the open approvals; the tenantree mark sits on
 * the right.
 *
 * THE TILES come AFTER the reply, never in the middle of it: Claude Code draws no MCP Apps views
 * for a plugin's server and folds tool calls away, so the mod draws each plan as a tile under the
 * text of the reply that made it.
 *
 * NO CALLS OF ITS OWN IN THE BACKGROUND: auto mode refuses a plugin's calls nobody asked for
 * (measured 16.10.2026). The tiles read the plan from the text of the tool answer; the plugin calls
 * tenantree only when the person presses a button, and the press is passed on as their request.
 */
const target = atom({ plugin: 'tenantree', key: 'target' } as const, { status: 'unknown' } as TargetState)
const server = atom({ plugin: 'tenantree', key: 'server' } as const, null as string | null)
const message = atom({ plugin: 'tenantree', key: 'message' } as const, null as string | null)
const tiles = atom({ plugin: 'tenantree', key: 'tiles' } as const, {} as Record<string, PlanTile>)
const turn = atom({ plugin: 'tenantree', key: 'turn' } as const, [] as string[])
const attached = atom({ plugin: 'tenantree', key: 'attached' } as const, [] as Attached[])
const expanded = atom({ plugin: 'tenantree', key: 'expanded' } as const, {} as Record<string, boolean>)
const signin = atom({ plugin: 'tenantree', key: 'signin' } as const, null as { url: string; system: string | null; at: number } | null)

const PREFIX = 'mcp__plugin_tenantree_tenantree__'
const TENANTREE_TOOL = /^mcp__plugin_tenantree_tenantree__([a-z0-9_]+)$/
const PLAN_LINK = /https:\/\/[^\s"<>\\]+\/plan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
const HANDOVER_LINK = /https:\/\/[^\s"<>\\]+\/secret\/[A-Za-z0-9_-]+/
const SIGNIN_LINK = /https:\/\/[^\s"<>\\]+\/sso\/start\/[A-Za-z0-9_-]+/
const SIGNIN_MS = 10 * 60 * 1000
const PLAN_MS = 15 * 60 * 1000
const KIND: Record<ActiveTarget['kind'], string> = { production: 'Production', quality: 'Quality', development: 'Development', other: 'Other' }
const LEVEL: Record<string, string> = { structure: 'Structure', landscape: 'Landscape', account: 'Account' }
// The tenantree mark (Logo E) for dark surfaces.
const MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-84 -38 780 780"><g transform="matrix(1.05 0 0 1.05 -0.7 -36)"><path fill="#05A4A0" d="M320 470 Q300 214 556 190 Q576 446 320 470Z"/><rect fill="#FFFFFF" x="224" y="80" width="137" height="640"/><rect fill="#0078CF" x="14" y="20" width="556" height="125"/></g></svg>'

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

/** A field of the structured content, which Claude Code hands a plugin as JSON text (measured 15.10.2026). */
function fieldOf(value: unknown, name: string, depth = 0): unknown {
  if (typeof value === 'string' && value.startsWith('{') && depth <= 4) {
    try {
      return fieldOf(JSON.parse(value), name, depth + 1)
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  const v = value as Record<string, unknown>
  if (name in v) return v[name]
  for (const child of Object.values(v)) {
    const found = fieldOf(child, name, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

// --- The plan text ----------------------------------------------------------

const FACT = /^([A-Z][A-Za-z ()/-]{1,28}):\s+(\S.*)$/
const FOR_THE_MODEL = /^(Repeat the same call|APPROVAL REQUIRED|On this installation|Approval page|Give the person|Do not call again)/
const LEFT_OUT = new Set(['Plan', 'Tool', 'Enabled because'])

/** The plan as its text states it: what the tile shows. */
function planOf(text: string): Omit<PlanTile, 'planId' | 'url' | 'expiresAt' | 'status'> {
  const lines = text.split('\n')
  const facts: Row[] = []
  const values: Row[] = []
  const warnings: string[] = []
  let title = ''
  let level: string | null = null
  let target: string | null = null
  let headline = ''
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim()
    if (!t || FOR_THE_MODEL.test(t)) continue
    if (!headline) {
      headline = t
      continue
    }
    if (t === 'With:') {
      const block: string[] = []
      for (i++; i < lines.length && (lines[i] ?? '').trim(); i++) block.push(lines[i] ?? '')
      try {
        for (const [k, v] of Object.entries(JSON.parse(block.join('\n')) as Record<string, unknown>)) values.push({ label: k, value: typeof v === 'string' ? v : JSON.stringify(v) })
      } catch {
        // Not JSON: left out of the tile; the reply names it.
      }
      continue
    }
    const plan = /^Plan:\s+(.*?)(?:\s+\(write level (\w+)\))?$/.exec(t)
    if (plan) {
      title = plan[1] ?? ''
      level = plan[2] ?? null
      continue
    }
    if (/^(WARNING|Warning|TRAP)[:\s]/.test(t)) {
      warnings.push(t.replace(/^(WARNING|Warning|TRAP):?\s*/, ''))
      continue
    }
    const fact = FACT.exec(t)
    if (fact && fact[1] && fact[2]) {
      if (fact[1] === 'Tenant') target = fact[2]
      else if (!LEFT_OUT.has(fact[1])) facts.push({ label: fact[1], value: fact[2] })
    }
  }
  return { title: title || 'Plan', level, target, headline, facts, values, warnings }
}

// --- Target and sign-in -----------------------------------------------------

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

async function serverOf($: EngineInterface): Promise<string | null> {
  const known = await read($, server)
  if (known) return known
  const connected = await $.mcp.connect('tenantree')
  if (!connected.isConnected) return null
  await update($, server, () => connected.server)
  return connected.server
}

/** Reads the target (read-only tools; at session start and when the person comes back). */
async function refresh($: EngineInterface) {
  const name = await serverOf($)
  if (!name) return
  const profile = await $.mcp.call(name, 'tenantree_profile_read', {})
  if (!profile.isError) await remember($, profile)
  const landscapes = await $.mcp.call(name, 'tenantree_landscape_query', {})
  if (!landscapes.isError) await remember($, landscapes)
}

/** A call the person asked for with a button: the press goes along as their request. */
async function pressed($: EngineInterface, tool: string, args: Record<string, unknown>, what: string) {
  const r = (await $.tool.call({ tool: `${PREFIX}${tool}`, ...args, consent: `The user pressed "${what}" in the tenantree band.` } as never)) as unknown
  if (r && typeof r === 'object' && 'deny' in r) throw new Error(String((r as { deny: unknown }).deny))
  return r as { text?: string; isError?: boolean; result?: unknown }
}

/** The state of one plan, on the person's press. */
async function check($: EngineInterface, id: string) {
  const tile = (await read($, tiles))[id]
  if (!tile) return
  await update($, tiles, all => ({ ...all, [id]: { ...tile, status: 'checking' as const } }))
  try {
    const r = await pressed($, 'tenantree_plan_read', { planId: tile.planId }, 'Update status')
    const body = r.text ?? textOf(r)
    const status = String(fieldOf(body, 'status') ?? fieldOf(r, 'status') ?? 'unknown')
    const get = <T,>(k: string) => (fieldOf(body, k) ?? fieldOf(r, k)) as T | undefined
    await update($, tiles, all => ({
      ...all,
      [id]: {
        ...tile,
        status: (['open', 'decided', 'closed'].includes(status) ? status : 'unknown') as PlanTile['status'],
        decision: get<'approve' | 'reject'>('decision'),
        by: get<string | null>('by'),
        ok: get<boolean>('ok'),
        at: get<number>('at'),
        first: get<string>('first'),
        error: r.isError ? body.split('\n')[0] : undefined,
      },
    }))
  } catch (err) {
    await update($, tiles, all => ({ ...all, [id]: { ...tile, status: 'unknown' as const, error: String((err as Error)?.message ?? err) } }))
  }
}

/** The approval code of a call, where Claude Code hands _meta "claude/plugins" to plugins (way B, 16.10.2026). */
function codeOf(meta: unknown): string | undefined {
  const plugins = (meta as Record<string, unknown> | undefined)?.['claude/plugins'] as Record<string, unknown> | undefined
  const plan = (plugins?.tenantree as { plan?: { code?: unknown } } | undefined)?.plan
  return typeof plan?.code === 'string' ? plan.code : undefined
}

/** Approve or reject on the person's press, with the code only the tile holds. */
async function decide($: EngineInterface, id: string, decision: 'approve' | 'reject') {
  const tile = (await read($, tiles))[id]
  if (!tile?.code) return
  await update($, tiles, all => ({ ...all, [id]: { ...tile, busy: decision } }))
  try {
    const r = await pressed($, 'tenantree_plan_decide', { planId: tile.planId, code: tile.code, decision }, decision === 'approve' ? 'Approve' : 'Reject')
    const body = r.text ?? textOf(r)
    const at = await $.clock.now()
    const closed = Boolean(r.isError) && /no longer open/.test(body)
    await update($, tiles, all => ({
      ...all,
      [id]: {
        ...tile,
        busy: undefined,
        code: undefined,
        // "Not carried out: ..." is the decide tool's own refusal; any other error is the result of the approved operation.
        status: (closed ? 'closed' : r.isError && /^Not carried out:/.test(body) ? 'unknown' : 'decided') as PlanTile['status'],
        decision,
        ok: !r.isError,
        at,
        first: body.split('\n')[0],
        handover: HANDOVER_LINK.exec(body)?.[0] ?? null,
        error: r.isError ? body.split('\n')[0] : undefined,
      },
    }))
  } catch (err) {
    await update($, tiles, all => ({ ...all, [id]: { ...tile, busy: undefined, status: 'unknown' as const, error: String((err as Error)?.message ?? err) } }))
  }
}

const path = (t: { organization: string; landscape: string; system: string }) => `${t.organization} → ${t.landscape} → ${t.system}`
const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
const normal = (s: string) => s.replace(/\s+/g, ' ').trim()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'tenantree', description: 'Show the tenantree account and the organizations, landscapes and subaccounts available to it' })
    void refresh($).catch(() => {})
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => []).catch(() => {})
    const now = await read($, target).catch(() => null)
    const waiting = await read($, signin).catch(() => null)
    if (now?.status === 'unknown' || waiting || (now?.status === 'known' && now.target?.right === 'none')) void refresh($).catch(() => {})
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const m = typeof e.tool === 'string' ? TENANTREE_TOOL.exec(e.tool) : null
    const tool = m?.[1]
    if (!tool) return result
    // The band and the tiles must never disturb the tool call itself.
    try {
      await remember($, result)
      const text = textOf(result)
      const failed = Boolean((result as { isError?: boolean } | null)?.isError)
      const at = await $.clock.now()
      if (tool === 'tenantree_landscape_signin') {
        const url = SIGNIN_LINK.exec(text)?.[0]
        const t = await read($, target)
        if (url) await update($, signin, () => ({ url, system: t.status === 'known' && t.target ? t.target.system : null, at }))
      } else if (!failed && !tool.startsWith('tenantree_')) await update($, signin, () => null)
      const link = tool === 'tenantree_plan_read' ? null : PLAN_LINK.exec(text)
      const id = e.tool_use_id
      if (link && link[1] && id) {
        const tile: PlanTile = { ...planOf(text), planId: link[1], url: link[0], expiresAt: at + PLAN_MS, status: 'open' }
        await update($, tiles, all => ({ ...all, [id]: tile }))
        await update($, turn, ids => [...ids, id])
      }
    } catch {
      // Nothing of the band is worth a failed tool call.
    }
    return result
  })

  // The tiles of a turn go under the text of its reply.
  on('turn.complete', async ($, e, next) => {
    const ids = await read($, turn).catch(() => [] as string[])
    if (ids.length) {
      // The codes, where Claude Code hands them to plugins; the model never reads this part.
      try {
        const messages = await $.session.messages()
        const codes = new Map<string, string>()
        for (const m of messages) for (const u of m.toolUses ?? []) {
          const code = codeOf((u as { meta?: unknown }).meta)
          if (code && ids.includes(u.tool_use_id)) codes.set(u.tool_use_id, code)
        }
        if (codes.size) await update($, tiles, all => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, codes.has(k) ? { ...v, code: codes.get(k) } : v])))
      } catch {
        // No codes: the tile offers the approval page.
      }
    }
    if (ids.length && e.answer) {
      const tail = normal(e.answer).slice(-160)
      await update($, attached, list => [...list.slice(-50), { tail, ids }]).catch(() => {})
      await update($, turn, () => []).catch(() => {})
    }
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

  // THE TILES AFTER THE REPLY (operator, 16.10.2026).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const list = await read($, attached)
    if (!list.length) return next(e)
    const text = normal(e.props.text)
    const hit = list.find(a => a.tail && text.endsWith(a.tail))
    if (!hit) return next(e)
    const all = await read($, tiles)
    const shown = hit.ids.map(id => [id, all[id]] as const).filter((x): x is readonly [string, PlanTile] => Boolean(x[1]))
    if (!shown.length) return next(e)
    const reply = await next(e)
    const opened = await read($, expanded)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const now = await $.clock.now()
    const rows = (rs: Row[]) =>
      rs.map(f => (
        <Box key={f.label}>
          <Box width={22}><Text dimColor>{f.label}</Text></Box>
          <Text>{f.value}</Text>
        </Box>
      ))
    return (
      <Box flexDirection="column" gap={1}>
        {reply}
        {shown.map(([id, p]) => {
          const expired = p.status === 'open' && now > p.expiresAt
          const open = p.status === 'open' && !expired
          const isOpen = Boolean(opened[id])
          const decided =
            p.status === 'decided'
              ? `${p.decision === 'approve' ? (p.ok === false ? 'Approved, but not carried out' : 'Approved and carried out') : 'Rejected. Nothing was changed.'}${p.by ? ` by ${p.by}` : ''}${p.at ? ` at ${time(p.at)}` : ''}.`
              : null
          return (
            <Box key={id} flexDirection="column" borderStyle="round" borderColor={p.status === 'open' && !expired ? 'suggestion' : undefined} paddingX={1}>
              <Box justifyContent="space-between">
                <Text bold>{p.title}</Text>
                {p.level ? <Text dimColor>Write level: {LEVEL[p.level] ?? p.level}</Text> : null}
              </Box>
              {p.target ? <Text dimColor>Target: {p.target}</Text> : null}
              {open && p.code ? (
                <Box marginTop={1} gap={2} alignItems="center">
                  <Button key={`approve-${id}`} label={p.busy === 'approve' ? 'Carrying out …' : 'Approve'} variant="primary" onPress={() => void (p.busy ? null : decide($, id, 'approve'))} />
                  <Button key={`reject-${id}`} label={p.busy === 'reject' ? 'Rejecting …' : 'Reject'} onPress={() => void (p.busy ? null : decide($, id, 'reject'))} />
                  <Text dimColor>Valid until {time(p.expiresAt)}. Nothing is changed until you approve.</Text>
                </Box>
              ) : open ? (
                <Box marginTop={1} flexDirection="column">
                  <Text dimColor>Valid until {time(p.expiresAt)}. Nothing is changed until you approve.</Text>
                  <Text dimColor>Approve and reject in this tile need the plugin channel of Claude Code, which is not enabled yet; please decide on the approval page.</Text>
                </Box>
              ) : null}
              {expired ? <Text dimColor>Expired at {time(p.expiresAt)} unless decided before.</Text> : null}
              {decided ? <Text color={p.decision === 'approve' && p.ok !== false ? 'success' : p.ok === false ? 'error' : undefined} bold>{decided}</Text> : null}
              {p.handover ? <Link href={p.handover} label="Open the secure one-time link" /> : null}
              {p.status === 'closed' ? <Text dimColor>This plan is no longer open (expired or superseded).</Text> : null}
              {p.status === 'checking' ? <Text dimColor>Reading the status …</Text> : null}
              {p.status === 'unknown' ? <Text color="error">The status could not be read{p.error ? `: ${p.error}` : '.'}</Text> : null}
              {isOpen ? (
                <Box flexDirection="column" marginTop={1}>
                  {p.facts.length ? <Box flexDirection="column">{rows(p.facts)}</Box> : null}
                  {p.values.length ? <Box flexDirection="column" marginTop={1}><Text dimColor>Values</Text>{rows(p.values)}</Box> : null}
                  {p.warnings.map(w => <Text key={w} color="warning">{w}</Text>)}
                </Box>
              ) : null}
              <Box marginTop={1} gap={2} alignItems="center">
                <Button key={`plan-${id}`} label={isOpen ? 'Hide plan' : 'Show plan'} onPress={() => void update($, expanded, all => ({ ...all, [id]: !isOpen }))} />
                {p.url ? <Link href={p.url} label="Open the approval page" /> : null}
                {p.status !== 'checking' && !p.busy ? <Button key={`update-${id}`} label="Update status" onPress={() => void check($, id)} /> : null}
              </Box>
              {decided && p.first ? <Text dimColor>{p.first}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, target)
    const now = await $.clock.now()
    const all = await read($, tiles)
    const open = Object.entries(all).filter(([, p]) => p.status === 'open' && now <= p.expiresAt)
    const pending = await read($, signin)
    const signinOpen = pending && now - pending.at < SIGNIN_MS ? pending : null
    if (state.status === 'unknown' && !open.length && !signinOpen) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Link, Button } = els
    // The picker and the mark where the surface draws them (terminal: no Svg; mobile: no Select).
    const Select = 'Select' in els ? els.Select : null
    const Svg = 'Svg' in els ? els.Svg : null
    const t = state.status === 'known' ? state.target : null
    const targets = state.status === 'known' ? state.targets ?? [] : []
    const active = targets.find(x => x.active)
    const note = await read($, message)
    const choose = async (id: string) => {
      if (id === active?.id) return
      await update($, message, () => 'Switching the subaccount …')
      try {
        const r = await pressed($, 'tenantree_landscape_use', { systemId: id }, 'Switch subaccount')
        await remember($, r.text ?? r)
        await refresh($).catch(() => {})
        await update($, message, () => (r.isError ? 'The subaccount could not be switched.' : null))
      } catch {
        await update($, message, () => 'The subaccount could not be switched.')
      }
    }
    const askSignin = async () => {
      try {
        const r = await pressed($, 'tenantree_landscape_signin', {}, 'Sign in')
        const url = SIGNIN_LINK.exec(r.text ?? textOf(r))?.[0]
        const at = await $.clock.now()
        if (url) await update($, signin, () => ({ url, system: t?.system ?? null, at }))
      } catch {
        await update($, message, () => 'The sign-in link could not be created.')
      }
    }
    const isProduction = t?.kind === 'production'
    const picker =
      state.status === 'unknown' ? (
        <Text dimColor>Reading the subaccount …</Text>
      ) : Select && targets.length > 0 ? (
        <Select key="target" options={targets.map(x => ({ value: x.id, label: path(x) }))} value={active?.id} onSelect={(v: string) => void choose(v)} />
      ) : (
        <Text bold>{t ? path(t) : 'No subaccount chosen'}</Text>
      )
    const notAdmitted = state.status === 'known' && t && (!t.signedIn || t.right === 'none')
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center">
          <Box alignItems="center" gap={1}>
            {isProduction ? <Text color="error" bold>● Production</Text> : null}
            {picker}
            {note ? <Text dimColor>{note}</Text> : null}
          </Box>
          <Box alignItems="center" gap={1} backgroundColor="#2b3036" borderStyle="round" borderColor="#4a5058" paddingX={1}>
            {Svg ? <Svg source={MARK} alt="tenantree" width={16} height={16} /> : null}
            {/* The mark opens the Tenantree Dashboard of the subaccount in the browser (operator, 16.10.2026). */}
            {t?.dashboardUrl ? <Link href={t.dashboardUrl} label="tenantree" /> : <Text color="#c9ced4" bold>tenantree</Text>}
          </Box>
        </Box>
        {signinOpen ? (
          <Box gap={1} marginTop={1} alignItems="center">
            <Text color="warning">◆ Sign-in required{signinOpen.system ? ` at the IAS of ${signinOpen.system}` : ''}:</Text>
            <Link href={signinOpen.url} label="Sign in" />
            <Text dimColor>valid until {time(signinOpen.at + SIGNIN_MS)}, once</Text>
          </Box>
        ) : notAdmitted ? (
          <Box gap={1} marginTop={1} alignItems="center">
            <Text color="warning">◆ Not signed in at the IAS of {t.system}.</Text>
            <Button key="signin" label="Sign in" onPress={() => void askSignin()} />
          </Box>
        ) : null}
        {open.length ? (
          <Box flexDirection="column" marginTop={1}>
            {open.map(([id, p]) => (
              <Box key={id} gap={1} alignItems="center">
                <Text color="warning">◆ Approval pending:</Text>
                <Text bold>{p.title}</Text>
                <Text dimColor>until {time(p.expiresAt)}</Text>
                {p.url ? <Link href={p.url} label="Approve or reject" /> : null}
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })
}
