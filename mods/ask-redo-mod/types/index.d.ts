/** One option of the question the band draws: its label, and its description when it has one. */
export type AskRedoOption = { label: string; description?: string }

/** The one single-choice question ask-redo-mod took over, parsed off the tool's input. */
export type AskRedoQuestion = {
  question: string
  /** the chip; '' when the call gave none */
  header: string
  /** two to four, in the order the model gave them */
  options: AskRedoOption[]
}

/** The question waiting for the person's answer: drawn above the prompt until it is answered or dropped. */
export type AskPending = {
  /** the AskUserQuestion call that was answered "not yet" */
  toolUseId: string
  /** the session it was asked in: the store mirror is restored only into the same session */
  sessionId: string
  question: AskRedoQuestion
  /** when it was taken over, in $.clock.now() milliseconds */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'ask-redo-mod': {
      /** the question waiting above the prompt, or null when none is */
      pending: AskPending | null
    }
  }
}
