# 9dub user guide

How to use 9dub through the draft and the season. For setup, see the [README](../README.md). For where data comes from, see [DATA_SOURCES.md](DATA_SOURCES.md). For the math, see [SCORING_METHOD.md](SCORING_METHOD.md).

- [Setting up](#setting-up)
- [Drafting](#drafting)
- [After the draft](#after-the-draft)
- [Season](#season)
- [Saving and backups](#saving-and-backups)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Limitations](#limitations)

## Setting up

The first launch opens **Set up 9dub**:

1. **Player list.** Import projections in *Settings & Data → Data & imports* (CSV or a pasted table; a [template](../public/data/template-projections.csv) is included). The demo pool has made-up players, so ESPN's rosters can't be matched to it.
2. **ESPN sign-in cookies.** Paste your `SWID` and `espn_s2` cookies (the page shows where to find them). They stay in `.local-data/espn/auth.json` on your computer and are never sent to the page.
3. **Your league.** 9dub lists your ESPN fantasy basketball leagues for the season. Pick one.
4. **Import league.** One read fills in the league size, rounds and lineup slots, your team, team names, the whole draft, rosters and IR, the matchup weeks and opponents, results so far, the standings and the NBA schedule.

**Without ESPN:** choose **Skip, set up by hand**. Then set teams, rounds, team names and your slot in *Settings & Data → League*, and record the draft yourself. When you change your slot, the snake order updates right away. You can also set it from **Your slot** in the Live Draft bar.

## Drafting

**Draft Room** (`1`) is built for keeping up with a live draft:

- Press `/` and type a name. `Enter` records the highlighted player for the team **on the clock**, and the toast offers **Undo**. `⇧Enter` previews the player instead.
- Drafted players sort last and are refused, so you can't draft a player twice without an explicit edit.
- **Corrections:** undo with `u` or `⌘Z` (undo survives a refresh). To edit, reassign or remove a pick, use the pencil on a recent pick or press `b` for the full board. To record a specific pick number or team, use the **Recording** button.
- **Fell behind?** Jump to your own pick and record only yours. 9dub shows **Partial log · N unrecorded**, marks players likely taken in those picks as *possibly taken*, and never treats them as safely available. Fill the gaps later from the left pane.

**The right rail** shows your roster with a nine-cell category strip and a plain-language read ("Big-man lean", "Weak: FT% (recoverable)"). Below it are three recommendation lanes:

- **Best Draft Decision:** quality first, then fit, then timing, with a quality floor.
- **Best Overall**.
- **Best Team Fit**.

Each pick comes with its reasons. The modes are Adaptive (default), Best Player Available, Team Fit and Optimize Selected Build.

**League Overview** (`2`) shows team cards, or in Advanced, a teams × categories heatmap of raw production, category score or rank. By default teams are compared **pick-adjusted**, which is fair when teams have made different numbers of picks.

**My Build** (`3`):

- Category bars with raw totals, FG% as makes/attempts, rank and z-score.
- Each player's shooting-volume impact, and the lineup fill.
- **Build Lab:** balanced, single-punt and correlated double-punt builds, each with viability, confidence, opportunity cost and targets. You can soft-lock or hard-lock a build. Nothing locks automatically.
- **What if I take…:** compare up to three players without drafting them.

## After the draft

After the last pick, *Live Draft* becomes **My League**, the app opens there, and its keys change:

- **League Overview** (`1`): team cards and the heatmap on today's rosters. Each opponent's card links to the week you play them next.
- **My Team** (`2`): category standing, roster, lineup, and **head-to-head by category**, a projection of the week you play each team, in schedule order.
- **Draft Recap** (`3`): the board and pick log. Picks can still be corrected.

The draft-only tools are hidden, and `/` now searches **NBA Players** (`5`).

**ESPN sync.** Connect on the setup page or in *Settings & Data → League → ESPN league*. If you have several leagues, pick one there. The refresh button in the top bar re-reads ESPN. The app also syncs on start-up (if the last sync is over 10 minutes old) and every 15 minutes while the tab is open. A sync updates team names, rosters, IR, injury tags, opponents, live category totals for the current week, final scores and standings. It only ever reads. See [DATA_SOURCES.md](DATA_SOURCES.md#espn-league-sync-read-only) for exactly what it reads.

## Season

**Season** (`4`) uses your **current rosters**: the draft plus any changes since.

### Rosters

- Each team's roster by slot (your league's lineup, e.g. PG … UTIL, BE, IR), like ESPN. Each player has **IR**, **Trade** and **Drop** buttons, and **Add a player** fills an open spot. Each change gets its own **Undo**, and the draft log itself never changes. With ESPN sync on, ESPN's rosters win at the next sync.
- To rename a team, double-click its name or use the pencil.
- **IR** marks a player out, optionally with an *until* date (he counts again the day after). Injured players fill the IR slots (default 2) and don't count toward roster size.

### Matchups

The matchups view needs the NBA schedule. It comes from ESPN at setup, or you can run `npm run data:schedule -- --file <pdf>` on the NBA's schedule PDF. With ESPN connected, the weeks and opponents come from your league. Without it, add weeks by hand.

Each week shows:

- **Projected score** (e.g. 5–4), with each category's totals and a call: *toss-up*, *lean* or *clear*. Weeks ESPN has scored show the **final** score and margins instead.
- **Outlook** per category (safe → far behind), and where you're not winning, **Chase** or **Let go**: whether one free-agent pickup for the rest of the week clearly helps.
- **Pickups this week:** the free agents that move the most categories, with the player you'd drop. *Try* loads one into the trade lab.
- **Week view:** a lineup calendar with one row per slot and one column per day. It shows both teams' games that count, day by day and for the week, plus who plays, who sits on a crowded night, who is out and how many seats stay empty. **Fill the empty seats** ranks NBA teams by how many of your open nights they play, with a back-to-back filter.
- **Day by slot:** both lineups for one day, set automatically like ESPN's Quick Lineup.
- **Trade lab:** give some of your players, get anyone, and see this week's score and your rest-of-season record before and after. **Record in Rosters** turns it into roster moves.
- **Your schedule:** every week's final or projected score, plus your record and place in the standings.

Weeks that overlap the NBA's unscheduled games (the NBA Cup knockout window) are marked *TBD*, and both sides are undercounted there until the NBA schedules those games.

## Saving and backups

- The session lives in this browser's IndexedDB. While the dev server runs, it's also mirrored to `.local-data/session-latest.json`, plus one dated copy per day in `.local-data/session-backups/` (the newest 14 are kept). If the browser's data is cleared, 9dub restores from that file on the next start.
- Browser storage is tied to the port, so the dev server always uses 5199 and refuses to start on another one.
- *Settings & Data → Session & backups* exports the whole session as JSON, optionally with the dataset. Imports are checked and migrated. You can also save and restore draft logs there.
- **The `9dub` command:** `bin/9dub` starts the dev server and opens the app, or just opens it if it's already running. Link it once with `ln -s "$PWD/bin/9dub" ~/.local/bin/9dub` (any folder on your PATH works).

## Keyboard shortcuts

Press `?` in the app for the full list. Shortcuts never fire while you're typing.

| Key | Action |
|---|---|
| `/` or `⌘K` | Player search |
| `Enter` / `⇧Enter` | Draft / preview the highlighted player |
| `u` or `⌘Z` | Undo the last draft change |
| `b` | Full draft board |
| `1`–`6` | Switch pages |

## Limitations

- **Projections are only as good as what you import.** Players whose source has no shooting attempts can't be valued on FG% or FT%, so they're badged *partial*. Deep picks may have no projection at all. In weekly matchups those players count at an estimate from their ESPN stats (*est.*), or at replacement level without them (*repl.*). Their player card shows the numbers used.
- **ESPN ADP** comes from ESPN's public drafts and flattens near pick 140. Treat it as relative order, not exact pick numbers.
- **Injury tags** come from your files or from ESPN at each sync. There is no other injury feed.
- **No probabilities.** There are no H2H win probabilities, ADP survival odds, opponent draft simulation or end-of-draft projections, because there's no model and data that could calibrate them.
- **Weekly matchups** are projected from season-long per-game lines, plus ESPN's totals so far for the current week. Toss-up / lean / clear compares the margin with rough weekly noise. They are not win probabilities.
- **ESPN only.** There's no Yahoo, Sleeper or Fantrax sync, but you can set up other leagues and keep them current by hand. The Season page assumes H2H each-category 9-cat.
- **Week dates** follow ESPN's default calendar. If your league changed its matchup lengths, fix the dates in *Season → Matchups → Edit*.
- **Lineup checks are warnings.** There is no lineup optimizer.
- **The Build Lab** simulation assumes opponents draft in ADP order. Its absolute numbers run optimistic, so viability is shown relative to a balanced build.
- **Player ids come from names** and are re-linked by name when a snapshot changes. Anything that can't be matched uniquely is reported, not guessed.
- **One tab at a time:** two tabs editing at once overwrite each other's autosave.
