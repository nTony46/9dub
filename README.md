# 9dub — 9-cat draft desk

A local-first draft assistant for **head-to-head 9-category NBA fantasy** (FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TO) snake drafts. It has three parts:

- a fast live-draft control center for every team in the league;
- a transparent 9-cat valuation and roster-building engine;
- in-season weekly matchup projections, with a read-only sync of your ESPN league.

Everything runs on your computer. 9dub ships **no real player data**: you bring projections you're entitled to use (a CSV or a pasted table), and a fictional demo pool is there to try the app.

> **Unofficial.** 9dub is not affiliated with or endorsed by ESPN, the NBA or any data provider. The ESPN sync uses ESPN's unofficial read API with your own sign-in cookies, and ESPN's terms of use prohibit automated access. Turning it on is your choice and your responsibility. It only ever reads (GET requests to ESPN's read hosts); no code path can make trades, adds, drops or lineup changes. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md#espn-league-sync-read-only).

## Quick start

```bash
npm install
npm run dev            # http://localhost:5199 (or just `9dub`, below)
```

The first launch opens **Set up 9dub**:

1. **Player list.** Import projections in *Settings & Data → Data & imports* (CSV or a pasted table; a [template](public/data/template-projections.csv) is included). The demo pool has made-up players, so ESPN's rosters can't be matched to it.
2. **ESPN sign-in cookies.** Paste your `SWID` and `espn_s2` cookies (the page shows where to find them). They stay in `.local-data/espn/auth.json` on your computer and are never sent to the page.
3. **Your league.** 9dub lists your ESPN fantasy basketball leagues for the season; pick one.
4. **Import league.** One read fills in the league size, rounds and lineup slots, your team, team names, the whole draft, rosters and IR, the matchup schedule (week dates and opponents), results so far, the standings and the NBA schedule.

Prefer not to connect ESPN? Choose **Skip, set up by hand**, then set teams, rounds and your slot in *Settings → League* and record the draft yourself.

**The `9dub` command.** `bin/9dub` starts the dev server and opens the app in your browser. If the app is already running, it just opens it. Install it once:

```bash
ln -s "$PWD/bin/9dub" ~/.local/bin/9dub   # any folder on your PATH works
```

After that, typing `9dub` in any terminal opens the app. Press Ctrl+C or close the window to stop it; your data stays saved (see "Your session is also saved to disk" below). It always uses http://localhost:5199 and never inherits a `NINEDUB_*=off` setting, so it opens your saved session.

Production build:

```bash
npm run build && npm run preview   # http://localhost:5199 — the preview server also serves .local-data/
```

Everything runs in the browser. State is stored in that browser profile's IndexedDB, with a localStorage mirror. There is no account and no hosted server. After the first load it works offline (the ESPN sync needs the local dev or preview server).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5199 |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm test` | Vitest unit and integration tests (engine, ESPN conversion, ingest parsers, import, store, React Testing Library flows). Real-data suites run only when a private snapshot exists in `.local-data/`. |
| `npm run test:e2e` | Playwright end-to-end tests. First time only: `npx playwright install chromium`. Demo flows run on a server with local data off (port 5299); a full real-data draft runs on port 5298 and skips if no snapshot exists. Neither contacts ESPN. |
| `npm run typecheck` / `npm run lint` | TypeScript (strict) / ESLint |
| `npm run check` | typecheck + lint + unit tests + build |
| `npm run data:ingest` | Advanced: reconcile your own exported source files in `Fantasy Draft Data/` (or `-- --dir <folder>`) into a private snapshot in `.local-data/`, with an audit (no network). See [Your own data files](#your-own-data-files-advanced). |
| `npm run data:schedule -- --file <pdf>` | Optional: convert the NBA "Regular Season Schedule By Date" PDF into `.local-data/nba-schedule-<season>.json`. With ESPN connected, setup gets the schedule from ESPN instead. |
| `npm run data:demo` | Regenerate the fictional demo pool in `public/data/` |
| `npm run data:build -- --in <file> …` | Build a snapshot from a single local CSV/TSV/JSON, written to `.local-data/` by default (no network) |

## Using it during a draft

1. **Before the draft:** *Settings & Data → League*. Set teams, rounds and team names. Set your slot when you learn it; the snake order regenerates instantly. You can also set it from **Your slot** in the Live Draft bar.
2. **Draft Room** (`1`): press `/` and type a name.
   - `Enter` records the highlighted player for the team **on the clock**, and the toast offers **Undo**.
   - `⇧Enter` previews the player instead.
   - Already-drafted players sort last and are refused, so duplicates are impossible without an explicit edit.
3. **Corrections:**
   - Undo any change with `u` / `⌘Z` (survives a refresh).
   - Use the pencil on a recent pick, or `b` for the full board, to edit the player or team, reassign, or remove a pick.
   - Use the **Recording** button to target any pick number or team.
4. **Fell behind?** Jump to your own pick and record only yours.
   - 9dub shows **Partial log · N unrecorded** and marks players likely taken in those picks as *possibly taken*. They are never treated as safely available.
   - Fill the gaps later from the left pane.
5. **Right rail:**
   - Your roster with a nine-cell standing strip and a plain-language read ("Big-man lean", "Weak: FT% (recoverable)").
   - Three recommendation lanes: **Best Draft Decision** (quality → fit → timing, with a quality floor), **Best Overall**, and **Best Team Fit**. Each has deterministic reasons.
   - Modes: Adaptive (default), Best Player Available, Team Fit, and Optimize Selected Build.
6. **League Overview** (`2`):
   - Simple: team cards.
   - Advanced: a teams × categories heatmap showing raw production, category score or rank. Comparison bases are **pick-adjusted** (default, fair across unequal pick counts), replacement-filled, per-player, or current roster.
7. **My Build** (`3`):
   - Category bars with hover detail: raw totals, FG% as makes/attempts, rank, z, and interpretation.
   - Each player's shooting volume impact, and the lineup fill.
   - **Build Lab**: balanced, single and correlated double punts, with viability, confidence, opportunity cost, rationale and targets. Builds can be **soft- or hard-locked**; nothing is ever locked automatically.
   - **What if I take…**: compare up to three players without drafting them.
8. **Back up:** *Settings & Data → Session* exports the whole session as versioned JSON, optionally with the dataset. Import validates and migrates the file. Saved draft logs can be restored.

Press `?` in the app for all shortcuts. Shortcuts never fire while you are typing in a field.

## During the season

**After the last pick**, *Live Draft* becomes **My League**, and the app opens there. Its keys change:
- **League Overview** (`1`): team cards and the heatmap on today's rosters, with players marked out shown on IR. Each opponent's card shows the week you play them next, linked to that matchup.
- **My Team** (`2`):
  - Category standing, your roster and lineup, and shooting impact.
  - **Head-to-head by category**: the projection of the week you play each team, in schedule order (the same numbers as Season: real game counts, daily lineups, live totals). Without the NBA schedule it falls back to per-game strength.
- **Draft Recap** (`3`): the board and pick log, where picks can still be corrected (slot, undo).

The bar shows this week's matchup, one click from its projection. Draft-only tools (Build Lab, recommendation lanes, *What if I take…*) are hidden. `/` now opens the player search on **NBA Players**.

**ESPN league sync (read-only).** Connect once on the setup page or in *Settings → League → ESPN league* (with several leagues, pick one there). The refresh button in the top bar (next to the theme toggle) re-reads ESPN.
- It also runs on start-up when the last sync is over 10 minutes old, and every 15 minutes while the tab is open.
- It updates team names, rosters (adds, drops, trades), IR, lineup slots, matchup opponents, players' NBA teams and position eligibility, and ESPN injury tags.
- For the current week it uses ESPN's category totals so far, plus a projection of the games that haven't tipped off.
- Once ESPN scores a week, Season → Matchups shows its final score (e.g. **W 5–4**) with each side's totals and the margin in every category. The schedule shows your season record in categories and your place in the standings.
- It only reads from ESPN; nothing can change your ESPN league. Details and caveats are in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md#espn-league-sync-read-only).

**Season** (`4`) has two views. Both use your **current rosters**: the draft plus any post-draft changes.

1. **Rosters:**
   - Each team's roster by slot (your league's lineup, e.g. PG … UTIL, BE, IR), like ESPN. Every player has **IR**, **Trade** and **Drop**; **Add a player** fills an open spot. Each change is a separate entry with its own **Undo**; the draft log itself is never edited. With ESPN sync on, ESPN's rosters win at the next sync.
   - Double-click a team name (or use the pencil) to rename it.
   - **IR** marks a player out, optionally with an *until* date (he counts again the day after); **Activate** brings him back. Injured players fill the **IR slots** (Settings → League, default 2) and don't count toward the roster size, so you can pick up a replacement.
2. **Matchups:**
   - Needs the NBA schedule: from ESPN at setup, or run `npm run data:schedule -- --file <pdf>` once and reload (or import the JSON it creates).
   - With ESPN connected, the weeks and opponents come from your league (week 1 from opening night to the first Sunday, then Monday–Sunday, with the All-Star week played together with the next one, as ESPN does). Without it, add weeks by hand and match each league team name to its draft slot once.
   - Weeks ESPN has scored show the **final** score instead of a projection.
   - **Week detail:**
     - The projected category score (e.g. 5–4), with each category's projected totals and a call: *toss-up*, *lean* or *clear*.
     - What it would take to flip a close loss.
     - **Outlook** for each category (safe, ahead, toss-up, behind, far behind) and, where you're not winning, **Chase** or **Let go**: whether one free-agent pickup for the rest of the week clearly helps. Hover a category for the gap, what's left to play, and the best pickup.
     - **Pickups this week**: the three free agents that move the most categories, with the player you'd drop; *Try* loads one into the trade lab.
     - **Week view** (default): a lineup calendar — one row per fantasy slot (PG … UTIL, BE, IR) and, for each day of the matchup, who fills it. Players stay in their usual slot; when a starter has no game, a bench player with a game moves into his seat (marked) (Tue–Sun in week 1, Mon–Sun after), with that day's opponent. It shows who plays, who sits on a crowded night, who is out, and how many seats stay empty each night. When an open seat needs a specific position (e.g. your only C has no game), it says so.
     - **Fill the empty seats:** NBA teams as extra rows aligned under the same days, ranked by how many of your remaining open nights they play (or filtered to back-to-backs on open nights). Nights where only one position helps are marked. It lists teams, not players, so you pick the player for the categories you're chasing.
     - **Day by slot:** both teams' lineups slot by slot like ESPN (your league's slots, then Bench and IR) with each player's opponent that day. They are set automatically like ESPN's Quick Lineup: everyone with a game starts, and when slots run out the best players start.
     - Player totals for the week (starts, games, projected counts).
   - **Trade lab:** give some of your players and get anyone (free agents or another team's players). It shows this week's score and your rest-of-season record before and after, plus the weeks that flip. **Record in Rosters** turns it into roster moves (trades go to the partner team, pickups drop your players).
   - **Your schedule:** every week's final or projected score, and your record and place in the standings.
   - **NBA Cup:** weeks that overlap the NBA's still-unscheduled games (the Cup knockout window) are flagged *TBD*. Both sides are undercounted there until the NBA sets those dates.

**Your session is also saved to disk.** While the dev server runs, 9dub mirrors the session to `.local-data/session-latest.json` (with one dated copy per day in `.local-data/session-backups/`, newest 14 kept). If the browser's data is ever cleared, or you open the app in another browser, it restores from that file automatically. The dev server always uses port 5199 and refuses to start on another port, because browser storage is tied to the port. Tests and throwaway servers run with `NINEDUB_SESSION_SAVE=off`.

## Your own data files (advanced)

Most people import one CSV or pasted table (*Settings & Data → Data & imports*). If you keep exports from several sources, `npm run data:ingest` reconciles them into one private snapshot with full provenance:

1. Put the files in `Fantasy Draft Data/` (any names, any sub-folders; old versions can stay). The ingest recognises, by content:
   - ESPN **Ranking & Projections** pages printed to PDF (one PDF per results page; the league view that shows PTS and TO);
   - ESPN **Live Draft Trends** pages printed to PDF;
   - the NBA Fantasy Edge **9-cat rankings** page printed to PDF (it carries FGA/FTA), and its CSV export as a cross-check;
   - FantasyPros **Draft ALL Rankings** and **Overall NBA ADP** CSVs.
2. Run `npm run data:ingest`. It prints counts and writes the snapshot to `.local-data/real-<season>.json`, an audit to `.local-data/audit/` (every file, duplicate, conflict and incomplete player), and the previous snapshot to `.local-data/history/` for rollback.
3. Start the app. Accept the banner, or go to *Settings & Data → Data & imports → Local real-data snapshots → Activate*.

Activating a new snapshot takes an automatic backup and re-links your draft picks, undo history, shortlist and overrides by player name, reporting anything it could not match. To roll back, activate the older snapshot or restore a backup.

What the numbers are:

- **Projections:** the default line comes from the most complete source (one with FGA/FTA). FGM/FTM are *derived* (% × attempts). A source's GP/MIN can supplement another's line, labelled as such. Lines without attempts are badged **≈ partial**, ranked after complete players and never recommended. Players with no projection anywhere are badged **no proj.**: searchable and draftable, not valued.
- **ESPN ADP:** Live Draft Trends `AVG PICK`; **†** marks the FantasyPros-reported ESPN ordinal, used only when ESPN has no row; **140+** is ESPN's "rarely drafted" ceiling and is not used for timing. Yahoo and average ADP are shown separately.
- **Rankings** stay apart: 9dub's own (per-game and GP-aware), each source's rank and value, FantasyPros expert consensus (**ECR**), and ESPN's list order.
- **Player sheet → Sources & market** shows every source's own line side by side and each field's origin. *Settings → Valuation* can switch to another source's profile or opt into an estimate of missing FGA/FTA (marked "est."); both are off by default.

`npm run data:build` handles a single file from the command line.

**Licensing.** Projections and rankings are third-party compilations, usually for personal use only. Keep `Fantasy Draft Data/` and `.local-data/` out of any public repo or deployment: both are git-ignored, the dev and preview servers refuse direct requests for them, and they are never bundled into `dist/`.

## How the math works (short version)

Full detail with worked examples is in [`docs/SCORING_METHOD.md`](docs/SCORING_METHOD.md).

- **Z-scores** come from an iteratively chosen top-200 **reference pool**, frozen per dataset. Drafting never changes values.
- **FG%/FT%** are valued by **impact** = makes − pool rate × attempts. Team FG% = ΣFGM/ΣFGA.
- **TO** is inverted.
- **Two rankings:** per-game, and GP-aware (missed games filled at replacement level, not zero).
- **Team fit** uses a saturating category-edge index against your actual league (diminishing returns, contested categories, scarcity). It is a *construction index* — **no fake win percentages**.
- **Guardrails:** recommendations protect intrinsic quality. Fit can reorder close players; a quality floor stops category specialists from leapfrogging clearly better players. This is tested with a "Trey Murphy vs. rebound specialist" fixture.
- **ADP timing** is a labelled heuristic, not a survival probability.
- **Partial lines** (no shooting attempts) rank after every complete line and are never recommended. Missing categories are not treated as average talent.
- **Lineup feasibility:** when the picks left only just cover your open starter slots, players who can't fill one drop out of the Decision and Fit lanes, with an explanation.

## Architecture

```
src/
  analytics/        pure TS engine — valuation, team, utility, recommend, builds, readout, timing, positions, what-if
  data/             Zod schemas (v2: profiles, market, rankings, provenance), normalization, import pipeline, demo generator
  data/ingest/      local source parsers (ESPN, Fantasy Edge, FantasyPros), reconciliation, audit report
  store/            Zustand store, Dexie (IndexedDB) persistence, pure draft logic, memoized derived selectors
  features/         setup, draft, league, build, season, players, settings
  components/       design-system primitives (Radix-based) + domain components (CatStrip, CategoryBars)
  styles/           Tailwind v4 + design tokens (light/dark)
scripts/data/       ingest.ts (+ ingest/readPdf.ts), generate-demo.ts, build-dataset.ts — local files only
scripts/            localDataPlugin.ts — serves .local-data/ to the dev/preview server only; espn.ts — the read-only ESPN client
tests/unit|e2e/     Vitest (+RTL) and Playwright
docs/               SCORING_METHOD.md, DATA_SOURCES.md
```

Decisions:

- **React 19 + TypeScript (strict) + Vite**
- **Tailwind v4** with semantic tokens (`--arena`, `--chalk`, `--clock`, `--plus`/`--minus`). Dark first; light mode via the header toggle.
- **Radix** primitives; **TanStack Table** with row virtualisation
- **Zustand** + **Dexie**, and **Zod** for every import and persisted object
- **Custom SVG/CSS charts** (diverging bars, heatmap, nine-cell strip) instead of a chart library: they are tiny, theme-aware and fast at 300 rows.
- **The engine is React-free and deterministic**, so a heavier simulation backend can replace pieces later without touching the UI.

## Known limitations

- **Projection coverage depends on what you import.** Players whose source has no shooting attempts value FG%/FT% as unknown (badged partial); deep picks may be unprojected.
- **ESPN ADP comes from ESPN's own public drafts** (league sizes not published) and flattens near pick 140. 9dub compares it directly to your pick numbers without rescaling, so treat it as relative order, not exact pick numbers.
- **Injury/status tags** come from your files as captured, or from ESPN at each sync. There is no other injury feed.
- **No end-of-draft projection** of other teams, no opponent draft simulation, no calibrated H2H win probabilities, no ADP survival probabilities. These are intentionally omitted until there is a model and data to support them.
- **Weekly matchups are projections from season-long per-game lines**, plus ESPN's totals so far for the current week. There is no injury news or daily lineup lock. Toss-up / lean / clear compares the margin with rough weekly noise and is not a win probability.
- **ESPN only.** There is no Yahoo, Sleeper or Fantrax sync; other leagues can still be set up and kept current by hand. 9dub is built for H2H each-category 9-cat leagues; other formats can use the draft tools, but the Season page assumes 9-cat H2H.
- **Week dates** follow ESPN's default calendar. A league that changed its matchup lengths can fix the dates in Season → Matchups → Edit.
- **Lineup checks are warnings.** There is no lineup optimiser.
- **Build simulation** assumes ADP-ordered opponents. Its absolute numbers are optimistic, so viability is shown relative to balanced.
- **Player ids are name-derived** and re-linked by name when a snapshot changes. A reference that cannot be matched uniquely is left as-is and reported. Fictional demo players are never mapped onto real ones.
- **Single-tab design:** two tabs editing at once will overwrite each other's autosave.

## License

[MIT](LICENSE). The license covers 9dub's code only, not any data you import or read from ESPN or other providers.
