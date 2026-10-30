export type Tally = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
  costInput: number
  costOutput: number
  costCacheRead: number
  costCacheWrite: number
  unpriced: number
}

export type SessionTally = Tally & {
  id: string
  cwd: string
  startedAt: number
  updatedAt: number
}

export type SyncInfo = {
  folder: string
  devices: string[]
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'token-tracker': {
      session: Shaped<SessionTally | null>
      total: Shaped<Tally>
      recent: Shaped<SessionTally[]>
      sync: Shaped<SyncInfo | null>
    }
  }
}
