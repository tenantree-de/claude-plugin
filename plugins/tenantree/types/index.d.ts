/** The active target as the tenantree server reports it with every tool answer. */
export type ActiveTarget = {
  organization: string
  landscape: string
  system: string
  kind: 'production' | 'quality' | 'development' | 'other'
  region: string
  subaccountId: string | null
  signedIn: boolean
  right: 'none' | 'read' | 'write'
}

/** unknown: not read yet or tenantree not connected; null: connected, no active target. */
export type TargetState = { status: 'unknown' } | { status: 'known'; target: ActiveTarget | null; at: number }

declare module 'claude-code' {
  interface PluginState {
    tenantree: { target: TargetState }
  }
}
