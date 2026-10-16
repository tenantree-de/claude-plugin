import { expect, test } from 'claude-code/testing'

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
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
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
  const other = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AssistantMessage', props: { text: 'Something else.', isFirstOfReply: true } } as never)
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
  const reply = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AssistantMessage', props: { text: ANSWER, isFirstOfReply: true } } as never)
  const tile = JSON.stringify(await reply.drawn())
  expect(tile).toContain('"Approve"')
  expect(tile).toContain('"Reject"')
})
