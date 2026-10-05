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
