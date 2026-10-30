import { expect, mock, test } from 'claude-code/testing'

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

test('a turn adds to the session and all-time totals', async ($, on) => {
  mock.store(on, { total: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, turns: 1, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, unpriced: 0 } })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'hi' }))

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
    text: 'hi', answer: 'hi', durationMs: 1, isAborted: false, turnId: 't1',
    reason: 'answer', usage: USAGE,
  } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^This session$/ }))?.text).toBe('This session')
    expect((await ui.find({ type: 'Text', text: /1,350 tokens/ }))?.text).toBe('1,350 tokens · 1 turns')
    expect((await ui.find({ type: 'Text', text: /1,360 tokens/ }))?.text).toBe('1,360 tokens · 2 turns')
    await ui.unmount()
  }
})

test('the usage band shows above the prompt before any turn or /tokens', async ($, on) => {
  mock.store(on, { total: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, turns: 1, costInput: 1.5, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, unpriced: 0 } })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'token-tracker', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, scroll: { offset: 0, bodyRows: 10 } },
  } as never)
  expect((await ui.find({ type: 'Text', text: /all-time/ }))?.text)
    .toBe('Tokens: $0.00 session · $1.50 all-time · 0 tokens')
  await ui.unmount()
})
