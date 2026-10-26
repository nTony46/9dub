import { isPctCombo } from './cells'

/** Import target fields a source column can map to. */
export const FIELD_KEYS = [
  'ignore',
  'name',
  'team',
  'positions',
  'espnId',
  'gp',
  'min',
  'pts',
  'tpm',
  'reb',
  'ast',
  'stl',
  'blk',
  'tov',
  'fgm',
  'fga',
  'fgPct',
  'fgCombo',
  'ftm',
  'fta',
  'ftPct',
  'ftCombo',
  'espnAdp',
  'espnRank',
  'sourceRank',
  'otherAdp',
  'note',
] as const
export type FieldKey = (typeof FIELD_KEYS)[number]

export const FIELD_LABEL: Record<FieldKey, string> = {
  ignore: '— ignore —',
  name: 'Player name',
  team: 'NBA team',
  positions: 'Positions',
  espnId: 'ESPN player id',
  gp: 'Games projected',
  min: 'Minutes / game',
  pts: 'Points',
  tpm: '3PM',
  reb: 'Rebounds',
  ast: 'Assists',
  stl: 'Steals',
  blk: 'Blocks',
  tov: 'Turnovers',
  fgm: 'FGM',
  fga: 'FGA',
  fgPct: 'FG%',
  fgCombo: 'FG% with (FGM/FGA)',
  ftm: 'FTM',
  fta: 'FTA',
  ftPct: 'FT%',
  ftCombo: 'FT% with (FTM/FTA)',
  espnAdp: 'ESPN ADP',
  espnRank: 'ESPN rank',
  sourceRank: 'Source 9-cat rank',
  otherAdp: 'Other ADP',
  note: 'Injury / role note',
}

/** Normalised header → field. Headers are lower-cased with spaces/punctuation removed (except % and #). */
const SYNONYMS: Record<string, FieldKey> = {
  player: 'name', name: 'name', playername: 'name', fullname: 'name', athlete: 'name',
  team: 'team', tm: 'team', nbateam: 'team', tm1: 'team',
  pos: 'positions', position: 'positions', positions: 'positions', eligibility: 'positions', elig: 'positions',
  espnid: 'espnId', playerid: 'espnId',
  gp: 'gp', g: 'gp', games: 'gp', gamesplayed: 'gp', gamesprojected: 'gp',
  min: 'min', mpg: 'min', minutes: 'min', mp: 'min', mins: 'min',
  pts: 'pts', points: 'pts', ppg: 'pts',
  '3pm': 'tpm', '3ptm': 'tpm', '3p': 'tpm', threes: 'tpm', tpm: 'tpm', '3pt': 'tpm', '3s': 'tpm', '3ptmade': 'tpm', fg3m: 'tpm',
  reb: 'reb', trb: 'reb', treb: 'reb', rebounds: 'reb', totreb: 'reb', rpg: 'reb',
  ast: 'ast', assists: 'ast', apg: 'ast',
  stl: 'stl', steals: 'stl', spg: 'stl',
  blk: 'blk', blocks: 'blk', bpg: 'blk',
  to: 'tov', tov: 'tov', turnovers: 'tov', tos: 'tov',
  fgm: 'fgm', fga: 'fga', 'fg%': 'fgPct', fgpct: 'fgPct', fgp: 'fgPct',
  ftm: 'ftm', fta: 'fta', 'ft%': 'ftPct', ftpct: 'ftPct', ftp: 'ftPct',
  espnadp: 'espnAdp', espnrank: 'espnRank', espnrk: 'espnRank',
  rank: 'sourceRank', rk: 'sourceRank', 'r#': 'sourceRank', '#': 'sourceRank', '9catrank': 'sourceRank', ovr: 'sourceRank',
  adp: 'otherAdp', blendadp: 'otherAdp', avgpick: 'otherAdp',
  note: 'note', notes: 'note', injury: 'note', status: 'note', news: 'note',
}

export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9%#]/g, '')
}

/**
 * Guess a mapping from headers + sample rows. Sample-aware: a column whose
 * values look like "0.573 (10.5/18.3)" maps to the combo field; Basketball-
 * Reference style "FG" next to "FGA" maps to FGM.
 */
export function autoMap(headers: readonly string[], sample: readonly string[][]): FieldKey[] {
  const norm = headers.map(normHeader)
  const used = new Set<FieldKey>()
  return norm.map((h, i) => {
    let f: FieldKey | undefined = SYNONYMS[h]
    if (h === 'fg' && norm.includes('fga')) f = 'fgm'
    if (h === 'ft' && norm.includes('fta')) f = 'ftm'
    if (h === 'espnadp' || (h.includes('espn') && h.includes('adp'))) f = 'espnAdp'
    if (h.includes('blend') && h.includes('adp')) f = 'otherAdp'
    const vals = sample.map((r) => r[i]).filter((v) => v != null && String(v).trim() !== '')
    const comboShare = vals.length ? vals.filter(isPctCombo).length / vals.length : 0
    if ((f === 'fgPct' || h.startsWith('fg')) && comboShare > 0.5) f = 'fgCombo'
    if ((f === 'ftPct' || h.startsWith('ft')) && comboShare > 0.5) f = 'ftCombo'
    if (!f || used.has(f)) return 'ignore'
    used.add(f)
    return f
  })
}

export const COUNTING_REQUIRED: FieldKey[] = ['pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'tov']
