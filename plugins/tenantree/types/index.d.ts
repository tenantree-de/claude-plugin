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

/** What the plan card knows about one plan after a press. */
export type PlanCardState = { status: 'busy' | 'approved' | 'rejected' | 'failed' | 'closed'; text: string; handover: string | null }

declare module 'claude-code' {
  interface PluginState {
    tenantree: {
      target: TargetState
      server: string | null
      message: string | null
      plans: Record<string, PlanCardState>
      probe: string | null
    }
  }
}
