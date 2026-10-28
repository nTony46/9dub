# Development

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5199
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 5199 (also runs the local data server and the ESPN sync) |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm run preview` | Serve the build on port 5199. Like the dev server, it serves `.local-data/`. |
| `npm test` | Vitest unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests (first time: `npx playwright install chromium`) |
| `npm run typecheck` / `npm run lint` | TypeScript (strict) / ESLint |
| `npm run check` | Typecheck, lint, unit tests and build |
| `npm run data:ingest` | Reconcile your own exports into a private snapshot ([details](DATA_SOURCES.md#your-own-files-the-local-pipeline)) |
| `npm run data:schedule -- --file <pdf>` | Convert the NBA's "Schedule By Date" PDF to `.local-data/nba-schedule-<season>.json` |
| `npm run data:build -- --in <file>` | Build a snapshot from one CSV/TSV/JSON ([details](DATA_SOURCES.md#other-ways-in-single-tables)) |
| `npm run data:demo` | Regenerate the fictional demo pool in `public/data/` |

## Tests

- **Unit tests** cover the engine, ESPN conversion, ingest parsers, import, the store, and React Testing Library flows. Real-data suites run only when a private snapshot exists in `.local-data/`, and skip otherwise.
- **End-to-end tests** run the demo flows on a server with local data off (port 5299). A full real-data draft runs on port 5298 and skips without a snapshot. Neither server contacts ESPN or writes your saved session.

## Environment switches

| Variable | Effect |
|---|---|
| `NINEDUB_LOCAL_DATA=off` | Don't serve `.local-data/` (the demo pool only) |
| `NINEDUB_SESSION_SAVE=off` | Don't read or write `.local-data/session-latest.json`. Use it for tests and throwaway servers. |
| `NINEDUB_ESPN=off` | Turn off the ESPN sync |

## Project layout

```
src/
  analytics/     pure TypeScript engine: valuation, team, recommend, builds, timing, matchup, streaming, chase
  data/          Zod schemas, normalization, import pipeline, demo generator, NBA schedule, ESPN conversion
  data/ingest/   local source parsers, reconciliation, audit report
  store/         Zustand store, Dexie (IndexedDB) persistence, draft logic, derived selectors, ESPN sync plan
  features/      setup, draft, league, build, season, players, settings
  components/    UI primitives (Radix-based) and domain components
scripts/         localDataPlugin.ts (local data server), espn.ts (read-only ESPN client), data/ (CLI tools)
tests/           unit/ (Vitest + RTL), e2e/ (Playwright), fixtures/
docs/            user guide, data sources, scoring method
```

## Design decisions

- **React 19, TypeScript (strict), Vite, Tailwind v4.** Semantic color tokens (`--arena`, `--chalk`, `--clock`, `--plus`/`--minus`). The app is dark first, with a light mode.
- **Zustand and Dexie** for state and persistence. **Zod** validates every import and every persisted object.
- **Radix** primitives. **TanStack Table** with row virtualization for the player list.
- **Custom SVG/CSS charts** (diverging bars, heatmap, nine-cell strip) instead of a chart library, because they're small, follow the theme and stay fast at 300 rows.
- **The engine is React-free and deterministic,** so its pieces can be replaced without touching the UI. The math is in [SCORING_METHOD.md](SCORING_METHOD.md).
- **Local only.** There are no accounts and no hosted backend. The dev and preview servers serve private files under `.local-data/` only through `scripts/localDataPlugin.ts`, and those files are never bundled into `dist/`.
