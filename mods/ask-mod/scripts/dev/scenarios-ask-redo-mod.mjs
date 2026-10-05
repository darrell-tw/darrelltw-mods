const Q3 = {
  question: 'Which store should hold the answers?',
  header: 'Store',
  options: [
    { label: 'Session state', description: 'Gone when the session ends; nothing written anywhere.' },
    { label: 'Plugin store (Recommended)', description: 'Survives a restart; 4 MiB cap shared with everything else the plugin keeps.' },
    { label: 'A file', description: 'Readable by other tools and by you; needs a path and a format.' },
  ],
}
const Q4CJK = {
  question: '這次的報價來源要走哪一條？Yahoo 延遲二十分鐘但免金鑰，永豐和群益是即時但要帳號。',
  header: '報價來源',
  options: [
    { label: 'Yahoo（延遲）', description: '免金鑰、免帳號，台股延遲約二十分鐘，美股即時。' },
    { label: '永豐 Shioaji', description: 'macOS／Linux，要永豐帳號和憑證，台股即時 tick。' },
    { label: '群益 Capital', description: 'Windows 限定，要群益帳號，DLL 路徑要自己設。' },
    { label: '先不接，用示範資料', description: '畫面先跑起來，footer 會標示範資料。' },
  ],
}
const Q2 = { question: 'Delete the old cache first?', header: 'Cache', options: [{ label: 'Yes, delete it' }, { label: 'No, keep it' }] }

const band = (q, cols, maxRows, freeText = true) => (mod, els) =>
  mod.drawBand(els, { question: q, columns: cols, layout: mod.fitBand(q, cols, maxRows, freeText), freeText, onPick: () => {} })

export default [
  { title: 'band 3 options, roomy', columns: 100, tree: band(Q3, 100, 20) },
  { title: 'band 4 CJK options, 80 cols', columns: 80, tree: band(Q4CJK, 80, 20) },
  { title: 'band 4 CJK options, 80 cols, maxRows 6', columns: 80, tree: band(Q4CJK, 80, 6) },
  { title: 'band 2 options, 60 cols, maxRows 4', columns: 60, tree: band(Q2, 60, 4) },
  { title: 'band 3 options, 160 cols', columns: 160, tree: band(Q3, 160, 20) },
]
