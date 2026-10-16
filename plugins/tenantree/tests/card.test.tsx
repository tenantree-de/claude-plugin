import { expect, test } from 'claude-code/testing'

const PLAN = '3b7ba663-0c63-4f5a-b804-c5dc3f693b4a'
const TOOL = 'mcp__plugin_tenantree_tenantree__cpi_runtimeartifact_delete'
const TEXT = `Planned, not executed yet.\n\nApproval page (personal sign-in required, valid for 15 minutes): https://portal.tenantree.de/t/x/plan/${PLAN}`

test('the plan card draws on the desktop under the tool call', async ($, on) => {
  on('mcp.call', async () => ({ value: {
    content: [{ type: 'text', text: JSON.stringify({ status: 'open', title: 'Undeploy integration artifact', level: 'landscape', tool: 'cpi_runtimeartifact_delete', parts: { headline: 'Planned, not executed yet.', facts: [{ label: 'Tenant', value: 'BICS Labor / bics-labor' }], values: [{ label: 'id', value: 'Tenantree_Demo_iFlow_X' }], cost: null, warnings: [], notes: [] }, expiresAt: Date.now() + 600000, url: `https://portal.tenantree.de/t/x/plan/${PLAN}` }) }],
    isError: false,
  } }) as never)
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:tenantree' } }) as never)
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: TEXT }], text: TEXT }) as never)
  const r = await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_1', id: 'Tenantree_Demo_iFlow_X' } as never)
  expect((r as { text?: string }).text).toContain(PLAN)
  // The tile reads its plan after the call has returned.
  await new Promise(resolve => setTimeout(resolve, 50))
  for (const component of ['ToolUse'] as const) {
    const props = component === 'ToolResult'
      ? { tool_use_id: 'toolu_1', tool: TOOL, output: [{ type: 'text', text: TEXT }], isErrored: false }
      : { tool_use_id: 'toolu_1', tool: TOOL, input: { id: 'Tenantree_Demo_iFlow_X' }, isRunning: false, isErrored: false, isInterrupted: false, output: [{ type: 'text', text: TEXT }] }
    const ui = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component, requestId: 'toolu_1', props } as never)
    const tree = await ui.drawn()
    const json = JSON.stringify(tree)
    expect(json).toContain('ENGINE')
    expect(json).toContain('Undeploy integration artifact')
    expect(json).toContain('Approve or reject on the approval page')
  }
  const band = await $.ui.mount({ plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } } as never)
  const json = JSON.stringify(await band.drawn())
  expect(json).toContain('Approval pending')
  expect(json).toContain('Approve or reject')
})
