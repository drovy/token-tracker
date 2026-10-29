import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { SessionTally, Tally } from '../types'

const PANE = 'token-tracker'
const MAX_SESSIONS = 500
const EMPTY: Tally = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }

const session = atom({ plugin: 'token-tracker', key: 'session' } as const, null, { shape: 'tally-1' })
const total = atom({ plugin: 'token-tracker', key: 'total' } as const, EMPTY, { shape: 'tally-1' })
const recent = atom({ plugin: 'token-tracker', key: 'recent' } as const, [], { shape: 'tally-1' })

const PARTS = [
  { field: 'input', label: 'Input', color: 'claude' },
  { field: 'output', label: 'Output', color: 'success' },
  { field: 'cacheRead', label: 'Cache read', color: 'suggestion' },
  { field: 'cacheWrite', label: 'Cache write', color: 'warning' },
] as const

const sum = (t: Tally) => t.input + t.output + t.cacheRead + t.cacheWrite

const add = <T extends Tally>(t: T, u: TurnUsage): T => ({
  ...t,
  input: t.input + u.input_tokens,
  output: t.output + u.output_tokens,
  cacheRead: t.cacheRead + u.cache_read_input_tokens,
  cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
  turns: t.turns + 1,
})

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
  $.ui.status(`Tokens: ${fmt(s ? sum(s) : 0)} session · ${fmt(sum(t))} all-time`)
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
  const storedTotal = asTally(await $.store.get('total'))
  await update($, total, () => storedTotal)
  await update($, recent, () =>
    Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20))
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show token usage for this session and all time',
    })
    await load($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
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
    await update($, total, () => newTotal)
    await update($, recent, () =>
      Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20))
    await refresh($)

    return result
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: 'Token usage' })
    const s = await read($, session)
    const t = await read($, total)

    return {
      text: `This session: ${(s ? sum(s) : 0).toLocaleString()} tokens. All time: ${sum(t).toLocaleString()} tokens.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, session)
    const t = await read($, total)
    const list = await read($, recent)
    const barWidth = Math.max(10, (e.props.bodyColumns ?? 40) - 6)

    // A rounded, Claude-orange bordered bubble.
    const card = (key: string, title: string, body: unknown) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="claude"
        paddingX={1} marginBottom={1}>
        <Text color="claude" bold>{title}</Text>
        {body}
      </Box>
    )

    // One coloured segment per category, sized by its share of the total.
    const bar = (x: Tally) => {
      const all = sum(x)
      if (all === 0) return <Text color="subtle">{'─'.repeat(barWidth)}</Text>
      return (
        <Box flexDirection="row">
          {PARTS.map(p => {
            const n = Math.round((x[p.field] / all) * barWidth)
            return n > 0 ? <Text color={p.color}>{'━'.repeat(n)}</Text> : null
          })}
        </Box>
      )
    }

    const tally = (key: string, title: string, x: Tally) => card(key, title, (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold size="title">{sum(x).toLocaleString()}</Text>
          <Text color="subtle">{x.turns} turns</Text>
        </Box>
        {bar(x)}
        {PARTS.map(p => (
          <Box flexDirection="row" justifyContent="space-between">
            <Text><Text color={p.color}>●</Text> <Text color="subtle">{p.label}</Text></Text>
            <Text tabular>{x[p.field].toLocaleString()}</Text>
          </Box>
        ))}
      </Box>
    ))

    return (
      <Box flexDirection="column">
        {tally('session', 'This session', s ?? EMPTY)}
        {tally('total', 'All time', t)}
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
                  <Text tabular bold={isMine}>{fmt(sum(one))}</Text>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
