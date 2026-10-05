/** The paragraph Claude wrote right before it asked: what the context strip quotes. */
export type AskLead = { text: string; at: number }

/** One remembered answer, keyed by the question's full text in AskHistory. */
export type AskHistoryEntry = {
  /** the answer as the tool reported it: one label, or several comma-joined */
  answer: string
  /** the question's header chip, for a looser match when the wording moved */
  header: string
  /** the option labels the question offered, in order */
  labels: string[]
  at: number
}

export type AskHistory = Record<string, AskHistoryEntry>

/** One option of a choice question, as the compare board draws it. */
export type AskOption = { label: string; description?: string; preview?: string }

/** One question of the round, parsed loosely off the tool's input. */
export type AskQuestion = {
  question: string
  header: string
  kind: 'choice' | 'text' | 'number'
  description?: string
  options: AskOption[]
  multiSelect: boolean
  placeholder?: string
  min?: number
  max?: number
  step?: number
  unit?: string
  defaultValue?: number
}

/** The AskUserQuestion call in flight: what the compare pane and the strip draw from. */
export type AskCurrent = {
  /** the call's tool_use_id, the dialog's requestId */
  requestId: string
  questions: AskQuestion[]
  /** whether the compare pane was seated: null before the open was tried, false when the terminal was too narrow */
  placed: boolean | null
}

declare module 'claude-code' {
  interface PluginState {
    'ask-mod': {
      /** the person's own say on the compare pane: closed it by hand (false), asked for it (true); null follows the `compare` option */
      compareOpen: boolean | null
      lead: AskLead | null
      history: AskHistory
      current: AskCurrent | null
    }
  }
}
