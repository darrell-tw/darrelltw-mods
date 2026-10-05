/* @jsx h */
import { atom, read, update } from 'claude-code'
import type { ElementTable, PluginOptions, Register, RenderElement, RenderNode } from 'claude-code'

import type { AskCurrent, AskHistory, AskHistoryEntry, AskLead, AskOption, AskQuestion } from '../types'

// ask-mod: a richer AskUserQuestion.
//
// Two drawings, one call. While an AskUserQuestion call is open:
//
// 1. The dialog itself is wrapped, not replaced. A `ui.render` hook on the
//    AskUserQuestion site asks the engine for its own dialog with `next(e)`
//    and puts a short context strip ABOVE it: how many questions, their
//    header chips, who asked, the paragraph Claude wrote right before asking,
//    and `↺ 上次選過` for a question that has come up before. The dialog
//    keeps the keyboard because it is still the engine's element.
//
//    The engine holds the tree around its dialog to hard rules (read off the
//    2.1.289 bundle, see docs/api-notes.md): at most 12 estimated rows, the
//    dialog last in document order, no Markdown, no width/height/position
//    props. So the strip is a handful of one-line Texts, each cut to fit, and
//    everything that needs room goes to a pane.
//
// 2. The compare board is a Pane. `tool.call` on AskUserQuestion opens it
//    before handing the call on and closes it once the answer is in; its own
//    `ui.render` lays every option out side by side with its description and
//    its preview RENDERED (a diff as a diff, fenced code as code, prose as
//    markdown), which the native dialog only shows for the focused option.
//    Wide fullscreen terminals dock it beside the transcript; narrower ones
//    seat it inline above the prompt, or not at all below the engine's
//    144-column floor for a pane nobody asked for, in which case the strip
//    says so and `/ask-compare` opens it by hand (which also lowers the floor
//    to 110 for the rest of the session).
//
// Why not own the dialog outright (intercept `tool.call`, draw a pane, answer
// with the pick)? A hook has ten seconds of its own time per dispatch, and a
// person takes longer than that to read four options. Waiting on `next(e)`
// is free, so the pane rides the engine's own dialog instead.
//
// This module never calls $.model.* and never touches the prompt or the
// questions. It writes the person's answers to $.store (so 上次選過 survives a
// restart) and the lead, the open call and the person's pane toggle to $.state.
//
// Never name a local variable `h`: every JSX tag in this file compiles to h(...).

// --- options -----------------------------------------------------------------

type CompareMode = 'auto' | 'always' | 'off'

type Config = {
  compare: CompareMode
  showLead: boolean
  showHistory: boolean
  previewLines: number
  cardMinColumns: number
}

const DEFAULTS: Config = {
  compare: 'auto',
  showLead: true,
  showHistory: true,
  previewLines: 12,
  cardMinColumns: 28,
}

function readConfig(options: PluginOptions): Config {
  const compare = options.compare
  const previewLines = options.previewLines
  const cardMinColumns = options.cardMinColumns
  return {
    compare: compare === 'always' || compare === 'off' ? compare : 'auto',
    showLead: options.showLead !== false,
    showHistory: options.showHistory !== false,
    previewLines:
      typeof previewLines === 'number' && previewLines >= 1 ? Math.floor(previewLines) : DEFAULTS.previewLines,
    cardMinColumns:
      typeof cardMinColumns === 'number' && cardMinColumns >= 12
        ? Math.floor(cardMinColumns)
        : DEFAULTS.cardMinColumns,
  }
}

// --- state ---------------------------------------------------------------------

const compareOpen = atom({ plugin: 'ask-mod', key: 'compareOpen' } as const, null)
const leadAtom = atom({ plugin: 'ask-mod', key: 'lead' } as const, null)
const historyAtom = atom({ plugin: 'ask-mod', key: 'history' } as const, {})
const currentAtom = atom({ plugin: 'ask-mod', key: 'current' } as const, null)

export const PANE = 'ask-mod'
const PANE_TITLE = '選項比較'
const PANE_ROWS = 16
const COMMAND = 'ask-compare'

const HISTORY_STORE_KEY = 'history'
const HISTORY_MAX = 300
const LEAD_MAX_CHARS = 240

// --- the questions, as the dialog draws them ------------------------------------
// `e.props.questions` is `unknown[]`: the tool's own schema, which the engine
// validated before the dialog opened. Parsed loosely all the same, so a field
// the schema grows later never throws here.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v
  return out as T
}

export function parseQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestion[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const question = str(item.question)
    if (question === undefined) continue
    const options: AskOption[] = []
    if (Array.isArray(item.options)) {
      for (const o of item.options) {
        if (!isRecord(o)) continue
        const label = str(o.label)
        if (label === undefined) continue
        options.push(compact({ label, description: str(o.description), preview: str(o.preview) }))
      }
    }
    const kind = item.kind === 'text' || item.kind === 'number' ? item.kind : 'choice'
    // compact(): the parsed round is kept in $.state as JSON, where an
    // `undefined` field would be dropped anyway; dropping it here keeps what a
    // test compares equal to what a drawing reads back
    out.push(
      compact({
        question,
        header: str(item.header) ?? '',
        kind,
        description: str(item.description),
        options,
        multiSelect: item.multiSelect === true,
        placeholder: str(item.placeholder),
        min: num(item.min),
        max: num(item.max),
        step: num(item.step),
        unit: str(item.unit),
        defaultValue: num(item.defaultValue),
      }),
    )
  }
  return out
}

const hasChoices = (q: AskQuestion): boolean => q.kind === 'choice' && q.options.length > 0
const hasPreview = (questions: readonly AskQuestion[]): boolean =>
  questions.some(q => q.options.some(o => o.preview !== undefined))

// --- the compare pane's open/closed rule ----------------------------------------

/** Whether the pane is wanted: the person's say wins, else the `compare` option's rule. */
export function decideCompare(mode: CompareMode, toggled: boolean | null, questions: readonly AskQuestion[]): boolean {
  if (mode === 'off' || !questions.some(hasChoices)) return false
  if (toggled !== null) return toggled
  if (mode === 'always') return true
  // auto: a preview is the one thing the native dialog hides until an option
  // is focused, so any preview earns the pane; so does a description-heavy
  // round (two or more questions, or descriptions on most options), which the
  // dialog shows one question at a time
  if (hasPreview(questions)) return true
  if (questions.length > 1) return true
  const options = questions.flatMap(q => q.options)
  const described = options.filter(o => o.description !== undefined).length
  return described * 2 >= options.length
}

// --- history -----------------------------------------------------------------------

export function mergeHistory(
  history: AskHistory | undefined,
  questions: readonly AskQuestion[],
  answers: unknown,
  now: number,
): AskHistory {
  const next: AskHistory = { ...history }
  if (!isRecord(answers)) return next
  for (const q of questions) {
    if (q.kind !== 'choice') continue
    const answer = str(answers[q.question])
    if (answer === undefined) continue
    const entry: AskHistoryEntry = {
      answer,
      header: q.header,
      labels: q.options.map(o => o.label),
      at: now,
    }
    next[q.question] = entry
  }
  const keys = Object.keys(next)
  if (keys.length > HISTORY_MAX) {
    keys
      .sort((a, b) => next[a]!.at - next[b]!.at)
      .slice(0, keys.length - HISTORY_MAX)
      .forEach(k => delete next[k])
  }
  return next
}

function sameLabels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((label, i) => label === b[i])
}

/** The remembered answer for this question: the same wording first, else the same header over the same options. */
export function recallAnswer(history: AskHistory, q: AskQuestion): AskHistoryEntry | undefined {
  const exact = history[q.question]
  if (exact !== undefined) return exact
  if (q.header === '') return undefined
  const labels = q.options.map(o => o.label)
  let best: AskHistoryEntry | undefined
  for (const entry of Object.values(history)) {
    if (entry.header !== q.header || !sameLabels(entry.labels, labels)) continue
    if (best === undefined || entry.at > best.at) best = entry
  }
  return best
}

function wasPicked(entry: AskHistoryEntry | undefined, label: string): boolean {
  if (entry === undefined) return false
  return entry.answer.split(',').some(part => part.trim() === label)
}

export type RecalledPick = { index: number; label: string; recommended: boolean }

/** The options of `q` picked last time, by their place in the question (the digit the dialog answers to). */
export function recalledPicks(history: AskHistory, q: AskQuestion): RecalledPick[] {
  const entry = recallAnswer(history, q)
  if (entry === undefined) return []
  const picks: RecalledPick[] = []
  q.options.forEach((o, index) => {
    if (!wasPicked(entry, o.label)) return
    const { label, recommended } = splitRecommended(o.label)
    picks.push({ index, label, recommended })
  })
  // an answer typed under "Other" matches no option: still worth a word
  if (picks.length === 0) picks.push({ index: -1, label: entry.answer, recommended: false })
  return picks
}

// --- the lead: what Claude said right before asking ---------------------------------

/** The last paragraph of the last text block, trimmed to one quotable line. */
export function leadFrom(content: readonly { type: string; [field: string]: unknown }[]): string | undefined {
  let text: string | undefined
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') text = block.text
  }
  if (text === undefined) return undefined
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p !== '')
  const last = paragraphs[paragraphs.length - 1]
  if (last === undefined) return undefined
  const flat = last
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
  if (flat === '') return undefined
  return flat.length > LEAD_MAX_CHARS ? `${flat.slice(0, LEAD_MAX_CHARS - 1)}…` : flat
}

// --- text that fits the strip ----------------------------------------------------------
// The engine estimates the rows around its dialog as, per string, one plus
// one more for every 40 characters of width; the whole strip may come to 12.
// Every line here is cut to STRIP_COLS of display width, so each estimates
// at two rows at most, and the strip's shape (below) keeps the sum under.

const STRIP_COLS = 78

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

// --- previews --------------------------------------------------------------------------
// A `Code` or `Markdown` takes at most 10000 characters and tab and newline as
// its only control characters; everything here keeps inside that.

const ELEMENT_TEXT_MAX = 10_000
const FENCE = /^```([\w+.-]*)[^\n]*\n([\s\S]*?)\n?```\s*$/
const DIFF_HEAD = /^(diff --git |--- |\+\+\+ |@@ -\d)/m

function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, ELEMENT_TEXT_MAX)
}

export type Preview =
  | { kind: 'code'; source: string; language?: string; hidden: number }
  | { kind: 'diff'; source: string }
  | { kind: 'markdown'; text: string; hidden: number }

function cutLines(text: string, maxLines: number): { text: string; hidden: number } {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { text, hidden: 0 }
  return { text: lines.slice(0, maxLines).join('\n'), hidden: lines.length - maxLines }
}

function looksLikeCode(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  if (lines.length < 2) return false
  const codey = lines.filter(l => /[{};=()[\]<>]|^\s{2,}\S/.test(l)).length
  return codey / lines.length >= 0.5
}

export function classifyPreview(raw: string, maxLines: number): Preview {
  const text = cleanText(raw).replace(/\s+$/, '')
  const fence = FENCE.exec(text)
  if (fence !== null) {
    const language = fence[1] === '' ? undefined : fence[1]
    const inner = fence[2] ?? ''
    if (language === 'diff' || DIFF_HEAD.test(inner)) return { kind: 'diff', source: inner }
    const cut = cutLines(inner, maxLines)
    return compact({ kind: 'code', source: cut.text, language, hidden: cut.hidden })
  }
  // a diff is never cut: a hunk cut short no longer parses, and the engine
  // would draw it as plain code with the colouring gone
  if (DIFF_HEAD.test(text)) return { kind: 'diff', source: text }
  if (looksLikeCode(text)) {
    const cut = cutLines(text, maxLines)
    return { kind: 'code', source: cut.text, hidden: cut.hidden }
  }
  const cut = cutLines(text, maxLines)
  return { kind: 'markdown', text: cut.text, hidden: cut.hidden }
}

// --- layout ------------------------------------------------------------------------------

const CARD_GAP = 1
const CARD_CHROME = 4 // a round border's two columns plus paddingX 1 on each side

/** Each card's outer width when `count` cards sit side by side in `columns`, or undefined when they must stack. */
export function cardWidth(columns: number, count: number, minColumns: number): number | undefined {
  if (count < 2) return undefined
  const width = Math.floor((columns - CARD_GAP * (count - 1)) / count)
  return width >= minColumns ? width : undefined
}

const KIND_MARK: Record<AskQuestion['kind'], string> = { choice: '', text: '✎ ', number: '# ' }

/** The elements every surface's table has: what both drawings here use. */
type Elements = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Code' | 'Markdown'>

export type StripInput = {
  questions: readonly AskQuestion[]
  metadataSource?: string
  lead: AskLead | null
  history: AskHistory
  current: AskCurrent | null
  /** whether the pane was even wanted for this round (false: nothing to say about it) */
  paneWanted: boolean
}

/**
 * The context strip above the dialog: at most five one-line Texts (title,
 * lead, two 上次選過 lines, a pane note) and a bottom margin, so the engine's
 * estimate stays at 11 rows or fewer whatever the inputs.
 */
export function drawStrip(els: Elements, input: StripInput): RenderElement {
  const { Box, Text } = els
  const { questions, lead, history, current } = input
  const several = questions.length > 1

  // the title is ONE Text with the chips nested, so the engine counts it as
  // one line (plus one per 40 cells), not one line per chip
  const title = several ? `Claude 想確認 ${questions.length} 件事` : 'Claude 想確認一件事'
  const chipTexts = questions.map((q, i) => ` ${KIND_MARK[q.kind]}${q.header === '' ? `Q${i + 1}` : q.header}${q.multiSelect ? ' ☑' : ''} `)
  const source = input.metadataSource === undefined ? '' : `來源 ${input.metadataSource}`
  let budget = STRIP_COLS - displayWidth(title) - 1
  const chips: RenderNode[] = []
  for (const chip of chipTexts) {
    const width = displayWidth(chip) + 1
    if (width > budget) break
    budget -= width
    chips.push(' ', <Text inverse>{chip}</Text>)
  }
  const sourceShown = source !== '' && displayWidth(source) + 2 <= budget

  // 上次選 lines: the option's digit in its own colour (the digit the dialog
  // answers to, the colour the pane's card wears), then its label without any
  // "(Recommended)" suffix, ★ where it had one
  const recalled = questions
    .filter(hasChoices)
    .map(q => ({ q, picks: recalledPicks(history, q) }))
    .filter(({ picks }) => picks.length > 0)
    .slice(0, 2)

  let note: string | undefined
  if (input.paneWanted && current !== null && current.placed === false) {
    const previews = questions.reduce((n, q) => n + q.options.filter(o => o.preview !== undefined).length, 0)
    note =
      previews > 0
        ? `▣ ${previews} 個選項附預覽，比較板放不下：終端機要 144 欄，或跑 /${COMMAND} 手動開`
        : `▣ 比較板放不下：終端機要 144 欄，或跑 /${COMMAND} 手動開`
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color="cyan">
          {title}
        </Text>
        {chips}
        {sourceShown && (
          <Text dimColor>
            {'  '}
            {source}
          </Text>
        )}
      </Text>
      {lead !== null && <Text dimColor>{fitWidth(`↳ ${lead.text}`, STRIP_COLS)}</Text>}
      {recalled.map(({ q, picks }) => {
        // the line is several Texts (a colour per digit); its width is kept
        // under STRIP_COLS by hand, since no one Text can be cut for it
        const lead = `↺ ${several && q.header !== '' ? `${q.header}：` : ''}上次選`
        let width = displayWidth(lead)
        const shown: RenderNode[] = []
        let left = 0
        for (const pick of picks) {
          const label = fitWidth(pick.label, 24)
          const piece = pick.index >= 0 ? ` ${pick.index + 1} ${label}${pick.recommended ? ' ★' : ''}` : ` 「${label}」`
          if (width + displayWidth(piece) + 4 > STRIP_COLS) {
            left = picks.length - shown.length
            break
          }
          width += displayWidth(piece)
          shown.push(
            <Text>
              {' '}
              {pick.index >= 0 ? (
                <Text color={optionColor(pick.index)} bold>
                  {pick.index + 1}{' '}
                </Text>
              ) : (
                '「'
              )}
              {label}
              {pick.index >= 0 ? '' : '」'}
              {pick.recommended ? <Text color="yellow"> ★</Text> : ''}
            </Text>,
          )
        }
        return (
          <Text>
            <Text color="yellow">{lead}</Text>
            {shown}
            {left > 0 && <Text dimColor> +{left}</Text>}
          </Text>
        )
      })}
      {note !== undefined && <Text dimColor>{fitWidth(note, STRIP_COLS)}</Text>}
    </Box>
  )
}

export type CompareInput = {
  current: AskCurrent | null
  history: AskHistory
  columns: number
  previewLines: number
  cardMinColumns: number
}

// What makes an option recognisable at a glance in the pane, in order of
// weight: every card wears its option's colour on its border and its digit
// (cyan, magenta, yellow, green: the same four ask-redo-mod's band uses), the
// label is one line, the badges (★ 建議 for a label the model marked as its
// recommendation, ↺ 上次選過) are a line of their own so they never wrap into
// the label, and a preview announces what it is (diff with its +/− count, the
// code's language, prose) before it is read.

/** The colour of option `i`, the same on every drawing of this mod and of ask-redo-mod. */
export const OPTION_COLORS = ['cyan', 'magenta', 'yellow', 'green'] as const
export const optionColor = (i: number): string => OPTION_COLORS[i % OPTION_COLORS.length]!

const RECOMMENDED_PATTERN = /\s*[（(]\s*(recommended|suggested|建議|推薦|預設|default)\s*[)）]\s*$/iu

/** A label with its "(Recommended)" suffix lifted off into a flag. */
export function splitRecommended(label: string): { label: string; recommended: boolean } {
  const bare = label.replace(RECOMMENDED_PATTERN, '').trim()
  return bare === '' || bare === label ? { label, recommended: false } : { label: bare, recommended: true }
}

/** Lines added and removed in a unified diff. */
export function diffStats(source: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of source.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

/** The dim line over a preview saying what it is: `diff · +3 −1`, `json · 12 行`, `說明 · 3 行`. */
export function previewTag(preview: Preview): string {
  if (preview.kind === 'diff') {
    const { added, removed } = diffStats(preview.source)
    return `diff · +${added} −${removed}`
  }
  const lines = (preview.kind === 'code' ? preview.source : preview.text).split('\n').length + preview.hidden
  const what = preview.kind === 'code' ? (preview.language ?? 'code') : '說明'
  return `${what} · ${lines} 行`
}

/** A number question as one line: `5 ├────●────┤ 20  預設 10 · 間隔 5 檔`. */
export function slider(q: AskQuestion, width: number): string {
  const { min, max, defaultValue, step, unit } = q
  if (min === undefined || max === undefined || max <= min) return `# 數字${unit === undefined ? '' : ` ${unit}`}`
  const track = Math.max(8, Math.min(40, width - displayWidth(`${min} `) - displayWidth(` ${max}`) - 24))
  const at = defaultValue === undefined ? -1 : Math.round(((Math.min(max, Math.max(min, defaultValue)) - min) / (max - min)) * (track - 1))
  let bar = ''
  for (let i = 0; i < track; i++) bar += i === at ? '●' : i === 0 ? '├' : i === track - 1 ? '┤' : '─'
  const notes: string[] = []
  if (defaultValue !== undefined) notes.push(`預設 ${defaultValue}`)
  if (step !== undefined) notes.push(`間隔 ${step}`)
  const tail = `${notes.join(' · ')}${unit === undefined ? '' : ` ${unit}`}`.trim()
  return `${min} ${bar} ${max}${tail === '' ? '' : `  ${tail}`}`
}

/** The compare pane: every question of the round, its options as cards, previews rendered. */
export function drawCompare(els: Elements, input: CompareInput): RenderElement {
  const { Box, Text, Code, Markdown } = els
  const { current, history, columns } = input
  if (current === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>目前沒有進行中的問題。</Text>
        <Text dimColor>下次 Claude 用 AskUserQuestion 問你時，選項會在這裡並排，說明和預覽一起看。</Text>
      </Box>
    )
  }
  const { questions } = current
  const several = questions.length > 1

  const drawPreview = (preview: Preview): RenderNode[] => {
    const nodes: RenderNode[] = [<Text dimColor>{previewTag(preview)}</Text>]
    if (preview.kind === 'diff') nodes.push(<Code source={preview.source} format="diff" />)
    else if (preview.kind === 'code') nodes.push(<Code source={preview.source} language={preview.language} />)
    else nodes.push(<Markdown text={preview.text} />)
    if (preview.kind !== 'diff' && preview.hidden > 0) nodes.push(<Text dimColor>… 還有 {preview.hidden} 行</Text>)
    return nodes
  }

  const drawChoice = (q: AskQuestion): RenderElement => {
    const width = cardWidth(columns, q.options.length, input.cardMinColumns)
    const remembered = recallAnswer(history, q)
    return (
      <Box flexDirection={width === undefined ? 'column' : 'row'} gap={width === undefined ? 0 : CARD_GAP}>
        {q.options.map((o, j) => {
          const { label, recommended } = splitRecommended(o.label)
          const picked = wasPicked(remembered, o.label)
          const color = optionColor(j)
          return (
            <Box flexDirection="column" width={width} flexShrink={0} borderStyle="round" borderColor={color} paddingX={1}>
              <Text wrap="truncate-end">
                <Text color={color} bold>
                  {j + 1}
                </Text>{' '}
                <Text bold>{label}</Text>
              </Text>
              {(recommended || picked) && (
                <Text wrap="truncate-end">
                  {recommended && <Text color="yellow">★ 建議 </Text>}
                  {picked && <Text color="yellow">↺ 上次選過</Text>}
                </Text>
              )}
              {o.description !== undefined && (
                <Text dimColor wrap="wrap">
                  {o.description}
                </Text>
              )}
              {o.preview !== undefined && (
                <Box flexDirection="column" marginTop={1}>
                  {drawPreview(classifyPreview(o.preview, input.previewLines))}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  const drawField = (q: AskQuestion): RenderElement => {
    const line =
      q.kind === 'number'
        ? slider(q, columns - CARD_CHROME)
        : `✎ 自由輸入${q.placeholder === undefined ? '' : ` · ${q.placeholder}`}`
    return (
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>在對話框按同一個數字就選它；顏色對應卡片。</Text>
      {questions.map((q, i) => (
        <Box flexDirection="column" marginTop={1}>
          <Text bold wrap="wrap">
            {several ? `${i + 1}/${questions.length} ` : ''}
            {q.header === '' ? '' : <Text inverse> {q.header} </Text>}
            {q.header === '' ? '' : ' '}
            {q.question}
            {q.multiSelect ? <Text color="yellow"> ☑ 可複選</Text> : ''}
          </Text>
          {q.description !== undefined && (
            <Text dimColor wrap="wrap">
              {q.description}
            </Text>
          )}
          {hasChoices(q) ? drawChoice(q) : drawField(q)}
        </Box>
      ))}
    </Box>
  )
}

// --- the module ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    // 上次選過 comes back from the store once per load; the state copy is
    // what the drawings read, so a write redraws them
    try {
      const kept = await $.store.get(HISTORY_STORE_KEY)
      if (isRecord(kept)) await update($, historyAtom, () => kept as AskHistory)
    } catch (error) {
      $.ui.log(`ask-mod: history not loaded: ${String(error)}`, { to: 'debug' })
    }
    if (cfg.compare !== 'off') {
      await $.command.register({
        name: COMMAND,
        description: '打開 AskUserQuestion 的選項比較板（之後每次問問題都自動開，直到你把它關掉）',
        immediate: true,
      })
    }
    return next(e)
  })

  // the person asked for the pane: open it now (asked, so it seats at any
  // width) and keep it wanted for the session
  on('command.run', { command: COMMAND }, async $ => {
    await update($, compareOpen, () => true)
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS })
    return { text: opened.isPlaced ? '選項比較板開了。' : `選項比較板還放不下：${opened.reason}` }
  })

  // the person closed the pane by hand: stay closed for the session
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, compareOpen, () => false)
    return next(e)
  })

  // the lead: the last paragraph of the model's latest text block in the main
  // conversation. A new prompt clears it, so a question asked cold at the top
  // of a turn never quotes the previous turn's sign-off as its reason.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const kept = await next(e)
    if (e.agentId === undefined) await update($, leadAtom, () => null)
    return kept
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const kept = await next(e)
    if (e.agentId === undefined && e.message.type === 'assistant') {
      const text = leadFrom(e.message.content)
      if (text !== undefined) {
        const at = await $.clock.now()
        const lead: AskLead = { text, at }
        await update($, leadAtom, () => lead)
      }
    }
    return kept
  })

  // the call: open the pane around it, remember the answer after it
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = parseQuestions(e.questions)
    const toggled = await read($, compareOpen)
    const wanted = decideCompare(cfg.compare, toggled, questions)
    const current: AskCurrent = { requestId: e.tool_use_id, questions, placed: null }
    await update($, currentAtom, () => current)

    let opened = false
    if (wanted) {
      const result = await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS })
      opened = result.isPlaced
      await update($, currentAtom, held => (held === null ? held : { ...held, placed: result.isPlaced }))
      if (!result.isPlaced) {
        // an unplaced pane would seat itself the moment the terminal widens,
        // mid-question or long after; better closed, the strip says why
        $.ui.log(`ask-mod: compare pane not placed: ${result.reason}`, { to: 'debug' })
        await $.ui.close({ id: PANE })
      }
    }

    let ran
    try {
      ran = await next(e)
    } finally {
      if (opened) await $.ui.close({ id: PANE })
      await update($, currentAtom, () => null)
    }

    if (!cfg.showHistory || ran.deny !== undefined || ran.isError === true) return ran
    const result: unknown = ran.result
    if (!isRecord(result)) return ran
    const now = await $.clock.now()
    const history = await update($, historyAtom, held => mergeHistory(held, questions, result.answers, now))
    try {
      await $.store.set(HISTORY_STORE_KEY, history)
    } catch (error) {
      $.ui.log(`ask-mod: history not saved: ${String(error)}`, { to: 'debug' })
    }
    return ran
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const own = await next(e)
    const questions = parseQuestions(e.props.questions)
    if (questions.length === 0) return own

    const { Box, Text, Code, Markdown } = $.ui.resolve(e)
    const [lead, history, current, toggled] = await Promise.all([
      cfg.showLead ? read($, leadAtom) : null,
      cfg.showHistory ? read($, historyAtom) : {},
      read($, currentAtom),
      read($, compareOpen),
    ])
    const strip = drawStrip(
      { Box, Text, Code, Markdown },
      {
        questions,
        metadataSource: e.props.metadataSource,
        lead,
        history,
        current: current !== null && current.requestId === e.requestId ? current : null,
        paneWanted: decideCompare(cfg.compare, toggled, questions),
      },
    )
    // the engine's dialog goes last: nothing may draw below it
    return (
      <Box flexDirection="column">
        {strip}
        {own}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Code, Markdown } = $.ui.resolve(e)
    const [current, history] = await Promise.all([read($, currentAtom), cfg.showHistory ? read($, historyAtom) : {}])
    return drawCompare(
      { Box, Text, Code, Markdown },
      {
        current,
        history,
        columns: e.props.bodyColumns,
        previewLines: cfg.previewLines,
        cardMinColumns: cfg.cardMinColumns,
      },
    )
  })
}
