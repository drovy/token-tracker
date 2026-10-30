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
  // Stands for the engine's own drawing of each row.
  on('ui.render', ($, e) => {
    if (e.component === 'AskUserQuestion') return { type: 'engine', ref: 0 } as never
    const { Text } = $.ui.resolve(e)
    return <Text>engine {e.component}</Text>
  })
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

type Mounted = Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>
type Kit = Parameters<Parameters<typeof test>[1]>[0]

const pet = async (ui: Mounted) =>
  (await ui.find({ type: 'Text', text: /^\s*\( / }))?.text?.trim()

const site = ($: Kit, component: string, requestId: string, props: object, surface = 'terminal') =>
  $.ui.mount({ plugin: 'token-tracker', component, requestId, surface, props } as never)

const hint = ($: Kit, surface = 'terminal') =>
  site($, 'PromptHint', 'hint', { isDraft: false, isWorking: false, hint: '? for shortcuts' }, surface)

const toolRow = ($: Kit, id: string, tool: string) =>
  site($, 'ToolUse', id, { tool, input: {}, isRunning: true, isErrored: false, isInterrupted: false, isExpanded: false })

test('Clawd hops onto the row of each tool as it runs', async ($, on) => {
  const { clock } = engine(on, {})
  const seen: (string | undefined)[] = []
  const rows: Record<string, Mounted> = {}
  on('tool.call', async (_, e) => {
    seen.push(await pet(rows[e.tool_use_id!]))
    return (e.tool === 'Bash' ? { deny: 'not allowed' } : { result: 'ok' }) as never
  })
  await start($)
  const home = await hint($)
  expect(await home.find({ type: 'Text', text: /▐.███.▌/ })).toBeTruthy()
  for (const [id, tool] of [['r1', 'Read'], ['e1', 'Edit'], ['b1', 'Bash']]) rows[id] = await toolRow($, id, tool)

  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: 'C:/proj/src/app.ts' } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: 'C:/proj/src/app.ts', old_string: 'a', new_string: 'b' } as never)
  expect(await pet(rows.e1)).toBe('( hmm. )')
  expect(await pet(rows.r1)).toBeUndefined()
  expect(await home.find({ type: 'Text', text: /▐.███.▌/ })).toBeFalsy()
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' } as never)
  expect(seen).toEqual(['( reading app.ts )', '( editing app.ts )', '( running npm test )'])
  expect(await pet(rows.b1)).toBe('( oops! Bash )')

  await turn($)
  expect(await pet(rows.b1)).toBe('( done! +1.4k tokens )')
  await clock.advance(6000)
  expect(await pet(rows.b1)).toBeUndefined()
  expect(await home.find({ type: 'Text', text: /▐.███.▌/ })).toBeTruthy()
})

test('Clawd sits on the text box on desktop and watches the person type', async ($, on) => {
  engine(on, {})
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length } as never
  })
  await start($)
  const home = await site($, 'AbovePrompt', 'band', { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, viewport: { columns: 85, rows: 40 } }, 'desktop')
  const type = (text: string, inputText: string) =>
    ($ as unknown as { prompt: { edit: (e: object) => Promise<unknown> } }).prompt.edit({
      origin: { kind: 'person' }, text, cursor: text.length, start: text.length, end: text.length, inputText,
    })
  await type('', 'is this broken')
  expect(await pet(home)).toBe('( uh oh… )')
  await type('is this broken', '?')
  expect(await pet(home)).toBe('( a question! )')
  const svg = await home.find({ type: 'Svg' } as never) as { props?: { source?: string } } | undefined
  expect(svg?.props?.source ?? '').toContain('#D97757')
})

test('selecting a message sends Clawd to sit on it', async ($, on) => {
  const { clock } = engine(on, {})
  let picked: object | undefined
  on('ui.selection', () => ({ value: picked }) as never)
  await start($)
  const msg = await site($, 'AssistantMessage', 'm1', { text: 'hello', isFirstOfReply: true })
  await clock.advance(700)
  expect(await pet(msg)).toBeUndefined()
  picked = { text: 'hello', requestId: 'm1' }
  await clock.advance(700)
  expect(await pet(msg)).toBe("( what's this? )")
})

test('clicking into the pane brings Clawd there to be petted, then it naps', async ($, on) => {
  const { clock } = engine(on, {})
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pet(ui)).toBeUndefined()
  await ui.press({ key: 'call-clawd' })
  expect(await pet(ui)).toBe('( done! hi! )')
  await ui.press({ key: 'pet-clawd' })
  expect(await pet(ui)).toBe('( ♥ ♥ ♥ )')
  await clock.advance(6000)
  expect(await pet(ui)).toBeUndefined()
  await clock.advance(130_000)
  expect(await pet(ui)).toMatch(/^\( z/)
})

test('a question dialog gets Clawd on top', async ($, on) => {
  engine(on, {})
  let dialog: Mounted | undefined
  let during: string | undefined
  on('tool.call', async () => {
    during = await pet(dialog!)
    return { result: 'ok' } as never
  })
  await start($)
  dialog = await site($, 'AskUserQuestion', 'q1', { tool: 'AskUserQuestion', questions: [] })
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [] } as never)
  expect(during).toBe('( your turn! )')
})

test('Clawd reads the desktop text box when no typing event comes', async ($, on) => {
  const { clock } = engine(on, {})
  let draft = ''
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }) as never)
  await start($)
  const band = await site($, 'AbovePrompt', 'band', { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, viewport: { columns: 85, rows: 40 } }, 'desktop')
  draft = 'thanks so much'
  await clock.advance(700)
  expect(await pet(band)).toBe('( ♥ )')
  const svg = await band.find({ type: 'Svg' } as never) as { props?: { width?: number } } | undefined
  expect(svg?.props?.width).toBe(72)
})
