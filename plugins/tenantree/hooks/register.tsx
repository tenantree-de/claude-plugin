import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ActiveTarget, TargetState } from '../types'

/**
 * Shows the active tenantree target permanently above the prompt:
 * organization / landscape / system, kind (production highlighted), region,
 * subaccount and the right from the customer's IAS. The value comes from the
 * structured content every tenantree tool returns; at session start the
 * plugin reads it once itself (read-only tool).
 */
const target = atom({ plugin: 'tenantree', key: 'target' } as const, { status: 'unknown' } as TargetState)

const TOOL_PREFIX = 'mcp__plugin_tenantree_tenantree__'
const KIND: Record<ActiveTarget['kind'], string> = { production: 'PRODUKTION', quality: 'Qualitätssicherung', development: 'Entwicklung', other: 'Sonstige' }
const RIGHT: Record<ActiveTarget['right'], string> = { write: 'Lesen und Schreiben', read: 'Lesen', none: 'keine Berechtigung' }

/** Finds `structuredContent.activeTarget` in whatever shape a tool result arrives. */
function activeTargetOf(value: unknown, depth = 0): ActiveTarget | null | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  const v = value as Record<string, unknown>
  const sc = v.structuredContent as Record<string, unknown> | undefined
  if (sc && typeof sc === 'object' && 'activeTarget' in sc) return (sc.activeTarget ?? null) as ActiveTarget | null
  if ('activeTarget' in v && (v.activeTarget === null || typeof v.activeTarget === 'object')) return v.activeTarget as ActiveTarget | null
  for (const child of Object.values(v)) {
    const found = activeTargetOf(child, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** Finds `structuredContent.signedInAs` (the tenantree account) in a tool result. */
function accountOf(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.signedInAs === 'string' && v.signedInAs) return v.signedInAs
  for (const child of Object.values(v)) {
    const found = accountOf(child, depth + 1)
    if (found) return found
  }
  return undefined
}

/** Keeps the active target and the account from a tenantree tool result. */
async function remember($: EngineInterface, result: unknown) {
  const found = activeTargetOf(result)
  if (found === undefined) return
  const account = accountOf(result)
  const at = await $.clock.now()
  await update($, target, (prev): TargetState => ({
    status: 'known', target: found, account: account ?? (prev.status === 'known' ? prev.account : undefined), at,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Read once, without blocking the start; a server that needs sign-in stays "unknown".
    void (async () => {
      try {
        const connected = await $.mcp.connect('tenantree')
        if (!connected.isConnected) return
        // The account comes from the profile, the target from the landscapes.
        const profile = await $.mcp.call(connected.server, 'tenantree_profile_read', {})
        if (!profile.isError) await remember($, profile)
        const answer = await $.mcp.call(connected.server, 'tenantree_landscape_query', {})
        if (!answer.isError) await remember($, answer)
      } catch {
        // The band then simply shows that the target is not known yet.
      }
    })()
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (typeof e.tool === 'string' && e.tool.startsWith(TOOL_PREFIX)) await remember($, result)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, target)
    if (state.status === 'unknown') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const t = state.target
    // The account sits on the right, the target on the left.
    const account = state.account ? <Text dimColor>angemeldet als {state.account}</Text> : null
    if (!t) {
      return (
        <Box justifyContent="space-between">
          <Text dimColor>tenantree · kein aktives Ziel – bitte eine Landschaft wählen</Text>
          {account}
        </Box>
      )
    }
    const isProduction = t.kind === 'production'
    const sub = t.subaccountId ? ` · Subaccount ${t.subaccountId.slice(0, 8)}…` : ''
    const right = t.signedIn ? RIGHT[t.right] : 'nicht am IAS angemeldet'
    return (
      <Box justifyContent="space-between">
        <Box>
          <Text color={isProduction ? 'error' : 'success'} bold>{isProduction ? '● ' : '○ '}</Text>
          <Text bold>tenantree · {t.organization} / {t.landscape} / {t.system}</Text>
          <Text color={isProduction ? 'error' : undefined} bold={isProduction}> · {KIND[t.kind]}</Text>
          <Text dimColor> · {t.region}{sub} · {right}</Text>
        </Box>
        {account}
      </Box>
    )
  })
}
