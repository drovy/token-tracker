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

export type Mood =
  | 'idle' | 'thinking' | 'reading' | 'editing' | 'running' | 'browsing'
  | 'helpers' | 'asking' | 'tinkering' | 'oops' | 'happy' | 'loved' | 'sleepy'
  | 'watching' | 'curious'

export type Pet = {
  mood: Mood
  note: string
  since: number
  frame: number
  steps: number
  gaze?: 'left' | 'right'
}

// Where Clawd sits: under the text box, on a transcript row (a message id or
// tool_use_id), on a question dialog, or in the pane.
export type Spot = {
  site: 'prompt' | 'row' | 'question' | 'pane'
  id?: string
}

declare module 'claude-code' {
  interface PluginState {
    'token-tracker': {
      session: Shaped<SessionTally | null>
      total: Shaped<Tally>
      recent: Shaped<SessionTally[]>
      sync: Shaped<SyncInfo | null>
      pet: Shaped<Pet>
      spot: Shaped<Spot>
    }
  }
}
