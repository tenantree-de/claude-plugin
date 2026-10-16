import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AccountState, ActiveTarget, Attached, CostSection, CostTile, DiagramTile, PlanTile, Row, Target, TargetState } from '../types'

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
const diagrams = atom({ plugin: 'tenantree', key: 'diagrams' } as const, {} as Record<string, DiagramTile>)
const costs = atom({ plugin: 'tenantree', key: 'costs' } as const, {} as Record<string, CostTile>)
const expanded = atom({ plugin: 'tenantree', key: 'expanded' } as const, {} as Record<string, boolean>)
const signin = atom({ plugin: 'tenantree', key: 'signin' } as const, null as { url: string; system: string | null; at: number } | null)
/** TEPLU-12: the tenantree account of this connection; signedOut after Sign out or when the server asks for a sign-in. */
const account = atom({ plugin: 'tenantree', key: 'account' } as const, { status: 'unknown' } as AccountState)

const PREFIX = 'mcp__plugin_tenantree_tenantree__'
const PORTAL = 'https://portal.tenantree.de'
const TENANTREE_TOOL = /^mcp__plugin_tenantree_tenantree__([a-z0-9_]+)$/
const PLAN_LINK = /https:\/\/[^\s"<>\\]+\/plan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
const HANDOVER_LINK = /https:\/\/[^\s"<>\\]+\/secret\/[A-Za-z0-9_-]+/
const SIGNIN_LINK = /https:\/\/[^\s"<>\\]+\/sso\/start\/[A-Za-z0-9_-]+/
const SIGNIN_MS = 10 * 60 * 1000
/** The last line of every tenantree answer names the active target (server, 16.10.2026). */
const TARGET_LINE = /tenantree target: (.+?) → (.+?) → (.+?) \((production|quality|development|other)\)\s*$/m
const STORE_KEY = 'lastTarget'
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

// --- The cost text -----------------------------------------------------------

const VIEW_LINK = /Graphical view in the Tenantree Dashboard: (https:\/\/\S+)/
const HEADING = /^[A-Z][A-Z ()/-]{2,}$/

/** The cost assessment as its text states it, by section (THE ACCOUNT NOW, COST RISKS, NOT CHECKED, ...). */
function costOf(text: string): CostTile {
  const sections: CostSection[] = []
  const risks: string[] = []
  const unchecked: string[] = []
  let current: CostSection | null = null
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (!t || TARGET_LINE.test(t) || VIEW_LINK.test(t) || /^Prices:/.test(t)) continue
    if (HEADING.test(t)) {
      current = { name: t.charAt(0) + t.slice(1).toLowerCase(), rows: [], lines: [] }
      if (!/^COST RISKS$|^NOT CHECKED$/.test(t)) sections.push(current)
      continue
    }
    if (!current) continue
    if (/^Cost risks$/.test(current.name)) risks.push(t)
    else if (/^Not checked$/.test(current.name)) unchecked.push(t)
    else {
      const m = /^([^:]{2,60}):\s+(.+)$/.exec(t)
      if (m && m[1] && m[2] && !/^https?$/.test(m[1])) current.rows.push({ label: m[1], value: m[2] })
      else current.lines.push(t)
    }
  }
  return { sections, risks, unchecked, url: VIEW_LINK.exec(text)?.[1] ?? null }
}

// --- The diagram ---------------------------------------------------------------

/** The diagram as its text states it: layers with their nodes, the connections, findings and notes. */
function diagramOf(text: string): DiagramTile {
  const lines = text.split('\n')
  const tile: DiagramTile = { title: 'Landscape', layers: [], edges: [], findings: [], notes: [], url: VIEW_LINK.exec(text)?.[1] ?? null }
  let mode: 'none' | 'layers' | 'edges' | 'findings' | 'notes' = 'none'
  for (const raw of lines) {
    const t = raw.trim()
    if (/^```/.test(t) || /^Mermaid:/.test(t)) { mode = 'none'; if (/^Mermaid:/.test(t)) break; continue }
    const title = /^Architecture diagram:\s*(.+)$/.exec(t)
    if (title?.[1]) { tile.title = title[1]; continue }
    if (/^Layers/.test(t)) { mode = 'layers'; continue }
    if (/^Connections/.test(t)) { mode = 'edges'; continue }
    if (/^Findings/.test(t)) { mode = 'findings'; continue }
    if (/^Notes/.test(t)) { mode = 'notes'; continue }
    if (!t || TARGET_LINE.test(t) || VIEW_LINK.test(t)) continue
    if (mode === 'layers') {
      const layer = /^\d+\.\s+(.+)$/.exec(t)
      if (layer?.[1]) { tile.layers.push({ name: layer[1], nodes: [] }); continue }
      const node = /^-\s+(.+)$/.exec(t)
      const current = tile.layers[tile.layers.length - 1]
      if (node?.[1] && current) {
        const [name, ...rest] = node[1].split(' -- ')
        current.nodes.push({ name: (name ?? '').trim(), detail: rest.length ? [rest.join(' -- ').trim()] : [] })
        continue
      }
      const last = current?.nodes[current.nodes.length - 1]
      if (last) last.detail.push(t)
    } else if (mode === 'edges') {
      const m = /^(.+?)\s*-(?:&gt;|>)\s*(.+?)(?:\s*\(([^)]*)\))?$/.exec(t)
      if (m?.[1] && m[2]) tile.edges.push({ from: m[1].trim(), to: m[2].trim(), label: m[3] ?? null })
    } else if (mode === 'findings') {
      if (!/^None\.?$/.test(t)) tile.findings.push(t.replace(/^-\s*/, ''))
    } else if (mode === 'notes') tile.notes.push(t.replace(/^-\s*/, ''))
  }
  return tile
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

/** The blocks of the second layer of a tenant diagram, in drawing order. */
const GROUPS = ['SAP subscriptions', 'tenantree access', 'Other instances'] as const
type Group = (typeof GROUPS)[number]

/**
 * Sorts the nodes of a layer into blocks: SAP subscriptions (reached by a connection labelled
 * 'subscribed'), tenantree's own access (named tenantree-… or tenantree_…) and other instances.
 * Null when no node is a subscription or a tenantree access: the layer keeps one box per node.
 */
function groupsOf(nodes: DiagramTile['layers'][number]['nodes'], edges: DiagramTile['edges']): Map<Group, typeof nodes> | null {
  const subscribed = new Set(edges.filter(e => /^subscribed$/i.test((e.label ?? '').trim())).map(e => e.to))
  const groupOf = (name: string): Group => (subscribed.has(name) ? 'SAP subscriptions' : /^tenantree[-_]/i.test(name) ? 'tenantree access' : 'Other instances')
  if (!nodes.some(n => groupOf(n.name) !== 'Other instances')) return null
  const out = new Map<Group, typeof nodes>()
  for (const g of GROUPS) {
    const members = nodes.filter(n => groupOf(n.name) === g)
    if (members.length) out.set(g, members)
  }
  return out
}

/**
 * The diagram as SVG: one column per layer, a box per node (in blocks where the layer groups),
 * curved connections in the tenantree colours.
 *
 * Colour scheme: a render hook learns the surface (desktop, mobile, editor) and its size, not the
 * person's light or dark theme ($.config's 'theme' row is the terminal's setting, not the app's).
 * The SVG therefore adapts itself: presentation attributes carry the light palette, and an embedded
 * <style> overrides them under @media (prefers-color-scheme: dark), which an SVG drawn as an image
 * evaluates against the app's own appearance. Should a surface ever drop the <style>, the light
 * palette remains complete and legible on its own background. 'light' and 'dark' force one scheme.
 */
function diagramSvg(d: DiagramTile, scheme: 'auto' | 'light' | 'dark' = 'auto'): { source: string; width: number; height: number } {
  const MAX_WIDTH = 1100, GAP_X = 64, TOP = 34, PAD = 16, INSET = 10, HEAD = 22, GROUP_GAP = 14
  const NAME_PX = 7.2, DETAIL_PX = 6.4, TEXT_PAD = 24, MIN_W = 200, MAX_W = 320
  const layers = d.layers.map((layer, li) => ({ layer, groups: li > 0 ? groupsOf(layer.nodes, d.edges) : null }))

  // Column widths from the longest text; past the overall cap the widest columns give way first.
  const wanted = layers.map(({ layer, groups }) => {
    const text = Math.max(0, ...layer.nodes.map(n => Math.max(n.name.length * NAME_PX, (n.detail[0] ?? '').length * DETAIL_PX)))
    return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(text + TEXT_PAD))) + (groups ? 2 * INSET : 0)
  })
  const room = MAX_WIDTH - 2 * PAD - Math.max(0, layers.length - 1) * GAP_X
  let ceiling = Math.max(...wanted, 0)
  while (ceiling > 120 && wanted.reduce((s, w) => s + Math.min(w, ceiling), 0) > room) ceiling -= 4
  const widths = wanted.map(w => Math.min(w, ceiling))

  // Vertical extent of each column: plain boxes, or blocks of compact boxes.
  const H = 50, GAP_Y = 12, HG = 44, GAP_G = 8
  const extent = layers.map(({ layer, groups }) =>
    groups
      ? [...groups.values()].reduce((s, ns) => s + HEAD + ns.length * (HG + GAP_G) - GAP_G + 2 * INSET, 0) + (groups.size - 1) * GROUP_GAP
      : layer.nodes.length * (H + GAP_Y) - GAP_Y,
  )
  const inner = Math.max(H, ...extent)
  const height = TOP + inner + PAD + 4
  const width = PAD * 2 + widths.reduce((s, w) => s + w, 0) + Math.max(0, layers.length - 1) * GAP_X

  const anchor = new Map<string, { left: number; right: number; mid: number }>()
  const block = new Map<string, { left: number; mid: number }>()
  const parts: string[] = []
  const box = (x: number, y: number, w: number, h: number, n: DiagramTile['layers'][number]['nodes'][number], first: boolean) => {
    const chars = (px: number) => Math.max(4, Math.floor((w - TEXT_PAD) / px))
    const nameY = h >= 50 ? 21 : 19, detailY = h >= 50 ? 38 : 34
    parts.push(
      `<rect class="${first ? 'box1' : 'box'}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${first ? '#e1f4ff' : '#ffffff'}" stroke="${first ? '#0078cf' : '#05a4a0'}" stroke-width="1.5"/>`,
      `<text class="name" x="${x + 12}" y="${y + nameY}" font-size="13" font-weight="600" fill="#1d2d3e">${esc(cut(n.name, chars(NAME_PX)))}</text>`,
      `<text class="detail" x="${x + 12}" y="${y + detailY}" font-size="11" fill="#556b82">${esc(cut(n.detail[0] ?? '', chars(DETAIL_PX)))}</text>`,
    )
    anchor.set(n.name, { left: x, right: x + w, mid: y + h / 2 })
  }

  let x = PAD
  layers.forEach(({ layer, groups }, li) => {
    const w = widths[li] ?? MIN_W
    let y = TOP + (inner - (extent[li] ?? 0)) / 2
    parts.push(`<text class="head" x="${x}" y="20" font-size="12" font-weight="600" fill="#758ca4">${esc(cut(layer.name.toUpperCase(), Math.floor(w / 7.6)))}</text>`)
    if (groups) {
      for (const [g, ns] of groups) {
        const h = HEAD + ns.length * (HG + GAP_G) - GAP_G + 2 * INSET
        parts.push(
          `<rect class="group" x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#eef1f4" stroke="#c9d2db" stroke-width="1"/>`,
          `<text class="ghead" x="${x + INSET + 2}" y="${y + INSET + 11}" font-size="11" font-weight="600" fill="#556b82">${esc(g)} (${ns.length})</text>`,
        )
        ns.forEach((n, ni) => box(x + INSET, y + INSET + HEAD + ni * (HG + GAP_G), w - 2 * INSET, HG, n, false))
        for (const n of ns) block.set(n.name, { left: x, mid: y + h / 2 })
        y += h + GROUP_GAP
      }
    } else {
      layer.nodes.forEach((n, ni) => box(x, y + ni * (H + GAP_Y), w, H, n, li === 0))
    }
    x += w + GAP_X
  })

  // One connection per source and block where the target sits in a block, otherwise one per connection.
  const drawn = new Set<string>()
  const lines = d.edges
    .map(e => {
      const a = anchor.get(e.from), grouped = block.get(e.to), b = grouped ?? anchor.get(e.to)
      if (!a || !b) return ''
      const key = `${e.from}\u0000${grouped ? `${b.left}:${b.mid}` : e.to}`
      if (drawn.has(key)) return ''
      drawn.add(key)
      const x1 = a.right, y1 = a.mid, x2 = b.left, y2 = b.mid, mx = (x1 + x2) / 2
      return `<path class="edge" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 6} ${y2}" fill="none" stroke="#758ca4" stroke-width="1.2" marker-end="url(#arrow)"/>`
    })
    .join('')

  const dark = '.bg{fill:#1d232a}.box{fill:#28313a;stroke:#05a4a0}.box1{fill:#28313a;stroke:#4db1ff}.name{fill:#eaecee}.detail,.head,.ghead{fill:#a9b4be}.group{fill:#222a32;stroke:#3a4652}.edge{stroke:#758ca4}.arrow{fill:#758ca4}'
  const style = scheme === 'light' ? '' : `<style>${scheme === 'dark' ? dark : `@media (prefers-color-scheme: dark){${dark}}`}</style>`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter, Segoe UI, Arial, sans-serif">` +
    style +
    `<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="arrow" d="M0 0 L8 4 L0 8 z" fill="#758ca4"/></marker></defs>` +
    `<rect class="bg" width="${width}" height="${height}" rx="10" fill="#f5f6f7"/>${lines}${parts.join('')}</svg>`
  return { source, width, height }
}

/** What the diagram shows, for a reader that cannot see it: layers, their blocks and nodes, and the findings. */
function diagramAlt(d: DiagramTile): string {
  const layers = d.layers.map((l, li) => {
    const groups = li > 0 ? groupsOf(l.nodes, d.edges) : null
    const content = groups ? [...groups].map(([g, ns]) => `${g}: ${ns.map(n => n.name).join(', ')}`).join('; ') : l.nodes.map(n => n.name).join(', ')
    return `${l.name}: ${content}`
  })
  const findings = d.findings.length ? `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}` : 'No findings'
  return `Architecture diagram ${d.title}. ${layers.join('. ')}. ${findings}.`
}

// --- Target and sign-in -----------------------------------------------------

/**
 * The picker labels come from the list of targets, which only the landscape query sends. When an
 * answer names the active target with other names (a landscape was renamed in the portal), the
 * active entry of the list follows, so that the band does not keep showing the old name.
 */
function withActive(targets: Target[] | undefined, t: Pick<ActiveTarget, 'organization' | 'landscape' | 'system'>): Target[] | undefined {
  if (!targets?.length) return targets
  const i = targets.findIndex(x => x.active)
  if (i < 0) return targets
  const a = targets[i]!
  if (a.organization === t.organization && a.landscape === t.landscape && a.system === t.system) return targets
  return targets.map((x, k) => (k === i ? { ...x, organization: t.organization, landscape: t.landscape, system: t.system } : x))
}

async function remember($: EngineInterface, result: unknown) {
  const zone = fieldOf(result, 'timeZone')
  if (typeof zone === 'string' && zone) personZone = zone
  const found = fieldOf(result, 'activeTarget') as ActiveTarget | null | undefined
  if (found === undefined) {
    // An SAP tool's answer names the target in its last line: enough for the band, without a call.
    const m = TARGET_LINE.exec(textOf(result))
    if (!m) return
    const [, organization = '', landscape = '', system = '', kind = 'other'] = m
    const at = await $.clock.now()
    await update($, target, (prev): TargetState => {
      const before = prev.status === 'known' ? prev : undefined
      const same = before?.target && before.target.organization === organization && before.target.landscape === landscape && before.target.system === system
      // The line comes only with an answer that went through: the person is admitted there.
      if (same && before?.target) return before.target.right === 'none' || !before.target.signedIn ? { ...before, target: { ...before.target, right: 'user', signedIn: true } } : before
      return { status: 'known', target: { organization, landscape, system, kind: kind as ActiveTarget['kind'], region: '', subaccountId: null, signedIn: true, right: 'user' }, account: before?.account, targets: withActive(before?.targets, { organization, landscape, system }), at }
    })
    await keep($)
    return
  }
  const signedInAs = fieldOf(result, 'signedInAs') as string | undefined
  const organizations = fieldOf(result, 'organizations') as Array<{ name: string; role: 'admin' | 'user' }> | undefined
  if (signedInAs) await update($, account, (): AccountState => ({ status: 'signedIn', email: signedInAs, organizations: organizations ?? [] }))
  const targets = fieldOf(result, 'targets') as Target[] | undefined
  const at = await $.clock.now()
  await update($, target, (prev): TargetState => {
    const before = prev.status === 'known' ? prev : undefined
    return { status: 'known', target: found, account: signedInAs ?? before?.account, targets: targets ?? (found ? withActive(before?.targets, found) : before?.targets), at }
  })
  await keep($)
}

/** The target outlives the session (it lives per person on the server anyway): the band stands at once. */
async function keep($: EngineInterface) {
  const now = await read($, target)
  if (now.status === 'known') await $.store.set(STORE_KEY, now).catch(() => {})
}

async function serverOf($: EngineInterface): Promise<string | null> {
  const known = await read($, server)
  if (known) return known
  const connected = await $.mcp.connect('tenantree')
  if (!connected.isConnected) {
    // The server asks for a sign-in: the band offers it (TEPLU-12).
    if (connected.reason === 'auth') await update($, account, (): AccountState => ({ status: 'signedOut' }))
    return null
  }
  await update($, server, () => connected.server)
  return connected.server
}

/** Reads the target (read-only tools; at session start and when the person comes back). */
async function refresh($: EngineInterface) {
  const name = await serverOf($)
  if (!name) return
  const profile = await $.mcp.call(name, 'tenantree_profile_read', {})
  if (profile.isError && NEEDS_SIGNIN.test(textOf(profile))) return signedOut($)
  if (!profile.isError) await remember($, profile)
  const landscapes = await $.mcp.call(name, 'tenantree_landscape_query', {})
  if (!landscapes.isError) await remember($, landscapes)
}

/** A call the person asked for with a button: the press goes along as their request. */
async function pressed($: EngineInterface, tool: string, args: Record<string, unknown>, what: string, consent?: string) {
  const r = (await $.tool.call({ tool: `${PREFIX}${tool}`, ...args, consent: consent ?? `The user pressed "${what}" in the tenantree band.` } as never)) as unknown
  if (r && typeof r === 'object' && 'deny' in r) throw new Error(String((r as { deny: unknown }).deny))
  return r as { text?: string; isError?: boolean; result?: unknown }
}

/**
 * THE TILE FOLLOWS ITS PLAN BY ITSELF (operator, 16.10.2026): while a plan is open, the tile asks every
 * few seconds whether it was decided -- on the approval page, in another tile, or not at all. The read
 * tool is marked read-only, so auto mode lets it through without a request of the person.
 */
let ticking: { cancel: () => void } | null = null
let lastTick = 0
const POLL_MS = 5000

async function check($: EngineInterface, id: string) {
  const tile = (await read($, tiles))[id]
  if (!tile || tile.status !== 'open') return
  const name = await serverOf($)
  if (!name) return
  const r = await $.mcp.call(name, 'tenantree_plan_read', { planId: tile.planId })
  if (r.isError) return
  const status = String(fieldOf(r, 'status') ?? '')
  if (status === 'open' || !status) return
  const get = <T,>(k: string) => fieldOf(r, k) as T | undefined
  await update($, tiles, all => ({
    ...all,
    [id]: {
      ...tile,
      code: undefined,
      status: (status === 'decided' ? 'decided' : 'closed') as PlanTile['status'],
      decision: get<'approve' | 'reject'>('decision'),
      by: get<string | null>('by'),
      ok: get<boolean>('ok'),
      at: get<number>('at'),
      first: get<string>('first'),
    },
  }))
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  lastTick = now
  const open = Object.entries(await read($, tiles)).filter(([, p]) => p.status === 'open' && now <= p.expiresAt + POLL_MS)
  if (!open.length) {
    ticking?.cancel()
    ticking = null
    return
  }
  for (const [id] of open) await check($, id).catch(() => {})
}

async function follow($: EngineInterface) {
  // A refused period ends an interval: a timer that has not ticked for two periods is started anew.
  const now = await $.clock.now()
  if (ticking && now - lastTick < 2 * POLL_MS) return
  ticking?.cancel()
  lastTick = now
  ticking = $.clock.every(POLL_MS, () => void tick($).catch(() => {}))
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

/**
 * THE PERSON SIGNS OUT IN THE PORTAL (TEPLU-12, TEN-537, 17.10.2026): the auto mode of Claude Code gives no
 * verdict for a sign-out the plugin calls itself, so Sign out opens the connections of the profile in the
 * portal. The band notices the sign-out with the next answer that asks for a sign-in.
 */
const SIGNOUT_URL = `${PORTAL}/clients/connections`
const NEEDS_SIGNIN = /Sign-in required|\b401\b|Unauthorized|needs? (?:a )?(?:new )?(?:sign-in|authentication)/i

async function signedOut($: EngineInterface) {
  await update($, account, (): AccountState => ({ status: 'signedOut' }))
  await update($, target, (): TargetState => ({ status: 'unknown' }))
  await update($, server, () => null)
  await update($, signin, () => null)
  await $.store.set(STORE_KEY, null).catch(() => {})
}

/** THE PERSON SIGNS IN: Claude Code holds the OAuth sign-in; connecting starts it where the host can. */
async function signIn($: EngineInterface) {
  await update($, message, () => 'Connecting to tenantree …')
  const connected = await $.mcp.connect('tenantree').catch(() => null)
  if (connected?.isConnected) {
    await update($, server, () => connected.server)
    await refresh($).catch(() => {})
  }
  const now = await read($, account)
  await update($, message, () => (now.status === 'signedIn' ? null : SIGNIN_HELP))
}
const SIGNIN_HELP = 'To sign in, run /mcp, select tenantree and choose Authenticate.'

const path = (t: { organization: string; landscape: string; system: string }) => `${t.organization} → ${t.landscape} → ${t.system}`
/**
 * TEN-375 / TEPLU-6: SAP BTP time (UTC) and the person's time zone from the profile (the server
 * names it in its answers), one time when both are equal. Without a known zone, UTC alone.
 */
let personZone: string | null = null
const time = (ms?: number) => {
  if (!ms) return ''
  const hm = (tz: string) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })
  const utc = hm('UTC')
  try {
    const local = personZone ? hm(personZone) : utc
    return local === utc ? `${utc} UTC` : `${utc} UTC (${local} ${personZone})`
  } catch {
    return `${utc} UTC`
  }
}
const normal = (s: string) => s.replace(/\s+/g, ' ').trim()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const last = (await $.store.get(STORE_KEY).catch(() => null)) as TargetState | null
    if (last && last.status === 'known') await update($, target, prev => (prev.status === 'unknown' ? last : prev)).catch(() => {})
    if (Object.values(await read($, tiles).catch(() => ({}))).some(p => p.status === 'open')) await follow($)
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

  // Only the Sign out button signs the connection out (TEN-537): never the model on its own.
  // Signing out is the person's own step in the portal (TEN-537): never the model's.
  on('tool.call', { tool: `${PREFIX}tenantree_session_delete` }, async () => ({
    deny: 'Signing out is done by the person: Sign out in the tenantree band opens the connections in the portal.',
  }))

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
      if (failed && NEEDS_SIGNIN.test(text)) {
        await signedOut($)
        return result
      }
      const at = await $.clock.now()
      if (tool === 'tenantree_landscape_signin') {
        const url = SIGNIN_LINK.exec(text)?.[0]
        const t = await read($, target)
        if (url) await update($, signin, () => ({ url, system: t.status === 'known' && t.target ? t.target.system : null, at }))
      } else if (!failed && !tool.startsWith('tenantree_')) await update($, signin, () => null)
      const id = e.tool_use_id
      // THE DIAGRAM TILE (16.10.2026): the landscape drawn by the plugin after the reply.
      if (tool === 'tenantree_diagram_read' && id && !failed) {
        const d = diagramOf(text)
        if (d.layers.length) {
          await update($, diagrams, all => ({ ...all, [id]: d }))
          await update($, turn, ids => [...ids, id])
        }
      }
      // THE COST TILE (16.10.2026): the assessment as a tile after the reply.
      if (tool === 'tenantree_cost_query' && id && !failed) {
        await update($, costs, all => ({ ...all, [id]: costOf(text) }))
        await update($, turn, ids => [...ids, id])
      }
      const link = tool === 'tenantree_plan_read' ? null : PLAN_LINK.exec(text)
      if (link && link[1] && id) {
        const tile: PlanTile = { ...planOf(text), planId: link[1], url: link[0], expiresAt: at + PLAN_MS, status: 'open' }
        await update($, tiles, all => ({ ...all, [id]: tile }))
        await update($, turn, ids => [...ids, id])
        await follow($)
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
    const acc = await read($, account)
    if (acc.status === 'signedOut') return { text: `Not signed in to tenantree. ${SIGNIN_HELP}` }
    if (state.status === 'unknown') return { text: 'tenantree is not connected in this session. Run /mcp, select the server tenantree and sign in.' }
    const lines = [`Signed in to tenantree as ${state.account ?? 'unknown'}.`]
    if (acc.status === 'signedIn' && acc.organizations.length) lines.push('', 'Organizations:', ...acc.organizations.map(o => `  ${o.name} (${o.role === 'admin' ? 'administrator' : 'user'})`))
    lines.push('', 'Available subaccounts:')
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
    const allCosts = await read($, costs)
    const allDiagrams = await read($, diagrams)
    const shownDiagrams = hit.ids.map(id => [id, allDiagrams[id]] as const).filter((x): x is readonly [string, DiagramTile] => Boolean(x[1]))
    const shown = hit.ids.map(id => [id, all[id]] as const).filter((x): x is readonly [string, PlanTile] => Boolean(x[1]))
    const shownCosts = hit.ids.map(id => [id, allCosts[id]] as const).filter((x): x is readonly [string, CostTile] => Boolean(x[1]))
    if (!shown.length && !shownCosts.length && !shownDiagrams.length) return next(e)
    const reply = await next(e)
    const opened = await read($, expanded)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    const Svg = 'Svg' in els ? els.Svg : null
    const now = await $.clock.now()
    const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const rows = (rs: Row[], width = 22) =>
      rs.map(f => (
        <Box key={f.label}>
          <Box width={width}><Text dimColor>{f.label}</Text></Box>
          <Text>{f.value}</Text>
        </Box>
      ))
    return (
      <Box flexDirection="column" gap={1}>
        {reply}
        {shownDiagrams.map(([id, d]) => {
          const svg = diagramSvg(d)
          return (
            <Box key={id} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} gap={1}>
              <Box justifyContent="space-between">
                <Markdown text={`### ${d.title}`} />
                {d.url ? <Link href={d.url} label="Open in the Tenantree Dashboard" /> : null}
              </Box>
              {Svg ? (
                <Svg source={svg.source} alt={diagramAlt(d)} width={Math.min(svg.width, 1100)} />
              ) : (
                <Markdown text={d.layers.map(l => `**${l.name}**\n${l.nodes.map(n => `- ${n.name}${n.detail[0] ? ` — ${n.detail[0]}` : ''}`).join('\n')}`).join('\n\n')} />
              )}
              {d.findings.length ? <Markdown text={`**Findings**\n${d.findings.map(f => `- ${f}`).join('\n')}`} /> : <Text color="success">No findings.</Text>}
              {d.notes.length ? <Markdown dimColor text={d.notes.map(n => `- ${n}`).join('\n')} /> : null}
            </Box>
          )
        })}
        {shownCosts.map(([id, c]) => (
          <Box key={id} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} gap={1}>
            <Box justifyContent="space-between">
              <Markdown text="### Costs" />
              {c.url ? <Link href={c.url} label="Open in the Tenantree Dashboard" /> : null}
            </Box>
            {c.risks.length ? (
              c.risks.map(r => {
                const [head, ...rest] = r.split(': ')
                const days = /(\d+) days remaining/.exec(r)?.[1]
                const ends = /ends on approximately (\d{4}-\d{2}-\d{2})/.exec(r)?.[1]
                return (
                  <Box key={r} flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
                    <Box justifyContent="space-between">
                      <Text color="warning" bold>◆ Cost risk · {rest.length ? head : 'Account'}</Text>
                      {days ? <Text color="warning" bold>{days} days left{ends ? ` · until ${ends}` : ''}</Text> : null}
                    </Box>
                    <Text>{rest.length ? rest.join(': ') : r}</Text>
                  </Box>
                )
              })
            ) : (
              <Text color="success">◆ No cost risk found.</Text>
            )}
            {c.sections.map(sec => (
              <Box key={sec.name} flexDirection="column">
                <Markdown text={`#### ${sec.name}`} />
                {sec.rows.length ? <Markdown text={`| Item | Value |\n|:--|:--|\n${sec.rows.map(r => `| ${cell(r.label)} | ${cell(r.value)} |`).join('\n')}`} /> : null}
                {sec.lines.map(l => <Markdown key={l} dimColor text={l} />)}
              </Box>
            ))}
            {c.unchecked.length ? (
              <Box flexDirection="column">
                <Markdown text="#### Not checked" />
                <Markdown dimColor text={c.unchecked.map(u => `- ${u}`).join('\n')} />
              </Box>
            ) : null}
          </Box>
        ))}
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
    const acc = await read($, account)
    if (state.status === 'unknown' && !open.length && !signinOpen && acc.status !== 'signedOut') return next(e)
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
    // The mark always opens the Tenantree Dashboard of the chosen subaccount (operator, 17.10.2026); the server's
    // address when it names one, else built from the chosen entry of the picker, else the portal.
    const dashboard = t?.dashboardUrl ?? (active ? `${PORTAL}/t/${active.id}/dashboard/` : `${PORTAL}/`)
    const email = acc.status === 'signedIn' ? acc.email : state.status === 'known' ? state.account ?? null : null
    return (
      <Box flexDirection="column">
        {/* TEPLU-12 (operator, 16.10.2026): the account above, the picker below it, the mark on the right. */}
        <Box justifyContent="space-between" alignItems="center">
          <Box alignItems="center" gap={1}>
            {acc.status === 'signedOut' ? (
              <>
                <Text color="warning">◆ Not signed in to tenantree</Text>
                <Button key="signin-tenantree" label="Sign in" variant="primary" onPress={() => void signIn($)} />
              </>
            ) : email ? (
              // Two lines (operator, 17.10.2026): the label with Sign out right-aligned above the e-mail.
              <Box flexDirection="column">
                <Box justifyContent="space-between" alignItems="center" gap={2}>
                  <Text dimColor>Signed in as</Text>
                  <Link href={SIGNOUT_URL} label="Sign out" />
                </Box>
                <Text>{email}</Text>
              </Box>
            ) : (
              <Text dimColor>Reading the account …</Text>
            )}
          </Box>
          <Box alignItems="center" gap={1} backgroundColor="#2b3036" borderStyle="round" borderColor="#4a5058" paddingX={1}>
            {Svg ? <Svg source={MARK} alt="tenantree" width={16} height={16} /> : null}
            {/* The mark opens the Tenantree Dashboard of the subaccount in the browser (operator, 16.10.2026). */}
            <Link href={dashboard} label="tenantree" />
          </Box>
        </Box>
        {acc.status === 'signedOut' ? null : (
          <Box alignItems="center" gap={1} marginTop={1}>
            {isProduction ? <Text color="error" bold>● Production</Text> : null}
            {picker}
            {note ? <Text dimColor>{note}</Text> : null}
          </Box>
        )}
        {acc.status === 'signedOut' && note ? <Text dimColor>{note}</Text> : null}
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
