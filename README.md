# 9dub

**A draft and season assistant for head-to-head 9-category fantasy basketball.**

9dub tracks every pick in your draft, explains each recommendation, and projects your weekly matchups category by category from real game counts and daily lineups. It runs entirely on your computer, with no account and no server.

It's built for H2H each-category leagues: FG%, FT%, 3PM, PTS, REB, AST, STL, BLK and TO.

## Features

- **Live draft.** Record every team's picks from the keyboard as they happen. Undo anything, fix mistakes, and keep going even if you fall behind.
- **Recommendations you can follow.** Three lanes (best decision, best overall, best fit) with plain-language reasons. The valuation is transparent: FG% and FT% are weighted by shooting volume, and turnovers count against you.
- **Build analysis.** See where your team stands in each category, test punt builds, and compare players before you take them.
- **League overview.** Every roster as team cards or a teams × categories heatmap.
- **Season matchups.** Weekly projections, both teams' games day by day, which categories to chase or let go, a waiver wire ranked by games and the categories you're after, and a trade lab.

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
git clone https://github.com/nTony46/9dub.git
cd 9dub
npm install
npm run dev        # opens at http://localhost:5199
```

The first launch opens a short setup page.

- **Try it with demo data.** A fictional player pool loads by default, so you can try a draft right away.
- **Use your own projections.** 9dub ships no real player data. Import projections you're entitled to use as a CSV or a pasted table in *Settings & Data → Data & imports*. A [template](public/data/template-projections.csv) is included.
- **Connect ESPN (optional).** Paste your ESPN sign-in cookies and pick your league. One read imports the settings, lineup, draft, rosters, schedule and standings, and later syncs keep them current. It needs your own projections, because ESPN's players are matched to your list by name. You can also skip ESPN and set up the league by hand.

To start the app by typing `9dub` in any terminal, run this once:

```bash
ln -s "$PWD/bin/9dub" ~/.local/bin/9dub   # any folder on your PATH works
```

## Your data stays local

- Your session is stored in your browser, with a backup copy in `.local-data/` while the dev server runs.
- `Fantasy Draft Data/` (your source files) and `.local-data/` are git-ignored and never bundled into a build. The local server refuses direct requests for them.
- Projections and rankings from third parties are usually licensed for personal use only. Don't commit them or publish a build that contains them.

## ESPN sync

> [!IMPORTANT]
> **Unofficial and read-only.** 9dub is not affiliated with or endorsed by ESPN, the NBA or any data provider. The sync uses ESPN's unofficial API with your own cookies. ESPN's terms of use prohibit automated access, so turning it on is your decision and your responsibility.

- **It only reads.** It sends only GET requests to ESPN's read-only API addresses. Nothing in 9dub can make trades, adds, drops or lineup changes.
- **Your cookies stay on your computer.** `SWID` and `espn_s2` are saved in `.local-data/espn/auth.json` (git-ignored, readable only by you). They're never sent to the page. `espn_s2` is a full ESPN login session, so treat that file like a password.
- **The API can change or stop working without notice.**

See [what the sync reads and updates](docs/DATA_SOURCES.md#espn-league-sync-read-only).

## Documentation

| Guide | Covers |
|---|---|
| [User guide](docs/USER_GUIDE.md) | Drafting, the season pages, shortcuts, backups, limitations |
| [Data sources](docs/DATA_SOURCES.md) | Importing projections, combining several exports, the ESPN sync in detail |
| [Scoring method](docs/SCORING_METHOD.md) | The valuation math, with worked examples |
| [Development](docs/DEVELOPMENT.md) | Commands, tests, project layout, design decisions |

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · Dexie (IndexedDB) · Zod · Radix UI · Vitest · Playwright

## Notes

- **Projections are only as good as what you import.** Weekly matchups are projected from season-long per-game lines.
- **No made-up odds.** 9dub doesn't show win or pick-survival probabilities, because there's no model and data that could calibrate them.
- **ESPN is the only league sync.** Leagues on other platforms can be set up and kept current by hand.
- **One tab at a time.** Two tabs editing at once overwrite each other's autosave.

More in [Limitations](docs/USER_GUIDE.md#limitations).

## License

[MIT](LICENSE). The license covers 9dub's code, not any data you import or read from ESPN or other providers.
