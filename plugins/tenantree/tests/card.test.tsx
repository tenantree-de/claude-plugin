import { expect, mock, test } from 'claude-code/testing'

const PLAN = '3b7ba663-0c63-4f5a-b804-c5dc3f693b4a'
const TOOL = 'mcp__plugin_tenantree_BTP-Connector__cpi_runtimeartifact_delete'
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
  expect(tile).toContain('Show technical details')
  expect(tile).toContain('Open the approval page')
  expect(tile).not.toContain('Tenantree_Demo_iFlow_X')
  expect(tile).not.toContain('"Approve"')
  await reply.press({ key: 'plan-toolu_1' } as never)
  const open = JSON.stringify(await reply.drawn())
  expect(open).toContain('Tenantree_Demo_iFlow_X')
  expect(open).toContain('Hide technical details')
  const other = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Something else.', isFirstOfReply: true } } as never)
  expect(JSON.stringify(await other.drawn())).not.toContain('Undeploy')
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  const json = JSON.stringify(await band.drawn())
  expect(json).toContain('Approval pending')
  expect(json).toContain('tenantree')
})

test('even with a code in the plugin channel the tile decides nothing and leads to the approval page (TEN-621)', async ($, on) => {
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
  expect(tile).not.toContain('"Approve"')
  expect(tile).not.toContain('"Reject"')
  expect(tile).toContain('Open the approval page')
  expect(tile).toContain('only on the approval page')
})

test('the tile learns by itself that its plan was approved on the page', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Undeployed.' }) }], isError: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_3', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  await clock.advance(6000)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('Approved and carried out by tenantree.')
  expect(tile).toContain('Your AI agent reports the result in the chat.')
  expect(tile).not.toContain('Update status')
})

for (const [decision, expected] of [['approve', ['freigegeben']], ['reject', []]] as const) {
  test(`TEPLU-15: deciding the only open plan (${decision}) proposes ${JSON.stringify(expected)} in the prompt box`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const suggested: string[] = []
    on('prompt.suggest', async (_$, e) => { suggested.push((e as { text: string }).text); return { isShown: true } as never })
    on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
    on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
    on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', decision, by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Done.' }) }], isError: false } }) as never)
    on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('session.messages', async () => ({ value: [] }) as never)
    await $.tool.call({ tool: TOOL, tool_use_id: `toolu_s_${decision}`, id: 'Tenantree_Demo_iFlow_X' } as never)
    await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: `ts_${decision}`, reason: 'answer', category: null } as never)
    await clock.advance(6000)
    expect(suggested).toEqual([...expected])
  })
}

test('TEN-742: no proposal when the agent already waits on the plan with tenantree_plan_wait', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const suggested: string[] = []
  on('prompt.suggest', async (_$, e) => { suggested.push((e as { text: string }).text); return { isShown: true } as never })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', state: 'approved', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Done.' }) }], isError: false } }) as never)
  on('tool.call', async (_$, e) => {
    const t = String((e as { tool?: string }).tool).endsWith('tenantree_plan_wait') ? 'Plan status: approved and carried out.\nResult: Done.' : TEXT
    return { ref: 1, result: [{ type: 'text', text: t }], text: t } as never
  })
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_w_1', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_plan_wait', tool_use_id: 'toolu_w_2', planId: PLAN } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer', category: null } as never)
  await clock.advance(6000)
  expect(suggested).toEqual([])
})

test('TEPLU-15: with two open plans an approval proposes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const suggested: string[] = []
  on('prompt.suggest', async (_$, e) => { suggested.push((e as { text: string }).text); return { isShown: true } as never })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  let calls = 0
  on('mcp.call', async () => {
    calls++
    const status = calls === 1 ? { status: 'decided', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Done.' } : { status: 'open' }
    return { value: { content: [{ type: 'text', text: JSON.stringify(status) }], isError: false } } as never
  })
  const SECOND = TEXT.replaceAll(PLAN, '4c8cb774-1d74-4a6b-a915-d6ed04704b5b')
  let n = 0
  on('tool.call', async () => { n++; const t = n === 1 ? TEXT : SECOND; return { ref: n, result: [{ type: 'text', text: t }], text: t } as never })
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_two_1', id: 'A' } as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_two_2', id: 'B' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'two', reason: 'answer', category: null } as never)
  await clock.advance(6000)
  expect(suggested).toEqual([])
})

test('TEPLU-14: the band shows the refresh button, which reads the plan state again at once', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  const called: string[] = []
  on('mcp.call', async (_$, e) => {
    const tool = (e as { tool?: string; name?: string }).tool ?? (e as { name?: string }).name ?? ''
    called.push(String(tool))
    if (String(tool).includes('plan_read')) return { value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Done.' }) }], isError: false } } as never
    return { value: { content: [{ type: 'text', text: '{}' }], isError: false } } as never
  })
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_r', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'tr', reason: 'answer', category: null } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  expect(JSON.stringify(await band.drawn())).toContain('↻')
  called.length = 0
  await band.press({ key: 'refresh' } as never)
  expect(called.some(t => t.includes('plan_read'))).toBe(true)
  expect(JSON.stringify(await band.drawn())).not.toContain('Approval pending')
})

test('TEN-754: an approved plan whose execution failed reads Approved, not carried out', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', decision: 'approve', by: 'ada@example.com', ok: false, at: 1_000_500, first: 'Not carried out: SAP answered 400.' }) }], isError: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_754', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't754', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  await clock.advance(6000)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('Approved, not carried out. Decision by ada@example.com')
  expect(tile).toContain('Carrying out failed; your AI agent reports the reason in the chat.')
  expect(tile).not.toContain('Approved and carried out')
})

// TEN-742: the tile names every state the server reports, and follows an approved plan while it is carried out.
const stateTile = async ($: any, on: any, answers: object[], polls: number) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let n = 0
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify(answers[Math.min(n++, answers.length - 1)]) }], isError: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_742', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't742', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  for (let i = 0; i < polls; i++) await clock.advance(6000)
  return JSON.stringify(await reply.drawn())
}

test('TEN-742: an approved plan sequence reads Approved, running, then its real result', async ($, on) => {
  const running = { status: 'decided', state: 'running', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Plan sequence approved: Two queues', sequenceId: 'a', sequence: { status: 'ready', mode: 'guided', done: 0, total: 2, finished: false } }
  const first = await stateTile($, on, [running], 1)
  expect(first).toContain('Approved. tenantree is carrying out the plan sequence: 0 of 2 steps done.')
  expect(first).not.toContain('Approved and carried out')
})

test('TEN-742: the tile keeps following a running sequence until it is finished', async ($, on) => {
  const running = { status: 'decided', state: 'running', decision: 'approve', ok: true, at: 1_000_500, sequenceId: 'a', sequence: { status: 'ready', mode: 'guided', done: 0, total: 2, finished: false } }
  const done = { ...running, state: 'approved', ok: true, sequence: { status: 'completed', mode: 'guided', done: 2, total: 2, finished: true } }
  const tile = await stateTile($, on, [running, done], 2)
  expect(tile).toContain('Approved and carried out')
  expect(tile).not.toContain('is carrying out')
})

test('TEN-793: a plan being carried out names the step that runs', async ($, on) => {
  const tile = await stateTile($, on, [{ status: 'open', state: 'running', progress: { step: 2, total: 3, done: 1, line: 'Step 2 of 3: Service key "k1"' } }], 1)
  expect(tile).toContain('Approved. tenantree is carrying out the plan. Step 2 of 3: Service key \\"k1\\" …')
})

test('TEN-742: a single plan being carried out reads Approved. tenantree is carrying out the plan', async ($, on) => {
  const tile = await stateTile($, on, [{ status: 'open', state: 'running' }], 1)
  expect(tile).toContain('Approved. tenantree is carrying out the plan …')
})

test('TEN-742: an expired plan and a superseded plan are named as such', async ($, on) => {
  const expired = await stateTile($, on, [{ status: 'closed', state: 'expired' }], 1)
  expect(expired).toContain('This plan expired without a decision.')
  expect(expired).not.toContain('expired or superseded')
})

test('TEN-742: a superseded plan says so', async ($, on) => {
  const superseded = await stateTile($, on, [{ status: 'closed', state: 'superseded' }], 1)
  expect(superseded).toContain('superseded by another plan with the same arguments')
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
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_cost_query', tool_use_id: 'toolu_c' } as never)
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
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_diagram_read', tool_use_id: 'toolu_d', kind: 'tenant' } as never)
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

test('in the desktop app the mod draws the diagram tile (no MCP App views any more)', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TENANT }], text: TENANT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_diagram_read', tool_use_id: 'toolu_t', kind: 'tenant' } as never)
  await $.turn.complete?.({ answer: 'The tenant landscape.', durationMs: 1, isAborted: false, turnId: 'tt', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AssistantMessage', props: { text: 'The tenant landscape.', isFirstOfReply: true } } as never)
  expect(JSON.stringify(await reply.drawn())).toContain('ENGINE')
  expect(JSON.stringify(await reply.drawn())).toContain('Subaccount bics-labor')
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
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_profile_read', tool_use_id: 'toolu_p' } as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_3', id: 'Tenantree_Demo_iFlow_X' } as never)
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  // 1 000 000 ms + 15 minutes = 00:31 UTC on 01.01.1970, 01:31 in Berlin (winter time).
  expect(JSON.stringify(await band.drawn())).toContain('00:31 UTC (01:31 Europe/Berlin)')
})

test('a global account renamed in the portal reaches the picker with the next answer', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  const target = (globalAccount: string) => ({ landscape: 'Org', globalAccount, subaccount: 'bics-labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' })
  const LIST = JSON.stringify({ message: 'Landscapes', targets: [{ id: 's1', landscape: 'Org', globalAccount: 'BICS Labor', subaccount: 'bics-labor', kind: 'development', active: true }], activeTarget: target('BICS Labor') })
  const ACCESS = JSON.stringify({ message: 'Access', activeTarget: target('BICS BTP') })
  let answer = LIST
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: answer }], text: answer }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_landscape_query', tool_use_id: 'toolu_l' } as never)
  answer = ACCESS
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_access_read', tool_use_id: 'toolu_a' } as never)
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

test('TEN-742: a plan interrupted during its execution reads outcome unknown', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'closed', state: 'interrupted' }) }], isError: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_int', id: 'Tenantree_Demo_iFlow_X' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'ti', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  await clock.advance(6000)
  expect(JSON.stringify(await reply.drawn())).toContain('The outcome is unknown')
})

test('TEN-742: a wait that returned with the plan still open does not suppress the proposal', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const suggested: string[] = []
  on('prompt.suggest', async (_$, e) => { suggested.push((e as { text: string }).text); return { isShown: true } as never })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ status: 'decided', state: 'approved', decision: 'approve', by: 'ada@example.com', ok: true, at: 1_000_500, first: 'Done.' }) }], isError: false } }) as never)
  on('tool.call', async (_$, e) => {
    const t = String((e as { tool?: string }).tool).endsWith('tenantree_plan_wait') ? 'Plan status: open -- not decided yet.' : TEXT
    return { ref: 1, result: [{ type: 'text', text: t }], text: t } as never
  })
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_wo_1', id: 'X' } as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_plan_wait', tool_use_id: 'toolu_wo_2', planId: PLAN } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'two', reason: 'answer', category: null } as never)
  await clock.advance(6000)
  expect(suggested).toEqual(['freigegeben'])
})

// TEN-744: the plan at a glance -- the summary sentence on top, a plan sequence as a short step list, every warning
// visible without opening the details; the plans of the steps and their facts stay out of the tile.
const SEQ_PLAN = '4c8cb774-1d74-4f6b-9c15-d6ed40740b5c'
const SEQ_TEXT = [
  'Plan: plan sequence "Tear down orders" -- 2 steps, carried out in this order after one approval',
  '  Mode guided: the agent carries out the approved steps one by one and checks every result before the next step; it cannot change a step.',
  '',
  'Step 1: Event Mesh: Delete Webhook (orders-hook) [irreversible]',
  '  Plan: delete the webhook "orders-hook"',
  '    Queue: orders',
  '  Warning: nothing is pushed to the endpoint any more.',
  '',
  'Step 2: Event Mesh: Delete Queue (orders) [irreversible, unmeasured]',
  '  Plan: delete the queue "orders"',
  '    Messages: 3',
  '',
  'Plan sequence ID (valid after the approval): 9b0f2f1e-0000-4000-8000-000000000001',
  '',
  'On this installation every plan is approved or rejected only by a person on the approval page in the browser.',
  `Approval page (personal sign-in required, valid for 15 minutes): https://portal.tenantree.de/t/x/plan/${SEQ_PLAN}`,
  'Give the person this link. Do not open it yourself.',
  'Summary: Carry out "Tear down orders" in 2 steps, in this order, after one approval – in the subaccount "bics-labor" (Development). No cost assessment applies to this operation.',
  'Plan: tenantree: Create Plan Sequence (write level landscape)',
].join('\n')

test('a plan sequence reads at a glance: summary, short step list, warnings always visible (TEN-744)', async ($, on) => {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: false } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: SEQ_TEXT }], text: SEQ_TEXT }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  await $.tool.call({ tool: 'mcp__plugin_tenantree_BTP-Connector__tenantree_plansequence_create', tool_use_id: 'toolu_s' } as never)
  await $.turn.complete?.({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'ts', reason: 'answer', category: null } as never)
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'terminal', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('Tear down orders')
  expect(tile).toContain('in 2 steps, in this order')
  expect(tile).toContain('Steps (2), carried out in this order after one approval:')
  expect(tile).toContain('Event Mesh: Delete Webhook (orders-hook)')
  expect(tile).toContain('Cannot be undone')
  expect(tile).toContain('Warning: Nothing is pushed to the endpoint any more.')
  expect(tile).not.toContain('Summary:')
  expect(tile).not.toContain('Messages')
  await reply.press({ key: 'plan-toolu_s' } as never)
  const open = JSON.stringify(await reply.drawn())
  expect(open).not.toContain('Messages')
  expect(open).not.toContain('orders-hook\\"')
})
