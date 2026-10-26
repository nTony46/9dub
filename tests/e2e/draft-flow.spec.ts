import { expect, test, type Page } from '@playwright/test'

async function draftViaSearch(page: Page, query: string) {
  const input = page.getByTestId('draft-search')
  await input.fill(query)
  await expect(page.getByRole('listbox')).toBeVisible()
  await input.press('Enter')
  await expect(input).toHaveValue('')
}

async function topAvailableName(page: Page, n = 0) {
  return (await page.getByTestId('player-table').locator('tbody tr').nth(n).locator('td').nth(1).locator('button').first().innerText()).trim()
}

test('fresh install shows data status and a usable draft configuration', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('DEMO DATA')).toBeVisible()
  await expect(page.getByTestId('on-clock')).toContainText('#1')
  await expect(page.getByTestId('player-table')).toBeVisible()
  await page.goto('/#/settings/league')
  await page.getByRole('radio', { name: '6', exact: true }).click()
  await expect(page.getByTestId('my-picks')).toContainText('6, 19, 30, 43, 54')
})

test('draft three players for different teams; board, rosters and analytics update; state survives reload', async ({ page }) => {
  await page.goto('/#/draft')
  await page.getByLabel('Your draft slot').selectOption('2')
  const avail = page.getByRole('radio', { name: /^Available \d+/ })
  await expect(avail).toHaveText('Available 280')

  const first = await topAvailableName(page)
  await draftViaSearch(page, first)
  const second = await topAvailableName(page)
  await draftViaSearch(page, second) // pick 2 = my team (slot 2)
  const third = await topAvailableName(page)
  await draftViaSearch(page, third)

  await expect(avail).toHaveText('Available 277')
  const recent = page.getByTestId('recent-picks')
  await expect(recent).toContainText(first)
  await expect(recent).toContainText(second)
  await expect(recent).toContainText(third)
  await expect(page.getByTestId('my-roster')).toContainText(second)
  await expect(page.getByTestId('on-clock')).toContainText('#4')
  // Drafted players leave the "Available" view.
  await expect(page.getByTestId('player-table')).not.toContainText(first)

  await page.reload()
  await expect(page.getByTestId('recent-picks')).toContainText(third)
  await expect(page.getByTestId('on-clock')).toContainText('#4')
  await expect(page.getByLabel('Your draft slot')).toHaveValue('2')

  // Undo button removes the last pick.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('on-clock')).toContainText('#3')
})

test('league overview switches between simple and advanced and shows all teams', async ({ page }) => {
  await page.goto('/#/draft')
  await draftViaSearch(page, await topAvailableName(page))
  await page.goto('/#/league')
  await expect(page.getByTestId('league-simple').locator('article')).toHaveCount(12)
  await page.getByRole('radio', { name: 'Advanced' }).click()
  const table = page.getByTestId('league-advanced').locator('tbody tr')
  await expect(table).toHaveCount(12)
  await page.getByRole('radio', { name: 'League rank' }).click()
  await page.getByRole('radio', { name: 'Current roster' }).click()
  await expect(page.getByText('Raw sums: teams with more picks look stronger')).toBeVisible()
})

test('My Build: preview a player, compare, discard, and lock a build', async ({ page }) => {
  await page.goto('/#/draft')
  await page.getByLabel('Your draft slot').selectOption('1')
  await draftViaSearch(page, await topAvailableName(page))
  await page.goto('/#/build')
  await expect(page.getByTestId('category-standing')).toBeVisible()
  await expect(page.getByTestId('build-lab')).toContainText('Early read')

  // Preview from the what-if search, add to comparison.
  const whatIf = page.getByTestId('what-if')
  await whatIf.getByRole('textbox').fill('a')
  await whatIf.locator('ul button').first().click()
  await expect(whatIf.locator('tbody tr')).toHaveCount(1)
  await whatIf.locator('tbody tr button').first().click()
  await expect(page.getByTestId('player-sheet')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Discard all' }).click()
  await expect(whatIf.locator('tbody tr')).toHaveCount(0)

  // Lock the first punt build (hard), then unlock.
  const lab = page.getByTestId('build-lab')
  await lab.getByRole('button', { name: /Hard punt/ }).first().click()
  await expect(lab.getByText(/hard lock/)).toBeVisible()
  await lab.getByRole('button', { name: 'Unlock' }).click()
  await expect(lab.getByText('No build locked')).toBeVisible()
})

test('import a CSV: valid rows map, invalid rows are visible, snapshot created with rollback', async ({ page }) => {
  await page.goto('/#/settings/data')
  const csv = [
    'Player,Team,Pos,GP,MIN,PTS,3PM,REB,AST,STL,BLK,TO,FGM,FGA,FTM,FTA,ESPN ADP',
    'Test Guard,BOS,PG,72,34,24.1,3.2,4.4,6.8,1.3,0.4,2.6,8.4,18.0,4.1,4.7,8.5',
    'Test Center,DEN,C,68,30,15.3,0.4,11.8,2.6,0.9,2.1,1.7,6.2,10.4,2.5,3.9,22',
    'Test Wing,MIA,SF,75,32,18.0,2.1,6.5,3.1,1.5,0.7,1.6,6.6,13.9,2.7,3.3,41.3',
    'Broken Row,LAL,SF,70,30,abc,1,5,2,1,0.5,1.5,5,11,2,2.5,90',
  ].join('\n')
  await page.getByRole('radio', { name: 'Upload CSV / TSV / JSON' }).click()
  await page.getByTestId('import-file').setInputFiles({ name: 'projections.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const preview = page.getByTestId('import-preview')
  await expect(preview).toBeVisible()
  await expect(preview.getByText('3 new')).toBeVisible()
  await expect(preview.getByText('1 invalid')).toBeVisible()
  await expect(preview).toContainText('Points: "abc" is not a number')
  await expect(preview.getByLabel('Map column FGA')).toHaveValue('fga')
  await page.getByTestId('import-confirm').click()
  await expect(page.getByText(/Imported 3 players/)).toBeVisible()
  await expect(page.getByText('3 players').first()).toBeVisible()
  // Roll back to the demo snapshot.
  await page.getByRole('button', { name: 'Activate' }).first().click()
  await expect(page.getByText('DEMO DATA')).toBeVisible()
  await expect(page.getByText('FICTIONAL DEMO').first()).toBeVisible()
})
