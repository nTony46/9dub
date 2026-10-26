/** Tiny app-level event bus for keyboard shortcuts (focus search, open help). */
type EventName = 'focus-search' | 'open-help' | 'open-board'
const target = new EventTarget()
export function emit(name: EventName): void {
  target.dispatchEvent(new Event(name))
}
export function on(name: EventName, fn: () => void): () => void {
  target.addEventListener(name, fn)
  return () => target.removeEventListener(name, fn)
}
