// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import { generateDemoDataset } from '@/data/demo/generate'
import { NineDubDB, setDb } from '@/store/db'
import { useApp } from '@/store/appStore'

const demo = generateDemoDataset({ count: 120 })

beforeAll(() => {
  setDb(new NineDubDB(`ui-${Math.random()}`))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ json: async () => (String(url).endsWith('manifest.json') ? { datasets: [{ file: 'demo.json', default: true }] } : demo) })),
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= () => {}
})

describe('Draft Room (UI)', () => {
  it('search → Enter drafts for the team on the clock and updates the board', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByTestId('player-table', {}, { timeout: 5000 })
    expect(screen.getByText('DEMO DATA')).toBeInTheDocument()

    const target = demo.players[3].identity.fullName
    const input = screen.getByTestId('draft-search')
    await user.type(input, target)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option')[0]).toHaveTextContent(target)
    await user.keyboard('{Enter}')

    const recent = screen.getByTestId('recent-picks')
    expect(within(recent).getByText(target)).toBeInTheDocument()
    expect(useApp.getState().draft.picks[0]).toMatchObject({ overall: 1, teamIndex: 0 })
    expect(screen.getByTestId('on-clock')).toHaveTextContent('#2')
    expect(input).toHaveValue('')

    // Drafting the same player again is refused (duplicate prevention).
    await user.type(input, target)
    await user.keyboard('{Enter}')
    expect(useApp.getState().draft.picks).toHaveLength(1)

    // Undo via keyboard (outside the input).
    await user.keyboard('{Escape}')
    ;(document.activeElement as HTMLElement)?.blur()
    await act(async () => {
      await user.keyboard('u')
    })
    expect(useApp.getState().draft.picks).toHaveLength(0)
  })
})
