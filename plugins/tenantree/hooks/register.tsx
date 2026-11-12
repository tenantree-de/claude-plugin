import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AccountState, ActiveTarget, Attached, BandState, CostSection, CostTile, DiagramTile, PlanTile, Row, Target, TargetState } from '../types'

/**
 * tenantree in Claude Code (operator, 15./16.10.2026):
 *
 * THE BAND above the prompt shows landscape -> global account -> subaccount of the active target, a
 * picker to switch it, the sign-in at the IAS and the open approvals; the tenantree mark sits on
 * the right.
 *
 * THE TILES come AFTER the reply, never in the middle of it -- IN THE TERMINAL ONLY. Since about
 * 21.10.2026 the Claude desktop app (and VS Code) draws the MCP Apps views of a plugin's server again,
 * inline at the tool call (observed 21.10.2026 for tenantree_cost_query and a plan preview, Claude
 * Code 2.1.296; not documented by Anthropic). There the original views are shown and the mod draws
 * nothing twice. The terminal cannot draw them, so there the mod keeps drawing its tiles.
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
const signin = atom({ plugin: 'tenantree', key: 'signin' } as const, null as { url: string; subaccount: string | null; at: number } | null)
// After signing out (17.10.2026): the one-time link that ends the IAS session in the browser.
const logout = atom({ plugin: 'tenantree', key: 'logout' } as const, null as { url: string; at: number } | null)
const LOGOUT_LINK = /https:\/\/[^\s)]+\/sso\/signout\/[A-Za-z0-9_-]+/
/** TEPLU-12: the tenantree account of this connection; signedOut after Sign out or when the server asks for a sign-in. */
const account = atom({ plugin: 'tenantree', key: 'account' } as const, { status: 'unknown' } as AccountState)

/**
 * TEPLU-17 (operator, 12.11.2026): the band appears only in projects where tenantree was used, and the person may
 * fold it to a small badge. Both are kept per project (the session's project root) across restarts of Claude Code.
 */
const band = atom({ plugin: 'tenantree', key: 'band' } as const, null as BandState | null)
const BAND_KEY = 'band:'

const PREFIX = 'mcp__plugin_tenantree_BTP-Connector__'
const PORTAL = 'https://portal.tenantree.de'
const TENANTREE_TOOL = /^mcp__plugin_tenantree_BTP-Connector__([a-z0-9_]+)$/
const PLAN_LINK = /https:\/\/[^\s"<>\\]+\/plan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
const SIGNIN_LINK = /https:\/\/[^\s"<>\\]+\/sso\/start\/[A-Za-z0-9_-]+/
const SIGNIN_MS = 10 * 60 * 1000
/** The last line of every tenantree answer names the active target (server, 16.10.2026). */
const TARGET_LINE = /tenantree target: (.+?) → (.+?) → (.+?) \((production|quality|development|other)\)\s*$/m
const STORE_KEY = 'lastTarget'
const PLAN_MS = 15 * 60 * 1000
const KIND: Record<ActiveTarget['kind'], string> = { production: 'Production', quality: 'Quality', development: 'Development', other: 'Other' }
// TEN-729: the write levels as people read them; the keys stay the internal values of the server.
const LEVEL: Record<string, string> = { structure: 'Subaccount: structure (no endpoints)', landscape: 'Subaccount: endpoints', account: 'Global Account' }
// The tenantree mark (Logo E). The stem is white for dark surfaces; under a light appearance the embedded
// <style> draws it in the navy of the light logo (as diagramSvg does: an SVG drawn as an image evaluates
// prefers-color-scheme against the app's appearance). Should a surface drop the <style>, the mark is as before.
const MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-84 -38 780 780"><style>@media (prefers-color-scheme: light){.stem{fill:#00203A}}</style><g transform="matrix(1.05 0 0 1.05 -0.7 -36)"><path fill="#05A4A0" d="M320 470 Q300 214 556 190 Q576 446 320 470Z"/><rect class="stem" fill="#FFFFFF" x="224" y="80" width="137" height="640"/><rect fill="#0078CF" x="14" y="20" width="556" height="125"/></g></svg>'
// The band's icon buttons (fold, unfold, refresh) share one slot: a column of this many cells that stretches its
// Button, so each is as wide as the others whatever its glyph. On the terminal `[ x ]` is exactly these cells.
const CONTROL = 5
const MARK_PX = 18

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
const FOR_THE_MODEL = /^(Repeat the same call|APPROVAL REQUIRED|On this installation|Approval page|Give the person|Do not call again|COST CONFIRMATION)/
// THE COST NOTICE (operator, 21.10.2026): the marker of a plan with costs or unchecked costs, and the head of its statement.
const COST_MARK = /^Cost confirmation required \((paid|unclear)\):/
const COST_HEAD = /^(Cost \(cost calculator\):|Cost:|Cost of |Cost afterwards|Cost while running|Afterwards:|From then on)/
const COST_TEXT = {
  title: 'Cost notice',
  lead: {
    paid: 'This plan can incur costs. Please review the cost assessment before you approve it.',
    unclear: 'The costs of this plan have not been checked. tenantree cannot rule out that costs arise.',
  },
  confirm: 'The approval page asks you to confirm the cost notice before you approve.',
} as const

/** The cost notice of a plan text: its kind (unclear wins) and the statements above its markers. */
function costOfPlan(text: string): PlanTile['cost'] {
  const lines = text.split('\n')
  let kind: 'paid' | 'unclear' | null = null
  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = COST_MARK.exec((lines[i] ?? '').trim())
    if (!m) continue
    kind = kind === 'unclear' || m[1] === 'unclear' ? 'unclear' : 'paid'
    const block: string[] = []
    for (let j = i - 1; j >= 0; j--) {
      const t = (lines[j] ?? '').trim()
      if (!t || /^Plan:/.test(t) || /^Step \d+:/.test(t) || COST_MARK.test(t)) break
      block.unshift(t)
    }
    const head = block.findIndex(l => COST_HEAD.test(l))
    parts.push((head >= 0 ? block.slice(head) : block.filter(l => /EUR|cost/i.test(l))).join('\n'))
  }
  return kind ? { kind, text: parts.filter(Boolean).join('\n\n') } : null
}
const LEFT_OUT = new Set(['Plan', 'Tool', 'Enabled because', 'Summary'])
const STEP = /^Step (\d+): (.*?)(?: \[([^\]]+)\])?$/
const WARNING = /^(WARNING|Warning|TRAP)[:\s]/

/** The plan as its text states it: what the tile shows. */
function planOf(text: string): Omit<PlanTile, 'planId' | 'url' | 'expiresAt' | 'status'> {
  const lines = text.split('\n')
  const facts: Row[] = []
  const values: Row[] = []
  const warnings: string[] = []
  const steps: NonNullable<PlanTile['steps']> = []
  let title = ''
  let level: string | null = null
  let target: string | null = null
  let headline = ''
  let summary = ''
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const t = raw.trim()
    if (!t || FOR_THE_MODEL.test(t) || COST_MARK.test(t)) continue
    if (!headline) {
      headline = t
      continue
    }
    // TEN-744: the plan at a glance, written by the server below the approval link.
    const glance = /^Summary:\s+(.*)$/.exec(raw)
    if (glance) {
      summary = glance[1] ?? ''
      continue
    }
    // A plan sequence (TEN-540): its steps as a short list; the plans of the steps stay in the reply.
    const step = STEP.exec(raw)
    if (step) {
      steps.push({ n: Number(step[1]), title: step[2] ?? '', irreversible: /\birreversible\b/.test(step[3] ?? '') })
      continue
    }
    // Warnings stay visible, every one of them, also those of a step; one may run over several lines (as on the server).
    if (WARNING.test(t)) {
      let w = t.replace(/^(WARNING|Warning|TRAP):?\s*/, '')
      while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() && !FACT.test((lines[i + 1] ?? '').trim()) && !FOR_THE_MODEL.test((lines[i + 1] ?? '').trim()) && !STEP.test(lines[i + 1] ?? '')) w += ` ${(lines[++i] ?? '').trim()}`
      warnings.push(w.replace(/^[a-z]/, c => c.toUpperCase()))
      continue
    }
    // Inside a step's own plan: neither facts nor values of the sequence itself.
    if (steps.length && /^\s/.test(raw)) continue
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
    const fact = FACT.exec(t)
    if (fact && fact[1] && fact[2]) {
      if (fact[1] === 'Tenant') target = fact[2]
      else if (!LEFT_OUT.has(fact[1])) facts.push({ label: fact[1], value: fact[2] })
    }
  }
  return { title: title || 'Plan', level, target, headline, summary, steps, facts, values, warnings, cost: costOfPlan(text) }
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
 * answer names the active target with other names (a global account was renamed in the portal), the
 * active entry of the list follows, so that the band does not keep showing the old name.
 */
function withActive(targets: Target[] | undefined, t: Pick<ActiveTarget, 'landscape' | 'globalAccount' | 'subaccount'>): Target[] | undefined {
  if (!targets?.length) return targets
  const i = targets.findIndex(x => x.active)
  if (i < 0) return targets
  const a = targets[i]!
  if (a.landscape === t.landscape && a.globalAccount === t.globalAccount && a.subaccount === t.subaccount) return targets
  return targets.map((x, k) => (k === i ? { ...x, landscape: t.landscape, globalAccount: t.globalAccount, subaccount: t.subaccount } : x))
}

async function remember($: EngineInterface, result: unknown) {
  const zone = fieldOf(result, 'timeZone')
  if (typeof zone === 'string' && zone) personZone = zone
  const found = fieldOf(result, 'activeTarget') as ActiveTarget | null | undefined
  if (found === undefined) {
    // An SAP tool's answer names the target in its last line: enough for the band, without a call.
    const m = TARGET_LINE.exec(textOf(result))
    if (!m) return
    const [, landscape = '', globalAccount = '', subaccount = '', kind = 'other'] = m
    const at = await $.clock.now()
    await update($, target, (prev): TargetState => {
      const before = prev.status === 'known' ? prev : undefined
      const same = before?.target && before.target.landscape === landscape && before.target.globalAccount === globalAccount && before.target.subaccount === subaccount
      // The line comes only with an answer that went through: the person is admitted there.
      if (same && before?.target) return before.target.right === 'none' || !before.target.signedIn ? { ...before, target: { ...before.target, right: 'user', signedIn: true, signInExpired: false } } : before
      return { status: 'known', target: { landscape, globalAccount, subaccount, kind: kind as ActiveTarget['kind'], region: '', subaccountId: null, signedIn: true, right: 'user' }, account: before?.account, targets: withActive(before?.targets, { landscape, globalAccount, subaccount }), at }
    })
    await update($, message, m => (m && !m.endsWith('…') ? null : m))
    await update($, signin, () => null)
    await keep($)
    return
  }
  const signedInAs = fieldOf(result, 'signedInAs') as string | undefined
  const landscapes = fieldOf(result, 'landscapes') as Array<{ name: string; role: 'admin' | 'user' }> | undefined
  if (signedInAs) {
    await update($, account, (): AccountState => ({ status: 'signedIn', email: signedInAs, landscapes: landscapes ?? [] }))
    await update($, logout, () => null)
    // Signed in (again): a sign-in hint in the band is out of date (operator, 17.10.2026).
    await update($, message, m => (m && SIGNIN_NOTES.some(n => m.startsWith(n)) ? null : m))
  }
  // NOTICES LEAVE WHEN THINGS WORKED (operator, 17.10.2026): an answer that went through clears the band's error
  // or hint line (progress lines ending in '…' stay until their action ends); signed in at the IAS of the active
  // target clears the pending IAS sign-in.
  await update($, message, m => (m && !m.endsWith('…') ? null : m))
  if (found?.signedIn) await update($, signin, () => null)
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
  // TEPLU-18: a name cached before the server key changed to "BTP-Connector" (from "tenantree", then "landscape") is not reused.
  if (known && known.endsWith(':BTP-Connector')) return known
  const connected = await $.mcp.connect('BTP-Connector')
  if (!connected.isConnected) {
    // The server asks for a sign-in: the band offers it (TEPLU-12).
    if (connected.reason === 'auth') {
      await update($, account, (): AccountState => ({ status: 'signedOut' }))
      void watchSignIn($)
    }
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

/** Reads the list of subaccounts for the picker (read-only), at most every 30 seconds. */
let lastTargets = 0
async function loadTargets($: EngineInterface) {
  const now = await $.clock.now()
  if (now - lastTargets < 30_000) return
  lastTargets = now
  const name = await serverOf($)
  if (!name) return
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
const APPROVED_PROMPT = 'freigegeben'

/**
 * TEPLU-14 (operator, 11.11.2026): the refresh button of the band reads everything again at once -- account and
 * active target, the list of subaccounts and the state of every open plan -- instead of waiting for the next poll.
 */
async function refreshAll($: EngineInterface) {
  await update($, message, () => 'Updating …')
  try {
    lastTargets = 0
    await refresh($)
    await loadTargets($)
    for (const [id, p] of Object.entries(await read($, tiles))) if (p.status === 'open' || p.status === 'running') await check($, id).catch(() => {})
    await update($, message, () => null)
  } catch (err) {
    await update($, message, () => (blockedByAuto(err) ? AUTO_BLOCKED : 'The status could not be updated.'))
  }
}

/** TEPLU-16: while a sign-in link is open, the subaccount list is read every 5 seconds until the sign-in arrives. */
let signinTimer: { cancel: () => void } | null = null
let lastSigninTick = 0
async function signinTick($: EngineInterface) {
  const now = await $.clock.now()
  lastSigninTick = now
  const pending = await read($, signin)
  const t = await read($, target)
  const done = t.status === 'known' && Boolean(t.target?.signedIn) && (!pending?.subaccount || t.target?.subaccount === pending.subaccount)
  if (!pending || done || now - pending.at >= SIGNIN_MS) {
    if (pending && done) await update($, signin, () => null)
    signinTimer?.cancel()
    signinTimer = null
    return
  }
  lastTargets = 0
  await loadTargets($)
}
async function followSignin($: EngineInterface) {
  const now = await $.clock.now()
  if (signinTimer && now - lastSigninTick < 2 * POLL_MS) return
  signinTimer?.cancel()
  lastSigninTick = now
  signinTimer = $.clock.every(POLL_MS, () => void signinTick($).catch(() => {}))
}

let ticking: { cancel: () => void } | null = null
// TEN-742 (review 11.11.2026): plans the agent already waits on with tenantree_plan_wait. The agent continues by itself
// once the plan is decided, so the prompt box proposes nothing for them.
const waitedOn = new Set<string>()
// TEN-742: a tile is followed while its plan is open, and after the approval while it is being carried out.
const RUNNING_MS = 2 * 60 * 60 * 1000
const followed = (p: PlanTile, now: number) => (p.status === 'open' && now <= p.expiresAt + POLL_MS) || (p.status === 'running' && now <= p.expiresAt + RUNNING_MS)
let lastTick = 0
const POLL_MS = 5000

async function check($: EngineInterface, id: string) {
  const tile = (await read($, tiles))[id]
  if (!tile || (tile.status !== 'open' && tile.status !== 'running')) return
  const name = await serverOf($)
  if (!name) return
  const r = await $.mcp.call(name, 'tenantree_plan_read', { planId: tile.planId })
  if (r.isError) return
  const get = <T,>(k: string) => fieldOf(r, k) as T | undefined
  // TEN-742: the server names the state (open, running, approved, rejected, expired, superseded, unknown); a server
  // before TEN-742 only says open, decided or closed.
  const legacy = String(fieldOf(r, 'status') ?? '')
  const state = String(get<string>('state') ?? (legacy === 'decided' ? (get<string>('decision') === 'approve' ? 'approved' : 'rejected') : legacy))
  if (state === 'open' || !state) return
  const next: PlanTile['status'] =
    state === 'running' ? 'running' : state === 'approved' || state === 'rejected' ? 'decided' : state === 'expired' || state === 'superseded' || state === 'interrupted' ? state : 'closed'
  const sequence = get<{ status: string; done: number; total: number }>('sequence') ?? null
  // TEN-793: the step being carried out, as one line ("Step 2 of 3: ..."); a server before TEN-793 sends none.
  const progress = next === 'running' ? (get<{ line?: string }>('progress')?.line ?? null) : null
  if (next === tile.status && next === 'running' && sequence?.done === tile.sequence?.done && sequence?.status === tile.sequence?.status && progress === (tile.progress ?? null)) return
  // TEPLU-15 (operator, 11.11.2026): when the only open plan is approved, "freigegeben" is proposed as the dim
  // suggestion of the prompt box, so Tab and Enter tell the agent to continue. With several open plans it would
  // be unclear which one was approved: no suggestion. The engine shows none while the box holds text.
  // Once per plan: on the step from open to approved (TEN-742: also when it is still being carried out).
  const now = await $.clock.now()
  const othersOpen = Object.entries(await read($, tiles)).some(([k, p]) => k !== id && p.status === 'open' && now <= p.expiresAt)
  const approvedNow = tile.status === 'open' && (state === 'running' || state === 'approved')
  if (approvedNow && !othersOpen && !waitedOn.has(tile.planId)) void $.prompt.suggest({ text: APPROVED_PROMPT }).catch(() => {})
  await update($, tiles, all => ({
    ...all,
    [id]: {
      ...tile,
      status: next,
      decision: get<'approve' | 'reject'>('decision') ?? (state === 'running' ? 'approve' : undefined),
      by: get<string | null>('by'),
      ok: get<boolean>('ok'),
      at: get<number>('at'),
      first: get<string>('first'),
      sequence,
      progress,
    },
  }))
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  lastTick = now
  const open = Object.entries(await read($, tiles)).filter(([, p]) => followed(p, now))
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

/*
 * NO DECISIONS IN THE TILE (TEN-621, 23.10.2026): the tile decided with the approval code from _meta
 * "claude/plugins". tenantree no longer hands that code to any client -- the plugin calls through the same
 * connection as the model, so the server cannot tell its press from a call of the model. The tile shows the
 * plan and opens the approval page, where the person signs in and decides.
 */

/**
 * THE PERSON SIGNS OUT IN THE PORTAL (TEPLU-12, TEN-537, 17.10.2026): the auto mode of Claude Code gives no
 * verdict for a sign-out the plugin calls itself, so Sign out opens the connections of the profile in the
 * portal. The band notices the sign-out with the next answer that asks for a sign-in.
 */
const NEEDS_SIGNIN = /Sign-in required|\b401\b|Unauthorized|needs? (?:a )?(?:new )?(?:sign-in|authentication)/i

/**
 * SIGN OUT AS THE PERSON'S OWN REQUEST (operator, 17.10.2026). The button and "/tenantree signout" put
 * "Sign me out of tenantree." into the prompt box; the person sends it with Enter, and Claude signs the
 * connection out because the person asked for it. The guard lets the model's call through only after the
 * person themselves sent such a request.
 */
let signOutRequestedAt = 0
const SIGNOUT_WINDOW_MS = 3 * 60 * 1000
/** A button's call that Claude Code's Auto permission mode refused (operator, 17.10.2026): the band says so. */
const AUTO_BLOCKED = 'The Auto permission mode blocks this action. Please switch the permission mode and press the button again.'
const blockedByAuto = (err: unknown) => /auto mode|classifier|no verdict|permission/i.test(String((err as Error)?.message ?? err))

const LOGIN_CONTEXT =
  'The person wrote "tenantree login". 1) Call tenantree_landscape_query. 2) If there is no active target and exactly one subaccount is listed, set it with tenantree_landscape_use (the person agreed to this for the single-system case); if several are listed, ask which one. 3) If the person is not signed in at the IAS of the active target, call tenantree_landscape_signin and give the link. Answer briefly: account, active target, IAS sign-in state. If the tenantree tools are not available, tell the person to run /mcp, select plugin:tenantree:BTP-Connector and choose Authenticate, then to write "tenantree login" again.'
const SIGNOUT_PROMPT = 'Sign me out of tenantree.'
// German as well (TEPLU-13): \"Melde mich bei tenantree ab\", \"Bei tenantree abmelden\", \"tenantree abmelden\".
const ASKS_SIGNOUT = /\bsign (?:me )?out\b.*\btenantree\b|\btenantree\b.*\bsign (?:me )?out\b|\bmelde?\b.*\btenantree\b.*\bab\b|\babmelden\b.*\btenantree\b|\btenantree\b.*\babmelden\b/i

async function signOut($: EngineInterface) {
  await update($, message, () => 'Signing out …')
  signOutRequestedAt = await $.clock.now()
  try {
    const r = await pressed($, 'tenantree_session_delete', {}, 'Sign out', 'The user pressed the "Sign out" button in the tenantree band and asks to sign this connection out of tenantree.')
    if (r.isError) throw new Error(r.text ?? textOf(r))
    await signedOut($)
    await showLogout($, r.text ?? textOf(r))
    await update($, message, () => null)
  } catch (err) {
    signOutRequestedAt = 0
    await update($, message, () => (blockedByAuto(err) ? AUTO_BLOCKED : 'The sign-out was not carried out.'))
  }
}

/**
 * THE BAND FOLLOWS THE SIGN-IN BY ITSELF (operator, 17.10.2026): while signed out, the plugin asks Claude Code
 * every 5 seconds whether the tenantree connection is back (no tool call); once it is, it reads the profile.
 */
let watching: { cancel: () => void } | null = null
let lastWatch = 0
const WATCH_MS = 5000

/**
 * THE CONNECTION STAYS (operator, 17.10.2026): Claude Code drops an MCP server whose connection broke (for
 * example while tenantree is redeployed) and does not dial it again by itself. The plugin dials it on a timer;
 * when it comes back, or the person signed in meanwhile, the band reads the state again. Connecting calls no tool.
 */
let wasConnected = true
async function checkSignIn($: EngineInterface) {
  lastWatch = await $.clock.now()
  const c = await $.mcp.connect('BTP-Connector').catch(() => null)
  const before = wasConnected
  wasConnected = Boolean(c?.isConnected)
  if (!c?.isConnected) return
  if (!before || (await read($, account)).status !== 'signedIn') {
    await update($, server, () => c.server)
    await refresh($).catch(() => {})
  }
}

/**
 * Started whenever the band shows "Not signed in" (also after a reload of the plugin, which ends timers), and
 * started anew when Claude Code let a period pass without a tick.
 */
async function watchSignIn($: EngineInterface) {
  const now = await $.clock.now()
  if (watching && now - lastWatch < 2 * WATCH_MS) return
  watching?.cancel()
  lastWatch = now
  watching = $.clock.every(WATCH_MS, () => void checkSignIn($).catch(() => {}))
}

async function showLogout($: EngineInterface, text: string) {
  const url = LOGOUT_LINK.exec(text)?.[0]
  const at = await $.clock.now()
  await update($, logout, () => (url ? { url, at } : null))
}

async function signedOut($: EngineInterface) {
  void watchSignIn($)
  await update($, account, (): AccountState => ({ status: 'signedOut' }))
  await update($, target, (): TargetState => ({ status: 'unknown' }))
  await update($, server, () => null)
  await update($, signin, () => null)
  await $.store.set(STORE_KEY, null).catch(() => {})
}

/** THE PERSON SIGNS IN: Claude Code holds the OAuth sign-in; connecting starts it where the host can. */
async function signIn($: EngineInterface) {
  await update($, message, () => 'Connecting to tenantree …')
  const connected = await $.mcp.connect('BTP-Connector').catch(() => null)
  if (connected?.isConnected) {
    await update($, server, () => connected.server)
    await refresh($).catch(() => {})
  }
  const now = await read($, account)
  if (now.status === 'signedIn') return update($, message, () => null)
  // Claude Code starts the OAuth sign-in only from /mcp (measured 17.10.2026): the band puts the command into
  // the prompt box, so one Enter opens it. The person keeps the choice; nothing is sent by itself.
  const filled = await $.prompt.fill({ text: '/mcp' }).catch(() => null)
  await update($, message, () => (filled?.isFilled ? SIGNIN_READY : SIGNIN_HELP))
}
const SIGNIN_NOTES = ['/mcp is in the prompt box', 'To sign in,', 'Connecting to tenantree']
const SIGNIN_READY = '/mcp is in the prompt box: press Enter, select plugin:tenantree:BTP-Connector and choose Authenticate. Afterwards write: tenantree login'
let lastStatus = 0
const STATUS_MS = 30_000
const SIGNIN_HELP = 'To sign in, run /mcp, select plugin:tenantree:BTP-Connector and choose Authenticate. Afterwards write: tenantree login'

const path = (t: { landscape: string; globalAccount: string; subaccount: string }) => `${t.landscape} → ${t.globalAccount} → ${t.subaccount}`
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

/**
 * TEPLU-17: the band of the session's project. With `keep`, a project not held yet is read from the store into the
 * session's state; without it (while drawing, which never writes) it is only read.
 */
async function bandOf($: EngineInterface, keep = true): Promise<BandState> {
  const project = await $.session.root().catch(() => '')
  const known = await read($, band)
  if (known && known.project === project) return known
  const kept = (await $.store.get(BAND_KEY + project).catch(() => undefined)) as Partial<BandState> | undefined
  const loaded: BandState = { project, used: kept?.used === true, collapsed: kept?.collapsed === true }
  if (!keep) return loaded
  await update($, band, prev => (prev && prev.project === project ? prev : loaded))
  return (await read($, band)) ?? loaded
}

/** TEPLU-17: changes the band of the session's project and keeps it for the next start. */
async function setBand($: EngineInterface, change: Partial<Omit<BandState, 'project'>>) {
  const now = await bandOf($)
  if (Object.entries(change).every(([k, v]) => now[k as keyof BandState] === v)) return
  const next: BandState = { ...now, ...change }
  await update($, band, () => next)
  await $.store.set(BAND_KEY + next.project, { used: next.used, collapsed: next.collapsed }).catch(() => {})
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await bandOf($).catch(() => {})
    const last = (await $.store.get(STORE_KEY).catch(() => null)) as TargetState | null
    if (last && last.status === 'known') await update($, target, prev => (prev.status === 'unknown' ? last : prev)).catch(() => {})
    if (Object.values(await read($, tiles).catch(() => ({}))).some(p => p.status === 'open' || p.status === 'running')) await follow($)
    await $.command.register({ name: 'tenantree', description: 'tenantree: show the band and the account, sign in or sign out', argumentHint: '[signin | signout]' })
    void refresh($).catch(() => {})
    void watchSignIn($).catch(() => {})
    return result
  })

  // THE STATUS ON EVERY INPUT (operator, 17.10.2026): one read-only call tells whether this connection is
  // signed in and as whom; the band offers Sign out or Sign in accordingly. At most every 30 seconds.
  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => []).catch(() => {})
    // Only a message the person sent themselves counts as a sign-out request.
    const origin = (e as { origin?: { kind?: string } }).origin?.kind
    const said = String((e as { text?: unknown }).text ?? '').trim()
    if (origin !== 'plugin' && (ASKS_SIGNOUT.test(said) || /^tenantree\s+log\s?out\.?$/i.test(said))) signOutRequestedAt = await $.clock.now()
    // "tenantree login" (operator, 17.10.2026): one read-only call that connects tenantree and fills the band.
    if (origin !== 'plugin' && /^tenantree\s+log\s?in\.?$/i.test(said)) {
      return next({ ...e, context: [...((e as { context?: readonly string[] }).context ?? []), LOGIN_CONTEXT] } as typeof e)
    }
    const at = await $.clock.now()
    if (at - lastStatus > STATUS_MS) {
      lastStatus = at
      void refresh($).catch(() => {})
    }
    return next(e)
  })

  // Only the Sign out button signs the connection out (TEN-537): never the model on its own.
  // Signing out is the person's own step in the portal (TEN-537): never the model's.
  on('tool.call', { tool: `${PREFIX}tenantree_session_delete` }, async ($, e, next) => {
    const at = await $.clock.now()
    if (at - signOutRequestedAt > SIGNOUT_WINDOW_MS) return { deny: 'Sign out only when the person has asked for it in their own message.' }
    signOutRequestedAt = 0
    const result = await next(e)
    const failed = Boolean((result as { isError?: boolean } | null)?.isError) || 'deny' in (result as object)
    if (!failed) {
      await signedOut($)
      await showLogout($, textOf(result))
    }
    await update($, message, () => (failed ? 'The sign-out was not carried out.' : null))
    return result
  })

  on('tool.call', async ($, e, next) => {
    const m = typeof e.tool === 'string' ? TENANTREE_TOOL.exec(e.tool) : null
    const tool = m?.[1]
    // Noted before the call: tenantree_plan_wait blocks while the person decides, and the tile may see the decision first.
    const waitFor = tool === 'tenantree_plan_wait' ? (e as { planId?: unknown }).planId : undefined
    if (typeof waitFor === 'string') waitedOn.add(waitFor)
    const result = await next(e)
    if (!tool) return result
    // The band and the tiles must never disturb the tool call itself.
    try {
      // TEPLU-17: a tenantree tool called in this project shows the band here from now on.
      await setBand($, { used: true }).catch(() => {})
      await remember($, result)
      const text = textOf(result)
      // A wait that ended with the plan still open: the agent may end its turn, so the proposal applies again.
      if (typeof waitFor === 'string' && /^Plan status: open\b/.test(text)) waitedOn.delete(waitFor)
      const failed = Boolean((result as { isError?: boolean } | null)?.isError)
      if (failed && NEEDS_SIGNIN.test(text)) {
        await signedOut($)
        return result
      }
      if (!failed && (await read($, account)).status === 'signedOut') void refresh($).catch(() => {})
      const at = await $.clock.now()
      if (tool === 'tenantree_landscape_signin') {
        const url = SIGNIN_LINK.exec(text)?.[0]
        const t = await read($, target)
        // A link while already signed in (a renewal) is no pending sign-in for the band.
        const already = t.status === 'known' && t.target?.signedIn
        if (url && !already) await update($, signin, () => ({ url, subaccount: t.status === 'known' && t.target ? t.target.subaccount : null, at }))
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
    if (ids.length && e.answer) {
      const tail = normal(e.answer).slice(-160)
      await update($, attached, list => [...list.slice(-50), { tail, ids }]).catch(() => {})
      await update($, turn, () => []).catch(() => {})
    }
    return next(e)
  })

  on('command.run', { command: 'tenantree' }, async ($, e) => {
    // TEPLU-17: /tenantree shows the band in this project, expanded, whatever the arguments.
    await setBand($, { used: true, collapsed: false }).catch(() => {})
    const verb = String((e as { args?: unknown }).args ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
    if (verb === 'signout' || verb === 'logout') {
      await signOut($)
      return { text: (await read($, message)) ?? '' }
    }
    if (verb === 'signin' || verb === 'login') {
      await signIn($)
      return { text: (await read($, message)) ?? 'Signed in to tenantree.' }
    }
    await refresh($).catch(() => {})
    const state = await read($, target)
    const acc = await read($, account)
    if (acc.status === 'signedOut') return { text: `Not signed in to tenantree. ${SIGNIN_HELP}` }
    if (state.status === 'unknown') return { text: 'tenantree is not connected in this session. Run /mcp, select the server plugin:tenantree:BTP-Connector and sign in.' }
    const lines = [`Signed in to tenantree as ${state.account ?? 'unknown'}.`]
    if (acc.status === 'signedIn' && acc.landscapes.length) lines.push('', 'Landscapes:', ...acc.landscapes.map(o => `  ${o.name} (${o.role === 'admin' ? 'administrator' : 'user'})`))
    lines.push('', 'Available subaccounts:')
    for (const t of state.targets ?? []) lines.push(`${t.active ? '▶' : ' '} ${path(t)} (${KIND[t.kind]})`)
    if (!state.targets?.length) lines.push('  none assigned')
    return { text: lines.join('\n') }
  })

  // THE TILES AFTER THE REPLY (operator, 16.10.2026).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // On every surface (operator, 21.10.2026): tenantree announces no MCP Apps views any more; plan, cost and
    // diagram are shown by this tile alone.
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
              ? `${p.decision !== 'approve' ? 'Rejected' : p.ok === false ? 'Approved, not carried out' : 'Approved and carried out by tenantree'}.${p.by || p.at ? ` Decision${p.by ? ` by ${p.by}` : ''}${p.at ? ` at ${time(p.at)}` : ''}.` : ''} ${p.decision !== 'approve' ? 'Nothing was changed.' : p.ok === false ? 'Carrying out failed; your AI agent reports the reason in the chat.' : 'Your AI agent reports the result in the chat.'}`
              : null
          return (
            <Box key={id} flexDirection="column" borderStyle="round" borderColor={p.status === 'open' && !expired ? 'suggestion' : undefined} paddingX={1}>
              <Box justifyContent="space-between">
                <Text bold>{p.title}</Text>
                {p.level ? <Text dimColor>Write level: {LEVEL[p.level] ?? p.level}</Text> : null}
              </Box>
              {/* TEN-744: the plan at a glance -- result, target and cost in one sentence; plans before TEN-744 name the target. */}
              {p.summary ? <Text>{p.summary}</Text> : p.target ? <Text dimColor>Target: {p.target}</Text> : null}
              {p.cost && (open || p.status === 'checking') ? (
                <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="warning" paddingX={1}>
                  <Text color="warning" bold>{COST_TEXT.title}</Text>
                  <Text>{COST_TEXT.lead[p.cost.kind]}</Text>
                  {p.cost.text ? <Text dimColor>{p.cost.text}</Text> : null}
                  <Text dimColor>{COST_TEXT.confirm}</Text>
                </Box>
              ) : null}
              {/* Warnings are never folded (TEN-744). */}
              {p.warnings.length ? (
                <Box flexDirection="column" marginTop={1}>
                  {p.warnings.map(w => <Text key={w} color="warning">{`Warning: ${w}`}</Text>)}
                </Box>
              ) : null}
              {p.steps?.length ? (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>{`Steps (${p.steps.length}), carried out in this order after one approval:`}</Text>
                  {p.steps.map(s => (
                    <Text key={`step-${s.n}`}>
                      {`${s.n}. ${s.title}`}
                      {s.irreversible ? <Text color="warning"> · Cannot be undone</Text> : null}
                    </Text>
                  ))}
                </Box>
              ) : null}
              {open ? (
                <Box marginTop={1} flexDirection="column">
                  <Text dimColor>Valid until {time(p.expiresAt)}. Nothing is changed until you approve.</Text>
                  <Text dimColor>Plans are approved or rejected only on the approval page in the browser, after your personal sign-in.</Text>
                </Box>
              ) : null}
              {expired ? <Text dimColor>Expired at {time(p.expiresAt)} unless decided before.</Text> : null}
              {decided ? <Text color={p.decision === 'approve' && p.ok !== false ? 'success' : p.ok === false ? 'error' : undefined} bold>{decided}</Text> : null}
              {p.status === 'running' ? (
                <Text color="success" bold>
                  {p.sequence
                    ? `Approved. tenantree is carrying out the plan sequence: ${p.sequence.done} of ${p.sequence.total} steps done.`
                    : p.progress
                      ? `Approved. tenantree is carrying out the plan. ${p.progress} …`
                      : 'Approved. tenantree is carrying out the plan …'}
                </Text>
              ) : null}
              {p.status === 'expired' ? <Text dimColor>This plan expired without a decision. Nothing was changed.</Text> : null}
              {p.status === 'superseded' ? <Text dimColor>This plan was superseded by another plan with the same arguments. Nothing was changed by it.</Text> : null}
              {p.status === 'interrupted' ? <Text color="warning">Approved, but the execution ended without a recorded result. The outcome is unknown; ask your AI agent to check the plan.</Text> : null}
              {p.status === 'closed' ? <Text dimColor>This plan is no longer available.</Text> : null}
              {p.status === 'checking' ? <Text dimColor>Reading the status …</Text> : null}
              {p.status === 'unknown' ? <Text color="error">The status could not be read{p.error ? `: ${p.error}` : '.'}</Text> : null}
              {isOpen ? (
                <Box flexDirection="column" marginTop={1}>
                  {p.summary && p.headline ? <Text dimColor>{p.headline}</Text> : null}
                  {p.summary && p.target ? <Text dimColor>Target: {p.target}</Text> : null}
                  {p.facts.length ? <Box flexDirection="column">{rows(p.facts)}</Box> : null}
                  {p.values.length ? <Box flexDirection="column" marginTop={1}><Text dimColor>Values</Text>{rows(p.values)}</Box> : null}
                </Box>
              ) : null}
              <Box marginTop={1} gap={2} alignItems="center">
                <Button key={`plan-${id}`} label={isOpen ? 'Hide technical details' : 'Show technical details'} onPress={() => void update($, expanded, all => ({ ...all, [id]: !isOpen }))} />
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
    // TEPLU-17: no band in a project where tenantree was never used; nothing is reported for it.
    const here = await bandOf($, false)
    if (!here.used) return next(e)
    const state = await read($, target)
    const now = await $.clock.now()
    const all = await read($, tiles)
    const open = Object.entries(all).filter(([, p]) => p.status === 'open' && now <= p.expiresAt)
    const loggedOut = await read($, logout)
    const logoutOpen = loggedOut && now - loggedOut.at < SIGNIN_MS ? loggedOut : null
    const pending = await read($, signin)
    // TEPLU-16 (operator, 11.11.2026): once the subaccount reports the sign-in, the link leaves the band -- a used
    // link opened a second time only shows "expired or already used". While it is open, the band asks every
    // 5 seconds (read-only) whether the sign-in arrived.
    const preState = await read($, target)
    const signedInNow = preState.status === 'known' && Boolean(preState.target?.signedIn) && (!pending?.subaccount || preState.target?.subaccount === pending.subaccount)
    if (pending && signedInNow) void update($, signin, () => null).catch(() => {})
    const signinOpen = pending && !signedInNow && now - pending.at < SIGNIN_MS ? pending : null
    if (signinOpen) void followSignin($).catch(() => {})
    const acc = await read($, account)
    void watchSignIn($).catch(() => {})
    // The picker needs the list of subaccounts; after a sign-in only the active target may be known.
    if (acc.status !== 'signedOut' && state.status === 'known' && !state.targets?.length) void loadTargets($).catch(() => {})
    if (state.status === 'unknown' && !open.length && !signinOpen && acc.status !== 'signedOut' && !here.collapsed) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Link, Button } = els
    // The mark where the surface draws it (terminal: no Svg). It always opens the Tenantree Dashboard of the chosen
    // subaccount (operator, 17.10.2026): the server's address when it names one, else built from the chosen entry
    // of the picker, else the portal.
    const Svg = 'Svg' in els ? els.Svg : null
    const t = state.status === 'known' ? state.target : null
    const targets = state.status === 'known' ? state.targets ?? [] : []
    const active = targets.find(x => x.active)
    const dashboard = t?.dashboardUrl ?? (active ? `${PORTAL}/t/${active.id}/dashboard/` : `${PORTAL}/`)
    const ROW = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 }
    const brand = (
      <Box {...ROW} gap={1} flexShrink={0}>
        {Svg ? <Svg source={MARK} alt="tenantree" width={MARK_PX} height={MARK_PX} /> : null}
        <Link href={dashboard}>
          <Text bold>tenantree</Text>
        </Link>
      </Box>
    )
    // One slot for every icon button. Children, not label: the desktop app would draw the label as text.
    const control = (key: string, glyph: string, onPress: () => void) => (
      <Box width={CONTROL} flexDirection="column" alignItems="stretch" flexShrink={0}>
        <Button key={key} onPress={onPress}>
          {glyph}
        </Button>
      </Box>
    )
    // TEPLU-17: folded, the band is one row: the button that unfolds it (where the fold button sits when unfolded),
    // the mark with the name, the chosen subaccount, the production marker and what needs attention.
    if (here.collapsed) {
      const unsigned = acc.status === 'signedOut' || signinOpen || (t && (!t.signedIn || t.right === 'none'))
      return (
        <Box {...ROW} paddingX={1}>
          {/* Operator, 12.11.2026: folded, only the control left and the mark right; no subaccount path. The notices
              stay, because they ask for an action. */}
          {control('expand', '↓', () => void setBand($, { collapsed: false }))}
          {t?.kind === 'production' ? <Text color="error" bold>● Production</Text> : null}
          {open.length ? <Text color="warning">◆ {open.length === 1 ? '1 approval pending' : `${open.length} approvals pending`}</Text> : null}
          {unsigned ? <Text color="warning">◆ Sign-in required</Text> : null}
          <Box flexGrow={1} />
          {brand}
        </Box>
      )
    }
    // The picker where the surface draws it (mobile: no Select).
    const Select = 'Select' in els ? els.Select : null
    const note = await read($, message)
    const choose = async (id: string) => {
      if (id === active?.id) return
      await update($, message, () => 'Switching the subaccount …')
      try {
        const r = await pressed($, 'tenantree_landscape_use', { subaccountId: id }, 'Switch subaccount')
        await remember($, r.text ?? r)
        await refresh($).catch(() => {})
        await update($, message, () => (r.isError ? 'The subaccount could not be switched.' : null))
      } catch (err) {
        await update($, message, () => (blockedByAuto(err) ? AUTO_BLOCKED : 'The subaccount could not be switched.'))
      }
    }
    const askSignin = async () => {
      try {
        const r = await pressed($, 'tenantree_landscape_signin', {}, 'Sign in')
        const url = SIGNIN_LINK.exec(r.text ?? textOf(r))?.[0]
        const at = await $.clock.now()
        if (url) await update($, signin, () => ({ url, subaccount: t?.subaccount ?? null, at }))
      } catch (err) {
        await update($, message, () => (blockedByAuto(err) ? AUTO_BLOCKED : 'The sign-in link could not be created.'))
      }
    }
    const isProduction = t?.kind === 'production'
    const picker =
      state.status === 'unknown' ? (
        <Text dimColor>Reading the subaccount …</Text>
      ) : Select && targets.length > 0 ? (
        // Without an active target the picker says so instead of showing the first entry as if it were chosen.
        <Select
          key="target"
          options={[...(active ? [] : [{ value: '', label: 'Choose a subaccount' }]), ...targets.map(x => ({ value: x.id, label: path(x) }))]}
          value={active?.id ?? ''}
          onSelect={(v: string) => void (v ? choose(v) : null)}
        />
      ) : (
        <Text bold>{t ? path(t) : 'No subaccount chosen'}</Text>
      )
    const notAdmitted = state.status === 'known' && t && (!t.signedIn || t.right === 'none')
    const email = acc.status === 'signedIn' ? acc.email : state.status === 'known' ? state.account ?? null : null
    // LAYOUT (operator, 12.11.2026): three columns of two rows. Left the controls -- the fold button above, the
    // refresh button below; in the middle the subaccount above and the account below; right the mark above and
    // Sign in or Sign out below. Built as two rows of three cells, so what stands side by side shares one centre
    // line whatever the heights of a button, a picker and a line of text; the left cells have one width and the
    // right cells end at the band's edge, which keeps the columns. Then one row per notice (IAS sign-in,
    // approvals, errors).
    const END = { ...ROW, gap: 1, justifyContent: 'flex-end' as const, flexShrink: 0 }
    return (
      <Box flexDirection="column" gap={1} paddingY={1} paddingX={1}>
        <Box flexDirection="column" gap={1}>
          <Box {...ROW}>
            {/* TEPLU-17: folds the band to its row. */}
            {control('collapse', '↑', () => void setBand($, { collapsed: true }))}
            <Box {...ROW} flexGrow={1}>
              {acc.status === 'signedOut' ? (
                <Text color="warning" bold>◆ Not signed in to tenantree</Text>
              ) : null}
              {acc.status !== 'signedOut' && isProduction ? <Text color="error" bold>● Production</Text> : null}
              {acc.status !== 'signedOut' ? picker : null}
            </Box>
            {/* The mark opens the Tenantree Dashboard of the subaccount in the browser (operator, 16.10.2026). */}
            <Box {...END}>{brand}</Box>
          </Box>
          <Box {...ROW}>
            {/* TEPLU-14: reads account, subaccount and approvals again. */}
            {control('refresh', '↻', () => void refreshAll($))}
            <Box {...ROW} flexGrow={1}>
              {acc.status === 'signedOut' ? (
                <Text dimColor>Sign in with /mcp → plugin:tenantree:BTP-Connector → Authenticate, then write: tenantree login</Text>
              ) : (
                <Text wrap="truncate-end">
                  <Text dimColor>Signed in as</Text> {email ?? 'Reading the account …'}
                </Text>
              )}
            </Box>
            <Box {...END}>
              {acc.status === 'signedOut' ? (
                <Button key="signin-tenantree" label="Sign in" variant="primary" onPress={() => void signIn($)} />
              ) : email ? (
                <Button key="signout" label="Sign out" onPress={() => void signOut($)} />
              ) : null}
            </Box>
          </Box>
        </Box>
        {note ? (
          <Box {...ROW}>
            <Text dimColor>{note}</Text>
          </Box>
        ) : null}
        {logoutOpen ? (
          <Box {...ROW}>
            <Text>Signed out of tenantree. End the IAS session in this browser as well:</Text>
            <Link href={logoutOpen.url} label="End IAS session" />
            <Text dimColor>valid until {time(logoutOpen.at + SIGNIN_MS)}, once</Text>
          </Box>
        ) : null}
        {signinOpen ? (
          <Box {...ROW}>
            <Text color="warning">◆ Sign-in required{signinOpen.subaccount ? ` at the IAS of ${signinOpen.subaccount}` : ''}:</Text>
            <Link href={signinOpen.url} label="Sign in" />
            <Text dimColor>valid until {time(signinOpen.at + SIGNIN_MS)}, usable once; this notice disappears after the sign-in</Text>
          </Box>
        ) : notAdmitted ? (
          <Box {...ROW}>
            {/* TEN-750: an expired sign-in is named as such; the button leads to tenantree_landscape_signin. */}
            <Text color="warning">{t.signInExpired ? `◆ Sign-in expired at the IAS of ${t.subaccount}.` : `◆ Not signed in at the IAS of ${t.subaccount}.`}</Text>
            <Button key="signin" label="Sign in" onPress={() => void askSignin()} />
          </Box>
        ) : null}
        {open.length ? (
          <Box flexDirection="column" gap={1}>
            {open.map(([id, p]) => (
              <Box key={id} {...ROW}>
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
