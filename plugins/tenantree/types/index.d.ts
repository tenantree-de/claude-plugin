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

/** The parsed plan as the server shows it on every card. */
export type PlanParts = {
  headline: string
  facts: Array<{ label: string; value: string }>
  values: Array<{ label: string; value: string }>
  cost: { rows: Array<{ label: string; value: string }>; notes: string[]; traps: string[] } | null
  warnings: string[]
  notes: string[]
}

/** What the plan card of one tool call knows (tenantree_plan_status with details; never the code). */
export type PlanCardState = {
  planId: string
  status: 'loading' | 'open' | 'decided' | 'closed' | 'unknown'
  title?: string
  level?: string
  parts?: PlanParts
  expiresAt?: number
  url?: string | null
  decision?: 'approve' | 'reject'
  by?: string | null
  channel?: string
  ok?: boolean
  at?: number
  first?: string
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    tenantree: {
      target: TargetState
      server: string | null
      message: string | null
      plans: Record<string, PlanCardState>
    }
  }
}
