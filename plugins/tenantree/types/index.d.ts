/** The active target as the tenantree server reports it with every tool answer. */
export type ActiveTarget = {
  /** The landscape: the customer in tenantree. */
  landscape: string
  /** The global account in SAP BTP. */
  globalAccount: string
  subaccount: string
  kind: 'production' | 'quality' | 'development' | 'other'
  region: string
  /** GUID of the subaccount in SAP BTP. */
  subaccountId: string | null
  /** Whether the sign-in at the IAS of the subaccount is valid now (false once it has expired). */
  signedIn: boolean
  /** TEN-750: true when a sign-in existed and has expired. */
  signInExpired?: boolean
  right: 'none' | 'user' | 'admin'
  dashboardUrl?: string
}

/** A subaccount the person may choose (tenantree_landscape_query, tenantree_subaccount_query). */
export type Target = {
  /** ID of the subaccount in tenantree (subaccountId of tenantree_landscape_use). */
  id: string
  landscape: string
  globalAccount: string
  subaccount: string
  kind: ActiveTarget['kind']
  active: boolean
}

/** unknown: not read yet or tenantree not connected; null target: connected, no active target. */
export type TargetState =
  | { status: 'unknown' }
  | { status: 'known'; target: ActiveTarget | null; account?: string; targets?: Target[]; at: number }

/** TEPLU-12: the tenantree account of this connection. */
export type AccountState =
  | { status: 'unknown' }
  | { status: 'signedIn'; email: string; landscapes: Array<{ name: string; role: 'admin' | 'user' }> }
  | { status: 'signedOut' }

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
  /** The cost notice of a plan with costs or unchecked costs (21.10.2026): approved only together with its confirmation. */
  cost?: { kind: 'paid' | 'unclear'; text: string } | null
}

/** One section of the cost tile: rows (label and value) and lines of text. */
export type CostSection = { name: string; rows: Row[]; lines: string[] }

/** The cost tile: read from the text of tenantree_cost_query (the plugin calls nothing for it). */
export type CostTile = { sections: CostSection[]; risks: string[]; unchecked: string[]; url: string | null }

/** The landscape diagram tile: read from the text of tenantree_diagram_read, drawn as SVG by the plugin. */
export type DiagramNode = { name: string; detail: string[] }
export type DiagramTile = {
  title: string
  layers: Array<{ name: string; nodes: DiagramNode[] }>
  edges: Array<{ from: string; to: string; label: string | null }>
  findings: string[]
  notes: string[]
  url: string | null
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
      signin: { url: string; subaccount: string | null; at: number } | null
      logout: { url: string; at: number } | null
      account: AccountState
      expanded: Record<string, boolean>
      costs: Record<string, CostTile>
      diagrams: Record<string, DiagramTile>
    }
  }
}
