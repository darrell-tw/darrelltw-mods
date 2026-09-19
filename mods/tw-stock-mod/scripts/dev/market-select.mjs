// Proves the market-switcher control itself, all four configurable styles
// (three since 2026-09-19 at the user's request, plus `menu` added the same
// day when `select`'s dropdown turned out to be keyboard-only - picked by
// `marketSwitcher` in stock-band.json, see MarketSwitcher's own comment in
// register.tsx):
//   - `tabs`: one Button per marketStops() entry, the current one
//     full-strength and the rest dimColor.
//   - `select`: the engine's own dropdown, labelled `市場: ...` - its
//     options are keyboard/focus-only, no click path.
//   - `cycle`: one Button that walks marketStops() in order (mobile's own
//     fallback, canSelect === false, draws this same style).
//   - `menu`: a header Button (`市場：...`) that toggles a column of plain
//     option Buttons below it - the mouse-clickable stand-in for `select`,
//     and the new default (see defaultConfig's own comment in register.tsx).
// Plus the two collapse rules: `select` drops to `cycle` when the resolved
// Elements table carries no Select at all, and `tabs` drops to `cycle` when
// the terminal is too narrow for its own Buttons (see tabsGroupWidth in
// register.tsx) - and the invalid-value fallback (parseConfigRoot keeps
// `menu` for anything it does not recognize, `menu` being defaultConfig()'s
// own default since 2026-09-19).
//
// Cases (1)-(9) prove the three original styles/collapse rules themselves,
// against the boot() default of both markets holding something
// (BOTH_HOLDINGS - see its own comment), so every stop each style can draw
// is always present and the case bodies stay about the switcher, not the
// holdings gate. Cases (10)-(13) prove the holdings gate itself
// (marketStops() only offering a market's `:pnl` stop when holdingsFor()
// actually finds holdings for it - 2026-09-19 regression fix, restoring
// behavior an earlier `buildCycle(hasUsHoldings)` parameter used to cover
// for US alone before a later refactor read the tw/us asymmetry as
// accidental and dropped the whole condition). Cases (14)-(16) prove `menu`
// itself: the default draws its header and nothing else, pressing the
// header opens the option column (marketStops() order/labels, only the
// current stop non-dim), and pressing an option both switches the stop
// (through the same onSelectMarket every other style already uses) and
// closes the menu again.
// Against the REAL register.tsx (bundled), same "stub host, canned
// $.http.fetch" shape as crypto-feed.mjs - this needs a fully controllable
// resolve() table (with or without Select) and a controllable viewport
// width as much as it needs canned network answers, so a live endpoint
// would prove nothing about either capability check.
//
// Usage: node market-select.mjs <register.js>
import { pathToFileURL } from 'node:url'
import { ok, done } from './assert.mjs'

const [, , modPath] = process.argv
globalThis.h = (type, props, ...kids) => ({ type, props: props ?? {}, kids: kids.flat() })
globalThis.Fragment = 'Fragment'

// Must match the literals in hooks/register.tsx - neither constant is
// exported, so this harness names them again to tell a Pionex ticker
// request apart from a CoinGecko market-cap-supply request (fetchCryptoSupply
// rides the same tick as feedCrypto - see register.tsx's feedOnce) in the
// shared $.http.fetch stub below.
const PIONEX_TICKERS_URL = 'https://api.pionex.com/api/v1/market/tickers'
const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets'
// This file is not the one proving the market-cap sort (see crypto-sort.mjs
// for that) - a happy, quiet answer here just keeps fetchCryptoSupply from
// ever logging a "CoinGecko unavailable" warning that would confuse this
// harness's own assertions.
const COINGECKO_HAPPY_BODY = JSON.stringify([
  { id: 'bitcoin', symbol: 'btc', circulating_supply: 19_800_000 },
  { id: 'ethereum', symbol: 'eth', circulating_supply: 120_500_000 },
  { id: 'solana', symbol: 'sol', circulating_supply: 480_000_000 },
  { id: 'binancecoin', symbol: 'bnb', circulating_supply: 145_800_000 },
  { id: 'ripple', symbol: 'xrp', circulating_supply: 58_500_000_000 },
  { id: 'dogecoin', symbol: 'doge', circulating_supply: 148_000_000_000 },
  { id: 'cardano', symbol: 'ada', circulating_supply: 35_400_000_000 },
  { id: 'avalanche-2', symbol: 'avax', circulating_supply: 410_000_000 },
  { id: 'chainlink', symbol: 'link', circulating_supply: 678_000_000 },
  { id: 'bitcoin-cash', symbol: 'bch', circulating_supply: 19_800_000 },
])

// A happy Pionex answer for the ten default CRYPTO_LIST codes - the same
// values crypto-feed.mjs uses (read off Pionex 2026-09-18/19), reused here
// rather than re-derived since this harness is not the one proving the
// pct/filter math, only that a request fires and the board goes live.
const HAPPY_TICKERS = [
  { symbol: 'BTC_USDT', time: 1789746167017, open: '76633.32', close: '80744.04', high: '81153.69', low: '76259.98', volume: '38480.088467', amount: '3017756588.53451109', count: 499384 },
  { symbol: 'ETH_USDT', time: 1789746167017, open: '2467.86', close: '2579.91', high: '2610.00', low: '2440.11', volume: '900000', amount: '2000000000', count: 100000 },
  { symbol: 'SOL_USDT', time: 1789746167017, open: '100.99', close: '110.92', high: '112.50', low: '99.80', volume: '500000', amount: '50000000', count: 80000 },
  { symbol: 'BNB_USDT', time: 1789746167017, open: '727.45', close: '756.24', high: '760.00', low: '720.10', volume: '90000', amount: '65000000', count: 40000 },
  { symbol: 'XRP_USDT', time: 1789746167017, open: '1.3058', close: '1.3785', high: '1.4000', low: '1.2900', volume: '4000000', amount: '5300000', count: 90000 },
  { symbol: 'DOGE_USDT', time: 1789746167017, open: '0.08177', close: '0.08735', high: '0.08900', low: '0.08100', volume: '80000000', amount: '6900000', count: 120000 },
  { symbol: 'ADA_USDT', time: 1789746167017, open: '0.2023', close: '0.2191', high: '0.2250', low: '0.1990', volume: '9000000', amount: '1900000', count: 60000 },
  { symbol: 'AVAX_USDT', time: 1789746167017, open: '7.59', close: '8.10', high: '8.25', low: '7.50', volume: '600000', amount: '4800000', count: 30000 },
  { symbol: 'LINK_USDT', time: 1789746167017, open: '11.37', close: '12.16', high: '12.30', low: '11.20', volume: '700000', amount: '8300000', count: 35000 },
  { symbol: 'BCH_USDT', time: 1789746167017, open: '232.8', close: '252.5', high: '256.4', low: '231.2', volume: '47345.0619', amount: '11599993.01419999', count: 30500 },
]
const HAPPY_BODY = JSON.stringify({ result: true, data: { tickers: HAPPY_TICKERS }, timestamp: 1789746167461 })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const k of node.kids ?? []) walk(k, visit)
}

/** Pulls the board's own props, every drawn Button, and every drawn Select out of one render tree. */
function drawInfo(tree) {
  let boardProps
  const buttons = []
  const selects = []
  walk(tree, n => {
    if (n.type === 'Client') boardProps = n.props.props
    if (n.type === 'Button') {
      buttons.push({ key: n.props.key, label: n.props.label, dimColor: !!n.props.dimColor, press: n.props.onPress })
    }
    if (n.type === 'Select') {
      selects.push({ key: n.props.key, label: n.props.label, options: n.props.options, value: n.props.value, select: n.props.onSelect })
    }
  })
  return { boardProps, buttons, selects }
}

// Every Button key the tabs row draws is `stock-band:market:<value>` (see
// register.tsx's tabs row) - `stock-band:market:tw`, `...:tw:pnl`, etc. This
// tells a tabs Button apart from the one `cycle` Button (bare
// `stock-band:market`, no suffix) without hardcoding all five keys twice.
const isTabButton = b => typeof b.key === 'string' && b.key.startsWith('stock-band:market:')

// `menu`'s own open option column draws `stock-band:market:menu:<value>`
// (see register.tsx's menu option Buttons) - a stricter prefix than
// isTabButton's, so a menu option is never mistaken for a tabs Button (both
// only ever draw under their own marketSwitcher style, but the two harness
// helpers should still tell them apart on their own, not by which case
// happens to be running). The bare header Button stays `stock-band:market`,
// same key `cycle` uses - only its label (the literal `市場：` prefix) says
// which of the two it is; cases below check the label where that matters.
const isMenuOptionButton = b => typeof b.key === 'string' && b.key.startsWith('stock-band:market:menu:')

// Mirrors register.tsx's own marketButtonLabel(marketLabel, pnl) off a
// drawn render's boardProps (`marketLabel` is the board's base label - 台股/
// 美股/加密貨幣 - `view` says whether the 庫存 suffix belongs on it) - the
// `menu` header's own on-screen text, cases (14)/(16) check against it
// rather than hardcoding "台股 ▾"/"美股庫存 ▾" twice.
const marketButtonLabelFor = boardProps => `${boardProps?.marketLabel}${boardProps?.view === 'pnl' ? '庫存' : ''} ▾`

// Both markets holding something is the shape every case before the
// holdings-gating fix (10)-(13) below was written against, and stays boot()'s
// own default so none of those cases has to pass `holdings` explicitly to
// keep seeing the five stops it always assumed - only (10)-(13) override it
// to prove the gate itself (brief's four acceptance scenarios). `holdingsSource:
// 'config'` sidesteps the holdings-FILE poll path entirely (a manual
// `holdings` block in stock-band.json - see holdingsFor's own doc comment),
// so these cases do not also have to fake `.claude/stock-holdings.json`.
const BOTH_HOLDINGS = { tw: [{ code: '2330', name: '台積電', qty: 1000, cost: 500 }], us: [{ code: 'AAPL', name: 'Apple', qty: 10, cost: 150 }] }

/**
 * Boots a fresh module instance (register.tsx keeps module-level mutable
 * state that must not leak between cases sharing one process, same reason
 * crypto-feed.mjs/sources-order.mjs re-import per case) with a manually-
 * driven clock, a `market` this case starts on, whether the resolved
 * Elements table carries a Select, which `marketSwitcher` style the config
 * requests (defaults to leaving the key out entirely, so parseConfigRoot's
 * own `'tabs'` default is what runs), a queue of canned Pionex responses,
 * how many columns `draw()`'s viewport reports (default 100 - wide enough
 * for tabs to fit, see tabsGroupWidth's own ~30-column estimate in
 * register.tsx; a case proving the narrow-terminal collapse passes a
 * smaller one), and which markets have holdings (`holdings`/`holdingsSource`,
 * defaulting to BOTH_HOLDINGS/'config' - see its own comment). Also returns
 * `files` (the mutable in-memory filesystem) and `pollNow` (fires the same
 * timer session.start registers for its config/holdings poll and gives its
 * unawaited work a moment to land) so a case can rewrite stock-band.json
 * mid-test and prove marketStops() picks the change up on the next render
 * (see case (13) below).
 */
let moduleTick = 0
async function boot({
  market,
  canSelect,
  marketSwitcher,
  columns = 100,
  cryptoResponses = [{ status: 200, text: HAPPY_BODY }],
  holdings = BOTH_HOLDINGS,
  holdingsSource = 'config',
}) {
  moduleTick += 1
  const url = pathToFileURL(modPath)
  url.search = `?case=${moduleTick}`
  const { register } = await import(url.href)

  const home = '/fake-home'
  const configOf = h => ({
    market,
    feed: 'auto',
    feedMs: 30000,
    refreshMs: 3000,
    holdings: h,
    holdingsSource,
    ...(marketSwitcher === undefined ? {} : { marketSwitcher }),
  })
  const files = {
    '.claude/stock-band.json': JSON.stringify(configOf(holdings)),
  }
  const calls = []
  const timers = []
  const logs = []
  let cryptoCalls = 0
  let clock = 1789746167017 // matches the fixtures' own `time`, arbitrary otherwise

  const $ = {
    clock: { now: async () => clock, every: (ms, fn) => timers.push({ ms, fn }) },
    fs: {
      read: async p => { if (p in files) return files[p]; throw new Error('ENOENT ' + p) },
      write: async (p, text) => { files[p] = text },
    },
    env: { get: async name => (name === 'HOME' ? home : undefined) },
    session: { cwd: async () => '/fake-project' },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    plugin: { root: '/fake-plugin-root' },
    ui: {
      log: m => logs.push(m),
      invalidate: () => {},
      resolve: async () =>
        canSelect
          ? { Box: 'Box', Text: 'Text', Button: 'Button', Client: 'Client', Select: 'Select' }
          : { Box: 'Box', Text: 'Text', Button: 'Button', Client: 'Client' },
    },
    http: {
      fetch: async (u, init) => {
        if (typeof u === 'string' && u.startsWith(COINGECKO_MARKETS_URL)) {
          // Routed away from `calls`/pionexCallCount entirely, same reason
          // as crypto-feed.mjs's stub: fetchCryptoSupply's own request must
          // never look like a second Pionex ticker call to this file's
          // assertions.
          return { status: 200, ok: true, text: COINGECKO_HAPPY_BODY, headers: {} }
        }
        calls.push({ url: u, init, at: clock })
        if (u === PIONEX_TICKERS_URL) {
          const idx = Math.min(cryptoCalls, cryptoResponses.length - 1)
          cryptoCalls += 1
          const r = cryptoResponses[idx]
          return { status: r.status, ok: r.status >= 200 && r.status < 300, text: r.text, headers: r.headers ?? {} }
        }
        // tw/us (Yahoo spark/chart) are not under test here - an empty but
        // VALID body, not a failure: a failure would set the shared
        // feedSkipUntil (see backOff in register.tsx), which gates every
        // market's next feed() call, including the crypto request this
        // harness is proving fires immediately.
        return { status: 200, ok: true, text: '{}' }
      },
    },
  }

  const handlers = new Map()
  register((event, a, b) => handlers.set(event, typeof a === 'function' ? a : b))
  const next = async () => ({ type: 'next', props: {}, kids: [] })
  await handlers.get('session.start')($, {}, next)
  // session.start already awaits its own boot feed() before returning - a
  // small buffer against anything unawaited, not load-bearing (same
  // convention as crypto-feed.mjs).
  await new Promise(r => setTimeout(r, 200))

  const draw = async () => {
    const tree = await handlers.get('ui.render')($, { props: {}, surface: 'terminal', viewport: { columns } }, next)
    return drawInfo(tree)
  }

  // A short real-time pause for whatever a press/select left unawaited
  // (requestFeed's own feed().catch(...) chain) - it does NOT touch `clock`
  // and does NOT fire any $.clock.every timer, so a request that shows up
  // after only this is a request that fired on the spot, not one waiting
  // for the next poll tick.
  const settle = () => new Promise(r => setTimeout(r, 200))

  const pionexCallCount = () => calls.filter(c => c.url === PIONEX_TICKERS_URL).length

  // Rewrites stock-band.json with `patch` merged over whatever it currently
  // holds, then fires the SAME timer session.start registered for its own
  // config/holdings poll (`timers[0]` - the poll timer is always registered
  // first, right after session.start's own boot `await poll()`, before the
  // feed timer further down the same handler - see poll()'s own doc comment
  // in register.tsx) and gives its unawaited `poll().catch(...)` chain a
  // moment to land, the same real-time `settle()` every press/select case
  // already uses for its own unawaited work. This is how case (13) proves a
  // stop can vanish out from under a person mid-session, not only be absent
  // from the start.
  const reconfigure = async patch => {
    const current = JSON.parse(files['.claude/stock-band.json'])
    files['.claude/stock-band.json'] = JSON.stringify({ ...current, ...patch })
    timers[0]?.fn()
    await settle()
  }

  return { draw, settle, calls, pionexCallCount, logs, reconfigure }
}

// --- (1): marketSwitcher:"select" draws a Select, not the cycle Button or the
// tabs row - five options now, holdings folded in as two extra rows, crypto
// gets none, and the Select carries the `市場` label the user asked for -----
{
  const { draw } = await boot({ market: 'crypto', canSelect: true, marketSwitcher: 'select' })
  const { boardProps, buttons, selects } = await draw()

  const marketSelect = selects.find(s => s.key === 'stock-band:market')
  ok(!!marketSelect, '(1) terminal draws a Select for the market control')
  ok(marketSelect?.label === '市場', `(1) the Select carries the "市場" label, so it reads "市場: 加密貨幣" collapsed (got ${JSON.stringify(marketSelect?.label)})`)
  ok(!buttons.some(b => b.key === 'stock-band:market'), '(1) the old cycle Button is not also drawn')
  ok(!buttons.some(isTabButton), '(1) the tabs row is not also drawn')
  ok(!buttons.some(b => b.key === 'stock-band:holdings'), '(1) no separate holdings Button is drawn either')

  const values = (marketSelect?.options ?? []).map(o => o.value)
  ok(values.length === 5, `(1) exactly five options (got ${values.length}: ${JSON.stringify(values)})`)
  ok(new Set(values).size === 5, '(1) the five option values are unique')
  ok(
    JSON.stringify(values) === JSON.stringify(['tw', 'tw:pnl', 'us', 'us:pnl', 'crypto']),
    `(1) options are 台股/台股庫存/美股/美股庫存/加密貨幣, in that order (got ${JSON.stringify(values)})`,
  )
  ok(!values.includes('crypto:pnl'), '(1) crypto gets no holdings option at all')

  const labels = (marketSelect?.options ?? []).map(o => o.label)
  ok(
    JSON.stringify(labels) === JSON.stringify(['台股', '台股庫存', '美股', '美股庫存', '加密貨幣']),
    `(1) labels come from MARKETS[id].label, holdings rows append 庫存 (got ${JSON.stringify(labels)})`,
  )
  ok(
    marketSelect?.value === boardProps?.market,
    `(1) Select's value tracks the board's current market (value=${marketSelect?.value}, market=${boardProps?.market})`,
  )
}

// --- (2): picking crypto switches the board and fetches AT ONCE -------------
{
  const { draw, settle, pionexCallCount } = await boot({ market: 'us', canSelect: true, marketSwitcher: 'select' })
  let { boardProps, selects } = await draw()
  ok(boardProps?.market === 'us', 'sanity: (2) starts on us')
  ok(pionexCallCount() === 0, '(2) no Pionex request yet before crypto is ever selected')

  selects.find(s => s.key === 'stock-band:market').select('crypto')
  await settle() // NOT advancing the clock and NOT firing any $.clock.every timer

  ok(pionexCallCount() === 1, `(2) selecting crypto fires the Pionex request immediately (got ${pionexCallCount()} calls)`)
  ;({ boardProps } = await draw())
  ok(boardProps?.market === 'crypto', '(2) the board switched to crypto')
  ok(boardProps?.source === 'live', `(2) the immediate fetch published live quotes, not demo (source=${boardProps?.source})`)
}

// --- (3): marketSwitcher:"select" but $.ui.resolve carries no Select falls
// back to the cycle Button (brief item 5) -----------------------------------
{
  const { draw } = await boot({ market: 'us', canSelect: false, marketSwitcher: 'select' })
  let { boardProps, buttons, selects } = await draw()
  ok(selects.length === 0, '(3) no Select drawn when $.ui.resolve does not carry one')
  ok(!buttons.some(isTabButton), '(3) no tabs row drawn either - the fallback is the single cycle Button')

  const marketBtn = buttons.find(b => b.key === 'stock-band:market')
  ok(!!marketBtn, '(3) falls back to the one cycle Button')
  ok(buttons.filter(b => b.key === 'stock-band:market' || isTabButton(b)).length === 1, '(3) exactly one market-control Button is drawn')

  const before = { market: boardProps?.market, view: boardProps?.view }
  marketBtn.press()
  ;({ boardProps } = await draw())
  const after = { market: boardProps?.market, view: boardProps?.view }
  ok(
    after.market !== before.market || after.view !== before.view,
    `(3) pressing the fallback Button walks to the next cycle stop (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`,
  )
}

// --- (4): picking a holdings row selects market AND view together, with no
// separate holdings Button anywhere to press afterward ----------------------
{
  const { draw, settle } = await boot({ market: 'us', canSelect: true, marketSwitcher: 'select' })
  let { boardProps, buttons, selects } = await draw()
  ok(boardProps?.market === 'us' && boardProps?.view === 'table', 'sanity: (4) starts on 美股 (table)')
  ok(!buttons.find(b => b.key === 'stock-band:holdings'), '(4) no independent holdings Button exists on 美股')

  selects.find(s => s.key === 'stock-band:market').select('us:pnl')
  await settle()
  ;({ boardProps, buttons, selects } = await draw())
  ok(
    boardProps?.market === 'us' && boardProps?.view === 'pnl',
    `(4) selecting "us:pnl" lands on 美股庫存 (market=${boardProps?.market}, view=${boardProps?.view})`,
  )
  ok(
    selects.find(s => s.key === 'stock-band:market')?.value === 'us:pnl',
    `(4) the Select's own value reflects 美股庫存, not just 美股 (value=${selects.find(s => s.key === 'stock-band:market')?.value})`,
  )
  ok(!buttons.find(b => b.key === 'stock-band:holdings'), '(4) still no independent holdings Button on 美股庫存')

  selects.find(s => s.key === 'stock-band:market').select('tw:pnl')
  await settle()
  ;({ boardProps, selects } = await draw())
  ok(
    boardProps?.market === 'tw' && boardProps?.view === 'pnl',
    `(4) selecting "tw:pnl" jumps straight to 台股庫存, no intermediate 台股 stop needed (market=${boardProps?.market}, view=${boardProps?.view})`,
  )
  ok(selects.find(s => s.key === 'stock-band:market')?.value === 'tw:pnl', '(4) value reflects 台股庫存')

  // crypto never has a holdings row (see (1)) - picking it from a pnl stop
  // must land on its table, not a `view: 'pnl'` a crypto board can never
  // reach through its own dropdown.
  selects.find(s => s.key === 'stock-band:market').select('crypto')
  await settle()
  let buttonsAfterCrypto
  ;({ boardProps, buttons: buttonsAfterCrypto, selects } = await draw())
  ok(
    boardProps?.market === 'crypto' && boardProps?.view === 'table',
    `(4) selecting crypto from a pnl stop lands on its table, not a stranded pnl view (market=${boardProps?.market}, view=${boardProps?.view})`,
  )
  ok(!buttonsAfterCrypto.find(b => b.key === 'stock-band:holdings'), '(4) no independent holdings Button on crypto either')
}

// --- (5): marketSwitcher:"tabs" (the default, stated explicitly here) draws
// all five stops (both markets holding something, boot()'s own default) as
// (dimColor false), every other stop dimColor true, no Select anywhere - and
// pressing 美股庫存 jumps straight to it through the same onSelectMarket
// state-switch `select` uses (brief item 1) ---------------------------------
{
  const { draw, settle } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'tabs' })
  let { boardProps, buttons, selects } = await draw()
  ok(selects.length === 0, '(5) no Select drawn under marketSwitcher:"tabs"')

  const tabs = buttons.filter(isTabButton)
  ok(tabs.length === 5, `(5) exactly five tab Buttons drawn (got ${tabs.length})`)
  ok(
    JSON.stringify(tabs.map(b => b.key)) ===
      JSON.stringify(['stock-band:market:tw', 'stock-band:market:tw:pnl', 'stock-band:market:us', 'stock-band:market:us:pnl', 'stock-band:market:crypto']),
    `(5) tab keys are the five stops' values, in order (got ${JSON.stringify(tabs.map(b => b.key))})`,
  )

  const active = tabs.find(b => b.key === 'stock-band:market:tw')
  const rest = tabs.filter(b => b.key !== 'stock-band:market:tw')
  ok(active && active.dimColor === false, `(5) the current stop (台股) is not dimColor (got ${active?.dimColor})`)
  ok(rest.every(b => b.dimColor === true), `(5) every other tab is dimColor (got ${JSON.stringify(rest.map(b => b.dimColor))})`)

  tabs.find(b => b.key === 'stock-band:market:us:pnl').press()
  await settle()
  ;({ boardProps } = await draw())
  ok(
    boardProps?.market === 'us' && boardProps?.view === 'pnl',
    `(5) pressing the 美股庫存 tab jumps straight there (market=${boardProps?.market}, view=${boardProps?.view})`,
  )
}

// --- (6): marketSwitcher:"cycle" draws exactly one Button, no Select and no
// tabs row - five presses from any starting stop return to it (brief item 3,
// buildCycle/nextCycleStop reused rather than a second stepping algorithm) --
{
  const { draw, settle } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'cycle' })
  let { boardProps, buttons, selects } = await draw()
  ok(selects.length === 0, '(6) no Select drawn under marketSwitcher:"cycle"')
  ok(!buttons.some(isTabButton), '(6) no tabs row drawn under marketSwitcher:"cycle"')
  ok(buttons.filter(b => b.key === 'stock-band:market').length === 1, '(6) exactly one market-control Button is drawn')

  const start = { market: boardProps?.market, view: boardProps?.view }
  for (let i = 0; i < 5; i++) {
    const btn = buttons.find(b => b.key === 'stock-band:market')
    btn.press()
    await settle()
    ;({ boardProps, buttons } = await draw())
  }
  ok(
    boardProps?.market === start.market && boardProps?.view === start.view,
    `(6) five presses walk all five stops and land back on the start (start=${JSON.stringify(start)}, after=${JSON.stringify({ market: boardProps?.market, view: boardProps?.view })})`,
  )
}

// --- (7): an invalid marketSwitcher value falls back to whatever
// defaultConfig() says (parseConfigRoot's own default-on-anything-unrecognized
// rule). Asserted first against an OMITTED value rather than against a named
// style, so moving the default again later cannot make THAT half of this
// case lie about what the fallback is - the way it moved `tabs` -> `select`
// -> `menu` across three passes on 2026-09-19. The second half below DOES
// name `menu` explicitly: `menu` is the current default (see defaultConfig's
// own comment in register.tsx), and case (14) already proves what its own
// closed shape looks like, so naming it here is asserting today's actual
// default, not re-deriving a style-agnostic check case (14) already owns. --
{
  const bad = await boot({ market: 'tw', canSelect: true, marketSwitcher: '貓' })
  const omitted = await boot({ market: 'tw', canSelect: true })
  const badDraw = await bad.draw()
  const defDraw = await omitted.draw()
  ok(
    badDraw.selects.length === defDraw.selects.length &&
      badDraw.buttons.filter(isTabButton).length === defDraw.buttons.filter(isTabButton).length,
    `(7) an invalid marketSwitcher value draws exactly what omitting it draws (bad: ${badDraw.buttons.filter(isTabButton).length} tabs/${badDraw.selects.length} selects, default: ${defDraw.buttons.filter(isTabButton).length} tabs/${defDraw.selects.length} selects)`,
  )
  const { buttons } = badDraw
  ok(badDraw.selects.length === 0, '(7) the fallback (menu) draws no Select')
  ok(!buttons.some(isMenuOptionButton), '(7) the fallback (menu) starts closed - no option column drawn yet')
  const header = buttons.find(b => b.key === 'stock-band:market')
  ok(
    typeof header?.label === 'string' && header.label.startsWith('市場：'),
    `(7) the fallback is specifically menu - its header carries the "市場：" prefix (got ${JSON.stringify(header?.label)})`,
  )
}

// --- (8): marketSwitcher:"tabs" but the terminal is too narrow for the five
// Buttons falls back to the single cycle Button (brief item 6) --------------
{
  // tabsGroupWidth() ~30 (see register.tsx) + RIGHT_BUTTON_GROUP_COLS 40 = a
  // ~70-column fit threshold; 40 columns is comfortably under it.
  const { draw } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'tabs', columns: 40 })
  const { buttons, selects } = await draw()
  ok(selects.length === 0, '(8) a narrow terminal falling back from tabs does not draw a Select')
  ok(!buttons.some(isTabButton), '(8) a narrow terminal does not draw the five-Button tabs row')
  ok(buttons.filter(b => b.key === 'stock-band:market').length === 1, '(8) a narrow terminal falls back to the single cycle Button')

  // Sanity: the same config at a wide viewport still draws tabs - proves (8)
  // is really about the width, not marketSwitcher:"tabs" silently always
  // falling back.
  const { draw: drawWide } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'tabs', columns: 100 })
  const wide = await drawWide()
  ok(wide.buttons.filter(isTabButton).length === 5, '(8) sanity: the same config at 100 columns draws the full tabs row')
}

// --- (9): crypto never gets a holdings target, in any of the three styles
// (brief item 7) -------------------------------------------------------------
{
  const { draw: drawTabs } = await boot({ market: 'crypto', canSelect: true, marketSwitcher: 'tabs' })
  const tabs = (await drawTabs()).buttons.filter(isTabButton)
  ok(tabs.length === 5 && !tabs.some(b => b.key === 'stock-band:market:crypto:pnl'), '(9) tabs: no 加密貨幣庫存 Button among the five')

  const { draw: drawSelect } = await boot({ market: 'crypto', canSelect: true, marketSwitcher: 'select' })
  const opts = (await drawSelect()).selects.find(s => s.key === 'stock-band:market')?.options ?? []
  ok(!opts.some(o => o.value === 'crypto:pnl'), '(9) select: no crypto:pnl option (same assertion (1) already makes, restated here for the trio)')

  // cycle: walk all five stops from a crypto start and confirm none of them
  // is `{ market: 'crypto', view: 'pnl' }` - the only way a cycle stop could
  // ever "stop on 加密貨幣庫存" at all.
  const { draw: drawCycle, settle } = await boot({ market: 'crypto', canSelect: true, marketSwitcher: 'cycle' })
  let { boardProps, buttons } = await drawCycle()
  const seen = []
  for (let i = 0; i < 5; i++) {
    seen.push({ market: boardProps?.market, view: boardProps?.view })
    buttons.find(b => b.key === 'stock-band:market').press()
    await settle()
    ;({ boardProps, buttons } = await drawCycle())
  }
  ok(
    !seen.some(s => s.market === 'crypto' && s.view === 'pnl'),
    `(9) cycle: never stops on 加密貨幣庫存 across all five stops (visited ${JSON.stringify(seen)})`,
  )
}

// --- (10): only tw has holdings - the regression this whole file exists to
// catch. marketStops() must drop us:pnl (there is nothing to show there) but
// keep every other stop, in all three styles, and `cycle`'s own "n/total"
// label denominator must read 4, not a hardcoded 5 -------------------------
{
  const holdings = { tw: [{ code: '2330', name: '台積電', qty: 1000, cost: 500 }], us: [] }

  const { draw: drawSelect } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'select', holdings, holdingsSource: 'config' })
  const values = ((await drawSelect()).selects.find(s => s.key === 'stock-band:market')?.options ?? []).map(o => o.value)
  ok(
    JSON.stringify(values) === JSON.stringify(['tw', 'tw:pnl', 'us', 'crypto']),
    `(10) select: only tw holds something, so us:pnl is gone but every other stop stays (got ${JSON.stringify(values)})`,
  )

  const { draw: drawTabs } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'tabs', holdings, holdingsSource: 'config' })
  const tabs = (await drawTabs()).buttons.filter(isTabButton)
  ok(
    JSON.stringify(tabs.map(b => b.key)) ===
      JSON.stringify(['stock-band:market:tw', 'stock-band:market:tw:pnl', 'stock-band:market:us', 'stock-band:market:crypto']),
    `(10) tabs: exactly four Buttons, us:pnl absent (got ${JSON.stringify(tabs.map(b => b.key))})`,
  )

  const { draw: drawCycle } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'cycle', holdings, holdingsSource: 'config' })
  const cycleBtn = (await drawCycle()).buttons.find(b => b.key === 'stock-band:market')
  ok(
    /\/4\s›/.test(cycleBtn?.label ?? ''),
    `(10) cycle: the "n/total" label's denominator is 4, tracking the real stop count (got ${cycleBtn?.label})`,
  )
}

// --- (11): both markets hold something - the same five stops every case
// above this point already assumed, restated here as its own scenario -----
{
  const { draw } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'select' })
  const values = ((await draw()).selects.find(s => s.key === 'stock-band:market')?.options ?? []).map(o => o.value)
  ok(
    JSON.stringify(values) === JSON.stringify(['tw', 'tw:pnl', 'us', 'us:pnl', 'crypto']),
    `(11) both markets holding something draws all five stops, unchanged from before this fix (got ${JSON.stringify(values)})`,
  )
}

// --- (12): neither market has holdings - both :pnl stops disappear, and
// `cycle`'s own denominator drops to the three table stops that remain -----
{
  const holdings = { tw: [], us: [] }

  const { draw: drawSelect } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'select', holdings, holdingsSource: 'config' })
  const values = ((await drawSelect()).selects.find(s => s.key === 'stock-band:market')?.options ?? []).map(o => o.value)
  ok(
    JSON.stringify(values) === JSON.stringify(['tw', 'us', 'crypto']),
    `(12) select: no holdings anywhere, so only the three table stops remain (got ${JSON.stringify(values)})`,
  )

  const { draw: drawTabs } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'tabs', holdings, holdingsSource: 'config' })
  const tabs = (await drawTabs()).buttons.filter(isTabButton)
  ok(
    JSON.stringify(tabs.map(b => b.key)) === JSON.stringify(['stock-band:market:tw', 'stock-band:market:us', 'stock-band:market:crypto']),
    `(12) tabs: exactly the three table stops, no pnl Button at all (got ${JSON.stringify(tabs.map(b => b.key))})`,
  )

  const { draw: drawCycle } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'cycle', holdings, holdingsSource: 'config' })
  const cycleBtn = (await drawCycle()).buttons.find(b => b.key === 'stock-band:market')
  ok(/\/3\s›/.test(cycleBtn?.label ?? ''), `(12) cycle: the "n/total" label's denominator is 3 (got ${cycleBtn?.label})`)
}

// --- (13): parked on 美股庫存 when its holdings vanish mid-session (the
// holdings file got deleted, or holdingsSource changed) - the render must
// converge to 美股's own table stop, not sit on a pnl view no switcher style
// can any longer reach (register.tsx's own convergence comment in
// AbovePrompt's ui.render explains why the SAME market's table stop, not a
// jump to `auto` or to tw, is the smallest change from what was on screen) -
{
  const { draw, settle, reconfigure } = await boot({ market: 'us', canSelect: true, marketSwitcher: 'select' })
  let { selects } = await draw()
  selects.find(s => s.key === 'stock-band:market').select('us:pnl')
  await settle()
  let { boardProps } = await draw()
  ok(boardProps?.market === 'us' && boardProps?.view === 'pnl', 'sanity: (13) starts parked on 美股庫存')

  // us holdings vanish - same holdings shape (10) proves the initial-absence
  // case with, here applied mid-session through a config rewrite + poll.
  await reconfigure({ holdings: { tw: BOTH_HOLDINGS.tw, us: [] }, holdingsSource: 'config' })
  ;({ boardProps, selects } = await draw())
  ok(
    boardProps?.market === 'us' && boardProps?.view === 'table',
    `(13) us holdings vanishing mid-session falls back to 美股's own table stop, not a stranded pnl view (market=${boardProps?.market}, view=${boardProps?.view})`,
  )
  const values = (selects.find(s => s.key === 'stock-band:market')?.options ?? []).map(o => o.value)
  ok(!values.includes('us:pnl'), '(13) the vanished us:pnl stop is also gone from the Select options')
}

// --- (14): marketSwitcher:"menu" (the default, stated explicitly here) draws
// only its header Button, closed - no Select, no tabs row, no option column
// yet (brief: `menu`'s closed shape) ------------------------------------------
{
  const { draw } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'menu' })
  const { boardProps, buttons, selects } = await draw()
  ok(selects.length === 0, '(14) no Select drawn under marketSwitcher:"menu"')
  ok(!buttons.some(isTabButton), '(14) no tabs row drawn under marketSwitcher:"menu"')
  ok(!buttons.some(isMenuOptionButton), '(14) closed by default - no option column drawn yet')

  const header = buttons.find(b => b.key === 'stock-band:market')
  ok(!!header, '(14) the header Button is drawn')
  ok(buttons.filter(b => b.key === 'stock-band:market').length === 1, '(14) exactly one header Button is drawn')
  ok(
    header?.label === `市場：${marketButtonLabelFor(boardProps)}`,
    `(14) the header reads "市場：" + the same label marketButtonLabel builds (got ${JSON.stringify(header?.label)})`,
  )
}

// --- (15): pressing the closed menu's header opens the option column - one
// Button per marketStops() entry, in order, only the current stop non-dim
// (brief: `menu`'s open shape) ------------------------------------------------
{
  const { draw, settle } = await boot({ market: 'tw', canSelect: true, marketSwitcher: 'menu' })
  let { buttons } = await draw()
  ok(!buttons.some(isMenuOptionButton), 'sanity: (15) starts closed')

  buttons.find(b => b.key === 'stock-band:market').press()
  await settle()
  ;({ buttons } = await draw())

  const options = buttons.filter(isMenuOptionButton)
  ok(options.length === 5, `(15) pressing the header opens exactly five option Buttons (got ${options.length})`)
  ok(
    JSON.stringify(options.map(b => b.key)) ===
      JSON.stringify([
        'stock-band:market:menu:tw',
        'stock-band:market:menu:tw:pnl',
        'stock-band:market:menu:us',
        'stock-band:market:menu:us:pnl',
        'stock-band:market:menu:crypto',
      ]),
    `(15) option keys are the five stops' values, in marketStops() order (got ${JSON.stringify(options.map(b => b.key))})`,
  )
  ok(
    JSON.stringify(options.map(b => b.label)) === JSON.stringify(['台股', '台股庫存', '美股', '美股庫存', '加密貨幣']),
    `(15) option labels are each stop's own full label - same five marketSelectOptions() uses (got ${JSON.stringify(options.map(b => b.label))})`,
  )

  const active = options.find(b => b.key === 'stock-band:market:menu:tw')
  const rest = options.filter(b => b.key !== 'stock-band:market:menu:tw')
  ok(active && active.dimColor === false, `(15) the current stop (台股) is not dimColor (got ${active?.dimColor})`)
  ok(rest.every(b => b.dimColor === true), `(15) every other option is dimColor (got ${JSON.stringify(rest.map(b => b.dimColor))})`)

  // Pressing the header again closes it back up - the same toggle, not a
  // one-way door.
  buttons.find(b => b.key === 'stock-band:market').press()
  await settle()
  ;({ buttons } = await draw())
  ok(!buttons.some(isMenuOptionButton), '(15) pressing the header again closes the option column')
}

// --- (16): pressing an open menu's option switches market AND view together
// (the same onSelectMarket state-switch `select`/`tabs` already use, not a
// second copy of it - brief item 1) and closes the menu on its own -----------
{
  const { draw, settle } = await boot({ market: 'us', canSelect: true, marketSwitcher: 'menu' })
  let { boardProps, buttons } = await draw()
  ok(boardProps?.market === 'us' && boardProps?.view === 'table', 'sanity: (16) starts on 美股 (table)')

  buttons.find(b => b.key === 'stock-band:market').press() // open
  await settle()
  ;({ buttons } = await draw())
  ok(buttons.filter(isMenuOptionButton).length === 5, 'sanity: (16) menu is open with five options')

  buttons.find(b => b.key === 'stock-band:market:menu:us:pnl').press()
  await settle()
  ;({ boardProps, buttons } = await draw())
  ok(
    boardProps?.market === 'us' && boardProps?.view === 'pnl',
    `(16) pressing the 美股庫存 option lands there, same as select's onSelect (market=${boardProps?.market}, view=${boardProps?.view})`,
  )
  ok(!buttons.some(isMenuOptionButton), '(16) the next render has no option list - pressing an option closes the menu')

  // The header's own label tracks the new stop, the same way select's own
  // value/cycle's own label already do.
  const header = buttons.find(b => b.key === 'stock-band:market')
  ok(
    header?.label === `市場：${marketButtonLabelFor(boardProps)}`,
    `(16) the header label updates to the new stop (got ${JSON.stringify(header?.label)})`,
  )
}

done()
