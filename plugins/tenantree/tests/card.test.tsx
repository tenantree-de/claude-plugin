import { expect, mock, test } from 'claude-code/testing'

const PLAN = '3b7ba663-0c63-4f5a-b804-c5dc3f693b4a'
const TOOL = 'mcp__plugin_tenantree_tenantree__cpi_runtimeartifact_delete'
const URL = `https://portal.tenantree.de/t/x/plan/${PLAN}`
const TEXT = [
  'Planned, not executed yet.',
  '',
  'Tenant:    BICS Labor / bics-labor',
  'Tool:      cpi_runtimeartifact_delete',
  'Object:    IntegrationDeployments',
  'Operation: delete',
  '',
  'With:',
  '  {',
  '    "id": "Tenantree_Demo_iFlow_X"',
  '  }',
  '',
  'On this installation every plan is approved only by a person with the Approve button.',
  `Approval page (personal sign-in required, valid for 15 minutes): ${URL}`,
  'Give the person this link. Do not open it yourself.',
  'Plan: Undeploy Integration Artifact (write level landscape)',
].join('\n')
const ANSWER = 'Both plans are ready. Please approve them in this order.'

test('the plan tile follows the reply and the band lists the open approval, without calls of its own', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_1', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('ENGINE')
  expect(tile).toContain('Undeploy Integration Artifact')
  expect(tile).toContain('Show plan')
  expect(tile).toContain('Open the approval page')
  expect(tile).not.toContain('Tenantree_Demo_iFlow_X')
  expect(tile).not.toContain('"Approve"')
  await reply.press({ key: 'plan-toolu_1' } as never)
  const open = JSON.stringify(await reply.drawn())
  expect(open).toContain('Tenantree_Demo_iFlow_X')
  expect(open).toContain('Hide plan')
  const other = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Something else.', isFirstOfReply: true } } as never)
  expect(JSON.stringify(await other.drawn())).not.toContain('Undeploy')
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  const json = JSON.stringify(await band.drawn())
  expect(json).toContain('Approval pending')
  expect(json).toContain('tenantree')
})

test('with the plugin channel the tile offers Approve and Reject', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'toolu_2', tool: TOOL, input: {}, meta: { 'claude/plugins': { tenantree: { plan: { code: 'c0de' } } } } }] }] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_2', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('"Approve"')
  expect(tile).toContain('"Reject"')
})

test('the tile learns by itself that its plan was approved on the page', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:tenantree' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Undeployed.' }) }], isError: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_3', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  await clock.advance(6000)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('Approved and carried out')
  expect(tile).not.toContain('Update status')
})

const COST = [
  'THE ACCOUNT NOW',
  '  Commercial model of the global account: not read (needs the account access cis/central).',
  '  SAP Integration Suite edition: Free plan (detected from the subscription it-cpi049-prov, plan free).',
  '  Term: 90 days, then the Standard Edition.',
  '',
  'COST RISKS',
  '  Integration Suite (plan free): free of charge for 90 days since 2026-09-25. 69 days remaining.',
  '',
  'NOT CHECKED',
  '  Cloud Foundry memory and cloud credits (needs the usage access)',
  '',
  'Prices: SAP Discovery Center with source and date per entry.',
  '',
  'Graphical view in the Tenantree Dashboard: https://portal.tenantree.de/t/x/dashboard/#/costs',
  '',
  'tenantree target: Brauer IT → BICS Labor → bics-labor (development)',
].join('\n')

test('the cost assessment becomes a tile after the reply', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: COST }], text: COST }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_tenantree__tenantree_cost_query', tool_use_id: 'toolu_c' } as never)
  await $.turn.complete?.({ answer: 'Here are the costs.', durationMs: 1, isAborted: false, turnId: 'tc', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Here are the costs.', isFirstOfReply: true } } as never)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('Cost risk')
  expect(tile).toContain(' days left')
  expect(tile).toContain('SAP Integration Suite edition')
  expect(tile).toContain('Open in the Tenantree Dashboard')
  expect(tile).not.toContain('tenantree target')
})

const DIAGRAM = [
  'Architecture diagram: Subaccount bics-labor',
  'Layers, left to right:',
  '1. Subaccounts',
  '   - bics-labor',
  '       This installation runs here',
  '2. Subscriptions, instances',
  '   - Integration Suite -- it-cpi049-prov / free',
  '       State: SUBSCRIBED',
  '   - tenantree-cpi -- Cloud Foundry instance',
  '       State: ready',
  '',
  'Connections (2):',
  '  bics-labor -> Integration Suite (subscribed)',
  '  bics-labor -> tenantree-cpi',
  '',
  'Findings (0):',
  '  None.',
  '',
  'Graphical view in the Tenantree Dashboard: https://portal.tenantree.de/t/x/dashboard/#/landscape',
].join('\n')

test('in the terminal the landscape diagram becomes a tile with heading and findings after the reply', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: DIAGRAM }], text: DIAGRAM }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_tenantree__tenantree_diagram_read', tool_use_id: 'toolu_d', kind: 'tenant' } as never)
  await $.turn.complete?.({ answer: 'Here is the landscape.', durationMs: 1, isAborted: false, turnId: 'td', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Here is the landscape.', isFirstOfReply: true } } as never)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('Subaccount bics-labor')
  // The terminal draws no SVG: the diagram is described in text; the desktop app shows the MCP App view.
  expect(tile).not.toContain('"type":"Svg"')
  expect(tile).toContain('No findings.')
})

const TENANT = [
  'Architecture diagram: Subaccount bics-labor',
  'Layers, left to right:',
  '1. Subaccounts',
  '   - bics-labor',
  '       This installation runs here',
  '2. Subscriptions, instances',
  '   - Integration Suite -- it-cpi049-prov / free',
  '   - SAP HANA Cloud -- hana-cloud-tools / tools',
  '   - mcp-apimgmt-guest -- Cloud Foundry instance',
  '   - tenantree-cpi -- Cloud Foundry instance',
  '   - tenantree_service_manager -- service-manager / subaccount-admin',
  '',
  'Connections (5):',
  '  bics-labor -> Integration Suite (subscribed)',
  '  bics-labor -> SAP HANA Cloud (subscribed)',
  '  bics-labor -> mcp-apimgmt-guest',
  '  bics-labor -> tenantree-cpi',
  '  bics-labor -> tenantree_service_manager',
  '',
  'Findings (0):',
  '  None.',
].join('\n')

test('in the desktop app the mod draws no diagram tile (the MCP App view is shown)', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TENANT }], text: TENANT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_tenantree__tenantree_diagram_read', tool_use_id: 'toolu_t', kind: 'tenant' } as never)
  await $.turn.complete?.({ answer: 'The tenant landscape.', durationMs: 1, isAborted: false, turnId: 'tt', reason: 'answer', category: null } as never)
  // The desktop app shows the MCP App view of the diagram itself: the mod draws no second tile there.
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AssistantMessage', props: { text: 'The tenant landscape.', isFirstOfReply: true } } as never)
  expect(JSON.stringify(reply)).not.toContain('Subaccount bics-labor')
})

test('times show SAP BTP time (UTC) and the person\'s zone from the profile (TEPLU-6)', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  const PROFILE = JSON.stringify({ message: 'Profile', timeZone: 'Europe/Berlin', activeTarget: null })
  on('tool.call', async (_$, e) =>
    (String((e as { tool?: string }).tool).endsWith('tenantree_profile_read')
      ? { ref: 1, result: [{ type: 'text', text: PROFILE }], text: PROFILE }
      : { ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_tenantree__tenantree_profile_read', tool_use_id: 'toolu_p' } as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_3', id: 'Tenantree_Demo_iFlow_X' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  // 1 000 000 ms + 15 minutes = 00:31 UTC on 01.01.1970, 01:31 in Berlin (winter time).
  expect(JSON.stringify(await band.drawn())).toContain('00:31 UTC (01:31 Europe/Berlin)')
})

test('a landscape renamed in the portal reaches the picker with the next answer', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  const target = (landscape: string) => ({ organization: 'Org', landscape, system: 'bics-labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' })
  const LIST = JSON.stringify({ message: 'Landscapes', targets: [{ id: 's1', organization: 'Org', landscape: 'BICS Labor', system: 'bics-labor', kind: 'development', active: true }], activeTarget: target('BICS Labor') })
  const ACCESS = JSON.stringify({ message: 'Access', activeTarget: target('BICS BTP') })
  let answer = LIST
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: answer }], text: answer }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_tenantree__tenantree_landscape_query', tool_use_id: 'toolu_l' } as never)
  answer = ACCESS
  await $.tool.call({ tool: 'mcp__plugin_tenantree_tenantree__tenantree_access_read', tool_use_id: 'toolu_a' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  const json = JSON.stringify(await band.drawn())
  expect(json).toContain('BICS BTP')
  expect(json).not.toContain('BICS Labor')
})

test('in the desktop app the plan tile is drawn, because the view of a plugin server cannot decide (K13a)', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_9', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't9', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  expect(JSON.stringify(await reply.drawn())).toContain('Undeploy Integration Artifact')
})
