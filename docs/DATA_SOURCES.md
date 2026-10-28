# Data sources: what 9dub uses, where it lives, and why

9dub ships **no real player data**. You bring projections you're entitled to use: one CSV or pasted table in the app, or several exported files reconciled by `npm run data:ingest` into a private snapshot in `.local-data/`. Raw files (`Fantasy Draft Data/`) and snapshots (`.local-data/`) are git-ignored and never bundled into `dist/`. A **fictional demo pool** ships as an explicit fallback, labelled as such everywhere. Projections are never scraped. The one use of a private API is the opt-in **ESPN league sync** (below): it reads only your own league, read-only, with your own cookies.

The ingest writes a full report of every file, duplicate, conflict and incomplete player to `.local-data/audit/REAL_DATA_AUDIT.md`.

## Your own files: the local pipeline

Most people import one CSV or pasted table in the app ([below](#other-ways-in-single-tables)). If you keep exports from several sources, put them in `Fantasy Draft Data/` (any names and sub-folders), or pass `-- --dir <folder>`, and run `npm run data:ingest`. It reconciles them into one private snapshot with full provenance. Print ESPN's projections from the league view that shows PTS and TO.

```
Fantasy Draft Data/            (your files; read-only to 9dub; git-ignored)
  ├─ 2026-27 Ranking & Projections - <league> - ESPN Fantasy Basketball N.pdf   ESPN projections, one PDF per results page
  ├─ Live Draft Trends - <view> - ESPN Fantasy Basketball N.pdf                  ESPN Live Draft Trends, one PDF per results page
  ├─ Fantasy Basketball Rankings 2026-27_ 9-Cat ….pdf                            Fantasy Edge printed page (has FGA/FTA)
  ├─ fantasy-basketball-rankings.csv                                             Fantasy Edge CSV (cross-check)
  ├─ FantasyPros_2026_Draft_ALL_Rankings.csv                                     expert consensus ranks
  └─ FantasyPros_2026_Overall_NBA_ADP_Rankings.csv                               Yahoo / ESPN / avg ADP

npm run data:ingest   →   .local-data/real-2026-27.json         snapshot (schema v2)
                          .local-data/manifest.json             served at /local-data/ by the dev/preview server only
                          .local-data/history/<old id>.json     previous snapshots (rollback)
                          .local-data/audit/*.md|json           audit
```

How the ingest works:

- **Files are identified by content, not by name.** Renamed files, sub-folders, extra copies and re-exports are all fine.
- **Duplicates are reported, not used twice.**
  - Byte-identical copies (SHA-256) and "logical duplicates" (the same ESPN results page printed twice) are detected and skipped.
  - A previously combined/derived CSV is only used to cross-check the parse.
- **PDFs are read from their embedded text layer** (pdfjs-dist, positions included). The parsers handle:
  - ESPN's sticky navigation bars printed over rows;
  - rows split across printed pages;
  - accent glyphs emitted as separate runs;
  - `--` cells and status tags (DTD/Out);
  - two-row 2026 actual / 2027 projection blocks;
  - Fantasy Edge's second line (FGA under FG%, FTA under FT%).
- **No OCR is used.** A PDF without a text layer is reported, not guessed.

### Which source supplies each field

| Field | Source (default) | Fallback / alternative | Kind |
|---|---|---|---|
| PTS, 3PM, REB, AST, STL, BLK, TO, FG%, FT% | Fantasy Edge 9-cat | ESPN projection for players outside FE's pool | sourced |
| FGA, FTA | Fantasy Edge printed page | — (opt-in estimate, below) | sourced |
| FGM, FTM | FG% × FGA, FT% × FTA | — | **derived** (inputs are rounded) |
| GP, MIN | ESPN projection | unknown → never 0 or 82 | **supplemental** on FE lines (labelled) |
| ESPN ADP | ESPN Live Draft Trends `AVG PICK` (snake) | FantasyPros "ESPN" column (integer ordinal, badged †) only when ESPN has no row | sourced |
| ESPN rank, 7-day trend, salary, %ROST | ESPN Live Draft Trends | — | sourced, separate fields (not ADP) |
| Yahoo ADP, average ADP | FantasyPros ADP | — | stored separately; **never** used as ESPN ADP |
| Fantasy Edge ADP | Fantasy Edge printed page | — | stored; platform not stated by the source |
| Expert rank, best/worst, average expert rank, SD | FantasyPros ECR | — | rankings, **not** ADP |
| 9-cat source rank and value | Fantasy Edge | — | kept apart from 9dub's ranks |
| Team, positions, status at capture | ESPN | FE / FantasyPros values kept per source | sourced |
| Prior-season actuals | ESPN "<year> STATISTICS" rows | — | reference only, **never a projection** |

**Alternate profile.**
- *Settings → Valuation → Projection source → ESPN projection* values ESPN's own counting stats and percentages.
- ESPN publishes no attempts, so FE attempts are used as a **cross-source volume proxy**, marked "x-src".
- Profiles are never averaged together.

**Opt-in estimate** (*Estimate missing FGA/FTA*, off by default).
- For lines with FG%/FT% but no attempts, attempts come from the points identity PTS = 2·FG%·FGA + 3PM + FT%·FTA.
- It uses the median FTA/FGA of the FE pool for the player's position group.
- On FE's own players this reproduces FGA within ~5% on average; FTA is rougher (~0.7/game).
- Estimated values are marked "est." and are never presented as projections.

**ESPN AVG PICK ceiling.** ESPN's Live Draft Trends reports about 140 for players rarely drafted. 9dub shows these as "140+" and does not use them as ADP for timing.

**In the app**, *Player sheet → Sources & market* shows every source's own line side by side, plus where each field came from.

### Players without full data

| Kind | How the app treats it |
|---|---|
| Complete 9-cat (counting + FGA + FTA) | valued and recommended |
| Projection without attempts (e.g. ESPN's) | valued on 7 categories, badged "≈ partial", ranked after every complete player, excluded from recommendations |
| Directory-only (ranks/ADP only) | searchable and draftable so the board stays accurate; not valued; rostered slots count at replacement level |

The ingest audit gives the counts for your files.

### Refreshing the data

1. Replace or add files in `Fantasy Draft Data/`. Old versions can stay; duplicates are detected.
2. Run `npm run data:ingest`. Check the console summary and `.local-data/audit/REAL_DATA_AUDIT.md`.
3. With the app running (`npm run dev` or `npm run preview`), a banner offers the new snapshot. Or use *Settings & Data → Data & imports → Local real-data snapshots → Activate*.
4. Activating:
   - takes an automatic backup (*Settings → Session & backups*);
   - re-links any changed player ids in your draft, undo history, shortlist and overrides by name, and reports anything it could not match.
5. Roll back by activating the previous snapshot (*Snapshots*) or restoring a backup.

### What ships vs what stays local

| File | Contents | Tracked in git? |
|---|---|---|
| `public/data/demo-*.json`, `manifest.json`, `template-projections.csv` | fictional demo pool, bundled index, import template | yes |
| `Fantasy Draft Data/**` | your source files | **no** (git-ignored; Vite refuses to serve it) |
| `.local-data/**` | reconciled snapshot, history, audit | **no** (git-ignored; served only via `/local-data/*.json` by the dev/preview server) |
| `backups/**` | reserved for local backups | **no** |
| `.local-data/nba-schedule-<season>.json` | NBA schedule built from the official "Schedule By Date" PDF you downloaded (`npm run data:schedule`) | **no** |
| `.local-data/league-<season>.json` | optional: your league's matchup schedule (team and manager names), if you keep one by hand | **no** |
| `.local-data/espn/` | your ESPN cookies (`auth.json`, owner-only) and the last sync's cache | **no** |
| `.local-data/session-latest.json`, `session-backups/` | your session (draft, rosters, matchups, settings), mirrored by the dev server for restore | **no** |

About the demo pool:

- It is fictional: archetype-based players with realistic category correlations and a few deliberately missing fields.
- It loads only when no local snapshot is available, or when you choose it.
- It is labelled fictional throughout.

## Sources investigated (research performed 2026-10-16)

Fewer than 10 polite requests were made per site, and only to read robots.txt, terms, and the visible page format. No authentication, paywall, bot challenge or private endpoint was touched.

### Hashtag Basketball — projections

URL: <https://hashtagbasketball.com/fantasy-basketball-projections>

- **robots.txt:** only SemrushBot is blocked; the path is allowed.
- **Terms** (<https://hashtagbasketball.com/terms-conditions>): no scraping clause. However: *"Redistribution or republication of any part of this site or its content is prohibited … without the express written consent of the Company."*
- **Access:** free users see the **top 30 only**; the full list needs a paid Patreon tier. The page is an ASP.NET postback form with no export or API.
- **Observed on the page:** "2026-27 Rest of Season Projections", "Updated: 16 October 2026", per-game, H2H.
- **Header:**

  ```
  R# | PLAYER | ADP | POS | TEAM | GP | MPG | FG% | FT% | 3PM | PTS | TREB | AST | STL | BLK | TO | TOTAL
  ```
- **Cell formats:**
  - FG%/FT% cells look like `0.573 (10.5/18.3)` — percentage plus makes/attempts per game.
  - The name cell holds both a full and a short name (raw text "Nikola JokicN.Jokic").
  - Team codes are HB's own (GS, NO, NY, PHO, SA…).
  - The TOTAL column uses HB's own turnover weight.
- **9dub support:** the paste importer recognises this layout (`hashtag-projections` preset):
  - parses `pct (m/a)` cells into makes/attempts;
  - cleans doubled names and re-joins copy line breaks;
  - drops repeated header rows;
  - maps R# → *source 9-cat rank* and ADP → *other ADP* (labelled "Hashtag ADP", **not** ESPN ADP);
  - ignores TOTAL except as a raw field.
- **Not verified:** exactly what a browser copy of the table produces. The parser handles the variants seen in raw HTML.

### Hashtag Basketball — ADP

URL: <https://hashtagbasketball.com/fantasy-basketball-adp>

- Free; 422 players; "Updated: 16 October 2026"; no export.
- Two-row header: `NAME | TEAM | YAHOO(POS, ADP, ORDER) | ESPN(POS, ADP, ORDER) | FANTRAX(POS, ADP, ORDER) | BLEND(ADP, ORDER)`.
- **9dub support:** `hashtag-adp` preset. ESPN ADP → `espnAdp`; BLEND ADP → `otherAdp` ("HB blended ADP"). Use **Merge into current** mode so ADP attaches to the existing projection rows by name.

### ESPN fantasy basketball projections

URL: <https://fantasy.espn.com/basketball/players/projections>

- **Terms** (<https://disneytermsofuse.com/english/>, §2.B(x)): users may not *"access, monitor, copy or extract the Disney Products using a robot, spider, script, or other automated means, including … data mining or web scraping."* **Automated access is prohibited.**
- **robots.txt:** `www.espn.com` blocks AI user agents site-wide; the fantasy API host returns 403 for robots.txt.
- **Rendering and access:** the page is client-rendered JS. No official public API or export was found. Unofficial community APIs exist; 9dub uses one only for the league sync below, never for projections.
- **Verified (2026-10-17 prints):** ESPN's Full Projections view shows GP, MIN, FG%, FT%, 3PM, REB, AST, A/TO, STL, BLK, TO and PTS, with **no FGA/FTA**. Each player has a `<year> PROJECTIONS` row and a `<year − 1> STATISTICS` row.
- **9dub support:**
  - You print or save the pages you can see as PDFs. The ingest reads them locally; there is no automated access.
  - Pasting a copied table also works (generic preset with column mapping).
  - ESPN Live Draft Trends PDFs supply ESPN ADP.

### FantasyPros

- **Free page:** ~264 players, **season totals**, no FGA/FTA. Header: `Player | PTS | REB | AST | BLK | STL | FG% | FT% | 3PM | GP | MIN | TO`.
- **CSV export:** requires sign-in.
- **Terms:** *"Except for a single copy made for personal use only, you may not copy, reproduce …"*.
- **robots.txt:** allows `/nba/projections/` but blocks `/api/`.
- **Official API:** exists (<https://www.fantasypros.com/api-data/>, `x-api-key`). The free key is "sample data, non-production"; personal-use production keys come with a paid tier.
- **9dub support:** the `fantasypros` preset handles `Name (TEAM - POS)` cells and comma numbers, converts totals → per game (÷ GP), and flags FG%/FT% *without volume*. Those players' FG/FT impact is shown as unknown, not zero.
- **Not built:** an API adapter, because the response schema could not be verified without a key.

### Basketball-Reference (2025–26 actuals)

- **Data-use policy:** *"you should not create websites or tools based on data you scrape from Sports Reference … without our permission."* No API.
- **Format:** per-game tables include FG, FGA, FT and FTA. You can export CSV from the browser.
- **9dub support:** `bbref` preset. It labels the season **"<previous season> actuals"** so prior-season stats are never mistaken for projections.

### Basketball Monster

- Projections are members-only (logged-out visitors are redirected).
- Terms and export were not verified.

## ESPN league sync (read-only)

Opt-in, for your own league. **Before turning it on, know that ESPN's terms (§2.B(x) above) prohibit automated access, and that the API is unofficial and can change or stop working without notice.** Using it is your decision.

- **What it reads:** your league from ESPN's fantasy read API (`lm-api-reads.fantasy.espn.com`, views `mTeam`, `mRoster`, `mSettings`, `mMatchup`, `mDraftDetail`), the NBA team list with game start times (`proTeamSchedules_wl`, cached a day), your league list (`fan.api.espn.com`) to find or choose the league, and, during first-time setup only, the names of drafted players no longer on a roster (`kona_player_info`).
- **Read-only by construction:** `scripts/espn.ts` sends only GET requests and refuses any URL outside the two read hosts before a request is made (unit-tested). No code path writes to ESPN: no trades, adds, drops or lineup changes.
- **Credentials:** your `SWID` and `espn_s2` cookies are in `.local-data/espn/auth.json` (git-ignored, owner-only permissions). Only the local dev server reads them. They are never sent to the page or saved in the session. `espn_s2` is a full ESPN login session, so treat the file like a password. Logging out of ESPN in the browser should end that session; paste fresh values in Settings → League → ESPN league afterwards.
- **First-time setup** (an empty draft): league size, rounds and lineup slots, your team (the one your cookies' account owns), team names, the draft (matched to your player list by name; drafted players it lacks are added without a projection), the matchup weeks and opponents, and the NBA schedule when none is loaded.
- **What each sync updates:** team names; rosters (adds, drops and trades become roster moves noted "ESPN"); IR (players in ESPN's IR slots are marked out with the note "ESPN IR"; marks you set yourself are left alone); matchup opponents; each rostered player's current NBA team and position eligibility; ESPN injury designations; the current week's category totals, which the matchup projection adds to a projection of the games not yet started; the final line of every regular-season matchup ESPN has scored (categories won, totals, ESPN's call per category); and the standings (category record and place, from `mTeam`).
- **When:** on app start when the last sync is over 10 minutes old, every 15 minutes while the tab is visible, and with the refresh button in the top bar. The local server answers at most one sync every 30 seconds.
- **Off switch:** `NINEDUB_ESPN=off` (the end-to-end tests set it; they never contact ESPN).

## Other ways in (single tables)

- **Paste or upload** a table in *Settings & Data → Import projections or ADP*. This works for a Hashtag subscription view, an ESPN list you copied, or a FantasyPros export.
  - **Replace** creates a new snapshot.
  - **Merge into current** attaches fields, such as a newer ESPN ADP, by name. An ESPN ADP merged this way takes precedence over the snapshot's capture.
- **One file from the command line**, written to the private folder:

```bash
npm run data:build -- --in ~/Downloads/projections.tsv --source "Hashtag Basketball projections (my paste)" \
  --url https://hashtagbasketball.com/fantasy-basketball-projections --season 2026-27 --retrieved 2026-10-16 \
  --merge-adp ~/Downloads/adp.tsv            # → .local-data/2026-27-import.json (private)
```

Only write to `public/data/` (`--out public/data/…`) for data you have the right to redistribute. Everything there is bundled into the build.

## Provenance tracked per snapshot

- **Snapshot level:**
  - `sources[]`: name, URL, capture date, fields supplied, notes;
  - `sourceUpdatedAt`, `parentId` (rollback lineage), `kind` (demo, import, bundled or local);
  - `profiles[]`: the alternate projection profiles available.
- **Record level** (schema v2):
  - `projection`: the default line, with `profile`, `gpSource`, `espnAdpSource` and `completenessFlags`;
  - `profiles`: each source's own line, with per-field origin (sourced, derived, cross-source, estimated, supplemental, missing);
  - `priorSeason`: actuals for reference;
  - `market`: ESPN live block, FantasyPros platform ADPs, Fantasy Edge ADP;
  - `rankings`: Fantasy Edge, FantasyPros ECR, ESPN list order;
  - `provenance`: files, team and positions by source, status as captured, notes and warnings;
  - `volumeEstimate`: the opt-in estimate.
- **Separate fields:** ESPN ADP, other ADPs, expert ranks, source 9-cat rank and 9dub's computed ranks are never interchanged.

## Licensing note for any public release

Publicly displayed projections are copyrighted compilations, and several sources explicitly prohibit republication. A public 9dub would need either:

- licensed data (e.g. a FantasyPros API production licence or a similar commercial feed), or
- a strictly bring-your-own-data model where each user imports what they are entitled to use.

The current local-first design is the latter.
