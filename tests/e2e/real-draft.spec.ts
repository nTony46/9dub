/**
 * Full 12-team, 13-round (156-pick) practice draft on the user's REAL local
 * snapshot, driven through the UI. Skips when no snapshot has been ingested.
 *
 * Opponents take the best remaining player by ESPN ADP (table sorted by ADP);
 * "my" team takes the top Best Draft Decision. Along the way it checks search,
 * player-source detail, an unprojected (directory-only) pick, undo, reload,
 * League Overview, My Build, console errors and pick-to-paint time.
 */
import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function hasLocalSnapshot(page: Page): Promise<boolean> {
  const res = await page.request.get('/local-data/manifest.json')
  if (!res.ok()) return false
  const m = (await res.json()) as { datasets?: unknown[] }
  return (m.datasets?.length ?? 0) > 0
}

async function sortByAdp(page: Page) {
  const header = page.getByTestId('player-table').locator('thead').getByRole('button', { name: /^ADP/ })
  // First click sorts ascending; verify via aria-sort.
  for (let i = 0; i < 2; i++) {
    const th = page.getByTestId('player-table').locator('thead th[aria-sort]')
    if ((await th.count()) && (await th.first().innerText()).startsWith('ADP') && (await th.first().getAttribute('aria-sort')) === 'ascending') return
    await header.click()
  }
}

async function onClockText(page: Page) {
  return (await page.getByTestId('on-clock').innerText({ timeout: 5_000 }).catch(() => '')).trim()
}

test('real-data practice draft: 156 picks with analysis, undo, reload and source detail', async ({ page }) => {
  test.setTimeout(600_000)
  test.skip(!(await hasLocalSnapshot(page)), 'No local real-data snapshot (run npm run data:ingest)')

  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto('/#/draft')
  await expect(page.getByTestId('player-table')).toBeVisible({ timeout: 30_000 })
  // First launch on this server loads the real snapshot (no demo badge in the header).
  await expect(page.locator('header').getByText('DEMO DATA')).toHaveCount(0)
  await page.getByLabel('Your draft slot').selectOption('6')

  // Search: accent- and suffix-insensitive, with ESPN ADP shown.
  const search = page.getByTestId('draft-search')
  for (const [q, name] of [
    ['jokic', 'Nikola Jokić'],
    ['wembanyama', 'Victor Wembanyama'],
    ['trey murphy', 'Trey Murphy III'],
    ['cason wallace', 'Cason Wallace'],
  ]) {
    await search.fill(q)
    await expect(page.getByRole('listbox')).toContainText(name)
  }
  // Player-source detail: separate ESPN market, expert and Fantasy Edge numbers.
  await search.fill('jokic')
  await search.press('Shift+Enter')
  const sheet = page.getByTestId('player-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('source-lines')).toContainText('Fantasy Edge')
  await expect(sheet.getByTestId('source-lines')).toContainText('ESPN proj.')
  await expect(sheet.getByTestId('market-ranks')).toContainText('AVG PICK')
  await expect(sheet.getByTestId('market-ranks')).toContainText('FantasyPros ECR')
  await page.keyboard.press('Escape')
  await search.fill('')

  await sortByAdp(page)
  const timings: { pick: number; ms: number }[] = []
  let reloaded = false
  let undone = false
  let directoryDrafted = false
  let midChecks = false

  for (let guard = 0; guard < 400; guard++) {
    // When the draft is complete the clock element is replaced, so check that first (never wait on a missing element).
    if (await page.getByText('DRAFT COMPLETE').count()) break
    const clock = await onClockText(page)
    if (!clock) break
    const pick = Number(clock.match(/#(\d+)/)?.[1] ?? '0')
    if (!pick) break

    // Mid-draft analysis views.
    if (pick === 75 && !midChecks) {
      midChecks = true
      await page.goto('/#/league')
      await expect(page.getByTestId('league-simple')).toBeVisible()
      await page.getByRole('radio', { name: 'Advanced' }).first().click()
      await expect(page.getByTestId('league-advanced')).toBeVisible()
      await page.goto('/#/build')
      await expect(page.getByTestId('category-standing')).toBeVisible()
      await expect(page.getByTestId('build-lab')).toBeVisible()
      await expect(page.getByTestId('what-if')).toBeVisible()
      await page.goto('/#/draft')
      await expect(page.getByTestId('player-table')).toBeVisible()
      await sortByAdp(page)
    }
    // Reload mid-draft: state must survive.
    if (pick === 90 && !reloaded) {
      reloaded = true
      await page.reload()
      await expect(page.getByTestId('on-clock')).toContainText('#90', { timeout: 30_000 })
      await sortByAdp(page)
    }
    // An unprojected (directory-only) player can still be logged for an opponent.
    if (pick === 130 && !directoryDrafted && !clock.includes('YOU')) {
      directoryDrafted = true
      await search.fill('bronny james')
      const opt = page.getByRole('listbox')
      await expect(opt).toContainText('no projection')
      await search.press('Enter')
      await expect(page.getByTestId('on-clock')).toContainText('#131')
      await expect(page.getByTestId('recent-picks')).toContainText('Bronny James')
      continue
    }

    const t0 = Date.now()
    if (clock.includes('YOU')) {
      await page.getByTestId('lane-decision').getByRole('button', { name: 'Draft', exact: true }).first().click()
    } else {
      await page.getByTestId('player-table').locator('tbody tr[data-player-id]').first().getByRole('button', { name: 'Draft', exact: true }).click()
    }
    if (pick < 156) await expect(page.getByTestId('on-clock')).toContainText(`#${pick + 1}`)
    else await expect(page.getByText('DRAFT COMPLETE')).toBeVisible()
    timings.push({ pick, ms: Date.now() - t0 })

    // Undo once mid-draft and redo the pick.
    if (pick === 50 && !undone) {
      undone = true
      await page.getByTitle('Undo last change (u or ⌘Z)').click()
      await expect(page.getByTestId('on-clock')).toContainText('#50')
    }
  }

  await expect(page.getByText('DRAFT COMPLETE')).toBeVisible()
  expect(reloaded && undone && directoryDrafted && midChecks).toBe(true)
  // My roster: 13 players, lineup fill shown on My Build.
  await page.goto('/#/build')
  await expect(page.getByTestId('my-roster').locator('li')).toHaveCount(13)
  await page.goto('/#/league')
  await page.getByRole('radio', { name: 'Simple' }).first().click()
  await expect(page.getByTestId('league-simple')).toContainText('no proj.')

  const late = timings.filter((t) => t.pick >= 60).map((t) => t.ms).sort((a, b) => a - b)
  const median = late[Math.floor(late.length / 2)]
  const p90 = late[Math.floor(late.length * 0.9)]
  console.log(`pick→paint (UI click to next pick on the clock, picks 60–156): median ${median} ms, p90 ${p90} ms, max ${late.at(-1)} ms over ${late.length} picks`)
  expect(median).toBeLessThan(600)
  expect(errors).toEqual([])
})
