import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'token-tracker',
  component: 'Pane',
  requestId: 'token-tracker',
  props: {
    title: 'Token usage',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 200,
  model: 'claude-opus-5-5',
}

const TOTAL = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, turns: 1, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, unpriced: 0 }

// The engine beneath the mod: an in-memory disk, and a record of opened panes.
function engine(on: On, env: Record<string, string>, files: Record<string, string> = {}, total = TOTAL) {
  const opened: string[] = []
  const norm = (p: string) => p.replace(/\\/g, '/')
  mock.store(on, { total })
  const clock = mock.clock(on)
  mock.env(on, env)
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.open', (_, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('fs.write', (_, e) => ((files[norm(e.path)] = e.text), { value: undefined }))
  on('fs.read', (_, e) => {
    if (!(norm(e.path) in files)) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[norm(e.path)] }
  })
  on('fs.list', (_, e) => ({
    value: Object.keys(files)
      .filter(p => p.startsWith(`${norm(e.path)}/`))
      .map(p => ({ name: p.slice(norm(e.path).length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'hi' }))
  return { opened, files, statuses, clock }
}

const start = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

const turn = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.turn.complete({
    text: 'hi', answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1',
    reason: 'answer', usage: USAGE,
  } as never)

test('the pane opens by itself when a session starts', async ($, on) => {
  const { opened } = engine(on, {})
  await start($)
  expect(opened).toEqual(['token-tracker'])
})

test('a turn adds to the session and all-time totals', async ($, on) => {
  engine(on, {})
  await start($)
  await turn($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^This session$/ }))?.text).toBe('This session')
    expect((await ui.find({ type: 'Text', text: /1,350 tokens/ }))?.text).toBe('1,350 tokens · 1 turns')
    expect((await ui.find({ type: 'Text', text: /1,360 tokens/ }))?.text).toBe('1,360 tokens · 2 turns')
    expect((await ui.find({ type: 'Text', text: /^Not syncing/ }))).toBeTruthy()
    await ui.unmount()
  }
})

test('totals sync with the other computer through OneDrive', async ($, on) => {
  const folder = 'C:/Users/me/OneDrive/Claude/token-tracker'
  const laptop = {
    device: 'LAPTOP',
    updatedAt: 5,
    total: { ...TOTAL, input: 1000, turns: 4 },
    sessions: [{ ...TOTAL, input: 1000, turns: 4, id: 'l1', cwd: 'C:/work/site', startedAt: 1, updatedAt: 5 }],
  }
  const { files } = engine(on, { OneDrive: 'C:/Users/me/OneDrive', COMPUTERNAME: 'DESKTOP' }, {
    [`${folder}/LAPTOP-abc123.json`]: JSON.stringify(laptop),
  })
  await start($)
  await turn($)

  const mine = Object.keys(files).find(p => p.includes('/DESKTOP-'))
  expect(mine).toBeTruthy()
  expect(JSON.parse(files[mine!]).total.turns).toBe(2)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^All time · 2 computers$/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /2,360 tokens/ }))?.text).toBe('2,360 tokens · 6 turns')
    expect((await ui.find({ type: 'Text', text: /site/ }))).toBeTruthy()
    await ui.unmount()
  }
})

test('usage shows in the status line before any turn or /tokens', async ($, on) => {
  const { statuses } = engine(on, {}, {}, { ...TOTAL, costInput: 1.5 })
  await start($)
  expect(statuses.at(-1)).toBe('$0.00 session · $1.50 all-time · 0 tokens')
})

const pet = async (ui: Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>) =>
  (await ui.find({ type: 'Text', text: /^\s*\( / }))?.text?.trim()

test('Clawd acts out what Claude is doing', async ($, on) => {
  engine(on, {})
  const seen: (string | undefined)[] = []
  let ui: Awaited<ReturnType<typeof $.ui.mount>>
  on('tool.call', async (_, e) => {
    seen.push(await pet(ui))
    return (e.tool === 'Bash' ? { deny: 'not allowed' } : { result: 'ok' }) as never
  })
  await start($)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.tool.call({ tool: 'Read', file_path: 'C:/proj/src/app.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proj/src/app.ts', old_string: 'a', new_string: 'b' } as never)
  expect(await pet(ui)).toBe('( hmm. )')
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(seen).toEqual(['( reading app.ts )', '( editing app.ts )', '( running npm test )'])
  expect(await pet(ui)).toBe('( oops! Bash )')

  await turn($)
  expect(await pet(ui)).toBe('( done! +1.4k tokens )')
  await ui.unmount()
})

test('petting Clawd makes it happy, then it settles and naps', async ($, on) => {
  const { clock } = engine(on, {})
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'pet-clawd' })
  expect(await pet(ui)).toBe('( ♥ ♥ ♥ )')
  await clock.advance(6000)
  expect(await pet(ui)).toBeUndefined()
  await clock.advance(130_000)
  expect(await pet(ui)).toMatch(/^\( z/)
  await ui.unmount()
})
