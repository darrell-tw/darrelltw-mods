# dev: look at the drawings

The dialog strip, the compare pane and ask-redo-mod's band are pure functions
(`drawStrip`, `drawCompare`, `drawBand`) that take an element table and return
a tree. `render.mjs` feeds them a plain table, converts the tree to real Ink
elements (the terminal surface's own layout engine: Yoga flexbox, borders,
wrapping) and prints each scenario as a framed block, so a layout change can be
looked at here instead of guessed at. Every UI change on this branch was judged
this way; a mod's `claude plugin test` checks structure, not paint.

```sh
cd mods/ask-mod/scripts/dev
bun install                                  # ink + react, once

# bundle a mod's module with the engine import stubbed (atom/read/update over a Map)
STUB=$PWD/claude-code-stub.mjs
bunx esbuild ../../hooks/register.tsx --bundle --format=esm --jsx-factory=h \
  --jsx-fragment=Fragment --alias:claude-code=$STUB --outfile=ask-mod.mjs
bunx esbuild ../../../ask-redo-mod/hooks/register.tsx --bundle --format=esm --jsx-factory=h \
  --jsx-fragment=Fragment --alias:claude-code=$STUB --outfile=ask-redo-mod.mjs

FORCE_COLOR=0 node render.mjs ask-mod            # every scenario in scenarios-ask-mod.mjs
FORCE_COLOR=0 node render.mjs ask-mod pane       # only the ones whose title contains "pane"
FORCE_COLOR=0 node render.mjs ask-redo-mod
```

Drop `FORCE_COLOR=0` to see the colours (the option colours on rails, digits
and borders are the point of several of these drawings).

What the renderer stands in for: a `Button` draws as the terminal does
(`n: label` when `plain`, `[ label ]` otherwise), a `Code` as its lines with
diff colouring, a `Markdown` as wrapped text. The frame's right edge is the
width you pass; CJK text makes the harness's own `│` padding drift right, which
is the harness's `padEnd`, not the layout.

Add a scenario to `scenarios-<mod>.mjs`: `{ title, columns, tree: (mod, els) =>
... }`, where `mod` is the bundled module and `els` the element table.
