// Screenshots: Ink frames (with ANSI colour) -> HTML -> Chromium PNG.
// usage: FORCE_COLOR=1 PW=<playwright dir> node shot.mjs <outdir>
import { frame } from './render.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const el = type => props => { const { children = [], ...rest } = props; return { type, props: rest, children: Array.isArray(children) ? children : [children] } }
const ELS = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Code: el('Code'), Markdown: el('Markdown') }

// --- ansi -> html -----------------------------------------------------------
const FG = { 30: '#3b3b3b', 31: '#ff5f56', 32: '#5af78e', 33: '#f3f99d', 34: '#57c7ff', 35: '#ff6ac1', 36: '#9aedfe', 37: '#f1f1f0', 90: '#808080', 91: '#ff6e67', 92: '#5af78e', 93: '#f3f99d', 94: '#57c7ff', 95: '#ff6ac1', 96: '#9aedfe', 97: '#ffffff' }
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function ansiToHtml(text) {
  let out = ''
  const st = { fg: null, bg: null, bold: false, dim: false, inverse: false, underline: false }
  const open = () => {
    let fg = st.fg ?? '#e6e6e6', bg = st.bg ?? 'transparent'
    if (st.inverse) [fg, bg] = [bg === 'transparent' ? '#1b1b1b' : bg, fg]
    const css = [`color:${fg}`, bg !== 'transparent' ? `background:${bg}` : '', st.bold ? 'font-weight:700' : '', st.dim ? 'opacity:.55' : '', st.underline ? 'text-decoration:underline' : ''].filter(Boolean).join(';')
    return `<span style="${css}">`
  }
  let openTag = open()
  out += openTag
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index))
    last = re.lastIndex
    const codes = (m[1] === '' ? '0' : m[1]).split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) Object.assign(st, { fg: null, bg: null, bold: false, dim: false, inverse: false, underline: false })
      else if (c === 1) st.bold = true
      else if (c === 2) st.dim = true
      else if (c === 4) st.underline = true
      else if (c === 7) st.inverse = true
      else if (c === 22) { st.bold = false; st.dim = false }
      else if (c === 24) st.underline = false
      else if (c === 27) st.inverse = false
      else if (c === 39) st.fg = null
      else if (c === 49) st.bg = null
      else if (FG[c] !== undefined) st.fg = FG[c]
      else if (c >= 40 && c <= 47) st.bg = FG[c - 10]
      else if (c >= 100 && c <= 107) st.bg = FG[c - 10]
      else if (c === 38 || c === 48) { const t = codes[i + 1]; if (t === 2) { const v = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; if (c === 38) st.fg = v; else st.bg = v; i += 4 } else if (t === 5) i += 2 }
    }
    out += '</span>' + open()
  }
  out += esc(text.slice(last)) + '</span>'
  return out
}

const page = (title, blocks) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #0f1115; padding: 24px; font-family: "DejaVu Sans Mono", "WenQuanYi Zen Hei", monospace; }
  .term { background: #1b1b1b; color: #e6e6e6; border-radius: 10px; padding: 14px 18px; display: inline-block; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
  .bar { display:flex; gap:7px; margin-bottom: 10px } .bar i { width: 12px; height: 12px; border-radius: 50%; display: inline-block }
  pre { margin: 0; font: 14px/1.35 "DejaVu Sans Mono", "WenQuanYi Zen Hei", monospace; white-space: pre; }
  .cap { color: #8b8b8b; font: 12px "DejaVu Sans Mono", "WenQuanYi Zen Hei", monospace; margin: 6px 0 2px; }
  .mock { color: #6f6f6f; }
  h1 { color: #ddd; font: 600 15px "DejaVu Sans Mono", "WenQuanYi Zen Hei", monospace; margin: 0 0 10px }
</style></head><body><h1>${esc(title)}</h1><div class="term" id="shot"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i></div>${blocks.join('')}</div></body></html>`

const block = (caption, ansi) => `${caption ? `<div class="cap">${esc(caption)}</div>` : ''}<pre>${ansiToHtml(ansi)}</pre>`
const mock = text => `<pre class="mock">${esc(text)}</pre>`

// --- scenarios -----------------------------------------------------------------
const redo = await import('./ask-redo-mod.mjs')
const ask = await import('./ask-mod.mjs')
const redoS = (await import('./scenarios-ask-redo-mod.mjs')).default
const askS = (await import('./scenarios-ask-mod.mjs')).default
const byTitle = (list, t) => list.find(s => s.title === t)
const promptBox = cols => mock(`╭${'─'.repeat(cols - 2)}╮\n│ > ${' '.repeat(cols - 6)}│\n╰${'─'.repeat(cols - 2)}╯`)

const shots = []
{
  const s = byTitle(redoS, 'band 3 options, roomy')
  shots.push(['ask-redo-band.png', 'ask-redo-mod · 問題畫在輸入框上方（100 欄）', [
    mock('⏺ Both work; the difference is whether we keep a schema around. Which\n  store do you want? I\'ll wait for your answer.\n'),
    block('', frame(s.tree(redo, ELS), s.columns)),
    promptBox(100),
  ]])
}
{
  const a = byTitle(redoS, 'band 4 CJK options, 80 cols'); const b = byTitle(redoS, 'band 2 options, 60 cols, maxRows 4')
  shots.push(['ask-redo-band-variants.png', 'ask-redo-mod · 四個中文選項（80 欄）／是非題一列（60 欄）', [
    block('4 options, 80 cols', frame(a.tree(redo, ELS), a.columns)), promptBox(80),
    block('2 options without descriptions, 60 cols', frame(b.tree(redo, ELS), b.columns)), promptBox(60),
  ]])
}
{
  const strip = byTitle(askS, 'strip, 1 question, lead + history'); const pane = byTitle(askS, 'pane, 1 question, 118 cols')
  const dialog = mock(`\n Which store should hold the answers?\n ❯ 1. Session state   Gone when the session ends; nothing written anywhere.\n   2. Plugin store (Recommended)   Survives a restart; 4 MiB cap shared with everything.\n   3. A file   Readable by other tools and by you; needs a path and a format.\n   4. Type your own answer\n\n Enter to select · ↑/↓ to navigate · Esc to cancel\n`)
  shots.push(['ask-mod-strip-dialog-pane.png', 'ask-mod · 脈絡列（上）＋ 引擎原生對話框（中，示意）＋ 選項比較板（下，118 欄）', [
    block('strip, drawn by ask-mod', frame(strip.tree(ask, ELS), 100)),
    block('the engine\'s own dialog (mock)', ''), dialog,
    block('compare pane, drawn by ask-mod', `╔═ 選項比較 ${'═'.repeat(104)} ✕ ═╗`), block('', frame(pane.tree(ask, ELS), pane.columns)), block('', `╚${'═'.repeat(118)}╝`),
    promptBox(118),
  ]])
}
{
  const s = byTitle(askS, 'pane, 3 questions, 118 cols')
  shots.push(['ask-mod-pane-3q.png', 'ask-mod · 三題一次攤開：選擇題、是非題、數字滑桿（118 欄）', [block('', frame(s.tree(ask, ELS), s.columns))]])
}
{
  const s = byTitle(askS, 'pane, 1 question, 70 cols (stacked)')
  shots.push(['ask-mod-pane-stacked.png', 'ask-mod · 窄終端機改成上下堆疊（70 欄）', [block('', frame(s.tree(ask, ELS), s.columns))]])
}

const outDir = process.argv[2]
mkdirSync(outDir, { recursive: true })
const { chromium } = await import(process.env.PW)
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
for (const [file, title, blocks] of shots) {
  const html = page(title, blocks)
  writeFileSync(`${outDir}/${file.replace(/\.png$/, '.html')}`, html)
  await pg.setContent(html)
  await pg.locator('body').screenshot({ path: `${outDir}/${file}` })
  console.log('wrote', file)
}
await browser.close()
