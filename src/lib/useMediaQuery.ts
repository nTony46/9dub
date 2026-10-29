import { useSyncExternalStore } from 'react'

const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** Whether a CSS media query matches, kept current as the window resizes (false where matchMedia is missing). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!supported()) return () => {}
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => supported() && window.matchMedia(query).matches,
    () => false,
  )
}
