import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnUsage } from 'claude-code'

import type { Mood, Pet, SessionTally, Spot, SyncInfo, Tally } from '../types'

const PANE = 'token-tracker'
const MAX_SESSIONS = 500
const EMPTY: Tally = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0,
  costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, unpriced: 0,
}

// API list prices in dollars per million tokens: input, output, cache read,
// cache write (5-minute TTL). Matched by substring of the model id; a model
// not listed is counted in tokens but not priced.
const RATES: { match: string; rate: [number, number, number, number] }[] = [
  { match: 'fable-5-1', rate: [10, 50, 0.25, 12.5] },
  { match: 'opus-5-5', rate: [4, 20, 0.2, 5] },
  { match: 'sonnet-5-5', rate: [2, 10, 0.2, 2.5] },
  { match: 'haiku-5-5', rate: [0.1, 0.5, 0.01, 0.125] },
]

const session = atom({ plugin: 'token-tracker', key: 'session' } as const, null, { shape: 'tally-1' })
const total = atom({ plugin: 'token-tracker', key: 'total' } as const, EMPTY, { shape: 'tally-1' })
const recent = atom({ plugin: 'token-tracker', key: 'recent' } as const, [], { shape: 'tally-1' })
const sync = atom({ plugin: 'token-tracker', key: 'sync' } as const, null, { shape: 'sync-1' })
const pet = atom({ plugin: 'token-tracker', key: 'pet' } as const,
  { mood: 'idle', note: '', since: 0, frame: 0, steps: 0 } as Pet, { shape: 'pet-1' })
const spot = atom({ plugin: 'token-tracker', key: 'spot' } as const, { site: 'prompt' } as Spot, { shape: 'spot-1' })

const PARTS = [
  { field: 'input', costField: 'costInput', label: 'Input', color: 'claude' },
  { field: 'output', costField: 'costOutput', label: 'Output', color: 'success' },
  { field: 'cacheRead', costField: 'costCacheRead', label: 'Cache read', color: 'suggestion' },
  { field: 'cacheWrite', costField: 'costCacheWrite', label: 'Cache write', color: 'warning' },
] as const

const sum = (t: Tally) => t.input + t.output + t.cacheRead + t.cacheWrite
const cost = (t: Tally) =>
  (t.costInput || 0) + (t.costOutput || 0) + (t.costCacheRead || 0) + (t.costCacheWrite || 0)

const usd = (raw: number | undefined) => {
  const n = raw || 0
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const add = <T extends Tally>(old: T, u: TurnUsage): T => {
  const t = { ...EMPTY, ...old }
  const rate = RATES.find(r => u.model.includes(r.match))?.rate
  const price = (tokens: number, perMillion: number) => (tokens * perMillion) / 1e6
  const all = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

  return {
    ...old,
    input: t.input + u.input_tokens,
    output: t.output + u.output_tokens,
    cacheRead: t.cacheRead + u.cache_read_input_tokens,
    cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
    turns: t.turns + 1,
    costInput: t.costInput + (rate ? price(u.input_tokens, rate[0]) : 0),
    costOutput: t.costOutput + (rate ? price(u.output_tokens, rate[1]) : 0),
    costCacheRead: t.costCacheRead + (rate ? price(u.cache_read_input_tokens, rate[2]) : 0),
    costCacheWrite: t.costCacheWrite + (rate ? price(u.cache_creation_input_tokens, rate[3]) : 0),
    unpriced: t.unpriced + (rate ? 0 : all),
  }
}

const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k`
  : String(n)

const asTally = (v: unknown): Tally => ({ ...EMPTY, ...(v as Partial<Tally> | undefined) })
const asSessions = (v: unknown): Record<string, SessionTally> =>
  v && typeof v === 'object' ? (v as Record<string, SessionTally>) : {}

async function refresh($: EngineInterface) {
  const s = await read($, session)
  const t = await read($, total)
  $.ui.status(`${usd(s ? cost(s) : 0)} session · ${usd(cost(t))} all-time · ${fmt(s ? sum(s) : 0)} tokens`)
}

type DeviceFile = { device: string; updatedAt: number; total: Tally; sessions: SessionTally[] }

let syncSetting = ''

// The folder each computer writes its own totals file to. Defaults to one in
// OneDrive, which is the same folder on every PC signed in to that account.
async function syncFolder($: EngineInterface): Promise<string | undefined> {
  const set = syncSetting.trim()
  if (set.toLowerCase() === 'off') return undefined
  if (set) return set.replace(/[\\/]+$/, '')
  const oneDrive = await $.env.get('OneDrive')
  return oneDrive ? `${oneDrive}/Claude/token-tracker` : undefined
}

// This computer's id, made once and kept, so its file keeps the same name.
async function device($: EngineInterface): Promise<{ id: string; name: string }> {
  const kept = (await $.store.get('device')) as { id: string; name: string } | undefined
  if (kept?.id) return kept
  const name = (await $.env.get('COMPUTERNAME')) || (await $.env.get('HOSTNAME')) || 'device'
  const id = `${name.replace(/[^A-Za-z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
  await $.store.set('device', { id, name })
  return { id, name }
}

const plus = (a: Tally, b: Tally): Tally => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  turns: a.turns + b.turns,
  costInput: a.costInput + b.costInput,
  costOutput: a.costOutput + b.costOutput,
  costCacheRead: a.costCacheRead + b.costCacheRead,
  costCacheWrite: a.costCacheWrite + b.costCacheWrite,
  unpriced: a.unpriced + b.unpriced,
})

const newest = (list: SessionTally[]) =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)

// Writes this computer's totals to the sync folder, then adds every other
// computer's file to them. A folder that can't be reached leaves this
// computer's own numbers, with the error to show.
async function combine(
  $: EngineInterface, own: Tally, sessions: Record<string, SessionTally>,
): Promise<{ total: Tally; recent: SessionTally[]; info: SyncInfo | null }> {
  const mine = Object.values(sessions)
  const folder = await syncFolder($)
  if (!folder) return { total: own, recent: newest(mine), info: null }

  const me = await device($)
  let sum = asTally(own)
  let all = mine
  const devices = [me.name]
  try {
    const file: DeviceFile = { device: me.name, updatedAt: await $.clock.now(), total: own, sessions: newest(mine) }
    await $.fs.write(`${folder}/${me.id}.json`, JSON.stringify(file))
    for (const entry of await $.fs.list(folder)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === `${me.id}.json`) continue
      try {
        const other = JSON.parse(await $.fs.read(`${folder}/${entry.name}`)) as DeviceFile
        sum = plus(sum, asTally(other.total))
        all = all.concat((other.sessions ?? []).map(one => ({ ...EMPTY, ...one })))
        devices.push(other.device || entry.name.replace(/\.json$/, ''))
      } catch {
        // A file still syncing, or not one of ours: skip it this time.
      }
    }
    return { total: sum, recent: newest(all), info: { folder, devices } }
  } catch (err) {
    return { total: own, recent: newest(mine), info: { folder, devices, error: String((err as Error)?.message ?? err) } }
  }
}

async function show($: EngineInterface, own: Tally, sessions: Record<string, SessionTally>) {
  const c = await combine($, own, sessions)
  await update($, total, () => c.total)
  await update($, recent, () => c.recent)
  await update($, sync, () => c.info)
}

// Loads persisted totals and this session's entry (if resumed) into state.
async function load($: EngineInterface) {
  const id = await $.session.id()
  const sessions = asSessions(await $.store.get('sessions'))
  const now = await $.clock.now()
  const mine: SessionTally = sessions[id] ?? {
    ...EMPTY, id, cwd: await $.session.cwd(), startedAt: now, updatedAt: now,
  }
  await update($, session, () => mine)
  await show($, asTally(await $.store.get('total')), sessions)
  await refresh($)
}

// Clawd, the Claude crab, acts out what Claude is doing and goes where the
// action is: the line under the text box while the person types, the row of
// the tool that is running, a row the person selects, a question dialog, or
// the pane once it is clicked. One timer moves the animation on, lets moods
// wear off and watches the mouse selection.
const TICK = 600
const SETTLE = 5000
const DOZE = 120_000

const TOOLS: [RegExp, Mood][] = [
  [/^(Read|Grep|Glob|LS|NotebookRead)$/, 'reading'],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'editing'],
  [/^(Bash|PowerShell|Monitor)$/, 'running'],
  [/^(WebFetch|WebSearch)$|browser|chrome/i, 'browsing'],
  [/^(Agent|Task|Workflow)$/, 'helpers'],
  [/^AskUserQuestion$/, 'asking'],
]
const WALKS: Mood[] = ['running', 'browsing', 'happy']
const FADES: Mood[] = ['happy', 'oops', 'loved', 'curious']

const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// A few words on what a tool call is about: a file's name, a command, a URL.
function about(e: Record<string, unknown>): string {
  const path = e.file_path ?? e.notebook_path ?? e.path
  if (typeof path === 'string') return short(path.split(/[\\/]/).pop() || path)
  for (const field of ['command', 'pattern', 'url', 'query', 'description']) {
    const v = e[field]
    if (typeof v === 'string') return short(v.split('\n')[0].replace(/^https?:\/\//, ''))
  }
  return ''
}

async function feel($: EngineInterface, mood: Mood, note = '', gaze?: Pet['gaze']) {
  const since = await $.clock.now()
  await update($, pet, p => ({ ...p, mood, note, since, gaze }))
}

const go = ($: EngineInterface, to: Spot) =>
  update($, spot, at => (at.site === to.site && at.id === to.id ? at : to))

// The person typing: Clawd hurries to the text box and follows the cursor.
async function watch($: EngineInterface, text: string, cursor: number) {
  await go($, { site: 'prompt' })
  if (!text.trim()) return feel($, 'idle')
  const say = /\?\s*$/.test(text) ? 'a question!'
    : text.length > 400 ? "that's a lot!"
    : /\b(bug|error|broken|fix)\b/i.test(text) ? 'uh oh…'
    : /\b(thanks|thank you|nice|great|love)\b/i.test(text) ? '♥'
    : ''
  const gaze = cursor < text.length / 2 ? 'left' : 'right'
  const now = await read($, pet)
  if (now.mood === 'watching' && now.note === say && now.gaze === gaze) return
  await feel($, 'watching', say, gaze)
}

let ticker: Timer | undefined
let lastPick: string | undefined

// A new mouse selection in the transcript: Clawd goes to sit on that row.
async function follow($: EngineInterface) {
  const picked = await $.ui.selection().catch(() => undefined)
  const key = picked?.requestId ? `${picked.requestId}:${picked.text}` : undefined
  if (key === lastPick) return
  lastPick = key
  if (!picked?.requestId) return
  await go($, { site: 'row', id: picked.requestId })
  await feel($, 'curious')
}

async function tick($: EngineInterface) {
  await follow($)
  const now = await $.clock.now()
  await update($, pet, p => {
    const age = now - p.since
    const mood: Mood = FADES.includes(p.mood) && age > SETTLE ? 'idle'
      : p.mood === 'idle' && age > DOZE ? 'sleepy'
      : p.mood
    const walks = WALKS.includes(mood) || (mood === 'idle' && p.frame % 4 === 0)
    return {
      ...p,
      ...(mood !== p.mood && { mood, note: '', since: now }),
      frame: p.frame + 1,
      steps: p.steps + (walks ? 1 : 0),
    }
  })
}

const EYES = { open: ' ▐▛███▜▌ ', shut: ' ▐█████▌ ', left: ' ▐▛███▜▌ ', right: ' ▐▛███▜▌ ' }
const ARMS = { down: '▝▜█████▛▘', up: '▗▟█████▙▖' }
const LEGS = ['  ▘▘ ▝▝  ', '  ▝▘ ▘▝  ']

// What Clawd looks like and says in a mood, on a frame of the animation.
function pose(p: Pet) {
  const f = p.frame
  const flip = f % 2 === 0
  const blink = f % 7 === 0
  const dots = '.'.repeat((f % 3) + 1)
  const note = p.note ? ` ${p.note}` : ''
  const look = (eyes: keyof typeof EYES, arms: keyof typeof ARMS, legs: number, say: string) =>
    ({ eyes, arms, legs, rows: [EYES[eyes], ARMS[arms], LEGS[legs]], say })
  switch (p.mood) {
    case 'watching': return look(blink ? 'shut' : p.gaze ?? 'open', 'down', 0, p.note)
    case 'curious': return look(p.frame % 3 === 0 ? 'left' : 'right', 'up', 0, "what's this?")
    case 'thinking': return look(blink ? 'shut' : 'open', 'down', 0, `hmm${dots}`)
    case 'reading': return look(blink ? 'shut' : 'open', 'down', 0, `reading${note}`)
    case 'editing': return look('open', flip ? 'up' : 'down', 0, `editing${note}`)
    case 'running': return look('open', 'down', flip ? 0 : 1, `running${note}`)
    case 'browsing': return look('open', 'down', flip ? 0 : 1, `surfing${note}`)
    case 'helpers': return look('open', flip ? 'up' : 'down', 0, `calling helpers${dots}`)
    case 'asking': return look('open', 'up', 0, 'your turn!')
    case 'tinkering': return look('open', flip ? 'up' : 'down', 0, `using${note}`)
    case 'oops': return look(flip ? 'shut' : 'open', 'down', 0, `oops!${note}`)
    case 'happy': return look('open', flip ? 'up' : 'down', flip ? 0 : 1, `done!${note}`)
    case 'loved': return look('shut', 'up', 0, '♥ ♥ ♥')
    case 'sleepy': return look('shut', 'down', 0, ['z', 'zZ', 'zZz'][f % 3])
    default: return look(blink ? 'shut' : 'open', 'down', 0, '')
  }
}

type Pose = ReturnType<typeof pose>

// Clawd as pixel art, for the surfaces that draw images: the square orange
// body, two dark eyes, a nub of an arm each side and four little legs.
const ORANGE = '#D97757'
const EYE = '#1F1E1D'
const PX = 4

function clawdSvg(look: Pose, px = PX) {
  const r = (x: number, y: number, w: number, h: number, fill = ORANGE) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
  const armY = look.arms === 'up' ? 0 : 2
  const legs = look.legs === 0 ? [2, 2, 2, 2] : [2, 1, 2, 1]
  const shift = { open: 0, left: -1, right: 1, shut: 0 }[look.eyes]
  const eyes = look.eyes === 'shut'
    ? r(4.5, 2, 2, 0.5, EYE) + r(11.5, 2, 2, 0.5, EYE)
    : r(5 + shift, 1, 1, 2, EYE) + r(12 + shift, 1, 1, 2, EYE)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 7" width="${18 * px}" height="${7 * px}" shape-rendering="crispEdges">`
    + r(3, 0, 12, 5) + r(1, armY, 2, 2) + r(15, armY, 2, 2)
    + [4, 6, 11, 13].map((x, i) => r(x, 5, 1, legs[i])).join('')
    + eyes + '</svg>'
}

// The picture where the surface draws images, the block glyphs in a terminal.
// Small is one row tall, to perch on a line without moving it.
function drawClawd($: EngineInterface, e: { surface: string }, look: Pose, small = false) {
  if (e.surface === 'terminal') {
    const { Box, Text } = $.ui.resolve(e as never)
    const rows = small ? [look.rows[0].trim()] : look.rows
    return <Box flexDirection="column">{rows.map(row => <Text color="claude">{row}</Text>)}</Box>
  }
  const { Svg } = $.ui.resolve(e as never) as unknown as { Svg: (props: object) => unknown }
  const px = small ? 2 : PX
  return <Svg source={clawdSvg(look, px)} alt={`Clawd${look.say ? `: ${look.say}` : ''}`} width={18 * px} height={7 * px} />
}

// Clawd and its speech bubble side by side, small enough for one line.
function perch($: EngineInterface, e: { surface: string }, look: Pose) {
  const { Box, Text } = $.ui.resolve(e as never)
  return (
    <Box flexDirection="row" alignItems="center">
      {look.say && <Text color="subtle" wrap="truncate-end">( {look.say} ) </Text>}
      {drawClawd($, e, look, true)}
    </Box>
  )
}

// Draws Clawd sitting on the top right of an engine row it was sent to,
// painted over the row so nothing in it moves; any other row is left alone.
async function sit($: EngineInterface, e: { surface: string; requestId: string }, next: (e: never) => Promise<unknown>, here = (at: Spot) => at.site === 'row' && at.id === e.requestId) {
  const at = await read($, spot)
  if (!here(at)) return next(e as never)
  const { Box } = $.ui.resolve(e as never)
  const row = await next(e as never)
  return (
    <Box flexDirection="column">
      {row}
      <Box position="absolute" top={0} right={1}>{perch($, e, pose(await read($, pet)))}</Box>
    </Box>
  )
}

// Back and forth across the pane: a step count folded into 0…room.
const pace = (steps: number, room: number) => {
  if (room <= 0) return 0
  const k = steps % (2 * room)
  return k <= room ? k : 2 * room - k
}

export const register: Register = (on, options) => {
  syncSetting = typeof options.syncFolder === 'string' ? options.syncFolder : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show token usage for this session and all time',
    })
    void $.ui.open({ id: PANE, title: 'Token usage' })
    await load($)
    ticker?.cancel()
    ticker = $.clock.every(TICK, () => void tick($))
    lastPick = undefined

    return next(e)
  })

  // The status line is per chat, so redraw it whenever a chat becomes active
  // again, not only when its session starts or a turn finishes.
  on('turn.start', async ($, e, next) => {
    await load($)
    await feel($, 'thinking')
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const shown = box as { text?: string; cursor?: number }
    if (typeof shown?.text === 'string') await watch($, shown.text, shown.cursor ?? shown.text.length)
    return box
  })

  on('prompt.change', async ($, e, next) => {
    const box = e as unknown as { text?: string; cursor?: number }
    if (typeof box.text === 'string') await watch($, box.text, box.cursor ?? box.text.length)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await go($, { site: 'prompt' })
    await feel($, 'thinking')
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    await go($, { site: 'pane' })
    await feel($, 'curious')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const mood = TOOLS.find(([match]) => match.test(e.tool))?.[1] ?? 'tinkering'
    // Clawd's part never stands in the way of the call itself.
    await (async () => {
      if (e.tool_use_id && !e.agentId) await go($, { site: mood === 'asking' ? 'question' : 'row', id: e.tool_use_id })
      await feel($, mood, mood === 'tinkering' ? short(e.tool.replace(/^mcp__[^_]+__/, '')) : about(e as never))
    })().catch(() => {})
    const result = await next(e)
    if (result.deny !== undefined || result.isError) await feel($, 'oops', short(e.tool)).catch(() => {})
    else if (mood !== 'asking') await feel($, 'thinking').catch(() => {})
    return result
  })

  on('session.attach', async ($, e, next) => {
    await load($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    await go($, { site: 'prompt' })
    if (e.isAborted) await feel($, 'oops', 'stopped')
    else await feel($, 'happy', usage ? `+${fmt(usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens)} tokens` : '')
    if (!usage) return result

    const id = await $.session.id()
    const now = await $.clock.now()

    // Re-read the store each time so concurrent sessions don't clobber each other.
    const sessions = asSessions(await $.store.get('sessions'))
    const prev = (await read($, session)) ?? {
      ...EMPTY, id, cwd: await $.session.cwd(), startedAt: now, updatedAt: now,
    }
    const base = sessions[id] ?? prev
    const mine = { ...add(base, usage), updatedAt: now }
    sessions[id] = mine

    const ids = Object.keys(sessions)
    if (ids.length > MAX_SESSIONS) {
      ids.sort((a, b) => sessions[a].updatedAt - sessions[b].updatedAt)
        .slice(0, ids.length - MAX_SESSIONS)
        .forEach(old => delete sessions[old])
    }

    const newTotal = add(asTally(await $.store.get('total')), usage)
    await $.store.set('sessions', sessions)
    await $.store.set('total', newTotal)

    await update($, session, () => mine)
    await show($, newTotal, sessions)
    await refresh($)

    return result
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: 'Token usage' })
    const s = await read($, session)
    const t = await read($, total)

    return {
      text: `This session: ${usd(s ? cost(s) : 0)} (${(s ? sum(s) : 0).toLocaleString()} tokens). All time: ${usd(cost(t))} (${sum(t).toLocaleString()} tokens). API list prices.`,
    }
  })

  // Clawd's home: the hint line right under the text box.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if ((await read($, spot)).site !== 'prompt') return next(e)
    const { Box } = $.ui.resolve(e)
    const line = await next(e)
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexGrow={1}>{line as never}</Box>
        {perch($, e, pose(await read($, pet)))}
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => sit($, e, next as never))
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => sit($, e, next as never))
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => sit($, e, next as never))
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => sit($, e, next as never))
  // Calls folded into a group have no row of their own: sit on the group.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => sit($, e, next as never,
    at => at.site === 'row' && !e.props.isExpanded && e.props.calls.some(c => c.tool_use_id === at.id)))

  // A question for the person: Clawd sits on top of the dialog.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const at = await read($, spot)
    if (at.site !== 'question' || at.id !== e.requestId) return next(e)
    const { Box } = $.ui.resolve(e)
    const look = pose(await read($, pet))
    const dialog = await next(e)
    return (
      <Box flexDirection="column">
        {perch($, e, look)}
        {dialog as never}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, session)
    const clawd = await read($, pet)
    const at = await read($, spot)
    const t = await read($, total)
    const list = await read($, recent)
    const synced = await read($, sync)
    const barWidth = Math.max(10, (e.props.bodyColumns ?? 40) - 6)

    // A rounded, Claude-orange bordered bubble.
    const card = (key: string, title: string, body: unknown) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="claude"
        paddingX={1} marginBottom={1}>
        <Text color="claude" bold>{title}</Text>
        {body}
      </Box>
    )

    // One coloured segment per category, sized by its share of the cost
    // (or of the tokens, when nothing is priced yet).
    const bar = (x: Tally) => {
      const byCost = cost(x) > 0
      const all = byCost ? cost(x) : sum(x)
      if (all === 0) return <Text color="subtle">{'─'.repeat(barWidth)}</Text>
      return (
        <Box flexDirection="row">
          {PARTS.map(p => {
            const n = Math.round(((byCost ? x[p.costField] : x[p.field]) / all) * barWidth)
            return n > 0 ? <Text color={p.color}>{'━'.repeat(n)}</Text> : null
          })}
        </Box>
      )
    }

    const tally = (key: string, title: string, raw: Tally) => {
      const x = { ...EMPTY, ...raw }
      return card(key, title, (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold size="title">{usd(cost(x))}</Text>
          <Text color="subtle">{sum(x).toLocaleString()} tokens · {x.turns} turns</Text>
        </Box>
        {bar(x)}
        {PARTS.map(p => (
          <Box flexDirection="row" justifyContent="space-between">
            <Text><Text color={p.color}>●</Text> <Text color="subtle">{p.label}</Text></Text>
            <Text tabular>{x[p.field].toLocaleString()} · {usd(x[p.costField])}</Text>
          </Box>
        ))}
        {x.unpriced > 0 && (
          <Text color="warning">{x.unpriced.toLocaleString()} tokens from models with no known price are not in the cost</Text>
        )}
      </Box>
      ))
    }

    const look = pose(clawd)
    const x = pace(clawd.steps, Math.max(0, (e.props.bodyColumns ?? 40) - 14 - (look.say ? look.say.length + 4 : 0)))
    const home = at.site !== 'pane' ? (
      <Box key="pet" flexDirection="row" marginBottom={1}>
        <Button key="call-clawd" plain label="call Clawd here" onPress={async () => { await go($, { site: 'pane' }); await feel($, 'happy', 'hi!') }} />
      </Box>
    ) : (
      <Box key="pet" flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" alignItems="center" marginLeft={x}>
          {drawClawd($, e, look)}
          {look.say && <Text color="subtle" wrap="truncate-end"> ( {look.say} )</Text>}
        </Box>
        <Button key="pet-clawd" plain label="pet Clawd" onPress={() => void feel($, 'loved')} />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {home}
        {tally('session', 'This session', s ?? EMPTY)}
        {tally('total', synced && synced.devices.length > 1 ? `All time · ${synced.devices.length} computers` : 'All time', t)}
        {card('recent', 'Recent sessions', (
          <Box flexDirection="column">
            {list.length === 0 && <Text color="subtle">None yet.</Text>}
            {list.map(one => {
              const isMine = one.id === s?.id
              return (
                <Box flexDirection="row" justifyContent="space-between">
                  <Text color={isMine ? 'claude' : 'subtle'} wrap="truncate-end">
                    {isMine ? '▸ ' : '  '}{one.cwd.split(/[\\/]/).pop()} · {new Date(one.updatedAt).toLocaleDateString()}
                  </Text>
                  <Text tabular bold={isMine}>{usd(cost(one))}</Text>
                </Box>
              )
            })}
          </Box>
        ))}
        {synced?.error
          ? <Text color="warning" wrap="wrap">Can't sync with {synced.folder}: {synced.error}</Text>
          : synced
            ? <Text color="subtle" wrap="wrap">Synced through {synced.folder} ({synced.devices.join(', ')})</Text>
            : <Text color="subtle" wrap="wrap">Not syncing: set a sync folder in the mod's settings to share totals between computers.</Text>}
        <Text color="subtle" wrap="wrap">
          API list prices with 5-minute cache writes. A subscription isn't billed per token, so this is what the same use would cost on the API. Cost counts from when this version was installed.
        </Text>
      </Box>
    )
  })
}
