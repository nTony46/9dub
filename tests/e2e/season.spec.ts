import { expect, test, type Page } from '@playwright/test'

const TEAMS = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS']

/** A local calendar date `offset` days from today. */
function isoFromToday(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** A whole week that hasn't started yet, so every day of it is still to play. */
const WEEK = Array.from({ length: 7 }, (_, i) => isoFromToday(7 + i))

/** Synthetic schedule: every NBA team plays every day of the week. */
function syntheticSchedule() {
  const games = []
  let n = 1
  for (const date of WEEK) for (let i = 0; i < TEAMS.length; i += 2) games.push({ n: n++, date, away: TEAMS[i], home: TEAMS[i + 1], neutral: false, cup: false })
  return { kind: 'nba-schedule', season: '2026-27', asOf: null, source: { file: 'synthetic.pdf', sha256: null }, createdAt: new Date().toISOString(), games, unscheduled: {}, tbdWindow: null }
}

async function draftTop(page: Page, picks: number) {
  for (let i = 0; i < picks; i++) {
    const name = (await page.getByTestId('player-table').locator('tbody tr').first().locator('td').nth(1).locator('button').first().innerText()).trim()
    const input = page.getByTestId('draft-search')
    await input.fill(name)
    await expect(page.getByRole('listbox')).toBeVisible()
    await input.press('Enter')
    await expect(input).toHaveValue('')
  }
}

test('season: post-draft roster moves, schedule import, weekly projection and what-if', async ({ page }) => {
  await page.goto('/#/draft')
  await page.getByLabel('Your draft slot').selectOption('1')
  await draftTop(page, 4) // picks 1–4 → slots 1–4

  // Rosters, laid out by slot: add a free agent to my team, then undo it.
  await page.goto('/#/season/rosters')
  const table = page.getByTestId('roster-table')
  const players = table.locator('li[data-player-row]')
  await expect(table.locator('li')).toHaveCount(15) // 10 starters + 3 BE + 2 IR
  await expect(players).toHaveCount(1)
  await page.getByTestId('roster-add').fill('a')
  await page.getByTestId('roster-add').press('Enter')
  await expect(players).toHaveCount(2)
  await expect(page.getByTestId('roster-moves').locator('li')).toHaveCount(1)
  await page.getByTestId('roster-moves').getByRole('button', { name: 'Undo this change' }).click()
  await expect(players).toHaveCount(1)
  // Add one for real so the matchup has two players on my side.
  await page.getByTestId('roster-add').fill('e')
  await page.getByTestId('roster-add').press('Enter')
  await expect(players).toHaveCount(2)
  // IR from the roster: the player moves to an IR row; Activate brings him back.
  const first = players.first()
  const who = (await first.getAttribute('data-player-row'))!
  await first.getByRole('button', { name: /^Move .+ to IR$/ }).click()
  await expect(table.locator(`li[data-player-row="${who}"]`)).toContainText('IR')
  await table.locator(`li[data-player-row="${who}"]`).getByRole('button', { name: /^Activate / }).click()
  await expect(table.locator(`li[data-player-row="${who}"]`).getByRole('button', { name: /^Move .+ to IR$/ })).toBeVisible()
  // Rename a team in place.
  await page.getByRole('button', { name: 'Rename team' }).click()
  await page.getByLabel('Team name').fill('Test Squad')
  await page.getByLabel('Team name').press('Enter')
  await expect(page.getByTestId('rosters-view')).toContainText('Test Squad')

  // Matchups: import the schedule, add a week, choose the opponent.
  await page.goto('/#/season')
  await expect(page.getByText('NBA schedule needed')).toBeVisible()
  await page.getByTestId('import-schedule').setInputFiles({ name: 'schedule.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(syntheticSchedule())) })
  await expect(page.getByText('NBA schedule needed')).toBeHidden()
  await page.getByTestId('add-week').click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.getByTestId('schedule-editor')
  await editor.getByLabel('Week 1 start', { exact: true }).fill(WEEK[0])
  await editor.getByLabel('Week 1 end', { exact: true }).fill(WEEK[6])
  await editor.getByLabel('Week 1 opponent', { exact: true }).selectOption('1')

  const detail = page.getByTestId('matchup-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('Test Squad vs Team 2')
  await expect(page.getByTestId('matchup-score')).toHaveText(/^\d–\d(–\d)?$/)
  await expect(page.getByTestId('matchup-categories')).toContainText('STL')
  // Outlook per category, and pickups for the rest of the week.
  await expect(page.getByTestId('matchup-categories')).toContainText('Outlook')
  await expect(page.getByTestId('outlook-PTS')).toHaveText(/Safe|Ahead|Toss-up|Behind|Far behind/)
  await expect(page.getByTestId('pickups')).toBeVisible()

  // Week view (default): players × days, open seats, and NBA teams to stream from.
  const grid = page.getByTestId('week-grid')
  await expect(grid).toContainText('seats empty')
  await expect(grid.locator('thead th')).toHaveCount(8) // player column + 7 days
  await expect(grid).toContainText('8 open') // 2 of my players play each day → 8 of 10 seats open
  await expect(grid).toContainText('UTIL') // rows by fantasy slot, like the day view
  await expect(page.getByTestId('stream-team').first()).toContainText('+7')
  await page.getByRole('radio', { name: 'Back-to-backs' }).click()
  await expect(page.getByTestId('stream-team').first()).toContainText('B2B')

  // Daily lineups by slot (auto "quick lineup"): every player plays every day here.
  await page.getByRole('radio', { name: 'Day by slot' }).click()
  await expect(page.getByTestId('day-strip').getByRole('button')).toHaveCount(7)
  const mine = page.getByTestId('lineup-mine')
  await expect(mine).toContainText('PG')
  await expect(mine).toContainText('UTIL')
  await expect(mine).toContainText('BE')
  await expect(mine).toContainText('IR')
  await expect(mine).toContainText('week 14')
  await expect(page.getByTestId('lineup-theirs')).toContainText('week 7')

  // Mark one of my players out: he moves to IR and stops counting; marking him healthy restores it.
  const outBtn = mine.getByRole('button', { name: /^Mark .+ out$/ }).first()
  const outName = (await outBtn.getAttribute('aria-label'))!.replace(/^Mark (.+) out$/, '$1')
  await outBtn.click()
  await expect(mine).toContainText('week 7')
  await expect(mine.locator('li', { hasText: outName })).toContainText('IR')
  await mine.getByRole('button', { name: `Mark ${outName} healthy` }).click()
  await expect(mine).toContainText('week 14')

  // Trade lab: give one of mine, pick up a free agent; see the effect, then record it.
  const lab = page.getByTestId('trade-lab')
  await lab.getByTestId('trade-give').selectOption({ index: 1 })
  await lab.getByTestId('trade-get').fill('o')
  await lab.getByTestId('trade-get').press('Enter')
  const result = page.getByTestId('trade-result')
  await expect(result).toContainText('Free-agent pickup')
  await expect(result).toContainText('This week')
  await expect(page.getByTestId('trade-score')).toHaveText(/^\d–\d(–\d)?$/)
  await result.getByRole('button', { name: 'Record in Rosters' }).click()
  await expect(result).toBeHidden()
  await page.getByRole('radio', { name: 'Rosters' }).click()
  await expect(page.getByTestId('roster-moves').locator('li')).toHaveCount(3) // earlier add + pickup + drop
  await page.getByRole('radio', { name: 'Matchups' }).click()

  // Everything survives a reload (schedule cached, season saved).
  await page.reload()
  await expect(page.getByTestId('matchup-detail')).toBeVisible()
  await expect(page.getByTestId('season-weeks').locator('li')).toHaveCount(1)
})
