import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, ToolCallArgs } from 'claude-code'

import type { AskPending, AskRedoQuestion } from '../types'
import {
  COMPOSE_SECTION,
  RESPONSE_TEXT,
  WAIT_REMINDER,
  canTakeOver,
  descriptionColumns,
  displayWidth,
  fitBand,
  labelColumns,
  splitRecommended,
  formatAnswer,
  formatSkip,
  parseChoiceQuestion,
  typedAnswer,
} from './register.tsx'

const PLUGIN = 'ask-redo-mod'
const PENDING = { plugin: PLUGIN, key: 'pending' } as const

const CHOICE = {
  question: 'Which store should hold the answers?',
  header: 'Store',
  multiSelect: false,
  options: [
    { label: 'Session state', description: 'Gone when the session ends.' },
    { label: 'Plugin store', description: 'Survives a restart.' },
    { label: 'A file', description: '' },
  ],
}

/** CHOICE as the mod parses it: the empty description dropped. */
const PARSED: AskRedoQuestion = {
  question: CHOICE.question,
  header: 'Store',
  options: [
    { label: 'Session state', description: 'Gone when the session ends.' },
    { label: 'Plugin store', description: 'Survives a restart.' },
    { label: 'A file' },
  ],
}

const BAND_PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

/** An AskUserQuestion call with arguments the input type does not list (kind, agentId), as the model or a loop may send. */
const askArgs = (questions: unknown, extra: Record<string, unknown> = {}): ToolCallArgs =>
  ({ tool: 'AskUserQuestion', questions, ...extra }) as unknown as ToolCallArgs

type World = {
  /** every value the mod wrote to its `pending` state */
  pending: (AskPending | null)[]
  /** every store write and delete, in order */
  store: string[]
  /** how often the engine's own dialog (the test's tool.call bottom) was reached */
  dialog: { reached: number }
  /** the text of every prompt that reached the bottom */
  submitted: string[]
}

type WorldOptions = {
  surfaces?: readonly ('terminal' | 'desktop' | 'mobile' | 'vscode')[]
  /** what the store holds at the start */
  store?: Record<string, unknown>
  /** the prompt bottom refuses every prompt with this reason */
  drop?: string
}

/**
 * The world beneath the mod: a terminal-only session, a clock, a store, the
 * engine's dialog as a bottom that records being reached, and a prompt bottom.
 * Each bottom is registered once: a test's `on` refuses a second matcher-less
 * hook on one event.
 */
function world(on: On, options: WorldOptions = {}): World {
  const w: World = { pending: [], store: [], dialog: { reached: 0 }, submitted: [] }
  mock.clock(on, { now: 1_000 })
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('state.set', PENDING, (_, e, next) => {
    w.pending.push(e.value)
    return next(e)
  })
  // spies before mock.store: the mock answers without calling next
  on('store.set', { key: /^pending\// }, (_, e, next) => {
    w.store.push(`set ${e.key} ${JSON.stringify(e.value)}`)
    return next(e)
  })
  on('store.delete', { key: /^pending\// }, (_, e, next) => {
    w.store.push(`delete ${e.key}`)
    return next(e)
  })
  mock.store(on, options.store)
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    w.dialog.reached += 1
    return { result: { questions: [CHOICE], answers: { [CHOICE.question]: 'A file' } } }
  })
  on('prompt.submit', (_, e) => {
    w.submitted.push(e.text)
    return options.drop === undefined ? { text: e.text } : { drop: options.drop }
  })
  // nothing stands beneath the plugins in a test: the band a session would
  // draw with no plugin drawing is this Text
  on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>{BENEATH}</Text>
  })
  return w
}

const BENEATH = 'beneath the plugins'

const last = <T,>(list: readonly T[]): T | undefined => list[list.length - 1]

// --- taking the call over -------------------------------------------------------------

describe('taking the call over', () => {
  test('answers a single-choice call at once, never reaching the dialog, and keeps the question', async ($, on) => {
    const w = world(on)
    const ran = await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })

    expect(w.dialog.reached).toBe(0)
    expect(ran.deny).toBeUndefined()
    expect(ran.result).toEqual({ questions: [CHOICE], answers: {}, response: RESPONSE_TEXT })
    expect(ran.context).toEqual([WAIT_REMINDER])

    const kept = last(w.pending)
    expect(kept).toEqual({ toolUseId: expect.any(String), sessionId: 'sess-1', question: PARSED, at: 1_000 })
    expect(w.store).toEqual([`set pending/sess-1 ${JSON.stringify(kept)}`])
  })

  test('the texts tell the model to end its turn and wait', () => {
    for (const text of [RESPONSE_TEXT, WAIT_REMINDER, COMPOSE_SECTION.text]) {
      expect(text).toMatch(/end (your|its) turn/i)
      expect(text).toContain('next message')
    }
    expect(WAIT_REMINDER).toContain('[AskUserQuestion answer]')
    expect(COMPOSE_SECTION.scope).toBe('session')
  })

  const fallbacks: [string, unknown, Record<string, unknown>?][] = [
    ['two questions', [CHOICE, { ...CHOICE, question: 'And the other one?' }]],
    ['a text question', [{ question: 'Name it?', header: 'Name', kind: 'text', multiSelect: false, options: [] }]],
    [
      'five options',
      [{ ...CHOICE, options: ['a', 'b', 'c', 'd', 'e'].map(label => ({ label, description: label })) }],
    ],
    ['multi-select', [{ ...CHOICE, multiSelect: true }]],
    ['an option with a preview', [{ ...CHOICE, options: [...CHOICE.options.slice(0, 2), { label: 'P', description: '', preview: 'x' }] }]],
    ['a subagent call', [CHOICE], { agentId: 'agent-7' }],
    ['an engine flow (metadata.source)', [CHOICE], { metadata: { source: 'remember' } }],
  ]
  for (const [name, questions, extra] of fallbacks) {
    test(`${name} goes to the engine's dialog untouched`, async ($, on) => {
      const w = world(on)
      const ran = await $.tool.call(askArgs(questions, extra))
      expect(w.dialog.reached).toBe(1)
      expect(ran.result).toEqual({ questions: [CHOICE], answers: { [CHOICE.question]: 'A file' } })
      expect(w.pending).toEqual([])
    })
  }

  test('a session drawn on a phone too goes to the dialog', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'mobile'] })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    expect(w.dialog.reached).toBe(1)
  })

  test('a second question while one waits goes to the dialog', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ ...CHOICE, question: 'Another?' }] })
    expect(w.dialog.reached).toBe(1)
    expect(w.pending).toHaveLength(1)
  })

  test('takeover off sends every call to the dialog', { options: { takeover: 'off' } }, async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    expect(w.dialog.reached).toBe(1)
    expect(w.pending).toEqual([])
  })

  test('the system prompt gains its section, last, only while AskUserQuestion is offered', async ($, on) => {
    world(on)
    const base = { id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }
    on('prompt.compose', () => ({ sections: [base] }))
    const facts = { model: 'm', promptModel: 'm', surfaces: ['terminal' as const], outputStyle: null, traits: [] }
    const offered = await $.prompt.compose({ ...facts, tools: ['Bash', 'AskUserQuestion'] })
    expect(offered.sections).toEqual([base, COMPOSE_SECTION])
    const withheld = await $.prompt.compose({ ...facts, tools: ['Bash'] })
    expect(withheld.sections).toEqual([base])
  })
})

// --- the band ----------------------------------------------------------------------------

describe('the band above the prompt', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws the waiting question with one hotkeyed Button per option on the ${surface} surface`, async ($, on) => {
      world(on)
      await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'AbovePrompt',
        props: BAND_PROPS,
        viewport: { columns: 105, rows: 40 },
      })
      expect(await ui.find({ type: 'Text', text: CHOICE.question })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' Store ' })).toBeDefined()
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map(b => [b.key, b.props.label, b.props.hotkey])).toEqual([
        ['option-1', 'Session state', '1'],
        ['option-2', 'Plugin store', '2'],
        ['option-3', 'A file', '3'],
        ['skip', '跳過', '0'],
      ])
      expect(buttons.every(b => b.props.plain === true)).toBe(true)
      expect(await ui.find({ type: 'Text', text: 'Gone when the session ends.' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /1–3 選 · 直接打字也行/ })).toBeDefined()
    })
  }

  test('with nothing pending the band is what stands beneath', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: BENEATH })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('yields to an engine survey', async ($, on) => {
    world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { ...BAND_PROPS, hasSurvey: true },
    })
    expect(await ui.find({ type: 'Text', text: BENEATH })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('a short band drops the hint row and keeps 跳過 beside the question', async ($, on) => {
    world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { ...BAND_PROPS, maxRows: 4, scroll: { offset: 0, bodyRows: 4 } },
    })
    expect(await ui.find({ type: 'Text', text: /1–3 選/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'skip' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  })
})

// --- answering ---------------------------------------------------------------------------

describe('answering', () => {
  const mountBand = ($: Engine) =>
    $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })

  test('pressing an option submits its formatted answer and clears the question', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const ui = await mountBand($)
    await ui.press({ key: 'option-2' })

    expect(w.submitted).toEqual([formatAnswer(PARSED, PARSED.options[1]!)])
    expect(w.submitted[0]).toBe(
      '[AskUserQuestion answer] Q: "Which store should hold the answers?" → A: Plugin store\nSurvives a restart.',
    )
    expect(last(w.pending)).toBeNull()
    expect(last(w.store)).toBe('delete pending/sess-1')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: BENEATH })).toBeDefined()
  })

  test('pressing twice answers once', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const ui = await mountBand($)
    await Promise.all([ui.press({ key: 'option-1' }), ui.press({ key: 'option-1' }).catch(() => undefined)])
    expect(w.submitted).toHaveLength(1)
  })

  test('跳過 submits a skip', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const ui = await mountBand($)
    await ui.press({ key: 'skip' })
    expect(w.submitted).toEqual([formatSkip(PARSED)])
    expect(last(w.pending)).toBeNull()
  })

  test('a typed prompt is the answer, rewritten on its way in', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const entered = await $.prompt.submit({ text: 'something I typed', wait: false, origin: { kind: 'composer' } })
    const answer = formatAnswer(PARSED, 'something I typed')
    expect(w.submitted).toEqual([answer])
    expect(entered.text).toBe(answer)
    expect(last(w.pending)).toBeNull()
  })

  test('a typed lone digit picks that option', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    await $.prompt.submit({ text: ' 3 ', wait: false, origin: { kind: 'composer' } })
    expect(w.submitted).toEqual([formatAnswer(PARSED, PARSED.options[2]!)])
  })

  test('a slash command passes through and the question keeps waiting', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    await $.prompt.submit({ text: '/model', wait: false, origin: { kind: 'composer' } })
    expect(w.submitted).toEqual(['/model'])
    expect(w.pending).toHaveLength(1)
    expect(last(w.pending)).not.toBeNull()
  })

  test('a prompt from elsewhere than the composer passes through', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    await $.prompt.submit({ text: 'a background task finished', wait: false, origin: { kind: 'task-notification' } })
    expect(w.submitted).toEqual(['a background task finished'])
    expect(w.pending).toHaveLength(1)
  })

  test('freeText off: a typed prompt passes through, a lone digit still answers', { options: { freeText: false } }, async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    await $.prompt.submit({ text: 'something I typed', wait: false, origin: { kind: 'composer' } })
    expect(w.submitted).toEqual(['something I typed'])
    expect(w.pending).toHaveLength(1)
    await $.prompt.submit({ text: '1', wait: false, origin: { kind: 'composer' } })
    expect(w.submitted[1]).toBe(formatAnswer(PARSED, PARSED.options[0]!))
    expect(last(w.pending)).toBeNull()
  })

  test('a prompt refused beneath leaves the question waiting', async ($, on) => {
    const w = world(on, { drop: 'blocked by a settings hook' })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const entered = await $.prompt.submit({ text: 'my answer', wait: false, origin: { kind: 'composer' } })
    expect(entered.drop).toBe('blocked by a settings hook')
    expect(w.pending.map(p => p === null)).toEqual([false, true, false])
  })

  test('/ask-redo-clear drops the question without answering it', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    const run = () =>
      $.command.run({
        command: 'ask-redo-clear',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 120 },
      })
    const answer = await run()
    expect(answer.text).toBe(`丟掉了待答的問題：${CHOICE.question}`)
    expect(answer.context?.[0]).toContain('without answering it')
    expect(last(w.pending)).toBeNull()
    expect(w.submitted).toEqual([])
    expect((await run()).text).toBe('沒有待答的問題。')
  })

  test('a question mirrored in the store comes back at session start, its own session only', async ($, on) => {
    const kept: AskPending = { toolUseId: 't-9', sessionId: 'sess-1', question: PARSED, at: 900 }
    const other: AskPending = { ...kept, sessionId: 'sess-0', at: 1_000 }
    const stale: AskPending = { ...kept, sessionId: 'sess-old', at: -10 * 24 * 60 * 60 * 1000 }
    const w = world(on, {
      store: { 'pending/sess-1': kept, 'pending/sess-0': other, 'pending/sess-old': stale, history: 1 },
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(w.pending).toEqual([kept])
    expect(w.store).toEqual(['delete pending/sess-old'])
  })

  test('a /clear drops the waiting question', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [CHOICE] })
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    expect(last(w.pending)).toBeNull()
    expect(last(w.store)).toBe('delete pending/sess-1')
  })
})

// --- pure parts --------------------------------------------------------------------------

describe('pure parts', () => {
  test('formatAnswer: the label and its description, or the typed text', () => {
    expect(formatAnswer(PARSED, PARSED.options[0]!)).toBe(
      '[AskUserQuestion answer] Q: "Which store should hold the answers?" → A: Session state\nGone when the session ends.',
    )
    expect(formatAnswer(PARSED, PARSED.options[2]!)).toBe(
      '[AskUserQuestion answer] Q: "Which store should hold the answers?" → A: A file',
    )
    expect(formatAnswer(PARSED, 'neither, use SQLite')).toBe(
      '[AskUserQuestion answer] Q: "Which store should hold the answers?" → A: neither, use SQLite',
    )
    expect(formatSkip(PARSED)).toContain('skipped')
  })

  test('typedAnswer: a lone digit picks, 0 skips, anything else is free text when allowed', () => {
    expect(typedAnswer(PARSED, '2', true)).toBe(formatAnswer(PARSED, PARSED.options[1]!))
    expect(typedAnswer(PARSED, '２', false)).toBe(formatAnswer(PARSED, PARSED.options[1]!))
    expect(typedAnswer(PARSED, '0', false)).toBe(formatSkip(PARSED))
    expect(typedAnswer(PARSED, '7', true)).toBe(formatAnswer(PARSED, '7'))
    expect(typedAnswer(PARSED, '7', false)).toBeUndefined()
    expect(typedAnswer(PARSED, '  ', true)).toBeUndefined()
    expect(typedAnswer(PARSED, ' my take ', true)).toBe(formatAnswer(PARSED, 'my take'))
  })

  test('canTakeOver: main loop, the model, a terminal, one single-choice question, nothing waiting', () => {
    const ok = { caller: 'engine', surfaces: ['terminal'], interactive: true, isPending: false }
    expect(canTakeOver([CHOICE], ok)).toEqual(PARSED)
    expect(canTakeOver([CHOICE], { ...ok, interactive: undefined })).toEqual(PARSED)
    expect(canTakeOver([CHOICE], { ...ok, agentId: 'a1' })).toBeUndefined()
    expect(canTakeOver([CHOICE], { ...ok, caller: 'other-plugin' })).toBeUndefined()
    expect(canTakeOver([CHOICE], { ...ok, surfaces: [] })).toBeUndefined()
    expect(canTakeOver([CHOICE], { ...ok, surfaces: ['desktop'] })).toBeUndefined()
    expect(canTakeOver([CHOICE], { ...ok, interactive: false })).toBeUndefined()
    expect(canTakeOver([CHOICE], { ...ok, isPending: true })).toBeUndefined()
    expect(canTakeOver([CHOICE], { ...ok, source: 'remember' })).toBeUndefined()
    expect(canTakeOver([CHOICE, CHOICE], ok)).toBeUndefined()
  })

  test('parseChoiceQuestion: kind choice or absent, 2-4 options, no previews; control characters flattened', () => {
    expect(parseChoiceQuestion([{ ...CHOICE, kind: 'choice' }])).toEqual(PARSED)
    expect(parseChoiceQuestion([{ ...CHOICE, kind: 'number', min: 1, max: 3 }])).toBeUndefined()
    expect(parseChoiceQuestion([{ ...CHOICE, options: CHOICE.options.slice(0, 1) }])).toBeUndefined()
    expect(parseChoiceQuestion('nope')).toBeUndefined()
    const messy = parseChoiceQuestion([{ ...CHOICE, question: 'Line one\nline\ttwo?', header: undefined }])
    expect(messy?.question).toBe('Line one line two?')
    expect(messy?.header).toBe('')
  })

  test('fitBand: roomy first, then descriptions fold, then the hint goes, then the question is cut', () => {
    const long: AskRedoQuestion = {
      question: '這一題的文字很長很長'.repeat(4),
      header: 'Store',
      options: PARSED.options.map(o => ({ ...o, description: 'A description that runs on for a while. '.repeat(3) })),
    }
    const roomy = fitBand(long, 60, 40)
    expect(roomy).toMatchObject({ descriptions: 'wrap', hint: true, question: 'wrap' })
    expect(roomy.rows).toBeGreaterThan(long.options.length + 2)

    const folded = fitBand(long, 60, 2 + 3 + 1)
    expect(folded).toMatchObject({ descriptions: 'truncate', hint: true, question: 'wrap', rows: 6 })

    const noHint = fitBand(long, 60, 5)
    expect(noHint).toMatchObject({ descriptions: 'truncate', hint: false })

    const tight = fitBand(long, 60, 4)
    expect(tight).toMatchObject({ descriptions: 'truncate', hint: false, question: 'truncate', rows: 4 })

    // too few rows for even the tightest: the tightest, and the band scrolls
    expect(fitBand(long, 60, 2)).toMatchObject({ question: 'truncate', rows: 4 })
    expect(fitBand(PARSED, 100, 20)).toMatchObject({ descriptions: 'wrap', hint: true, question: 'wrap', rows: 5 })
  })

  test('labelColumns and descriptionColumns: the widest `n: label` (badge included) capped to 40%, the rest for descriptions', () => {
    expect(labelColumns(PARSED, 100)).toBe(displayWidth('1: Session state'))
    const starred: AskRedoQuestion = { ...PARSED, options: [{ label: 'Plugin store (Recommended)' }, { label: 'A file' }] }
    expect(labelColumns(starred, 100)).toBe(displayWidth('1: Plugin store') + displayWidth('★ 建議') + 1)
    expect(labelColumns(starred, 40)).toBe(16)
    expect(descriptionColumns(100, 16)).toBe(100 - 2 - 16 - 2)
    expect(descriptionColumns(24, 16)).toBe(0)
    expect(displayWidth('中文ab')).toBe(6)
  })

  test('splitRecommended lifts a "(Recommended)" suffix in either language off the label', () => {
    expect(splitRecommended('Plugin store (Recommended)')).toEqual({ label: 'Plugin store', recommended: true })
    expect(splitRecommended('永豐 Shioaji（建議）')).toEqual({ label: '永豐 Shioaji', recommended: true })
    expect(splitRecommended('A file')).toEqual({ label: 'A file', recommended: false })
    expect(splitRecommended('(Recommended)')).toEqual({ label: '(Recommended)', recommended: false })
  })

  test('fitBand lays description-less options across one row when they fit', () => {
    const yesNo: AskRedoQuestion = { question: 'Delete it?', header: 'Cache', options: [{ label: 'Yes' }, { label: 'No' }] }
    expect(fitBand(yesNo, 60, 20)).toMatchObject({ across: true, rows: 3 })
    expect(fitBand(yesNo, 12, 20)).toMatchObject({ across: false })
    expect(fitBand(PARSED, 100, 20).across).toBe(false)
  })
})
