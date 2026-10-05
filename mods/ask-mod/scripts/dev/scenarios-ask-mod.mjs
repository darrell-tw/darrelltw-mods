const DIFF = ['@@ -1,3 +1,3 @@', ' const store = readJson(path)', '-const cache = new Map()', '+const cache = new Map(seed)', ' export { store, cache }'].join('\n')
const QS = [
  {
    question: 'Which store should hold the answers?',
    header: 'Store',
    multiSelect: false,
    options: [
      { label: 'Session state', description: 'Gone when the session ends; nothing written anywhere.' },
      { label: 'Plugin store (Recommended)', description: 'Survives a restart; 4 MiB cap shared with everything the plugin keeps.', preview: DIFF },
      { label: 'A file', description: 'Readable by other tools and by you; needs a path and a format.', preview: '```json\n{ "answers": { "store": "file" } }\n```' },
    ],
  },
]
const QS2 = [
  ...QS,
  {
    question: '要不要順便把舊的 cache 清掉？',
    header: 'Cache',
    multiSelect: false,
    options: [{ label: '清掉', description: '下次啟動重抓一次。' }, { label: '留著', description: '舊資料先用著。' }],
  },
  { question: '一頁幾檔？', header: 'Page', kind: 'number', min: 5, max: 20, step: 5, defaultValue: 10, unit: '檔', multiSelect: false, options: [] },
]

const current = qs => mod => ({ requestId: 't', questions: mod.parseQuestions(qs), placed: true })
const history = { [QS[0].question]: { answer: 'Plugin store (Recommended)', header: 'Store', labels: [], at: 1 } }

export default [
  {
    title: 'strip, 1 question, lead + history',
    columns: 100,
    tree: (mod, els) =>
      mod.drawStrip(els, {
        questions: mod.parseQuestions(QS),
        metadataSource: undefined,
        lead: { text: '兩種做法都能動，差在之後要不要維護一個 schema，我想先問你偏好哪邊再動手。', at: 1 },
        history,
        current: current(QS)(mod),
        paneWanted: true,
      }),
  },
  {
    title: 'strip, 3 questions, pane not placed',
    columns: 100,
    tree: (mod, els) =>
      mod.drawStrip(els, { questions: mod.parseQuestions(QS2), lead: null, history, current: { ...current(QS2)(mod), placed: false }, paneWanted: true }),
  },
  { title: 'pane, 1 question, 118 cols', columns: 118, tree: (mod, els) => mod.drawCompare(els, { current: current(QS)(mod), history, columns: 118, previewLines: 12, cardMinColumns: 28 }) },
  { title: 'pane, 3 questions, 118 cols', columns: 118, tree: (mod, els) => mod.drawCompare(els, { current: current(QS2)(mod), history, columns: 118, previewLines: 12, cardMinColumns: 28 }) },
  { title: 'pane, 1 question, 70 cols (stacked)', columns: 70, tree: (mod, els) => mod.drawCompare(els, { current: current(QS)(mod), history, columns: 70, previewLines: 12, cardMinColumns: 28 }) },
]
