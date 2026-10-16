/** The active target as the tenantree server reports it with every tool answer. */
export type ActiveTarget = {
  organization: string
  landscape: string
  system: string
  kind: 'production' | 'quality' | 'development' | 'other'
  region: string
  subaccountId: string | null
  signedIn: boolean
  right: 'none' | 'user' | 'admin'
  dashboardUrl?: string
}

/** A system the person may choose (tenantree_landscape_query). */
export type Target = {
  id: string
  organization: string
  landscape: string
  system: string
  kind: ActiveTarget['kind']
  active: boolean
}

/** unknown: not read yet or tenantree not connected; null target: connected, no active target. */
export type TargetState =
  | { status: 'unknown' }
  | { status: 'known'; target: ActiveTarget | null; account?: string; targets?: Target[]; at: number }

/** One row of a plan: a label and its value. */
export type Row = { label: string; value: string }

/** A plan tile: read from the plan text of the tool answer (the plugin calls nothing for it). */
export type PlanTile = {
  planId: string
  title: string
  level: string | null
  target: string | null
  headline: string
  facts: Row[]
  values: Row[]
  warnings: string[]
  url: string | null
  expiresAt: number
  status: 'open' | 'decided' | 'closed' | 'checking' | 'unknown'
  decision?: 'approve' | 'reject'
  by?: string | null
  ok?: boolean
  at?: number
  first?: string
  error?: string
  /** The approval code from _meta "claude/plugins", where Claude Code hands it over; never shown. */
  code?: string
  handover?: string | null
  busy?: 'approve' | 'reject'
}

/** The tiles a reply shows after its text: the end of that text and the tiles' tool use ids. */
export type Attached = { tail: string; ids: string[] }

declare module 'claude-code' {
  interface PluginState {
    tenantree: {
      target: TargetState
      server: string | null
      message: string | null
      tiles: Record<string, PlanTile>
      turn: string[]
      attached: Attached[]
      signin: { url: string; system: string | null; at: number } | null
      expanded: Record<string, boolean>
    }
  }
}
