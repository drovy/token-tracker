export type Tally = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

export type SessionTally = Tally & {
  id: string
  cwd: string
  startedAt: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'token-tracker': {
      session: Shaped<SessionTally | null>
      total: Shaped<Tally>
      recent: Shaped<SessionTally[]>
    }
  }
}
