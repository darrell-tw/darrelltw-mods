# Function-hooks API notes (verified sources only)

Sources: `cc-arcade-ref` (github.com/sezaakgun/cc-arcade, cloned `--depth 1`) and
`claude-code.d.ts` from `anthropics/claude-code` repo, `mods/types/claude-code.d.ts`
(fetched via `gh api`, saved to scratchpad, line numbers below refer to that fetch).

## Plugin layout (cc-arcade-ref)
- `.claude-plugin/plugin.json`: `name, version, description, author{name}, homepage, repository, license, keywords`.
- `hooks/hooks.json`: `{ "description": "...", "modules": ["./register.tsx"] }` — module path is a string literal, relative to `hooks/`.
- `hooks/register.tsx`: `export const register: Register = on => { ... }`. `Register = (on: On, options: PluginOptions) => unknown` (d.ts:5880).
- Board files are separate `Client` surface modules loaded by `module` string literal only — no variables (d.ts ClientProps.module comment, ~line 1013): "a variable there is refused at load, as is a path outside the plugin".
- Rule (README "Develop", common.tsx comment): never name a local variable `h` in any `/* @jsx h */` file — every JSX tag compiles to `h(...)`.

## `on(pattern, [matcher], hook)` (register.tsx)
- `on('session.start', async ($, e, next) => { const r = await next(e); ...; return r })` — `e.cwd`, `e.surface`, `e.isInteractive` (d.ts:7302).
- `on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {...})`. Guard `e.props.hasSurvey` and `e.surface !== 'terminal'` before drawing (register.tsx ~line 197; AbovePrompt props at d.ts:6524: `hasSurvey, isWorking, maxRows, bodyColumns, scroll, view`, all read-only).
- `e.viewport?.columns` (d.ts:6223/6787, `RenderViewport`, optional, "absent where no surface has measured").
- `const { Box, Button, Client, Text } = await $.ui.resolve(e)` (register.tsx line ~196; d.ts confirms `'ui.resolve': ResolveInput` / returns `ElementTable`).
- `Button.hotkey` (d.ts:653-658): one digit or one lowercase letter. A digit presses from an empty composer; a digit *or* letter presses on keydown only while one of the band's Buttons already holds the focus ring. Consequence for a band: a letter hotkey buys nothing over plain Enter once the ring is on a Button, and a digit hotkey fires from an empty composer and eats a prompt that starts with that digit — cc-stock-band (2026-09-16) dropped every `hotkey` prop for this reason and left its buttons click- or focus+Enter-only.
- `<Client key="..." module="./boards/x.tsx" width={cols} height={rows} props={...} />` — props must be `JsonValue`.
- `on('turn.complete', async ($, e, next) => { const r = await next(e); ...; return r })` — used as a passthrough hook.
- `$.ui.invalidate('ui.render')` triggers a re-render (d.ts:1849, `InvalidatableEventName` includes `RenderEventName`, d.ts:3782).
- `$.ui.log(text)` for diagnostics on caught errors (register.tsx pattern, used throughout for store/fs failures).

## Clock and fs (`$`, hooks module only — NOT available inside a Client board)
- `$.clock.now(): Promise<number>` (d.ts:2517-2522) — **must be awaited**; cc-arcade-ref's `register.tsx` calls it unawaited in a couple of spots (e.g. `turnStartedAt = $.clock.now()`), which is a latent bug in that repo (never `tsc`-checked in CI — the README says type-checking needs `/plugin-types` run interactively, and CI only runs `bun test` + `oxlint`). This mod always awaits it.
- `$.clock.every(ms, fn): Timer` (d.ts:2540-2547) — dispatched as an event per period; `fn` may be async (fire-and-forget). Used here for a 500ms poll of the progress file.
- `$.fs.read(path): Promise<string>` — relative paths resolve against the session's cwd, rejects (`ENOENT`) if missing (d.ts:2426-2433, 4617-4622). We read `.claude/deploy-progress.json` (relative), wrapped in try/catch.

## Client board module (`hooks/board.tsx`)
- Signature: `ClientModule<P, S> = (props: P, surface: ClientSurface<S>) => RenderElement` (d.ts:966).
- `surface.elements` = `Box/Text/...` (no `Client`, no `Raster`) — d.ts:938.
- `surface.state` / `surface.setState(next)`: local state kept across redraws; start `surface.every(ms, fn)` only once, guarded by `if (surface.state === undefined)` (pattern from `hooks/boards/pet.tsx`).
- `surface.every(ms, fn): () => void` runs on the surface's own frame clock, independent of the hooks module — this is where all our animation ticks (150ms walk frame, 80ms track cursor, 500ms node pulse) live, so they only run while the `Client` is mounted (i.e. while the band is shown) and stop automatically when unmounted.
- The Client board has **no `$`**: it cannot call `$.clock.now()` itself. Wall-clock anchoring (`now`, `started`, `stepStarted`) is passed in via `props` from the hooks module (same pattern as `pet.tsx`'s `props={{ pet, now: $.clock.now() }}`), and the board extrapolates further ticks locally via its own frame counter — this is the standard pattern, not a workaround.

## Colors
- `TextProps.color?: string; backgroundColor?: string` — "Colors are a theme key or a raw color" (d.ts:7796-7809). Confirmed raw hex works: `hooks/boards/common.tsx`'s `Run` type carries `color?: string, bg?: string` and both are passed straight to `<Text color backgroundColor>`. **No conflict with the prototype's raw `#rrggbb` values** — no fallback needed.

## Install / validate (from README + local `claude plugin --help`)
- Function hooks flag: `~/.claude/settings.json` → `{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }`.
- Local hacking, no marketplace: `claude --plugin-dir <path>` (one session only).
- Persistent user-level install: `claude plugin marketplace add <local-path-or-repo>` then `claude plugin install <name>@<marketplace>`.
- `claude plugin validate <path>` validates a plugin or marketplace manifest (no interactive session needed).
- Real type-checking needs `/plugin-types` run inside an interactive session first (writes gitignored `.claude/types/`) — **not available to this non-interactive run**; flagged as unverified in the final report.

## The AskUserQuestion render site (verified 2026-10-05 against 2.1.289's own bundle)
- `ui.render` is raised on `{ component: 'AskUserQuestion' }` on every surface
  (d.ts `RenderPropsOf.AskUserQuestion`: `tool`, `questions: unknown[]`,
  `metadataSource?`). `requestId` is the call's `tool_use_id`.
- **A hook keeps the engine's dialog by wrapping it, not replacing it:** `const
  own = await next(e)` resolves to the engine's own dialog tree (an `engine`
  node), and the hook returns a `Box` with `own` as one child among its own.
  Keyboard handling stays the engine's because the dialog is still the engine's
  element. This is exactly what the engine's built-in hot-reload mod does on
  this site (its registration reads `i("ui.render",{component:"AskUserQuestion",
  ...},async(t,e,f)=>{let o=await f(e); ... return Tt(t.ui.resolve(e),o,...)})`
  in the 2.1.289 bundle), so it is the supported shape.
- **The tree around the dialog is validated by hard rules** (the validator
  `NYn` in the bundle, its constants `ibt=12`, `yvn=40`, `S6r=2`,
  `C6r={padding:2,paddingY:2,paddingTop:1,paddingBottom:1,margin:2,marginY:2,
  marginTop:1,marginBottom:1}`). A tree that breaks one is refused whole and
  the engine draws its own dialog with none of the hook's additions:
  - **exactly one engine node** (`${J} engine nodes; AskUserQuestion is drawn by
    exactly one`), and **nothing after it** in document order (`draws below the
    dialog`). Everything a mod adds goes above the dialog.
  - **at most 12 estimated rows** around the dialog (`more than 12 rows around
    the dialog`). The estimate per node: a string child is 1 row (0 inside an
    inline element such as `Text`) + its newlines + `floor(width / 40)`; a
    `Text` element adds 1 unless already inside an inline element (so a `Text`
    with nested `Text` chips counts once); `borderStyle` adds 2; `padding`/
    `margin` add 2 per unit, `paddingY`/`marginY` 2, `paddingTop`/`Bottom` and
    `marginTop`/`Bottom` 1; `gap`/`rowGap` add their value once per child; a
    `Code` counts its lines, a `Markdown` its lines + 1. Row direction does not
    matter: children of a `flexDirection="row"` Box are summed as if stacked.
  - **no `Markdown`** (`Markdown around the dialog (its rows are not bounded
    there)`); `Code` is fine.
  - **no `width`, `height`, `minWidth`, `minHeight`, `position`, `top`, `left`,
    `right`, `bottom`** on any element, nor as hover overrides (`Box prop
    "width" around the dialog`). Side-by-side cards with fixed widths are out.
  - the engine node may not sit inside an inline element or under a Box with
    `display`/`overflow`/`position` or any of the props above.
- **Owning the dialog is not possible from a mod.** No API answers a dialog a
  plugin drew itself, and `tool.call` cannot wait for the person either:
  `HookBudget.ms` is `10_000` of the hook's own time per dispatch, waits on
  `next` and `$` excepted but `$.clock.sleep` included (d.ts ~4927). A
  `tool.call` hook that opens a pane and awaits a press times out before anyone
  has read the options. Awaiting `next(e)` is free, though, so a `tool.call`
  hook can open a pane before `next(e)` and close it after: that is where
  ask-mod's compare board lives.
- A pane opened from a `tool.call` hook is "unasked": the engine seats it only
  from 144 columns (110 once the person opened that id by hand), and
  `$.ui.open` resolves `{ isPlaced: false, reason }` below that. A pane opened
  from `command.run` is asked and seats at any width. Check `isPlaced` and
  close an unplaced pane, or it seats itself when the terminal widens later.
- `$.ui.notice(tool_use_id, text)` adds one dim line under the open dialog and
  is the cheap alternative when all you want is a note, not a layout.
- Rewriting `e.props.questions` via `next({ ...e, props })` is allowed but the
  rewrite "must still fit the tool's schema or the original is drawn".
- Every element ask-mod draws (`Box`, `Text`, `Button`, `Code`, `Markdown`) is
  in all four surface tables (d.ts `Elements`); `Input`/`Select` are missing on
  mobile, `Client` on vscode and mobile, `Raster`/`Image` are terminal-only.
- `Code` and `Markdown` take at most 10000 characters with tab and newline as
  the only control characters; a `Code format="diff"` whose source does not
  parse as hunks is drawn as plain code (so never cut a diff to fit).

## `claude plugin test` facts (2.1.289)
- Nothing stands beneath the plugins: every event the plugin raises or the
  test calls on `$` needs a bottom the test registers with `on(...)`, or the
  call fails `no implementation for <event>`. `mock.clock`, `mock.store` and
  `mock.env` are the ready-made bottoms for those three nouns; `$.state` is
  served by the host and needs none.
- An "op event" bottom (`ui.open`, `ui.close`, `command.register`, `store.*`,
  ...) answers `{ value }` or `{ deny }`, not the bare value: `on('ui.open', ()
  => ({ value: { isPlaced: true } }))`, `on('ui.close', () => ({ value:
  undefined }))`, `on('command.register', (_, e) => ({ value: { command: e.name
  } }))`. A bare value is `skipped: returned neither { value } nor { deny }`.
  `session.start`'s bottom returns `{ cwd }`, `tool.call`'s `{ result }`.
- The test's `$` (`Engine`) has no `state`, `store` or `ui.close`: read a
  plugin's state by spying `on('state.set', { plugin, key }, (_, e, next) =>
  { seen.push(e.value); return next(e) })`, and the store by spying
  `store.set` **before** `mock.store(on)` (the mock answers without `next`).
- **`AskUserQuestion` cannot be mounted in a test**: the site insists on exactly
  one `engine` node, which only the real engine's bottom produces; a test's
  own `ui.render` bottom yields `0 engine nodes`. Draw the strip through a pure
  function and feed it a plain element table instead; mount `Pane` for the rest.
- `setTimeout` is not declared in the test environment's types; wait on a
  `state.set` spy resolving a promise instead of polling.

## The AbovePrompt site (verified 2026-10-05 against 2.1.289's own bundle)
- **The dialog's rules do not apply to the band.** The validator `NYn(tree,
  component, opts)` sets `x = component === "AskUserQuestion"` and `T = x ||
  opts.within === "AskUserQuestion"`; the 12-row budget, the no-`Markdown`
  rule, the no-`width`/`height`/`position`/offset rule and the one-engine-node
  rule are all gated on `T` (or `x`). For `AbovePrompt` only the general rules
  hold: at most 20000 nodes (`qIe`), depth 32 (`VIe`), a text child of at most
  10000 characters (`VU`) holding no control character, 100000 characters of
  text in all (`vZ`), every element from the surface's table with its prop
  allow-list, `Input`/`Select`/`Markdown`/`Client`/`Raster`/`Image` keys unique,
  and the Raster-cell and Image-byte caps. Nothing bounds its rows:
  `e.props.maxRows` (d.ts:9723) is a layout budget, and a taller tree scrolls in
  a window of `scroll.bodyRows` with the engine's `n more` cue under it.
- **The bare-digit press** (d.ts:8876, 9730) is the composer hook `Wm` (the
  engine's own feedback card answers its 0/1/2 through it too), armed by the
  band with `enabled: !hasSurvey && <drawn tree has a hotkeyed Button>` (and not
  while the person collapsed the band). It fires when the composer's value
  becomes exactly one character that is a digit hotkey of a Button wholly inside
  the scroll window (NFKC-normalized, so a full-width `１` counts; the AZERTY
  remap `zIe` of `&é"'(-è_çà` sits on the Enter path only, which the band turns
  off), after a 400 ms debounce (`AZ=400`), never within 600 ms of the band
  arming (`cp=600`), and empties the composer. The band passes `enterConfirms:
  false`, so Enter on a lone digit does NOT press: it submits the digit as an
  ordinary prompt. A mod that wants a typed `1⏎` to count as option 1 maps the
  lone-digit prompt itself at `prompt.submit`.

## Answering a tool call from a hook (2.1.289 bundle)
- **A hook's own `{ result }` is validated against the tool's output schema**
  (d.ts:12156): core runs `tool.outputSchema?.safeParse(result)` and on a
  mismatch the model gets an error result, `tool.call step resolved <Tool>
  with a result that does not match its output shape: ...`. On success the
  parsed value (defaults filled in) goes through the tool's own
  `mapToolResultToToolResultBlockParam`, exactly as the tool's own result would.
- **AskUserQuestion's output schema** requires `questions` (the question
  objects, `kind`/`description`/... optional) and `answers` (a record of
  string to string); `response`, `annotations`, `afkTimeoutMs` (a positive
  integer) and `followUp` are optional. Its mapper reads, in order:
  `afkTimeoutMs` set (an "away from keyboard, proceed with your best judgment"
  text), `followUp` (call AskUserQuestion again), a non-blank `response`
  printed as **`The user responded: <response>`**, the answers, and with none
  of these `The user did not answer the questions.` So a hook that answers "not
  yet" writes its `response` to read after "The user responded: ".
- A hook's `context` on a `tool.call` answer is one reminder after the result
  (d.ts:12165); the model reads it, the person never sees it.
- `next.origin.plugin` is `"engine"` on the model's own call. Another plugin's
  `$.ui.ask` (d.ts:2332) is a `tool.call` of AskUserQuestion through every hook
  but the caller's, with `next.origin.plugin` naming that plugin: a hook that
  answers AskUserQuestion itself must pass those through, or it answers the
  other plugin's question with nothing.

## `$.prompt.submit` from a plugin (d.ts:4558, 8470, 8516)
- `PromptSubmitArgs` is `{ text, attachments?, asUser? }`: `origin`, `turnId`,
  `wait` and `context` are the engine's. The prompt is queued and starts a turn
  of its own once the session is idle, never folded into a running turn; the
  call resolves as that turn starts (reference.md, "Work that outlives a
  dispatch").
- Every hook sees `origin: { kind: 'plugin', name, asUser? }`, so a
  `prompt.submit` hook keyed on `origin.kind === 'composer'` (the person's own
  Enter) never sees its own plugin's submission. Without `asUser` the model
  reads "The <name> plugin sent a message: ..."; with `asUser: true` it reads
  the text bare. `@file` mentions and pasted images are not expanded either way.
- A `prompt.submit` hook that rewrites the person's prompt does it with
  `next({ ...e, text })`; `next` resolves `{ drop }` when a settings hook beneath
  refused it, which the hook can use to undo what it did on the way down.

## More `claude plugin test` facts (2.1.289)
- `session.surfaces` and `session.id` have no implementation in a test: a
  plugin that calls them needs bottoms, `on('session.surfaces', () => ({ value:
  ['terminal'] }))` and `on('session.id', () => ({ value: 'sess-1' }))`.
  `session.end`'s bottom returns `{ sessionId }`; `prompt.submit`'s returns the
  `PromptSubmitResult` itself (`{ text }` or `{ drop }`), not `{ value }`.
- The test's `$.prompt.submit` takes the whole `PromptSubmitInput` (`text`,
  `wait`, `origin`), not a plugin's `PromptSubmitArgs`.
- The test's `on` refuses a second matcher-less hook on one event (`hooks module
  did not load: on("store.set") registered twice`), and `mock.store` registers
  matcher-less `store.*` hooks: a store spy beside it needs a matcher (a RegExp
  works, `{ key: /^pending\// }`), and `mock.store` is called once per test
  (give it the starting entries there). `claude plugin validate` refuses the
  same in a module, even with an early `return` between the two `on` calls.
- `agentId` given to `$.tool.call` (cast past `ToolCallArgs`, which does not
  list it) reaches the hook as `e.agentId`.
- After a press that clears what a band draws from, the redraw falls through to
  `next(e)`, so a test that presses needs its own `ui.render` bottom for the
  component even when the first draw never reached it.
