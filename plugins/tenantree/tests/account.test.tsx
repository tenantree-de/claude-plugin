import { expect, test } from 'claude-code/testing'

const P = 'mcp__plugin_tenantree_tenantree__'
const PROFILE = JSON.stringify({
  message: 'Signed in to tenantree as person@example.test.',
  signedInAs: 'person@example.test',
  organizations: [{ name: 'Brauer IT', role: 'admin' }],
  activeTarget: { organization: 'Brauer IT', landscape: 'BICS BTP', system: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' },
})

test('TEPLU-12: the band shows the account with Sign out to the portal; a call that asks for a sign-in turns it into Sign in', async ($, on) => {
  const calls: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false, reason: 'auth', message: 'Needs sign-in.' } }) as never)
  on('tool.call', async (_$, e) => {
    calls.push(String(e.tool))
    if (e.tool === `${P}tenantree_landscape_query`) return { ref: 1, result: [{ type: 'text', text: 'Sign-in required.' }], text: 'Sign-in required.', isError: true } as never
    return { ref: 1, result: [{ type: 'text', text: PROFILE }], text: PROFILE } as never
  })
  on('store.set', async () => ({ value: undefined }) as never)
  await $.tool.call({ tool: `${P}tenantree_profile_read`, tool_use_id: 'toolu_p' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 160 } } as never)
  const before = JSON.stringify(await band.drawn())
  expect(before).toContain('person@example.test')
  expect(before).toContain('Sign out')

  // The model cannot sign the person out.
  const denied = (await $.tool.call({ tool: `${P}tenantree_session_delete`, tool_use_id: 'toolu_m' } as never)) as { deny?: string }
  expect(String(denied.deny)).toContain('Sign out')
  expect(calls).not.toContain(`${P}tenantree_session_delete`)

  expect(before).toContain('https://portal.tenantree.de/security#connections')

  // Signed out in the portal: the next tenantree answer asks for a sign-in.
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_q' } as never)
  const after = JSON.stringify(await band.drawn())
  expect(after).toContain('Not signed in to tenantree')
  expect(after).toContain('Sign in')
  expect(after).not.toContain('person@example.test')

  // Sign in: where the host cannot start the sign-in, the band names the way through /mcp.
  await band.press({ key: 'signin-tenantree' } as never)
  expect(JSON.stringify(await band.drawn())).toContain('run /mcp, select tenantree and choose Authenticate')
})
