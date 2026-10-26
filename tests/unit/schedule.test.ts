import { describe, expect, it } from 'vitest'
import type { PdfItem, PdfPage } from '@/data/ingest/pdfLines'
import { addDays, datesBetween, isoFromSlashDate, parseNbaSchedulePdf, seasonLabel, teamsByDate, unscheduledInfo, type ScheduleGame } from '@/data/schedule'

/** Synthetic rows laid out like the NBA "Schedule By Date" PDF (x positions from the real layout). */
const row = (y: number, cells: [number, string][]): PdfItem[] => cells.map(([x, s]) => ({ s, x, y, w: s.length * 4.2 }))
const header = (y: number) =>
  row(y, [
    [45, 'GAME'],
    [85, 'DAY'],
    [127, 'DATE'],
    [190, 'TEAM 1'],
    [288, 'TEAM 2'],
    [357, 'LOCAL'],
    [419, 'ET'],
    [473, 'NAT TV'],
    [536, 'R'],
    [556, '#'],
  ])
const page = (n: number, items: PdfItem[]): PdfPage => ({ page: n, width: 612, height: 792, items })

describe('NBA schedule PDF parser', () => {
  const pages = [
    page(1, [
      ...row(87, [[45, 'AS OF AUGUST 13, 2026']]),
      ...header(117),
      ...row(134, [[58, '1'], [86, 'Tue.'], [121, '10/20/26'], [193, 'Boston'], [253, 'at'], [291, 'Detroit'], [360, '3:00 PM'], [412, '3:00 PM'], [469, 'NBC/PCK']]),
      // Noon tip-off: the local-time cell sits left of the LOCAL header and must not join the home team's name.
      ...row(146, [[58, '2'], [85, 'Sun.'], [121, '11/1/26'], [184, 'Orlando'], [253, 'at'], [284, 'New York'], [352, '12:00 PM'], [412, '12:00 PM']]),
      ...row(159, [[58, '3'], [87, 'Sat.'], [124, '11/7/26'], [192, 'Denver'], [252, 'vs'], [290, 'Indiana'], [360, '4:00 PM'], [412, '5:00 PM'], [556, 'B']]),
      ...row(171, [[58, '4'], [88, 'Fri.'], [124, '11/6/26'], [181, 'LA Clippers'], [253, 'at'], [290, 'Golden State'], [360, '7:00 PM'], [407, '10:00 PM'], [536, 'R'], [555, 'C']]),
      ...row(184, [[58, '5'], [88, 'Fri.'], [124, '11/6/26'], [181, 'Gotham'], [253, 'at'], [290, 'Atlanta'], [360, '7:00 PM'], [412, '7:00 PM']]),
    ]),
    // Header repeats on every page; a game listed twice is kept once.
    page(2, [...header(64), ...row(80, [[49, '1'], [86, 'Tue.'], [121, '10/20/26'], [193, 'Boston'], [253, 'at'], [291, 'Detroit'], [360, '3:00 PM'], [412, '3:00 PM']])]),
  ]
  const { games, asOf, warnings } = parseNbaSchedulePdf(pages)

  it('reads dates, teams, neutral sites and NBA Cup group games', () => {
    expect(asOf).toBe('2026-08-13')
    expect(games.map((g) => g.n)).toEqual([1, 2, 4, 3])
    expect(games[0]).toEqual({ n: 1, date: '2026-10-20', away: 'BOS', home: 'DET', neutral: false, cup: false })
    expect(games.find((g) => g.n === 2)).toMatchObject({ date: '2026-11-01', away: 'ORL', home: 'NYK' })
    expect(games.find((g) => g.n === 3)).toMatchObject({ away: 'DEN', home: 'IND', neutral: true, cup: false })
    expect(games.find((g) => g.n === 4)).toMatchObject({ away: 'LAC', home: 'GSW', cup: true })
  })

  it('reports rows it cannot read instead of guessing a team', () => {
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/Gotham/)
  })

  it('labels the season from the first game', () => {
    expect(seasonLabel(games)).toBe('2026-27')
  })
})

describe('schedule helpers', () => {
  it('handles calendar math across months and years', () => {
    expect(isoFromSlashDate('1/4/27')).toBe('2027-01-04')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(datesBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('counts games still to be scheduled and finds the longest Nov–Dec gap', () => {
    const g = (n: number, date: string, away: string, home: string): ScheduleGame => ({ n, date, away, home, neutral: false, cup: false })
    const games = [g(1, '2026-11-01', 'BOS', 'NYK'), g(2, '2026-11-02', 'BOS', 'MIA'), g(3, '2026-11-04', 'NYK', 'MIA'), g(4, '2026-11-09', 'BOS', 'NYK'), g(5, '2026-11-10', 'MIA', 'BOS')]
    const { unscheduled, tbdWindow } = unscheduledInfo(games)
    expect(unscheduled).toEqual({ BOS: 78, NYK: 79, MIA: 79 })
    expect(tbdWindow).toEqual({ start: '2026-11-05', end: '2026-11-08' })
    expect(teamsByDate({ games }).get('2026-11-02')).toEqual(new Set(['BOS', 'MIA']))
  })
})
