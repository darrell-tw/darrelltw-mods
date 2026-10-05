# ask-redo-mod

AskUserQuestion，從輸入框回答。A single-choice question from Claude no longer
opens the engine's dialog: it is drawn in the band right above your prompt, and
you answer it the way you answer the engine's own surveys — type its number in
the empty prompt — or click an option, or just type what you actually think.

```
 Store  Which store should hold the answers?
▌ 1: Session state        Gone when the session ends; nothing written anywhere.
▌ 2: Plugin store ★ 建議  Survives a restart; 4 MiB cap shared with everything else the plugin keeps.
▌ 3: A file               Readable by other tools and by you; needs a path and a format.
1–3 選 · 直接打字也行 · 0: 跳過
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ >                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

一眼辨識靠四件事：每個選項的軌條 `▌` 和數字用自己的顏色（1 cyan、2 magenta、3 yellow、4
green，和 ask-mod 比較板的卡片同一套）；標籤對齊成一欄，往下掃只看標籤就夠；模型在標籤
後面標的「(Recommended)」「（建議）」拿掉改成 ★ 徽章；選項都沒說明時整排畫在一列，是非題
只占三列：

```
 Cache  Delete the old cache first?
▌ 1: Yes, delete it  ▌ 2: No, keep it
1–2 選 · 直接打字也行 · 0: 跳過
```

```

- **按數字**：輸入框是空的時候打 `1`–`4`，不用按 Enter，那個選項就送出（和原生
  survey 同一套機制：停 0.4 秒才觸發，所以連打兩個字就不會誤按）。打 `1` 再按
  Enter 也算選 1。
- **點選項**：終端機有回報滑鼠點擊（例如全螢幕模式）就直接點；或 ctrl+x tab
  把焦點移進來，用方向鍵和 Enter。
- **直接打字**：輸入框裡打一段話送出，就是你的答案（`/` 開頭的指令照常執行，
  問題繼續掛著）。不想要這個行為，把 `freeText` 關掉。
- **0 跳過**：告訴 Claude 你不想選，請它自己判斷或換個方式問。
- **`/ask-redo-clear`**：問題卡住了（例如 Claude 沒停下來、你已經不需要回答），
  把它丟掉，什麼答案都不送。

Claude receives your answer as an ordinary user message:

```
[AskUserQuestion answer] Q: "Which store should hold the answers?" → A: Plugin store
Survives a restart.
```

or, for something you typed, `… → A: <what you typed>`.

## 代價，先講清楚 / What it costs

This mod cannot make the tool wait for you. A hook gets ten seconds of its own
time per call, and the engine's dialog cannot be replaced by a plugin's drawing
(see [`docs/api-notes.md`](../../docs/api-notes.md)). So it does the only thing
that works: it **answers the AskUserQuestion call immediately** with "not
answered yet", tells the model to end its turn, and collects your real answer
as your **next prompt**.

- **每一題多一輪模型往返。** The model's turn ends right after it asks; your
  answer starts a new turn, which re-reads the conversation (mostly from the
  prompt cache, but it is still a second request) before the work continues.
  With the native dialog the same turn would simply have carried on.
- **The model has to cooperate.** The tool result (`The user responded:
  [ask-redo-mod] Not answered yet. …`), a reminder after it, and one paragraph
  in the system prompt all say: end your turn now with one short line, do not
  guess, do not re-ask, do not continue the work that depends on the answer.
  Nothing enforces it, and how reliably each model obeys has not been measured
  here. A model that ignores it may keep working on a guess, or ask again — a second question while one is
  waiting goes to the engine's dialog, and `/ask-redo-clear` drops a stale one.
- The transcript shows the tool's result as that "not answered yet" line, and
  your answer as a user message starting `[AskUserQuestion answer]`.
- Each answer is a real prompt: it lands in your prompt history and in the
  transcript as your message, and other mods and settings hooks see it at
  `UserPromptSubmit` like anything else you type.

If that trade is not worth it for you, set `takeover` to `off` (or just keep
`ask-mod`, which leaves the dialog alone).

## 什麼時候還是原生對話框 / When the engine's dialog still asks

The mod takes a call over only when **all** of these hold, and hands it to the
engine's dialog untouched otherwise:

- it is the **main conversation's** call (a subagent's goes to the dialog), made
  by the model (another plugin's `$.ui.ask` goes to the dialog);
- the session draws **only on a terminal**, interactively: a session that also
  draws on the desktop app, VS Code or a phone over Remote Control gets the
  dialog, since the band and the digit trick are the terminal's;
- the call has **exactly one question**, a **single-choice** one (`kind` absent
  or `"choice"`, not `multiSelect`), with **2–4 options**, **no option
  `preview`** (the band has no room for one), and no `metadata.source` (the
  engine's own flows, such as `/remember`);
- no other question is already waiting above the prompt.

While an engine survey holds the band, the survey wins and the question waits
underneath it; it comes back when the survey is gone.

## 和 ask-mod 一起裝 / With ask-mod

They are made to sit side by side. ask-redo-mod takes the single-choice
questions; everything else — several questions, multi-select, text and number
questions, previews, subagents — reaches the engine's dialog, where ask-mod's
context strip and compare pane show exactly as before.

One wrinkle: both hook `tool.call` on AskUserQuestion. If ask-mod's hook happens
to run first for a question ask-redo then takes over, ask-mod may open its
compare pane (when its `compare` rule says so) and close it again a moment
later, since the call returns at once. Nothing breaks; the pane just flickers.

## 和 tw-stock-mod 一起裝 / With tw-stock-mod

Both draw the band above the prompt, and the band holds one drawing: whichever
mod's hook sits outer in the chain draws, and the stock board draws without
handing the band on. If the stock board's hook is the outer one in your setup,
the question is **not drawn** while the board shows: the call is still taken
over and Claude still waits, and typing your answer (or a lone digit and Enter)
still works, but you see the question only if Claude's waiting line repeats
it. The order of
two plugins a person installed is not documented and has not been checked
here; if you hit this, snooze the stock board while answering, or set
`takeover` to `off` in that project.

## Requirements

- Claude Code 2.1.289 or later, with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set
  in `~/.claude/settings.json`:

  ```json
  { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
  ```

- An interactive terminal session. Everywhere else the mod stands aside and the
  dialog asks as usual.

## Install

```sh
claude plugin marketplace add darrell-tw/darrelltw-mods
claude plugin install ask-redo-mod@darrelltw-mods
```

Restart Claude Code. `--scope local` from inside a project keeps it to that
project, as with the other mods here. To remove:

```sh
claude plugin uninstall ask-redo-mod@darrelltw-mods
```

## Configure

Both are `/config` rows (or `claude plugin configure ask-redo-mod`):

| option | default | what it does |
| --- | --- | --- |
| `takeover` | `single-choice` | `single-choice`: take over the questions described above. `off`: take over nothing — every call goes to the dialog, nothing is drawn, `/ask-redo-clear` is not registered, nothing is added to the system prompt. |
| `freeText` | `true` | whether a prompt you type while a question waits is your answer. Off: only a digit (pressed in the empty prompt, or typed alone and sent) or a click answers; anything else you type is sent as an ordinary prompt and the question keeps waiting. |

## How it works

- `tool.call` on `AskUserQuestion` checks the conditions above and, when they
  hold, does **not** call `next`: it keeps the question in `$.state` (and a copy
  in `$.store`, keyed by the session id, so resuming the same session puts it
  back when the resume keeps the id) and returns `{ result: { questions, answers: {}, response }, context:
  [reminder] }`. The result has to fit the tool's output schema — `questions`
  and `answers` are required — or the engine turns it into an error result.
- `ui.render` on `AbovePrompt` draws the waiting question: an inverse header
  chip and the question, one `Button plain hotkey="n"` per option with its
  description beside it, and a dim hint row with `跳過` on `0`. It is sized to
  the band's `bodyColumns`, and fitted to `maxRows`: descriptions fold to one
  truncated line first, then the hint row goes (跳過 moves up beside the
  question), then the question is cut to one line. A taller band would scroll,
  and a bare digit only presses a Button that is wholly in view.
- A press re-reads the state (so a double press or an answer typed meanwhile is
  not sent twice), clears the question and calls `$.prompt.submit({ text,
  asUser: true })`: the answer is queued as your own words and starts a turn as
  soon as the session is idle.
- `prompt.submit` rewrites a prompt you typed (`origin.kind === 'composer'`, not
  starting with `/`) into the same answer form while a question waits; if a
  settings hook beneath refuses that prompt, the question goes back up.
- `prompt.compose` adds one `session` paragraph at the end of the system prompt
  while AskUserQuestion is offered in a terminal session, so the model knows
  what a "not answered yet" result means before it ever sees one.
- `session.end` drops the waiting question (a `/clear` also deletes its stored
  copy).

## Develop

```sh
# validate the manifest and what the module hooks and calls
claude plugin validate mods/ask-redo-mod

# run the tests (hooks/ask-redo.test.tsx) through the engine's own runner
claude plugin test mods/ask-redo-mod

# type-check, once the engine has laid mods/ask-redo-mod/.claude-plugin/types/
# by loading the folder (claude --plugin-dir mods/ask-redo-mod)
bunx -p typescript tsc -p mods/ask-redo-mod

# lint
bunx --bun oxlint@1.83.0 mods/ask-redo-mod/hooks --deny-warnings

# look at the band as Ink lays it out (mods/ask-mod/scripts/dev/README.md)
cd mods/ask-mod/scripts/dev && bun install && FORCE_COLOR=0 node render.mjs ask-redo-mod
```

The tests drive the whole loop through the engine's test runner: a
`$.tool.call` that must never reach the test's own dialog bottom, the band
mounted on `AbovePrompt` on the terminal and desktop tables, presses that must
reach a `prompt.submit` bottom with the formatted answer, typed prompts, the
fallbacks, `/ask-redo-clear`, the store round-trip, and the pure helpers
(`formatAnswer`, `canTakeOver`, `typedAnswer`, `fitBand`).

Never name a local variable `h` in `hooks/*.tsx` — every JSX tag compiles to a
call of `h`.

## License

[MIT](LICENSE).
