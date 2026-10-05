# darrelltw-mods

Claude Code mods I build for myself and then clean up enough to share. They
draw into places Claude Code already has (the strip above the prompt, the
AskUserQuestion dialog), they all run on **function hooks** (early access), and
nothing here calls `$.model.*`. All but one leave your prompt and the model's
tokens alone; the exception is `ask-redo-mod`, which turns your answer to a
question it took over into your next prompt and so costs a model round-trip per
question (its README says exactly how).

## What's in here

| mod | what it does |
| --- | --- |
| [`tw-stock-mod`](mods/tw-stock-mod/README.md) | 台股／美股看板。台股時段顯示台股清單（紅漲綠跌），美股時段顯示美股清單（綠漲紅跌），券商風格表格＋Solari 翻牌指數列＋損益模式。台美各 20 檔，報價預設走 Yahoo（免金鑰），永豐 Shioaji 可選，照個人偏好順序（`~/.claude/stock-band.json`） |
| [`ask-mod`](mods/ask-mod/README.md) | 更好讀的 AskUserQuestion。原生對話框上面加一條脈絡列（幾題、header chips、Claude 問之前最後說的那段話），下面加一塊比較板把所有選項並排攤開：說明、preview 一起看，diff／程式碼 preview 直接著色，上次選過的選項標 ↺。對話框本體和鍵盤操作完全不變 |
| [`ask-redo-mod`](mods/ask-redo-mod/README.md) | 換掉單選題的 AskUserQuestion。只有一題、單選、2–4 個選項的問題改畫在輸入框上方，空白輸入框按數字就選、點選項也行，或直接打一段話當答案。Claude 會先停下來等你，答案當成你的下一則訊息送回去：每題多一輪模型往返，模型不聽話時也可能自己猜。其他題型照樣是原生對話框，和 `ask-mod` 可以一起裝 |

More will land here. The marketplace is named after me rather than after what
is in it, so adding an unrelated mod later does not make the name a lie.

## Install

1. Turn function hooks on in `~/.claude/settings.json` (merge the `env` key if
   you already have one):

   ```json
   { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
   ```

2. Add this marketplace, then install the mod you want from inside the
   project you want it in. `--scope local` keeps the mod in that one project
   instead of every project on the machine:

   ```sh
   claude plugin marketplace add darrell-tw/darrelltw-mods
   cd /path/to/your/project
   claude plugin install tw-stock-mod@darrelltw-mods --scope local
   ```

   Drop `--scope local` only if you want the band above the prompt everywhere.

3. Restart Claude Code.

Each mod's own README covers its config file, and the stock mod ships a
`/tw-stock-mod:stock-band-setup` command that writes one for you.

To remove:

```sh
claude plugin uninstall tw-stock-mod@darrelltw-mods --scope local
claude plugin marketplace remove darrelltw-mods
```

Run the uninstall from the same project, and match the scope you installed
with: a `user` install needs `--scope user`. Uninstalling leaves the runtime
files behind in `~/.claude/stock-band/<project slug>/` (quote cache,
heartbeat, 永豐's log and pid, the SDK's own `shioaji.log`, and any holdings
永豐 fetched) — delete that whole folder to clean those up too. The folder
only exists once 永豐's fetcher has run; a Yahoo-only install never creates it.

## Nothing shows up?

Four different causes produce the exact same symptom — no band, and no error
message anywhere — so check all four in order:

1. `claude --version` needs to be 2.1.269 or later.
2. Open Claude Code in that project and run `! echo
   $CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. It needs to print `1`. A blank line
   means the flag is off — merge `{ "env": {
   "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }` into
   `~/.claude/settings.json` (add just that key if `env` already exists).
3. Fully quit and reopen Claude Code after editing settings.
   `/reload-plugins` does not re-read `env`.
4. Confirm the mod installed into the project you have open right now
   (`--scope local` scopes one install to one project):

   ```sh
   sed -n '/tw-stock-mod@darrelltw-mods/,/^    \]/p' ~/.claude/plugins/installed_plugins.json | grep projectPath
   ```

   It prints one path per install; this project must be one of them. If it is not, run the
   install command again from inside this project's directory. (`claude
   plugin list` will not help here — every local install prints the same
   `tw-stock-mod@darrelltw-mods / Scope: local` line with no path.)

## Requirements

- **Claude Code 2.1.269 or later.** Drawing above the prompt does not exist
  before that.
- **`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.** Function hooks are early access;
  without the flag Claude Code ignores the `modules` key and nothing loads.
- **An interactive terminal.** `AbovePrompt` is terminal-only — nothing draws
  in `claude -p`, the desktop app, or mobile. Measured on macOS iTerm2,
  Terminal.app, and tmux. Windows and the VS Code integrated terminal are
  untested — reports welcome.

## Repo layout

```
.claude-plugin/marketplace.json   makes this repo installable as a marketplace
docs/api-notes.md                 function-hooks API facts every mod here relies on, with sources
mods/<name>/                      one mod per folder, each its own plugin
  .claude-plugin/plugin.json      that mod's manifest
  hooks/                          its hooks module and Client board
  README.md                       its own docs
```

Adding a mod means dropping a folder under `mods/` and adding one entry to
`.claude-plugin/marketplace.json`. The repo root is only ever the marketplace,
never a plugin itself.

## Develop

```sh
# type-check a mod (needs the early-access types: run /plugin-types in a Claude
# Code session opened in this repo first)
bunx -p typescript tsc -p mods/tw-stock-mod

# lint
bunx --bun oxlint@1.83.0 mods/tw-stock-mod/hooks --deny-warnings

# validate the marketplace manifest
claude plugin validate .
```

Never name a local variable `h` in any `hooks/*.tsx` file — every JSX tag in
those files compiles to a call of `h`.

## Author

**Darrell**

- X: [@darrell_tw_](https://x.com/darrell_tw_)
- Threads: [@darrell_tw_](https://www.threads.com/@darrell_tw_)
- Instagram: [@darrell_tw_](https://www.instagram.com/darrell_tw_/)
- Facebook: [darrelltw](https://www.facebook.com/darrelltw)
- LinkedIn: [darrell-wang-tw](https://www.linkedin.com/in/darrell-wang-tw/)
- GitHub: [@darrell-tw](https://github.com/darrell-tw)
- Email: info@darrelltw.com

Issues and PRs welcome.

## License

[MIT](LICENSE). Use it, change it, ship it in something you sell — just keep
the copyright notice.
