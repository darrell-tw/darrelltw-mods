// runtime stand-in for the 'claude-code' import: atom/read/update over a plain map
const store = new Map()
const keyOf = ref => `${ref.plugin}/${ref.key}/${ref.id ?? ''}`
export const atom = (ref, initial) => ({ ref, initial })
export const read = async (_$, a) => (store.has(keyOf(a.ref)) ? store.get(keyOf(a.ref)) : a.initial)
export const update = async (_$, a, fn) => { const v = fn(store.has(keyOf(a.ref)) ? store.get(keyOf(a.ref)) : a.initial); store.set(keyOf(a.ref), v); return v }
