import { expect, mock, test } from 'claude-code/testing'

const P = 'mcp__plugin_tenantree_landscape__'
const PROFILE = JSON.stringify({
  message: 'Signed in to tenantree as person@example.test.',
  signedInAs: 'person@example.test',
  landscapes: [{ name: 'Brauer IT', role: 'admin' }],
  activeTarget: { landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' },
})

test('TEPLU-12: the band shows the account with Sign out to the portal; a call that asks for a sign-in turns it into Sign in', async ($, on) => {
  const calls: string[] = []
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  // Connected; the picker list comes from the landscape query the band reads itself.
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:landscape' } }) as never)
  const LIST = JSON.stringify({ message: 'Landscapes', targets: [{ id: 's1', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', active: true }, { id: 's2', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'QS', kind: 'quality', active: false }], activeTarget: { landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' } })
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: LIST }], isError: false } }) as never)
  on('clock.every', async () => ({ value: { cancel: () => {} } }) as never)
  on('tool.call', async (_$, e) => {
    calls.push(String(e.tool))
    if (e.tool === `${P}tenantree_session_delete`) return { deny: 'The server-side auto mode classifier gave no verdict.' } as never
    if (e.tool === `${P}tenantree_landscape_query`) return { ref: 1, result: [{ type: 'text', text: 'Sign-in required.' }], text: 'Sign-in required.', isError: true } as never
    return { ref: 1, result: [{ type: 'text', text: PROFILE }], text: PROFILE } as never
  })
  on('store.set', async () => ({ value: undefined }) as never)
  await $.tool.call({ tool: `${P}tenantree_profile_read`, tool_use_id: 'toolu_p' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 160 } } as never)
  const before = JSON.stringify(await band.drawn())
  expect(before).toContain('person@example.test')
  // The subaccount picker stays: the band reads the list when only the active target is known.
  const withList = JSON.stringify(await band.drawn())
  expect(withList).toContain('"type":"Select"')
  expect(withList).toContain('Brauer IT → BICS BTP → QS')
  expect(before).toContain('Sign out')

  // The model cannot sign the person out.
  const denied = (await $.tool.call({ tool: `${P}tenantree_session_delete`, tool_use_id: 'toolu_m' } as never)) as { deny?: string }
  expect(String(denied.deny)).toContain('asked for it')
  expect(calls).not.toContain(`${P}tenantree_session_delete`)


  // Sign out calls the server directly; where the Auto permission mode refuses the call, the band says so.
  await band.press({ key: 'signout' } as never)
  const blocked = JSON.stringify(await band.drawn())
  expect(blocked).toContain('The Auto permission mode blocks this action')
  expect(blocked).toContain('person@example.test')

  // Signed out in the portal: the next tenantree answer asks for a sign-in.
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_q' } as never)
  const after = JSON.stringify(await band.drawn())
  expect(after).toContain('Not signed in to tenantree')
  expect(after).toContain('Sign in')
  expect(after).not.toContain('person@example.test')

  // Sign in: where the host cannot start the sign-in, the band names the way through /mcp.
  await band.press({ key: 'signin-tenantree' } as never)
  expect(JSON.stringify(await band.drawn())).toContain('select plugin:tenantree:landscape and choose Authenticate')
})

test('TEN-729: the picker sets the target with the parameter subaccountId', async ($, on) => {
  const args: Array<Record<string, unknown>> = []
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:landscape' } }) as never)
  const LIST = JSON.stringify({ message: 'Landscapes', targets: [{ id: 's1', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', active: true }, { id: 's2', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'QS', kind: 'quality', active: false }], activeTarget: { landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' } })
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: LIST }], isError: false } }) as never)
  on('clock.every', async () => ({ value: { cancel: () => {} } }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  on('tool.call', async (_$, e) => {
    if (e.tool === `${P}tenantree_landscape_use`) args.push(e as never)
    return { ref: 1, result: [{ type: 'text', text: LIST }], text: LIST } as never
  })
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_l' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 160 } } as never)
  expect(JSON.stringify(await band.drawn())).toContain('Brauer IT → BICS BTP → QS')
  await band.select({ key: 'target', value: 's2' } as never)
  expect(args.length).toBe(1)
  expect(args[0]!.subaccountId).toBe('s2')
  expect(args[0]!.systemId).toBeUndefined()
})

test('TEN-750: an expired IAS sign-in of the active target shows "Sign-in expired" with Sign in, not the admitted state', async ($, on) => {
  const EXPIRED = JSON.stringify({
    message: 'Landscapes',
    signedInAs: 'person@example.test',
    targets: [{ id: 's1', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', active: true }],
    activeTarget: { landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: false, signInExpired: true, right: 'none' },
  })
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:landscape' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: EXPIRED }], isError: false } }) as never)
  on('clock.every', async () => ({ value: { cancel: () => {} } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: EXPIRED }], text: EXPIRED }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_e' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 160 } } as never)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('Sign-in expired at the IAS of Labor.')
  expect(drawn).not.toContain('Not signed in at the IAS of Labor.')
  expect(drawn).toContain('Sign in')
})

test('TEPLU-16: the sign-in link leaves the band once the subaccount reports the sign-in', async ($, on) => {
  const target = (signedIn: boolean) => ({ landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn, right: signedIn ? 'admin' : 'none' })
  const LINK = 'https://portal.tenantree.de/sso/start/abcdefghijklmnopqrstuvwxyz012345'
  const SIGNIN = JSON.stringify({ message: `Sign-in at the IAS of Labor:\n\n${LINK}\n\nPlease open the link.`, signedInAs: 'person@example.test', activeTarget: target(false) })
  const LIST = (signedIn: boolean) => JSON.stringify({ message: 'Landscapes', signedInAs: 'person@example.test', targets: [{ id: 's1', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', active: true }], activeTarget: target(signedIn) })
  const clock = mock.clock(on, { now: 1_000_000 })
  let signedIn = false
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:landscape' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: LIST(signedIn) }], isError: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: SIGNIN }], text: SIGNIN }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  await $.tool.call({ tool: `${P}tenantree_landscape_signin`, tool_use_id: 'toolu_s' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 160 } } as never)
  expect(JSON.stringify(await band.drawn())).toContain(LINK)
  signedIn = true
  await clock.advance(6000)
  const after = JSON.stringify(await band.drawn())
  expect(after).not.toContain(LINK)
  expect(after).not.toContain('Sign-in required')
})
