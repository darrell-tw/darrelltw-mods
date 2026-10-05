// Renders the mods' pure drawings (ask-mod's drawStrip / drawCompare,
// ask-redo-mod's drawBand) through real Ink, the terminal surface's own layout
// engine, and prints each scenario as a framed text block. See README.md here.
// usage: node render.mjs <ask-mod|ask-redo-mod> [scenario-filter]
import React from 'react'
import { Box, Text } from 'ink'
import { render } from 'ink'
import { EventEmitter } from 'node:events'

globalThis.h = (type, props, ...kids) => {
  const children = kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)
  return typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children }
}
globalThis.Fragment = 'Fragment'

const el = type => props => {
  const { children = [], ...rest } = props
  return { type, props: rest, children: Array.isArray(children) ? children : [children] }
}
const ELS = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Code: el('Code'), Markdown: el('Markdown') }

const ACCENT = 'cyan'
function toInk(node, key = 0) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return null
  const kids = (node.children ?? []).map((c, i) => toInk(c, i))
  const { hover: _hover, ...p } = node.props ?? {}
  switch (node.type) {
    case 'Box':
      return React.createElement(Box, { key, ...p }, ...kids)
    case 'Text':
      return React.createElement(Text, { key, ...p }, ...kids)
    case 'Button': {
      const label = p.label ?? kids.join('')
      if (p.plain) {
        return React.createElement(
          Text,
          { key, dimColor: p.dimColor },
          p.hotkey !== undefined ? React.createElement(Text, { color: ACCENT }, p.hotkey + ':') : null,
          p.hotkey !== undefined ? ' ' : '',
          label,
        )
      }
      return React.createElement(Text, { key, color: p.variant === 'primary' ? ACCENT : undefined, dimColor: p.dimColor }, `[ ${label} ]`)
    }
    case 'Code': {
      const lines = String(p.source).split('\n')
      return React.createElement(
        Box,
        { key, flexDirection: 'column' },
        ...lines.map((l, i) => {
          const color = p.format === 'diff' ? (l.startsWith('+') ? 'green' : l.startsWith('-') ? 'red' : l.startsWith('@@') ? 'cyan' : undefined) : undefined
          return React.createElement(Text, { key: i, color, wrap: 'truncate-end' }, l === '' ? ' ' : l)
        }),
      )
    }
    case 'Markdown':
      return React.createElement(Text, { key, wrap: 'wrap', dimColor: p.dimColor }, String(p.text))
    default:
      return React.createElement(Text, { key, color: 'red' }, `<${node.type}?>`)
  }
}

export function frame(tree, columns) {
  // ink-testing-library pins its stdout at 100 columns; a stream of our own sets the width
  const stdout = Object.assign(new EventEmitter(), { columns, rows: 60, frames: [], write: s => { stdout.frames.push(s); return true } })
  const stdin = Object.assign(new EventEmitter(), { isTTY: false, setRawMode() {}, setEncoding() {}, read() { return null }, unref() {}, ref() {} })
  const app = render(React.createElement(Box, { width: columns, flexDirection: 'column' }, toInk(tree)), { stdout, stdin, debug: true, exitOnCtrlC: false, patchConsole: false })
  app.unmount()
  const last = stdout.frames.at(-1) ?? ''
  return last.replace(/\n$/, '')
}

export function show(title, tree, columns) {
  const out = frame(tree, columns)
  const rows = out.split('\n')
  console.log(`\n== ${title}  (${columns} cols, ${rows.length} rows)`)
  console.log('┌' + '─'.repeat(columns) + '┐')
  for (const r of rows) console.log('│' + r.padEnd(columns) + '│')
  console.log('└' + '─'.repeat(columns) + '┘')
}

const [, , which, filter = ''] = process.argv
if (process.argv[1].endsWith('render.mjs')) {
const mod = await import(`./${which}.mjs`)
const scenarios = (await import(`./scenarios-${which}.mjs`)).default
for (const s of scenarios) {
  if (filter && !s.title.includes(filter)) continue
  show(s.title, s.tree(mod, ELS), s.columns)
}
}
