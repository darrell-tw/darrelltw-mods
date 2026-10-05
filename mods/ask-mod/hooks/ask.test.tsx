import { describe, expect, mock, test } from 'claude-code/testing'

import type { AskHistory } from '../types'
import {
  PANE,
  cardWidth,
  classifyPreview,
  decideCompare,
  displayWidth,
  drawCompare,
  drawStrip,
  fitWidth,
  leadFrom,
  mergeHistory,
  parseQuestions,
  recallAnswer,
} from './register.tsx'

const DIFF = ['@@ -1,2 +1,2 @@', ' const a = 1', '-const b = 2', '+const b = 3'].join('\n')

const QUESTIONS = [
  {
    question: 'Which store should hold the answers?',
    header: 'Store',
    multiSelect: false,
    options: [
      { label: 'Session state', description: 'Gone when the session ends.' },
      { label: 'Plugin store', description: 'Survives a restart.', preview: DIFF },
      { label: 'A file', description: 'Readable by other tools.', preview: '```json\n{ "a": 1 }\n```' },
    ],
  },
]

const PANE_PROPS = {
  title: '選項比較',
  isFocused: false,
  bodyColumns: 118,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 16 },
  view: {},
}

const CURRENT = { plugin: 'ask-mod', key: 'current' } as const
const COMPARE_OPEN = { plugin: 'ask-mod', key: 'compareOpen' } as const

// --- a plain element table and tree readers for the pure drawings ---------------------

type Tree = { type: string; props: Record<string, unknown>; children: unknown[] }

function flatten(children: unknown): unknown[] {
  if (children === undefined || children === null || children === false) return []
  if (Array.isArray(children)) return children.flatMap(flatten)
  return [children]
}

const fake = (type: string) => (props: Record<string, unknown>) => {
  const { children, ...rest } = props
  return { type, props: rest, children: flatten(children) } as unknown as Tree
}

const ELS = {
  Box: fake('Box'),
  Text: fake('Text'),
  Code: fake('Code'),
  Markdown: fake('Markdown'),
} as unknown as Parameters<typeof drawStrip>[0]

function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (typeof node === 'number') return [String(node)]
  if (typeof node !== 'object' || node === null) return []
  const tree = node as Tree
  const own = tree.type === 'Code' ? [String(tree.props.source)] : tree.type === 'Markdown' ? [String(tree.props.text)] : []
  return [...own, ...tree.children.flatMap(texts)]
}

function ofType(node: unknown, type: string): Tree[] {
  if (typeof node !== 'object' || node === null) return []
  const tree = node as Tree
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap(c => ofType(c, type))]
}

/**
 * The engine's own estimate of the rows a tree takes around its dialog, as its
 * 2.1.289 validator computes it (docs/api-notes.md): a string is one row plus
 * one per 40 cells (none for the one when inside an inline element), an
 * inline element one row, a border two, margins and paddings their cells, a
 * gap one per child, a Code its lines. The dialog refuses more than 12.
 */
function engineRows(node: unknown, inInline = false): number {
  if (typeof node === 'string') {
    return (inInline ? 0 : 1) + (node.split('\n').length - 1) + Math.floor(displayWidth(node) / 40)
  }
  if (typeof node !== 'object' || node === null) return 0
  const tree = node as Tree
  if (tree.type === 'Code') return String(tree.props.source).split('\n').length
  if (tree.type === 'Markdown') return String(tree.props.text).split('\n').length + 1
  const inline = tree.type === 'Text'
  let rows = !inInline && inline ? 1 : 0
  const per: Record<string, number> = {
    padding: 2,
    paddingY: 2,
    paddingTop: 1,
    paddingBottom: 1,
    margin: 2,
    marginY: 2,
    marginTop: 1,
    marginBottom: 1,
  }
  let gap = 0
  for (const [k, v] of Object.entries(tree.props)) {
    if (typeof v === 'number') {
      rows += Math.abs(v) * (per[k] ?? 0)
      if (k === 'gap' || k === 'rowGap') gap += Math.abs(v)
    } else if (k === 'borderStyle') rows += 2
  }
  rows += gap * tree.children.length
  for (const child of tree.children) rows += engineRows(child, inInline || inline)
  return rows
}

const AROUND_THE_DIALOG = 12

// --- the strip ------------------------------------------------------------------------

describe('the strip above the dialog', () => {
  const base = {
    questions: parseQuestions(QUESTIONS),
    lead: null,
    history: {} as AskHistory,
    current: null,
    paneWanted: true,
  }

  test('names the round and its chips in one Text', () => {
    const strip = drawStrip(ELS, base)
    expect(texts(strip).join('')).toContain('Claude 想確認一件事')
    expect(texts(strip).join('')).toContain(' Store ')
    expect(ofType(strip, 'Text').filter(t => t.props.inverse === true)).toHaveLength(1)
    expect(engineRows(strip)).toBeLessThanOrEqual(AROUND_THE_DIALOG)
  })

  test('quotes the lead, marks 上次選過 and says when the pane did not fit', () => {
    const strip = drawStrip(ELS, {
      ...base,
      lead: { text: '兩種做法都能動，差在之後要不要維護一個 schema。', at: 1 },
      history: { [QUESTIONS[0]!.question]: { answer: 'A file', header: 'Store', labels: [], at: 1 } },
      current: { requestId: 't1', questions: base.questions, placed: false },
      metadataSource: 'remember',
    })
    const all = texts(strip).join('\n')
    expect(all).toContain('↳ 兩種做法都能動')
    expect(all).toContain('↺ 上次選 A file')
    expect(all).toContain('2 個選項附預覽，比較板放不下')
    expect(all).toContain('來源 remember')
    expect(engineRows(strip)).toBeLessThanOrEqual(AROUND_THE_DIALOG)
  })

  test('stays within the engine budget at the worst: four wide questions, a long lead, long answers', () => {
    const wide = parseQuestions(
      Array.from({ length: 4 }, (_, i) => ({
        question: `問題 ${i} ${'很長的問題文字'.repeat(10)}`,
        header: '十二個字的標頭十二個字',
        multiSelect: true,
        options: [
          { label: '選項甲'.repeat(8), description: 'd'.repeat(300), preview: 'p'.repeat(300) },
          { label: '選項乙'.repeat(8), description: 'd'.repeat(300) },
          { label: '選項丙'.repeat(8) },
          { label: '選項丁'.repeat(8) },
        ],
      })),
    )
    const history: AskHistory = {}
    for (const q of wide) history[q.question] = { answer: q.options.map(o => o.label).join(', '), header: q.header, labels: [], at: 1 }
    const strip = drawStrip(ELS, {
      questions: wide,
      metadataSource: 'a-very-long-source-name-that-will-not-fit',
      lead: { text: '字'.repeat(240), at: 1 },
      history,
      current: { requestId: 't', questions: wide, placed: false },
      paneWanted: true,
    })
    expect(engineRows(strip)).toBeLessThanOrEqual(AROUND_THE_DIALOG)
    for (const line of ofType(strip, 'Text').filter(t => t.props.inverse !== true)) {
      expect(displayWidth(texts(line).join(''))).toBeLessThanOrEqual(80)
    }
    expect(ofType(strip, 'Markdown')).toHaveLength(0)
    expect(ofType(strip, 'Box').some(b => 'width' in b.props)).toBe(false)
  })

  test('says nothing about the pane when it was not wanted or did fit', () => {
    const current = { requestId: 't', questions: base.questions, placed: true }
    expect(texts(drawStrip(ELS, { ...base, current })).join('')).not.toContain('比較板')
    const unwanted = { ...current, placed: false }
    expect(texts(drawStrip(ELS, { ...base, current: unwanted, paneWanted: false })).join('')).not.toContain('比較板')
  })
})

// --- the compare pane -----------------------------------------------------------------

describe('the compare pane', () => {
  const input = {
    history: {},
    columns: 118,
    previewLines: 12,
    cardMinColumns: 28,
  }

  test('lays the options out as cards with their previews rendered', () => {
    const tree = drawCompare(ELS, { ...input, current: { requestId: 't', questions: parseQuestions(QUESTIONS), placed: true } })
    const cards = ofType(tree, 'Box').filter(b => b.props.borderStyle === 'round')
    expect(cards).toHaveLength(3)
    expect(cards.every(c => c.props.width === 38)).toBe(true)
    const code = ofType(tree, 'Code')
    expect(code).toHaveLength(2)
    expect(code[0]!.props.format).toBe('diff')
    expect(code[1]!.props.language).toBe('json')
    expect(texts(tree).join('\n')).toContain('Which store should hold the answers?')
  })

  test('stacks the cards when the pane is narrow', () => {
    const tree = drawCompare(ELS, { ...input, columns: 60, current: { requestId: 't', questions: parseQuestions(QUESTIONS), placed: true } })
    const cards = ofType(tree, 'Box').filter(b => b.props.borderStyle === 'round')
    expect(cards.every(c => c.props.width === undefined)).toBe(true)
  })

  test('marks the option picked last time', () => {
    const history: AskHistory = { [QUESTIONS[0]!.question]: { answer: 'Plugin store', header: 'Store', labels: [], at: 1 } }
    const tree = drawCompare(ELS, { ...input, history, current: { requestId: 't', questions: parseQuestions(QUESTIONS), placed: true } })
    expect(texts(tree).filter(t => t === '↺ 上次選過')).toHaveLength(1)
  })

  test('with no call open it says so', () => {
    expect(texts(drawCompare(ELS, { ...input, current: null })).join('')).toContain('目前沒有進行中的問題')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws through the engine on the ${surface} surface while a call is open`, async ($, on) => {
      mock.clock(on)
      mock.store(on)
      on('ui.open', () => ({ value: { isPlaced: true as const } }))
      on('ui.close', () => ({ value: undefined }))
      let release!: () => void
      on(
        'tool.call',
        { tool: 'AskUserQuestion' },
        () =>
          new Promise<{ result: unknown }>(resolve => {
            release = () => resolve({ result: { questions: QUESTIONS, answers: {} } })
          }),
      )

      const cleared: boolean[] = []
      let seated!: () => void
      const placed = new Promise<void>(resolve => {
        seated = resolve
      })
      on('state.set', CURRENT, (_, e, next) => {
        if (e.value === null) cleared.push(true)
        else if (e.value.placed === true) seated()
        return next(e)
      })

      const pending = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
      await placed

      const ui = await $.ui.mount({
        plugin: 'ask-mod',
        surface,
        component: 'Pane',
        requestId: PANE,
        props: PANE_PROPS,
        viewport: { columns: 120, rows: 40 },
      })
      expect(await ui.findAll({ type: 'Code' })).toHaveLength(2)
      for (const o of QUESTIONS[0]!.options) expect(await ui.find({ type: 'Text', text: o.label })).toBeDefined()

      release()
      await pending
      expect(cleared).toEqual([true])
    })
  }
})

// --- the call ---------------------------------------------------------------------------

describe('around the call', () => {
  test('opens the pane before the dialog, closes it after, and remembers the answer', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const events: string[] = []
    on('store.set', { key: 'history' }, (_, e, next) => {
      events.push(`store ${JSON.stringify(e.value)}`)
      return next(e)
    })
    mock.store(on)
    on('ui.open', (_, e) => {
      events.push(`open ${e.id}`)
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', (_, e) => {
      events.push(`close ${e.id} ${e.origin.kind}`)
      return { value: undefined }
    })
    on('tool.call', { tool: 'AskUserQuestion' }, () => {
      events.push('dialog')
      return { result: { questions: QUESTIONS, answers: { [QUESTIONS[0]!.question]: 'Plugin store' } } }
    })

    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })

    expect(events.slice(0, 3)).toEqual([`open ${PANE}`, 'dialog', `close ${PANE} plugin`])
    const saved = events.find(line => line.startsWith('store '))
    expect(saved).toBeDefined()
    const history = JSON.parse(saved!.slice('store '.length)) as AskHistory
    expect(history[QUESTIONS[0]!.question]).toEqual({
      answer: 'Plugin store',
      header: 'Store',
      labels: ['Session state', 'Plugin store', 'A file'],
      at: 1_000,
    })
  })

  test('a pane the terminal cannot seat is closed again and noted on the call', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const events: string[] = []
    on('ui.open', () => ({ value: { isPlaced: false as const, reason: '96 columns; a pane nobody asked for seats from 144' } }))
    on('ui.close', (_, e) => {
      events.push(`close ${e.id}`)
      return { value: undefined }
    })
    const placed: (boolean | null)[] = []
    on('state.set', CURRENT, (_, e, next) => {
      if (e.value !== null) placed.push(e.value.placed)
      return next(e)
    })
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: QUESTIONS, answers: {} } }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    expect(placed).toEqual([null, false])
    expect(events).toEqual([`close ${PANE}`])
  })

  test('compare off never opens the pane', { options: { compare: 'off' } }, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let opened = 0
    on('ui.open', () => {
      opened += 1
      return { value: { isPlaced: true as const } }
    })
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: QUESTIONS, answers: {} } }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    expect(opened).toBe(0)
  })

  test('/ask-compare opens the pane by hand and keeps it wanted for the session', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let opened = 0
    on('ui.open', () => {
      opened += 1
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', () => ({ value: undefined }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    const toggles: (boolean | null)[] = []
    on('state.set', COMPARE_OPEN, (_, e, next) => {
      toggles.push(e.value)
      return next(e)
    })
    // a bare round: auto would not open the pane for it
    const bare = [{ ...QUESTIONS[0]!, options: QUESTIONS[0]!.options.map(o => ({ label: o.label, description: '' })) }]
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: bare, answers: {} } }))

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'AskUserQuestion', questions: bare })
    expect(opened).toBe(0)

    const answer = await $.command.run({
      command: 'ask-compare',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(answer.text).toBe('選項比較板開了。')
    expect(opened).toBe(1)
    expect(toggles).toEqual([true])
    await $.tool.call({ tool: 'AskUserQuestion', questions: bare })
    expect(opened).toBe(2)
  })

  test('history in the store comes back at session start', async ($, on) => {
    mock.store(on, {
      history: { [QUESTIONS[0]!.question]: { answer: 'A file', header: 'Store', labels: [], at: 5 } },
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    const written: AskHistory[] = []
    on('state.set', { plugin: 'ask-mod', key: 'history' }, (_, e, next) => {
      written.push(e.value)
      return next(e)
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(written).toHaveLength(1)
    expect(written[0]![QUESTIONS[0]!.question]?.answer).toBe('A file')
  })
})

// --- pure parts ------------------------------------------------------------------------

describe('pure parts', () => {
  test('parseQuestions reads the tool schema loosely and drops junk', () => {
    const parsed = parseQuestions([
      ...QUESTIONS,
      { question: 'How many?', header: 'Count', kind: 'number', min: 1, max: 9, multiSelect: false },
      { nope: true },
      'text',
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.kind).toBe('choice')
    expect(parsed[0]!.options).toHaveLength(3)
    expect(parsed[1]!.kind).toBe('number')
    expect(parsed[1]!.max).toBe(9)
    expect('placeholder' in parsed[1]!).toBe(false)
  })

  test('decideCompare: the toggle wins, then the mode, then previews, several questions or descriptions', () => {
    const qs = parseQuestions(QUESTIONS)
    const bare = parseQuestions([{ ...QUESTIONS[0], options: QUESTIONS[0]!.options.map(o => ({ label: o.label })) }])
    const text = parseQuestions([{ question: 'Name?', header: 'Name', kind: 'text', multiSelect: false }])
    expect(decideCompare('off', true, qs)).toBe(false)
    expect(decideCompare('auto', false, qs)).toBe(false)
    expect(decideCompare('always', null, bare)).toBe(true)
    expect(decideCompare('always', null, text)).toBe(false)
    expect(decideCompare('auto', null, qs)).toBe(true)
    expect(decideCompare('auto', null, bare)).toBe(false)
    expect(decideCompare('auto', null, [...bare, ...bare])).toBe(true)
  })

  test('classifyPreview: fences, diffs, code and prose', () => {
    expect(classifyPreview('```ts\nlet a = 1\n```', 12)).toEqual({ kind: 'code', source: 'let a = 1', language: 'ts', hidden: 0 })
    expect(classifyPreview(DIFF, 2)).toEqual({ kind: 'diff', source: DIFF })
    expect(classifyPreview('```diff\n' + DIFF + '\n```', 2)).toEqual({ kind: 'diff', source: DIFF })
    const long = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join('\n')
    const cut = classifyPreview(long, 5)
    expect(cut.kind).toBe('code')
    expect(cut.kind === 'code' && cut.hidden).toBe(15)
    expect(classifyPreview('Just a sentence.\n\nAnd another.', 12)).toEqual({
      kind: 'markdown',
      text: 'Just a sentence.\n\nAnd another.',
      hidden: 0,
    })
    expect(classifyPreview('a\u0007b\u001bc', 12)).toEqual({ kind: 'markdown', text: 'abc', hidden: 0 })
  })

  test('cardWidth: side by side while each card keeps its minimum, else stacked', () => {
    expect(cardWidth(120, 3, 28)).toBe(39)
    expect(cardWidth(80, 3, 28)).toBeUndefined()
    expect(cardWidth(120, 1, 28)).toBeUndefined()
  })

  test('displayWidth and fitWidth count CJK as two cells', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('中文')).toBe(4)
    expect(fitWidth('中文中文', 8)).toBe('中文中文')
    expect(fitWidth('中文中文', 7)).toBe('中文中…')
    expect(fitWidth('abcdef', 4)).toBe('abc…')
  })

  test('mergeHistory and recallAnswer: exact wording first, then header over the same options', () => {
    const qs = parseQuestions(QUESTIONS)
    const history = mergeHistory(undefined, qs, { [qs[0]!.question]: 'A file' }, 7)
    expect(recallAnswer(history, qs[0]!)?.answer).toBe('A file')
    const reworded = { ...qs[0]!, question: 'Where should the answers live?' }
    expect(recallAnswer(history, reworded)?.answer).toBe('A file')
    const otherOptions = { ...reworded, options: [{ label: 'X' }, { label: 'Y' }] }
    expect(recallAnswer(history, otherOptions)).toBeUndefined()
    expect(mergeHistory(history, qs, 'not an object', 8)).toEqual(history)
  })

  test('leadFrom quotes the last paragraph of the last text block, flattened', () => {
    const content = [
      { type: 'text', text: 'First.\n\n## Heading\n- one\n- two\n\nSo I need to know which one you want.' },
      { type: 'tool_use', id: 'x', name: 'AskUserQuestion', input: {} },
    ]
    expect(leadFrom(content)).toBe('So I need to know which one you want.')
    expect(leadFrom([{ type: 'text', text: '   ' }])).toBeUndefined()
    expect(leadFrom([{ type: 'text', text: 'x'.repeat(500) }])).toHaveLength(240)
  })
})
