# ask-mod

A richer AskUserQuestion. The engine's own dialog stays exactly where it is and
keeps the keyboard — arrows, Enter, number keys, Tab between questions, typing
under "Other" all work as before. This mod adds two things around it:

```
Claude 想確認一件事  Store                                        來源 remember
↳ 兩種做法都能動，差在之後要不要維護一個 schema，我想先問你偏好哪邊再動手。
↺ 上次選 2 Plugin store ★

┌ (the engine's own dialog, untouched) ─────────────────────────────────┐
│ Which store should hold the answers?                                   │
│ ❯ 1. Session state   Gone when the session ends.                       │
│   2. Plugin store    Survives a restart.                               │
│   3. A file          Readable by other tools and by you.               │
│   4. Type your own answer                                              │
└────────────────────────────────────────────────────────────────────────┘

╔═ 選項比較 ════════════════════════════════════════════════════════════════════════════════════ ✕ ═╗
║ 在對話框按同一個數字就選它；顏色對應卡片。                                                              ║
║                                                                                                      ║
║  Store  Which store should hold the answers?                                                         ║
║ ╭────────────────────────────╮ ╭────────────────────────────╮ ╭────────────────────────────╮        ║
║ │ 1 Session state            │ │ 2 Plugin store             │ │ 3 A file                   │        ║
║ │ Gone when the session      │ │ ★ 建議 ↺ 上次選過          │ │ Readable by other tools    │        ║
║ │ ends; nothing written      │ │ Survives a restart; 4 MiB  │ │ and by you; needs a path   │        ║
║ │ anywhere.                  │ │ cap shared with everything │ │ and a format.              │        ║
║ │                            │ │ the plugin keeps.          │ │                            │        ║
║ │                            │ │                            │ │ json · 1 行                │        ║
║ │                            │ │ diff · +1 −1               │ │ { "answers": { "store":    │        ║
║ │                            │ │ @@ -1,3 +1,3 @@            │ │ "file" } }                 │        ║
║ │                            │ │  const store = readJson(p) │ │                            │        ║
║ │                            │ │ -const cache = new Map()   │ │                            │        ║
║ │                            │ │ +const cache = new Map(s)  │ │                            │        ║
║ ╰────────────────────────────╯ ╰────────────────────────────╯ ╰────────────────────────────╯        ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

Each card's border and digit wear that option's colour (1 cyan, 2 magenta,
3 yellow, 4 green, the same four ask-redo-mod's band uses), so "the magenta
one" and "2" are the same thing at a glance; the strip's `↺ 上次選 2` digit
is painted the same. A label the model marked `(Recommended)` loses the suffix
and wears `★ 建議` on the badge line instead; a preview says what it is before
you read it (`diff · +1 −1`, `json · 1 行`); a number question is a slider
(`5 ├────●─────┤ 20  預設 10 · 間隔 5 檔`); a multi-select question is marked
`☑ 可複選`.

```

**Above the dialog: a context strip.** How many questions this round, one
inverted chip per question (its `header`, with `✎` for a free-text question,
`#` for a number, `☑` for multi-select), who asked when the call carried a
`metadata.source`, and the last paragraph Claude wrote before it asked — the
"why I'm asking" that otherwise scrolls off above the dialog. A new prompt
clears that lead, so a question asked cold at the top of a turn never quotes
the previous turn's sign-off as its reason. When a question has come up before
(same wording, or the same `header` over the same option labels), a yellow
`↺ 上次選 …` names what you picked then.

**Beside or below the dialog: a compare pane.** While the call is open, a pane
lays every option of every question out as a card — side by side when each
card can keep `cardMinColumns` (default 28), stacked otherwise — with the
option's number (the same digit the dialog answers to), its label, its
description, and its `preview` **rendered**, which the native dialog only
shows for the one option under the cursor:

- a unified diff (or a ```` ```diff ```` fence) draws as a coloured diff via
  `Code format="diff"`; diffs are never cut short, since a hunk cut mid-way
  stops parsing
- a fenced block draws as code in that language; unfenced text that reads like
  code (braces, semicolons, indentation on half its lines) draws as code too
- anything else draws as Markdown, so lists and tables in a preview come out
  as lists and tables
- code and markdown previews fold past `previewLines` (default 12) with a dim
  `… 還有 N 行`

`✎` and `#` questions get a one-line card instead (placeholder, or min–max /
unit / step / default), so the pane accounts for every question in the round.
The option you picked last time wears `↺ 上次選過` on its card. The pane opens
as the dialog opens and closes as the answer goes in; on a fullscreen terminal
it docks beside the transcript, on the main screen it sits inline above the
prompt.

**Where the pane goes, and when it does not.** A pane nobody asked for is
seated by the engine only from 144 columns (110 once you have opened that pane
by hand at some point). Below that the mod closes it again and the strip says
so: `▣ 2 個選項附預覽，比較板放不下：終端機要 144 欄，或跑 /ask-compare 手動開`.
`/ask-compare` opens it right away (it is marked immediate, so it runs while
the dialog is up), seats at any width, and keeps it wanted for the rest of the
session. Closing the pane by hand (its `✕`, or Esc while it holds the keys)
keeps it closed for the session; `/ask-compare` brings it back.

Zero model tokens: nothing here calls `$.model.*`, rewrites the questions, or
changes what the model reads back. What the tool reports is exactly what the
engine's dialog collected.

## Requirements

- Claude Code 2.1.289 or later, with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set
  in `~/.claude/settings.json`:

  ```json
  { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
  ```

- Any surface for the strip: the AskUserQuestion site is raised on the
  terminal, the desktop app, VS Code and mobile alike, and `Box`, `Text`,
  `Code` and `Markdown` exist on all four. The pane needs a surface that
  places panes (the terminal, the desktop app). Measured on macOS iTerm2 and
  Terminal.app; reports from the others welcome.

## Install

```sh
claude plugin marketplace add darrell-tw/darrelltw-mods
claude plugin install ask-mod@darrelltw-mods
```

Restart Claude Code. The next time Claude asks you something, the strip is
there and the pane opens when the round earns it (see `compare` below).
`--scope local` from inside a project keeps it to that project, as with the
other mods here.

To remove:

```sh
claude plugin uninstall ask-mod@darrelltw-mods
```

The remembered answers live in the plugin's own store and go away with it.

## Configure

Everything is a `/config` row (or `claude plugin configure ask-mod`), nothing
is a file:

| option | default | what it does |
| --- | --- | --- |
| `compare` | `auto` | when the pane opens. `auto`: for a round where any option carries a preview, or that has several questions, or where at least half the options carry a description — the cases the native dialog shows one piece at a time. `always`: every round with a choice question. `off`: never, and `/ask-compare` is not registered — the strip alone. Your own say overrides the mode: `/ask-compare` turns it on for the session, closing the pane by hand turns it off. |
| `showLead` | `true` | the `↳ …` line quoting Claude's last paragraph before the question |
| `showHistory` | `true` | remember answers and mark `↺ 上次選過`; off, nothing is written to the store |
| `previewLines` | `12` | lines of a code or markdown preview a card shows before folding the rest |
| `cardMinColumns` | `28` | the narrowest a card may get before the options stack vertically |

## How it works, and why this shape

A `ui.render` hook on `{ component: 'AskUserQuestion' }` calls `next(e)` to
get the engine's own dialog tree, then returns a `Box` with the strip and that
tree. The dialog keeps its keyboard handling because it is still the engine's
element, just with a neighbour. This is the same shape the engine's built-in
hot-reload mod uses on this site, so it is the supported way in, not a trick.

It is also a tightly bounded one. The engine holds the tree around its dialog
to rules read off the 2.1.289 bundle (see
[`docs/api-notes.md`](../../docs/api-notes.md)): at most 12 estimated rows
(a `Text` counts one plus one per 40 cells of text, a border two, a margin its
cells), the engine's dialog **last** in document order, no `Markdown`, and no
`width`, `height`, `position` or offset props. That is why the strip is a
handful of one-line `Text`s each cut to 78 cells — a test in
`hooks/ask.test.tsx` runs the engine's own estimate over the worst case and
holds it under 12 — and why everything that needs room is a pane instead.

The pane rides the call. `tool.call` on `AskUserQuestion` parses the round,
opens the pane (`$.ui.open`), awaits `next(e)` — the engine's dialog, which
costs the hook nothing of its ten-second budget — then closes the pane and
files the answers under each question's text in `$.state` and `$.store`.
Owning the dialog outright (draw the question in a pane, answer the call with
the pick) is not possible from a mod: the ten seconds are the hook's own time,
and a person takes longer than that to read four options.

`session.append` on `door: 'response'` keeps the last paragraph of the model's
latest text block in `$.state` for the lead (and `door: 'prompt'` clears it).
Both drawings read `$.state`, so a write redraws them without an `invalidate`.

## Develop

```sh
# validate the manifest and what the module hooks and calls
claude plugin validate mods/ask-mod

# run the tests (hooks/ask.test.tsx) through the engine's own runner
claude plugin test mods/ask-mod

# type-check, once the engine has laid mods/ask-mod/.claude-plugin/types/ by
# loading the folder (claude --plugin-dir mods/ask-mod, or a dev-mods session)
bunx -p typescript tsc -p mods/ask-mod

# lint
bunx --bun oxlint@1.83.0 mods/ask-mod/hooks --deny-warnings

# look at the strip and the pane as Ink lays them out (scripts/dev/README.md)
cd mods/ask-mod/scripts/dev && bun install && FORCE_COLOR=0 node render.mjs ask-mod
```

The AskUserQuestion site cannot be mounted in `claude plugin test` (the
engine's dialog is an `engine` node only the real engine produces, and the
site insists on exactly one), so the strip is a pure function (`drawStrip`)
the tests feed a plain element table and read back, and the pane is tested
both that way (`drawCompare`) and through `$.ui.mount` on the `Pane`
component while a `$.tool.call` is held open.

Never name a local variable `h` in `hooks/*.tsx` — every JSX tag compiles to a
call of `h`.

## Ideas not built yet

Things the same hooks could do and this version deliberately leaves out, in
rough order of how useful they looked:

- **Answer with a click from the pane.** A `Button` per card whose press
  types the option's digit into the dialog. There is no API for a plugin to
  press a key into the engine's dialog today; the day `$.prompt.fill` or a
  dialog equivalent allows it, the cards become the dialog.
- **A `/ask-history` command** listing remembered answers with a way to forget
  one, and a `↺` that says how long ago.
- **Live "waiting" clock in the strip** (`等了 00:42`) off `$.clock.every` and
  `$.ui.invalidate`. Cheap, but a ticking number next to a question you are
  reading is noise more than help.
- **Hover reveals** in the pane on the fullscreen terminal: fold the previews
  and show one as a `position: "absolute"` card over the pointer. Saves rows;
  loses the point of seeing them all at once.
- **Question text rewrites** via `next({ ...e, props })`: surfacing a preview's
  first line as the option description inside the engine's own list. Works,
  but moves the goalposts for the model's wording and the schema has to still
  fit.
- **A note under the dialog** via `$.ui.notice(tool_use_id, text)`: one dim
  line the engine itself draws under its dialog, outside the 12-row budget.
  Where to put the lead if the strip ever has to go.

## License

[MIT](LICENSE).
