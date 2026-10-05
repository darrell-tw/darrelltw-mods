/* @jsx h */
import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, PluginOptions, Register, RenderElement, RenderNode } from 'claude-code'

import type { AskPending, AskRedoOption, AskRedoQuestion } from '../types'

// ask-redo-mod: AskUserQuestion, answered from the prompt.
//
// ask-mod decorates the engine's dialog; this mod replaces it for the common
// case. A hook cannot wait for a person (ten seconds of its own time per
// dispatch), and the dialog site cannot be redrawn by a plugin (one engine
// node, at most 12 rows around it), so the only way to change how the person
// answers is to answer the call at once and collect the real answer later:
//
// 1. `tool.call` on AskUserQuestion takes over a call that is ONE single-choice
//    question with 2-4 options, from the main conversation, in a terminal-only
//    interactive session, with nothing else pending. It does not call `next`:
//    it keeps the question in $.state (mirrored to $.store for a restart) and
//    answers the call itself with `answers: {}` and a `response` saying the
//    person has not answered yet and the model must end its turn now.
// 2. `ui.render` on AbovePrompt draws the question in the band above the
//    prompt: one plain Button per option with hotkeys 1..n, which a bare digit
//    typed in an EMPTY composer presses (the engine's own survey mechanism),
//    and a 跳過 button on 0.
// 3. A press submits the answer as the person's next prompt
//    (`$.prompt.submit`, `asUser`); a prompt the person types while the
//    question waits is rewritten into the same answer form on its way in.
//
// Everything else (several questions, multi-select, text/number questions,
// previews, a subagent's call, another plugin's $.ui.ask, a session drawn
// anywhere but a terminal) goes to the engine's dialog untouched.
//
// This module never calls $.model.*. It costs the model one extra round-trip
// per question taken over: the call's turn ends, and the answer starts a new one.
//
// Never name a local variable `h`: every JSX tag in this file compiles to h(...).

// --- options -----------------------------------------------------------------

type Takeover = 'single-choice' | 'off'

type Config = {
  takeover: Takeover
  freeText: boolean
}

function readConfig(options: PluginOptions): Config {
  return {
    takeover: options.takeover === 'off' ? 'off' : 'single-choice',
    freeText: options.freeText !== false,
  }
}

// --- state -----------------------------------------------------------------------

const pendingAtom = atom({ plugin: 'ask-redo-mod', key: 'pending' } as const, null)

const COMMAND = 'ask-redo-clear'
const STORE_PREFIX = 'pending/'
const STORE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// --- what the model reads --------------------------------------------------------
// The tool's own mapper prints a hook result's `response` as "The user
// responded: <response>", so the text is written to read right after that.

/** The `response` of a taken-over call: what the model reads as the tool's result. */
export const RESPONSE_TEXT =
  "[ask-redo-mod] Not answered yet. The question is now shown above the user's prompt, and their answer will arrive as their next message. End your turn now with one short line saying you are waiting for their answer. Do not guess the answer, do not ask again, and do not continue the work that depends on it."

/** The reminder the model reads after the tool's result of a taken-over call. */
export const WAIT_REMINDER =
  'The AskUserQuestion call above was not answered in a dialog: ask-redo-mod moved the question above the user\'s prompt. Their answer arrives as their next message, starting "[AskUserQuestion answer]". END YOUR TURN NOW with one short line saying you are waiting for it. Do not guess the answer, do not re-ask, and do not continue any work that depends on it.'

/** The system prompt section that tells the model how this session answers AskUserQuestion. */
export const COMPOSE_SECTION = {
  id: 'ask-redo-mod:wait',
  text: 'AskUserQuestion in this session: a single-choice question may come back at once with a result saying the user has not answered yet and will answer in their next message. When it does, end your turn immediately with one short line saying you are waiting for their answer; do not guess it, re-ask it, or continue work that depends on it. The answer arrives as a user message starting "[AskUserQuestion answer]".',
  scope: 'session',
} as const

const ANSWER_PREFIX = '[AskUserQuestion answer]'

/** The prompt the model receives for an answer: the question, the pick (or the typed text), and the pick's description. */
export function formatAnswer(question: AskRedoQuestion, answer: AskRedoOption | string): string {
  const head = `${ANSWER_PREFIX} Q: "${question.question}" → A: `
  if (typeof answer === 'string') return `${head}${answer}`
  const line = `${head}${answer.label}`
  return answer.description === undefined ? line : `${line}\n${answer.description}`
}

/** The prompt the model receives when the person skips the question. */
export function formatSkip(question: AskRedoQuestion): string {
  return `${ANSWER_PREFIX} Q: "${question.question}" → skipped: the user chose not to answer. Proceed with your best judgement, or ask in a different way.`
}

// --- the question, parsed loosely ------------------------------------------------
// `e.questions` was validated against the tool's input schema before the call
// reached the hooks; parsed loosely all the same, so a field the schema grows
// later never throws here. Control characters are flattened to spaces: the
// band refuses a text child holding one.

const TEXT_MAX = 2000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  if (flat === '') return undefined
  return flat.length > TEXT_MAX ? `${flat.slice(0, TEXT_MAX - 1)}…` : flat
}

/** The one question a call could be taken over for: single choice, 2-4 options, no previews; else undefined. */
export function parseChoiceQuestion(raw: unknown): AskRedoQuestion | undefined {
  if (!Array.isArray(raw) || raw.length !== 1) return undefined
  const item: unknown = raw[0]
  if (!isRecord(item)) return undefined
  if (item.kind !== undefined && item.kind !== 'choice') return undefined
  if (item.multiSelect === true) return undefined
  const question = clean(item.question)
  if (question === undefined || !Array.isArray(item.options)) return undefined
  if (item.options.length < 2 || item.options.length > 4) return undefined
  const options: AskRedoOption[] = []
  for (const o of item.options) {
    if (!isRecord(o)) return undefined
    const label = clean(o.label)
    // a preview is what the engine's dialog shows beside the focused option;
    // the band has no room for one, so such a question stays the dialog's
    if (label === undefined || (typeof o.preview === 'string' && o.preview.trim() !== '')) return undefined
    const description = clean(o.description)
    options.push(description === undefined ? { label } : { label, description })
  }
  return { question, header: clean(item.header) ?? '', options }
}

/** Every surface the session draws on is a terminal (and there is at least one). */
export function isTerminalOnly(surfaces: readonly string[]): boolean {
  return surfaces.length > 0 && surfaces.every(s => s === 'terminal')
}

export type TakeOverContext = {
  /** the call's loop: absent on the main conversation */
  agentId?: string
  /** `next.origin.plugin`: "engine" for the model's own call, a plugin's name for its `$.ui.ask` */
  caller: string
  /** `$.session.surfaces()` */
  surfaces: readonly string[]
  /** `session.start`'s `isInteractive`; undefined while not yet seen */
  interactive?: boolean
  /** a question is already waiting above the prompt */
  isPending: boolean
  /** the call's `metadata.source`, set by the engine's own flows */
  source?: string
}

/** The question to take over, or undefined when the engine's dialog should ask it. */
export function canTakeOver(questions: unknown, ctx: TakeOverContext): AskRedoQuestion | undefined {
  if (ctx.agentId !== undefined || ctx.caller !== 'engine') return undefined
  if (ctx.interactive === false || !isTerminalOnly(ctx.surfaces)) return undefined
  if (ctx.isPending || ctx.source !== undefined) return undefined
  return parseChoiceQuestion(questions)
}

/**
 * What a prompt the person typed while a question waits stands for: an
 * option (a lone digit 1..n), a skip (a lone 0), free text (anything else,
 * when `freeText`), or undefined to send the prompt through untouched.
 */
export function typedAnswer(question: AskRedoQuestion, text: string, freeText: boolean): string | undefined {
  const typed = text.trim()
  if (typed === '') return undefined
  const digit = typed.normalize('NFKC')
  if (/^[0-9]$/.test(digit)) {
    const n = Number(digit)
    if (n === 0) return formatSkip(question)
    const option = question.options[n - 1]
    if (option !== undefined) return formatAnswer(question, option)
  }
  return freeText ? formatAnswer(question, typed) : undefined
}

function parsePending(value: unknown): AskPending | undefined {
  if (!isRecord(value)) return undefined
  const { toolUseId, sessionId, at } = value
  if (typeof toolUseId !== 'string' || typeof sessionId !== 'string' || typeof at !== 'number') return undefined
  const question = isRecord(value.question)
    ? parseChoiceQuestion([{ ...value.question, multiSelect: false }])
    : undefined
  return question === undefined ? undefined : { toolUseId, sessionId, question, at }
}

// --- fitting the band ----------------------------------------------------------------
// The band has no row rule of its own (its validator applies the dialog's
// 12-row budget only at the AskUserQuestion site): a tree taller than
// `maxRows` scrolls, and a bare digit then presses only the Buttons wholly in
// view. So the drawing is fitted to `maxRows`: descriptions fold to one
// truncated line first, then the hint row goes (跳過 moves up beside the
// question), then the question itself is cut to one line.
//
// What makes an option recognisable at a glance, in order of weight:
// - every option row starts in the same place, with a rail glyph in that
//   option's own colour (cyan, magenta, yellow, green: the same four ask-mod
//   paints its cards with), so the eye lands on "which row" before reading
// - the labels sit in one aligned column, the descriptions in another, so a
//   downward scan reads the labels alone
// - a label the model marked as its recommendation ("(Recommended)", 建議,
//   推薦) loses that suffix and wears a ★ badge instead
// - options with no descriptions sit on ONE row when they fit, so a yes/no
//   question costs three rows, not five

const SKIP_LABEL = '跳過'
const ROW_GAP = 2
const RAIL = '▌'
const RAIL_WIDTH = 2 // the glyph and a space
const MIN_DESCRIPTION_COLS = 8
const LABEL_COL_SHARE = 0.4 // the label column takes at most this share of the band
const RECOMMENDED_BADGE = '★ 建議'
const RECOMMENDED_PATTERN = /\s*[（(]\s*(recommended|suggested|建議|推薦|預設|default)\s*[)）]\s*$/iu

/** The colour of option `i`, the same on every drawing of this mod and of ask-mod. */
export const OPTION_COLORS = ['cyan', 'magenta', 'yellow', 'green'] as const
export const optionColor = (i: number): string => OPTION_COLORS[i % OPTION_COLORS.length]!

/** A label with its "(Recommended)" suffix lifted off into a flag. */
export function splitRecommended(label: string): { label: string; recommended: boolean } {
  const bare = label.replace(RECOMMENDED_PATTERN, '').trim()
  return bare === '' || bare === label ? { label, recommended: false } : { label: bare, recommended: true }
}

/** Terminal cells a string takes: CJK and other wide code points count two, combining marks none. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue
    if (cp >= 0x300 && cp <= 0x36f) continue
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    )
      width += 2
    else width += 1
  }
  return width
}

/** `text` cut to `cols` cells of display width, an ellipsis closing a cut. */
export function fitWidth(text: string, cols: number): string {
  if (displayWidth(text) <= cols) return text
  let out = ''
  let width = 0
  for (const ch of text) {
    const w = displayWidth(ch)
    if (width + w > cols - 1) break
    out += ch
    width += w
  }
  return `${out}…`
}

const rowsOf = (width: number, columns: number): number => Math.max(1, Math.ceil(width / Math.max(1, columns)))

const chipOf = (question: AskRedoQuestion): string => ` ${question.header === '' ? '問題' : question.header} `
const SKIP_WIDTH = displayWidth(`0: ${SKIP_LABEL}`)
const BADGE_WIDTH = displayWidth(RECOMMENDED_BADGE) + 1

/** The hint under the options: which digits answer, that 0 skips, that typing counts. */
export function hintText(count: number, freeText: boolean): string {
  return `${count === 1 ? '1' : `1–${count}`} 選${freeText ? ' · 直接打字也行' : ' · 打字不算回答'} · `
}

export type BandLayout = {
  /** descriptions wrap under their own room, or fold to one truncated line */
  descriptions: 'wrap' | 'truncate'
  /** the dim hint row with 跳過 on it; without it 跳過 sits beside the question */
  hint: boolean
  /** the question wraps, or is cut to one line */
  question: 'wrap' | 'truncate'
  /** no option carries a description and they all fit on one row: drawn across */
  across: boolean
  /** cells of the label column (`n: label`, plus a ★ badge where one is); every option row aligns on it */
  labelColumns: number
  /** the rows this layout is estimated at */
  rows: number
}

const headOf = (i: number, option: AskRedoOption): { text: string; width: number; recommended: boolean } => {
  const { label, recommended } = splitRecommended(option.label)
  const text = `${i + 1}: ${label}`
  return { text, width: displayWidth(text) + (recommended ? BADGE_WIDTH : 0), recommended }
}

/** The label column: the widest `n: label` (and its badge), capped to a share of the band. */
export function labelColumns(question: AskRedoQuestion, columns: number): number {
  const widest = Math.max(...question.options.map((o, i) => headOf(i, o).width))
  return Math.min(widest, Math.max(12, Math.floor(columns * LABEL_COL_SHARE)))
}

/** Columns left for a description beside the aligned label column, or 0 when too few to bother. */
export function descriptionColumns(columns: number, labelCols: number): number {
  const left = columns - RAIL_WIDTH - labelCols - ROW_GAP
  return left >= MIN_DESCRIPTION_COLS ? left : 0
}

function fitsAcross(question: AskRedoQuestion, columns: number): boolean {
  if (question.options.some(o => o.description !== undefined)) return false
  const width = question.options.reduce((sum, o, i) => sum + RAIL_WIDTH + headOf(i, o).width, 0) + ROW_GAP * (question.options.length - 1)
  return width <= columns
}

function estimateRows(
  question: AskRedoQuestion,
  columns: number,
  freeText: boolean,
  layout: Omit<BandLayout, 'rows'>,
): number {
  const topWidth = displayWidth(chipOf(question)) + 1 + displayWidth(question.question)
  const topColumns = layout.hint ? columns : columns - SKIP_WIDTH - ROW_GAP
  let rows = layout.question === 'wrap' ? rowsOf(topWidth, topColumns) : 1
  if (layout.across) rows += 1
  else {
    const room = descriptionColumns(columns, layout.labelColumns)
    question.options.forEach(o => {
      rows += o.description !== undefined && room > 0 && layout.descriptions === 'wrap' ? rowsOf(displayWidth(o.description), room) : 1
    })
  }
  if (layout.hint) rows += rowsOf(displayWidth(hintText(question.options.length, freeText)) + SKIP_WIDTH, columns)
  return rows
}

/** The roomiest layout of the band that fits `maxRows`, else the tightest. */
export function fitBand(question: AskRedoQuestion, columns: number, maxRows: number, freeText = true): BandLayout {
  const across = fitsAcross(question, columns)
  const labelCols = labelColumns(question, columns)
  const tiers: Omit<BandLayout, 'rows'>[] = [
    { descriptions: 'wrap', hint: true, question: 'wrap', across, labelColumns: labelCols },
    { descriptions: 'truncate', hint: true, question: 'wrap', across, labelColumns: labelCols },
    { descriptions: 'truncate', hint: false, question: 'wrap', across, labelColumns: labelCols },
    { descriptions: 'truncate', hint: false, question: 'truncate', across, labelColumns: labelCols },
  ]
  let last: BandLayout | undefined
  for (const tier of tiers) {
    last = { ...tier, rows: estimateRows(question, columns, freeText, tier) }
    if (last.rows <= maxRows) return last
  }
  return last!
}

// --- the drawing ---------------------------------------------------------------------

/** The elements both surfaces that raise the band have: what the drawing uses. */
type Elements = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>

export type BandInput = {
  question: AskRedoQuestion
  columns: number
  layout: BandLayout
  freeText: boolean
  /** pressed with the option's index, or null for 跳過 */
  onPick: (index: number | null) => unknown
}

export function drawBand(els: Elements, input: BandInput): RenderElement {
  const { Box, Text, Button } = els
  const { question, layout, columns } = input
  const skip = (
    <Button key="skip" plain hotkey="0" dimColor role="dismiss" onPress={() => input.onPick(null)}>
      {SKIP_LABEL}
    </Button>
  )
  const top = (
    <Text wrap={layout.question === 'wrap' ? 'wrap' : 'truncate-end'}>
      <Text inverse>{chipOf(question)}</Text> <Text bold>{question.question}</Text>
    </Text>
  )
  const room = descriptionColumns(columns, layout.labelColumns)

  // one option: its rail, its `n: label` button in the aligned column (a label
  // wider than the column is cut; the press answers by index, not by text), its
  // ★ badge, and its description
  const option = (o: AskRedoOption, i: number): RenderNode => {
    const head = headOf(i, o)
    const labelRoom = layout.labelColumns - 3 - (head.recommended ? BADGE_WIDTH : 0)
    const label = fitWidth(splitRecommended(o.label).label, Math.max(1, labelRoom))
    const cell = (
      <Box flexDirection="row" width={layout.across ? undefined : RAIL_WIDTH + layout.labelColumns} flexShrink={0}>
        <Text color={optionColor(i)}>{RAIL} </Text>
        <Button key={`option-${i + 1}`} plain hotkey={String(i + 1)} onPress={() => input.onPick(i)}>
          {label}
        </Button>
        {head.recommended && <Text color="yellow"> {RECOMMENDED_BADGE}</Text>}
      </Box>
    )
    if (layout.across) return cell
    return (
      <Box flexDirection="row" gap={ROW_GAP}>
        {cell}
        {o.description !== undefined && room > 0 && (
          <Text dimColor wrap={layout.descriptions === 'wrap' ? 'wrap' : 'truncate-end'}>
            {o.description}
          </Text>
        )}
      </Box>
    )
  }
  const rows: RenderNode[] = layout.across
    ? [<Box flexDirection="row" gap={ROW_GAP}>{question.options.map(option)}</Box>]
    : question.options.map(option)

  return (
    <Box flexDirection="column">
      {layout.hint ? (
        top
      ) : (
        <Box flexDirection="row" gap={ROW_GAP}>
          {top}
          {skip}
        </Box>
      )}
      {rows}
      {layout.hint && (
        <Box flexDirection="row">
          <Text dimColor>{hintText(question.options.length, input.freeText)}</Text>
          {skip}
        </Box>
      )}
    </Box>
  )
}

// --- keeping the pending question ------------------------------------------------------

const storeKey = (sessionId: string): string => `${STORE_PREFIX}${sessionId}`

async function keepPending($: EngineInterface, pending: AskPending): Promise<void> {
  await update($, pendingAtom, () => pending)
  try {
    await $.store.set(storeKey(pending.sessionId), pending)
  } catch (error) {
    $.ui.log(`ask-redo-mod: pending question not mirrored: ${String(error)}`, { to: 'debug' })
  }
}

/** Drops the pending question if it is still `pending`; true when this call dropped it. */
async function dropPending($: EngineInterface, pending: AskPending): Promise<boolean> {
  let dropped = false
  await update($, pendingAtom, held => {
    dropped = held !== null && held !== undefined && held.toolUseId === pending.toolUseId
    return dropped ? null : (held ?? null)
  })
  if (!dropped) return false
  try {
    await $.store.delete(storeKey(pending.sessionId))
  } catch (error) {
    $.ui.log(`ask-redo-mod: pending mirror not deleted: ${String(error)}`, { to: 'debug' })
  }
  return true
}

/** Restores this session's mirrored question; forgets other sessions' week-old ones. */
async function restorePending($: EngineInterface): Promise<void> {
  const [sessionId, now, keys] = await Promise.all([$.session.id(), $.clock.now(), $.store.keys()])
  for (const key of keys) {
    if (!key.startsWith(STORE_PREFIX)) continue
    const kept = parsePending(await $.store.get(key))
    if (kept !== undefined && kept.sessionId === sessionId) {
      await update($, pendingAtom, held => held ?? kept)
    } else if (kept === undefined || now - kept.at > STORE_MAX_AGE_MS) {
      await $.store.delete(key)
    }
  }
}

// --- the module ------------------------------------------------------------------------

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  // `session.start` fires again for this module on a reload, so the closure
  // learns it afresh; undefined (never seen) defers to the surfaces check
  let interactive: boolean | undefined

  on('session.start', async ($, e, next) => {
    // off: this pass-through is the module's one hook; every call goes to the
    // engine's dialog, nothing is drawn, nothing kept, no command registered
    if (cfg.takeover === 'off') return next(e)
    interactive = e.isInteractive
    try {
      await restorePending($)
    } catch (error) {
      $.ui.log(`ask-redo-mod: pending question not restored: ${String(error)}`, { to: 'debug' })
    }
    await $.command.register({
      name: COMMAND,
      description: '丟掉輸入框上方那題還沒回答的 AskUserQuestion（卡住時用），不送任何答案',
      immediate: true,
    })
    return next(e)
  })

  if (cfg.takeover === 'off') return

  // a /clear ends the conversation the question belongs to
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    try {
      const pending = await read($, pendingAtom)
      if (pending !== null) {
        await update($, pendingAtom, () => null)
        if (e.reason === 'clear') await $.store.delete(storeKey(pending.sessionId))
      }
    } catch (error) {
      $.ui.log(`ask-redo-mod: pending question not cleared at session end: ${String(error)}`, { to: 'debug' })
    }
    return ended
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    // the cheap refusals first: no `$` call for a subagent's or a plugin's ask
    if (e.agentId !== undefined || next.origin.plugin !== 'engine') return next(e)
    const [surfaces, held] = await Promise.all([$.session.surfaces(), read($, pendingAtom)])
    const question = canTakeOver(e.questions, {
      caller: next.origin.plugin,
      surfaces,
      interactive,
      isPending: held !== null,
      source: e.metadata?.source,
    })
    if (question === undefined) return next(e)

    const [sessionId, at] = await Promise.all([$.session.id(), $.clock.now()])
    await keepPending($, { toolUseId: e.tool_use_id, sessionId, question, at })
    // answered here, `next` never called: the engine's dialog never opens.
    // The result must fit the tool's output schema (questions and answers
    // required) or core turns it into an error result.
    return {
      result: { questions: e.questions, answers: {}, response: RESPONSE_TEXT },
      context: [WAIT_REMINDER],
    }
  })

  // the person typed a prompt while the question waits: that is the answer
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.text.trimStart().startsWith('/')) return next(e)
    const pending = await read($, pendingAtom)
    if (pending === null) return next(e)
    const text = typedAnswer(pending.question, e.text, cfg.freeText)
    if (text === undefined) return next(e)
    await dropPending($, pending)
    const entered = await next({ ...e, text })
    // a settings hook beneath refused it: the question still waits
    if (entered.drop !== undefined) await keepPending($, pending)
    return entered
  })

  on('command.run', { command: COMMAND }, async $ => {
    const pending = await read($, pendingAtom)
    if (pending === null || !(await dropPending($, pending))) return { text: '沒有待答的問題。' }
    return {
      text: `丟掉了待答的問題：${pending.question.question}`,
      context: [
        `The user dropped the pending AskUserQuestion ("${pending.question.question}") without answering it. Do not wait for that answer.`,
      ],
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes('AskUserQuestion') || !isTerminalOnly(e.surfaces)) return composed
    return { sections: [...composed.sections, COMPOSE_SECTION] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // an engine survey owns the band while it shows
    if (e.props.hasSurvey) return next(e)
    const pending = await read($, pendingAtom)
    if (pending === null) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const layout = fitBand(pending.question, columns, e.props.maxRows, cfg.freeText)
    return drawBand(
      { Box, Text, Button },
      {
        question: pending.question,
        columns,
        layout,
        freeText: cfg.freeText,
        // the press re-reads the state: a question answered meanwhile (typed,
        // pressed twice, dropped) is not answered again
        onPick: async index => {
          const now = await read($, pendingAtom)
          if (now === null || now.toolUseId !== pending.toolUseId) return
          const option = index === null ? undefined : now.question.options[index]
          const text = option === undefined ? formatSkip(now.question) : formatAnswer(now.question, option)
          if (!(await dropPending($, now))) return
          try {
            // queued as the person's own words; starts a turn once the session is idle
            await $.prompt.submit({ text, asUser: true })
          } catch (error) {
            $.ui.log(`ask-redo-mod: answer not submitted: ${String(error)}`)
            await keepPending($, now)
          }
        },
      },
    )
  })
}
