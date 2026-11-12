import { expect, test } from 'claude-code/testing'

const P = 'mcp__plugin_tenantree_BTP-Connector__'
const LIST = JSON.stringify({
  message: 'Landscapes',
  signedInAs: 'person@example.test',
  targets: [{ id: 's1', landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', active: true }],
  activeTarget: { landscape: 'Brauer IT', globalAccount: 'BICS BTP', subaccount: 'Labor', kind: 'development', region: 'eu10', subaccountId: null, signedIn: true, right: 'admin' },
})
const BAND = { plugin: 'tenantree', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 160 } } as const

/** A session in project `root` whose store is `store` (shared between "restarts"). */
function engine(on: Parameters<Parameters<typeof test>[1]>[1], root: string | (() => string), store: Map<string, unknown>, answer: () => string = () => LIST, read: () => string = () => LIST) {
  on('clock.now', async () => ({ value: 1_000_000 }) as never)
  on('clock.every', async () => ({ value: { cancel: () => {} } }) as never)
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  on('mcp.connect', async () => ({ value: { isConnected: true, server: 'plugin:tenantree:BTP-Connector' } }) as never)
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: read() }], isError: false } }) as never)
  on('command.register', async () => ({ value: { command: 'tenantree' } }) as never)
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('session.root', async () => ({ value: typeof root === 'string' ? root : root() }) as never)
  on('store.get', async (_$, e) => ({ value: store.get(String((e as { key: string }).key)) }) as never)
  on('store.set', async (_$, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, JSON.parse(JSON.stringify(value)))
    return { value: undefined } as never
  })
  on('tool.call', async () => ({ ref: 1, result: [{ type: 'text', text: answer() }], text: answer() }) as never)
}

test('TEPLU-17: no band in a project without tenantree; the first tenantree tool call shows it', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on, '/projects/a', store)
  await $.session.start({ cwd: '/projects/a', surface: 'desktop', isInteractive: true } as never)
  const band = await $.ui.mount(BAND as never)
  // Signed in and with a known target, the band still stays away: tenantree was not used in this project.
  expect(JSON.stringify(await band.drawn())).toContain('ENGINE')
  expect(JSON.stringify(await band.drawn())).not.toContain('person@example.test')
  // Another tool does not count.
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'toolu_b' } as never)
  expect(JSON.stringify(await band.drawn())).toContain('ENGINE')

  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_q' } as never)
  const shown = JSON.stringify(await band.drawn())
  expect(shown).toContain('person@example.test')
  expect(shown).toContain('"key":"collapse"')
  expect(store.get('band:/projects/a')).toEqual({ used: true, collapsed: false })
})

test('TEPLU-17: the band folds to a badge and unfolds; the state is kept per project across a restart', async ($, on) => {
  const store = new Map<string, unknown>([['band:/projects/a', { used: true, collapsed: false }]])
  engine(on, '/projects/a', store)
  await $.session.start({ cwd: '/projects/a', surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_q' } as never)
  const band = await $.ui.mount(BAND as never)
  expect(JSON.stringify(await band.drawn())).toContain('person@example.test')

  await band.press({ key: 'collapse' } as never)
  const folded = JSON.stringify(await band.drawn())
  expect(folded).toContain('"key":"expand"')
  expect(folded).not.toContain('person@example.test')
  expect(store.get('band:/projects/a')).toEqual({ used: true, collapsed: true })

  await band.press({ key: 'expand' } as never)
  expect(JSON.stringify(await band.drawn())).toContain('person@example.test')
  expect(store.get('band:/projects/a')).toEqual({ used: true, collapsed: false })
})

test('TEPLU-17: after a restart a folded band stays folded, and another project keeps its own state', async ($, on) => {
  const store = new Map<string, unknown>([['band:/projects/a', { used: true, collapsed: true }]])
  engine(on, '/projects/b', store)
  await $.session.start({ cwd: '/projects/b', surface: 'desktop', isInteractive: true } as never)
  const band = await $.ui.mount(BAND as never)
  // Project b: never used, no band, although project a has one.
  expect(JSON.stringify(await band.drawn())).toContain('ENGINE')
  expect(store.has('band:/projects/b')).toBe(false)
})

test('TEPLU-17: a folded band shows its badge at once after a restart', async ($, on) => {
  const store = new Map<string, unknown>([['band:/projects/a', { used: true, collapsed: true }]])
  engine(on, '/projects/a', store)
  await $.session.start({ cwd: '/projects/a', surface: 'terminal', isInteractive: true } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"key":"expand"')
  expect(drawn).not.toContain('"key":"collapse"')
})

test('TEPLU-17: /tenantree shows the band, expanded, in a project without tenantree use', async ($, on) => {
  const store = new Map<string, unknown>([['band:/projects/c', { used: false, collapsed: true }]])
  engine(on, '/projects/c', store)
  await $.session.start({ cwd: '/projects/c', surface: 'desktop', isInteractive: true } as never)
  const band = await $.ui.mount(BAND as never)
  expect(JSON.stringify(await band.drawn())).toContain('ENGINE')
  await $.command.run({ command: 'tenantree', args: '' } as never)
  const shown = JSON.stringify(await band.drawn())
  expect(shown).toContain('"key":"collapse"')
  expect(shown).toContain('person@example.test')
  expect(store.get('band:/projects/c')).toEqual({ used: true, collapsed: false })
})

test('TEPLU-17: the folded badge keeps the production marker, pending approvals and a required sign-in', async ($, on) => {
  const store = new Map<string, unknown>([['band:/projects/a', { used: true, collapsed: true }]])
  const PROD = LIST.replace('"kind":"development","region"', '"kind":"production","region"').replace('"signedIn":true', '"signedIn":false')
  const PLAN = 'Plan: Create a queue (write level landscape)\nApproval page: https://portal.tenantree.de/plan/12345678-1234-1234-1234-123456789abc'
  let text = PROD
  engine(on, '/projects/a', store, () => text, () => PROD)
  await $.session.start({ cwd: '/projects/a', surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_q' } as never)
  text = PLAN
  await $.tool.call({ tool: `${P}eventmesh_queue_create`, tool_use_id: 'toolu_plan' } as never)
  const band = await $.ui.mount(BAND as never)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"key":"expand"')
  expect(drawn).toContain('Production')
  expect(drawn).toContain('1 approval pending')
  expect(drawn).toContain('Sign-in required')
})

test('TEPLU-17: a change of the project root while drawing reads the new project without writing', async ($, on) => {
  const store = new Map<string, unknown>([['band:/projects/a', { used: true, collapsed: false }]])
  let root = '/projects/a'
  engine(on, () => root, store)
  await $.session.start({ cwd: '/projects/a', surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: `${P}tenantree_landscape_query`, tool_use_id: 'toolu_q' } as never)
  const band = await $.ui.mount(BAND as never)
  expect(JSON.stringify(await band.drawn())).toContain('person@example.test')
  root = '/projects/b'
  await band.unmount()
  const again = await $.ui.mount(BAND as never)
  expect(JSON.stringify(await again.drawn())).toContain('ENGINE')
  expect(store.has('band:/projects/b')).toBe(false)
})
