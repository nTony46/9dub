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
  setDb(new NineDubDB(`post-${Math.random()}`))
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

const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('after the draft (UI)', () => {
  it('leads with the league and your team, on rosters that include post-draft moves and IR', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByTestId('player-table', {}, { timeout: 5000 })
    expect(screen.getByRole('button', { name: 'Live Draft' })).toBeInTheDocument()

    // A 4-team, 2-round draft: I pick first.
    const s = useApp.getState()
    expect(s.setSettings({ teams: 4, rounds: 2, userSlot: 1 }).ok).toBe(true)
    const ids = demo.players.slice(0, 8).map((p) => p.identity.id)
    await act(async () => {
      ids.forEach((id) => useApp.getState().draftPlayer(id))
    })
    // Snake: my picks are overall 1 and 8.
    const [mine1, mine2] = [ids[0], ids[7]]
    const freeAgent = demo.players[20].identity.id
    await act(async () => {
      expect(useApp.getState().moveRosterPlayer(mine1, null).ok).toBe(true)
      expect(useApp.getState().moveRosterPlayer(freeAgent, 0).ok).toBe(true)
      useApp.getState().setInjury(mine2, null)
    })

    // The nav and sub-tabs switch to the league once every pick is in.
    expect(screen.getByRole('button', { name: 'My League' })).toBeInTheDocument()
    expect(screen.getByText('Draft complete')).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'League views' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent?.replace(/\d$/, ''))).toEqual(['League Overview', 'My Team', 'Draft Recap'])

    // My Team: today's roster (pickup in, drop out, injured player on IR) and a row per opponent.
    await go('#/build')
    const roster = await screen.findByTestId('my-roster')
    const name = (id: string) => demo.players.find((p) => p.identity.id === id)!.identity.fullName
    expect(within(roster).getByText(name(freeAgent))).toBeInTheDocument()
    expect(within(roster).queryByText(name(mine1))).toBeNull()
    expect(within(roster).queryByText(name(mine2))).toBeNull()
    expect(screen.getByText(name(mine2))).toBeInTheDocument() // listed under IR
    expect(within(screen.getByTestId('head-to-head')).getAllByRole('row')).toHaveLength(1 + 3)
    expect(screen.queryByTestId('build-lab')).toBeNull()
    expect(screen.queryByTestId('what-if')).toBeNull()

    // League Overview: the injured player is shown on IR; the dropped one is gone.
    await go('#/league')
    const cards = await screen.findByTestId('league-simple')
    expect(within(cards).getByText(name(mine2))).toBeInTheDocument()
    expect(within(cards).getAllByText('IR')).toHaveLength(1)
    expect(within(cards).queryByText(name(mine1))).toBeNull()

    // Number keys follow the new tab order.
    ;(document.activeElement as HTMLElement | null)?.blur()
    await act(async () => {
      await user.keyboard('2')
    })
    expect(window.location.hash).toBe('#/build')
    await act(async () => {
      await user.keyboard('3')
    })
    expect(window.location.hash).toBe('#/draft')
  })
})
