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

/**
 * Synthetic ESPN results for weeks 2–3 (this test's only week is week 1, so it stays projected),
 * set through the app's own store module: every team's totals differ by slot.
 */
async function seedEspnResults(page: Page) {
  await page.evaluate(async () => {
    const url = '/src/store/appStore.ts'
    const { useApp } = await import(/* @vite-ignore */ url)
    const totals = (slot: number) => ({ pts: 380 + slot * 7, tpm: 40 + slot, reb: 150 + ((slot * 5) % 13), ast: 80 + ((slot * 3) % 11), stl: 20 + (slot % 4), blk: 15 + (slot % 5), tov: 45 + ((slot * 2) % 7), fgm: 140 + slot, fga: 310, ftm: 60 + slot, fta: 85 })
    const side = (slot: number) => ({ slot, wins: 5, losses: 4, ties: 0, totals: totals(slot), cats: {} })
    const results = [2, 3].flatMap((period) => Array.from({ length: 6 }, (_, k) => ({ period, home: side(2 * k + 1), away: side(2 * k + 2) })))
    useApp.setState((s: { season: object }) => ({
      season: {
        ...s.season,
        espn: { syncedAt: Date.now(), leagueId: 1, leagueName: 'Synthetic', changes: [], unmatched: [], players: {}, live: null, teamNames: [], results, standings: [], stats: {}, teamStatus: [], pending: null, lineups: null },
      },
    }))
  })
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
  // Tag my players as streamers: a label on the row (and on my side of the matchup), nothing else. Untagging takes it off.
  for (const row of await players.all()) await row.getByRole('button', { name: /^Tag .+ as a streamer$/ }).click()
  await expect(table.getByTestId('streamer-badge')).toHaveCount(2)
  const streamerRow = table.locator(`li[data-player-row="${who}"]`)
  await streamerRow.getByRole('button', { name: /^Untag .+ as a streamer$/ }).click()
  await expect(streamerRow.getByTestId('streamer-badge')).toHaveCount(0)
  await expect(table.getByTestId('streamer-badge')).toHaveCount(1)
  await streamerRow.getByRole('button', { name: /^Tag .+ as a streamer$/ }).click()
  await expect(streamerRow.getByTestId('streamer-badge')).toHaveText('Streamer')
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
  // Outlook per category, and the waiver wire for the rest of the week.
  await expect(page.getByTestId('matchup-categories')).toContainText('Outlook')
  await expect(page.getByTestId('outlook-PTS')).toHaveText(/Safe|Ahead|Toss-up|Behind|Far behind/)
  const wire = page.getByTestId('waiver-wire')
  await expect(wire.getByTestId('wire-row').first()).toBeVisible()
  // Pick the categories: one column each.
  const reb = wire.getByRole('group', { name: 'Categories you’re after' }).getByRole('button', { name: 'REB', exact: true })
  const rebValue = wire.getByTestId('wire-row').first().getByTestId('wire-REB')
  if ((await reb.getAttribute('aria-pressed')) === 'true') await reb.click()
  await expect(reb).toHaveAttribute('aria-pressed', 'false')
  await expect(rebValue).toHaveCount(0)
  await reb.click()
  await expect(reb).toHaveAttribute('aria-pressed', 'true')
  await expect(rebValue).toHaveCount(1)
  // Sort by games: most starts first (a column header in the table, a menu in the two-line layout).
  if ((await wire.getAttribute('data-layout')) === 'table') await wire.getByRole('button', { name: 'Games' }).click()
  else await wire.getByLabel('Sort by').selectOption('games')
  const games = await wire.getByTestId('wire-games').allInnerTexts()
  expect(games.map(Number)).toEqual([...games.map(Number)].sort((a, b) => b - a))
  // A toggle shows or hides it, and the choice is remembered.
  await page.getByTestId('wire-toggle').click()
  await expect(wire).toHaveCount(0)
  await expect(page.getByTestId('wire-toggle')).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('wire-toggle').click()
  await expect(wire.getByTestId('wire-row').first()).toBeVisible()
  // On a wide window it docks in its own column beside the matchup, and the hide button closes it.
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect(page.getByTestId('wire-dock').getByTestId('waiver-wire')).toBeVisible()
  await page.getByTestId('wire-hide').click()
  await expect(page.getByTestId('wire-dock')).toHaveCount(0)
  await page.getByTestId('wire-toggle').click()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.getByTestId('wire-dock')).toHaveCount(0)
  await expect(wire).toBeVisible()

  // Week view (default): players × days, open seats, and NBA teams to stream from.
  const grid = page.getByTestId('week-grid')
  await expect(grid).toContainText('seats empty')
  // Games that count, both sides: 2 of mine and 1 of theirs play each day.
  await expect(page.getByTestId('games-tally')).toContainText('14–7')
  await expect(page.getByTestId('games-row-me').locator('td')).toHaveText(['Test Squad14', ...Array(7).fill('2')])
  await expect(page.getByTestId('games-row-them').locator('td')).toHaveText(['Team 27', ...Array(7).fill('1')])
  await expect(grid.locator('thead th')).toHaveCount(8) // player column + 7 days
  await expect(grid).toContainText('8 open') // 2 of my players play each day → 8 of 10 seats open
  await expect(grid).toContainText('UTIL') // rows by fantasy slot, like the day view
  await expect(page.getByTestId('stream-team').first()).toContainText('+7')
  await expect(page.getByTestId('streaming-count')).toContainText('at +7')
  // Top 8 teams first; "Show all" lists every team with a game on an open night.
  await expect(page.getByTestId('stream-team')).toHaveCount(8)
  await page.getByTestId('streaming-all').click()
  expect(await page.getByTestId('stream-team').count()).toBeGreaterThan(8)
  await page.getByTestId('streaming-all').click()
  await expect(page.getByTestId('stream-team')).toHaveCount(8)
  await page.getByRole('radio', { name: 'Back-to-backs' }).click()
  await expect(page.getByTestId('stream-team').first()).toContainText('B2B')
  // A team here filters the waiver wire to its players.
  const streamTeam = page.getByTestId('stream-team').first().locator('button').first()
  const code = (await streamTeam.innerText()).trim()
  await streamTeam.click()
  await expect(wire.getByTestId('wire-team')).toHaveText(code)
  for (const row of await wire.getByTestId('wire-row').all()) await expect(row.getByTestId('wire-player')).toContainText(code)
  await wire.getByTestId('wire-team').click()
  await expect(wire.getByTestId('wire-team')).toHaveCount(0)

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
  await expect(mine.getByTestId('streamer-badge')).toHaveCount(2)
  await expect(page.getByTestId('lineup-theirs').getByTestId('streamer-badge')).toHaveCount(0)

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

  // League ranks, season to date: hidden until ESPN has results; a toggle puts each team's rank under its totals.
  await expect(page.getByTestId('ranks-toggle')).toHaveCount(0)
  await seedEspnResults(page)
  await expect(page.getByTestId('ranks-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('rank-mine-PTS')).toHaveCount(0)
  await page.getByTestId('ranks-toggle').click()
  await expect(page.getByTestId('ranks-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ranks-caption')).toContainText('League rank, season to date: actual ESPN totals, weeks 2–3')
  // Slot 1 (me) has the fewest points, slot 2 (the opponent) the next fewest; fewer turnovers ranks higher.
  await expect(page.getByTestId('rank-mine-PTS')).toHaveText('12th')
  await expect(page.getByTestId('rank-theirs-PTS')).toHaveText('11th')
  await expect(page.getByTestId('rank-mine-TO')).toHaveText(/^(T-)?\d+(st|nd|rd|th)$/)
  // The whole league, collapsed until opened, with both matchup teams marked.
  const league = page.getByTestId('league-ranks')
  await expect(league.locator('table')).toBeHidden()
  await league.locator('summary').click()
  await expect(league.locator('tbody tr')).toHaveCount(12)
  await expect(league.getByTestId('league-ranks-me')).toContainText('Test Squad')
  await expect(league.getByTestId('league-ranks-opp')).toContainText('Opponent')

  // Everything survives a reload (schedule cached, season saved, toggles remembered).
  await page.reload()
  await expect(page.getByTestId('matchup-detail')).toBeVisible()
  await expect(page.getByTestId('season-weeks').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('ranks-toggle')).toHaveAttribute('aria-pressed', 'true')
  // One tagged player went in the trade; the other keeps his tag, the pickup has none.
  await page.getByRole('radio', { name: 'Rosters' }).click()
  await expect(page.getByTestId('roster-table').locator('li[data-player-row]')).toHaveCount(2)
  await expect(page.getByTestId('roster-table').getByTestId('streamer-badge')).toHaveCount(1)
})
