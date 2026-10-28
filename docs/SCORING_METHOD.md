# 9dub scoring method

This documents exactly what the engine in `src/analytics/` computes. Every number shown in the UI traces to a function here, and most have unit tests in `tests/unit/`. Nothing is a learned or AI-generated score.

Notation: *c* is a category (FG, FT, 3PM, PTS, REB, AST, STL, BLK, TO), *R* is roster size (= draft rounds), *T* is the number of teams.

---

## 1. Inputs and units

- Every projection is stored **per game** (`src/data/schema.ts`). Season-total imports are divided by GP at import time and flagged `unit-converted-from-totals`. The raw source cells are kept on the record.
- Shooting volume is optional. `null` always means "not supplied" and is never coerced to 0.
  - FGM is derived as FG% × FGA **only when FGA is supplied** (flagged `derived-fgm`).
  - Attempts are never derived from a percentage alone.
- Manual overrides (player sheet → *Manual override*) replace individual per-game fields before valuation. The source values are kept.
- **Projection profiles** (`src/data/engineAdapter.ts`). A dataset can carry several sources' lines per player, for example Fantasy Edge (default) and ESPN.
  - The engine values exactly one line per player: the default, or the profile chosen in *Settings → Valuation*. Lines are never averaged.
  - A chosen profile without attempts borrows them from another profile of the same player; this is marked `cross-source`.
  - The opt-in *Estimate missing FGA/FTA* fills attempts from the points identity (§3); this is marked `estimated`.
  - Players with no line at all are "directory" entries: searchable and draftable, never valued.

## 2. Reference pool (frozen per dataset)

`computeReferenceParams` (`valuation.ts`) iterates:

1. Value everyone against the whole dataset.
2. Take the top *N* by total z (default *N* = 200, configurable; ties broken by id). Players whose nine categories are all computable come first, so partial lines never enter the pool while complete players remain.
3. Recompute the baselines, means and SDs on that pool.
4. Repeat until pool membership stops changing (max 8 iterations; usually 3).

The pool depends only on the dataset, overrides and settings, **never on draft status**. Drafting a player cannot move anyone's value or rank. There is a test for this ("draft state never moves player values").

The SD is the **population** SD (divide by *n*), because the pool is the population we normalise against. A degenerate SD of 0 is replaced by 1.

## 3. Player category values

| Category | Raw value used | z-score |
|---|---|---|
| 3PM, PTS, REB, AST, STL, BLK | per-game stat | (x − μ) / σ |
| TO | per-game turnovers | **(μ − x) / σ** (inverted: fewer is better) |
| FG | **impact** = FGM − b_FG · FGA | (impact − μ) / σ |
| FT | **impact** = FTM − b_FT · FTA | (impact − μ) / σ |

The baseline b_FG = ΣFGM / ΣFGA over the pool, an attempt-weighted rate (not a mean of percentages). By construction the pool's mean impact is ≈ 0.

Impact makes FG%/FT% volume-aware:

- A 60% shooter on 2 FGA barely moves a team.
- A 55% shooter on 15 FGA does.
- A 40% shooter on 20 FGA hurts much more than one on 2 FGA.

All three cases are covered in `valuation.test.ts`.

**Missing volume.** If FGA (or FTA) is absent:

- That category's z is `null` and the player is flagged.
- The total sums the categories that exist, shown as `≈` beside the rank and "7/9 cats — partial" in the preview.
- It is never treated as zero attempts. Team FG% excludes such players and reports how many were excluded.
- A partial total implicitly scores the missing categories as average, which flatters poor shooters. So:
  - **every ranking and the recommendation lanes put complete players first**;
  - partial lines are kept out of the Decision and Fit lanes while any complete player is available.

**Optional volume estimate** (off by default; *Settings → Valuation*):

```
PTS = 2·FGM + 3PM + FTM,  FGM = FG%·FGA,  FTM = FT%·FTA,  FTA = r·FGA
⇒ FGA = (PTS − 3PM) / (2·FG% + r·FT%)
```

- *r* is the median FTA/FGA of the Fantasy Edge pool for the player's position group (C ≈ 0.35, F ≈ 0.26, G ≈ 0.25).
- Re-estimating FE's own 200 players gives FGA mean absolute error ≈ 5% and FTA ≈ 0.7/game.
- It is a labelled proxy for ranking deep players, not a projection.

**Hand-worked example** (three-player pool, from `tests/unit/valuation.test.ts`):

```
        PTS  TO   FGM/FGA          FTM/FTA
  A     20   2    8 / 16   (50%)   4.0 / 5 (80%)
  B     10   1    4.5 / 7.5 (60%)  1.0 / 2 (50%)
  C     15   3    5.5 / 13.75 (40%) 2.7 / 3 (90%)

FG baseline = 18 / 37.25 = 0.483221     (a mean of % would be 0.500)
impacts     A +0.268456   B +0.875839   C −1.144295   (sum 0)
SD          sqrt((0.0720687 + 0.7670937 + 1.3094117)/3) = 0.846281
z_FG        A +0.31722    B +1.03493    C −1.35215
z_TO        A 0           B +1.22474    C −1.22474   (B has the fewest TO)
```

## 4. Totals, per-game vs GP-aware

- **Per-game value** = Σ_c z_c, ranked over the whole dataset. This is "rank" in the UI.
- **GP-aware value** blends each category with replacement level for the games a player is projected to miss:

  ```
  a      = min(GP, G) / G            (G = full-season games, default 82)
  gpZ_c  = a · z_c + (1 − a) · r_c   (r = replacement-level z, §5)
  ```

  Missed games are filled by a replacement-level player rather than by zeros. A star missing 20 games loses more than a fringe player missing 20, and nobody's value is simply multiplied by GP.
- Both rankings are always shown. The *Valuation basis* setting chooses which one drives recommendations and team totals.
- In GP-aware mode, team stat lines are blended the same way (`effectiveLine`), so units never mix.
- If GP is unknown, the per-game value is used and flagged (a "?" next to the GP-aware rank). Unknown GP is never treated as 0 or 82.
- In the real-data snapshot, GP comes from ESPN's 2027 projection, attached to Fantasy Edge lines as a labelled supplemental field.

## 5. Replacement level

Replacement level is the mean z (and mean stat line) of the *T* players ranked just after every roster spot is filled: ranks *T·R*+1 … *T·R*+*T* by per-game value. It is used for:

- value over replacement (VORP),
- open roster slots,
- GP-aware blending.

## 6. Team aggregation (`team.ts`)

- **Counting stats** are sums of per-game lines.
- **Team FG% = ΣFGM / ΣFGA** and **FT% = ΣFTM / ΣFTA**, over players with volume. This is never an average of player percentages (tested with 1/2 vs 10/25 shooters).
- **Category score** = Σ player z_c. This is exactly right for percentages too: Σ impact_i = ΣFGA · (team FG% − b), so the summed z is proportional to volume × efficiency above baseline.

Ways to compare teams with **unequal pick counts**:

| Basis | What it is | Use |
|---|---|---|
| Current roster | raw sums | Labelled as *not* comparable across counts |
| Per player | sum ÷ rostered players | Average quality |
| Replacement-filled | open slots at replacement level | Conservative floor; teams with fewer picks look weaker |
| **Pick-adjusted** (League default) | actual picks + the *expected* value at each unmade pick, from a ±6-pick window of the value-ordered board (`pickValueCurve`) | Stage-fair; a neutral placeholder, **not** a forecast |

- Confidence labels come from picks made: **low** under max(3, 0.3R), **medium** under 0.65R, otherwise **higher**.
- An **end-of-draft projection is deliberately omitted**. 9dub does not model what other managers will take.

## 7. League scale and "typical team"

Over the drafted band (top *T·R* players):

- σ_c = √R · sd_c is the **construction scale** for team-level differences. It is used in σ units for bars and colours and as the Φ scale below.
- **Typical team after k picks** = Σ_{j≤k} (mean z of round band j) + (R − k) · r_c. This keeps comparisons stage-matched. Comparing a 3-player roster with a finished one would be meaningless.

## 8. Category-edge utility (diminishing returns)

```
edge_c(s) = mean over opponents o of Φ((s_c − o_c) / σ_c)
U(s)      = Σ_c w_c · edge_c(s)
```

- *s* is the slot-adjusted strength. Opponents are the actual league teams, or a typical team at the same stage before any are known.
- Φ saturates, so extra strength in a category you already dominate adds little, and gains are largest where the league is contested.
- **This is a construction index, not a win probability.** The UI shows it as "category edges" with that caveat. It never shows percentages.

**Scarcity.** Supply_c is Σ max(0, z_c) over the top max(24, 2T) available players. The multiplier is √(mean supply / supply_c), clamped to [0.8, 1.25], and multiplies w_c. Scarce categories (often AST, STL) are nudged up, plentiful ones down.

## 9. Recommendations (`recommend.ts`)

For every available player x:

| Component | Definition |
|---|---|
| **Quality** | basis total; VORP = total − replacement total |
| **Fit** | ΔU when x replaces one replacement-level open slot (Δ_c = z_c − r_c) |
| **Urgency** (timing) | logistic((followingPick − ADP) / (2 + 0.08·ADP)) — heuristic, see §11 |
| **Gone-before** | the same, evaluated at my next pick (when I am not on the clock) |

Normalisation is relative to the best player plausibly available at my pick (gone-before < 0.7):

- q = VORP / VORP_ref, clamped to [−0.5, 1]
- f = fit / fit_max, clamped to [−0.5, 1]
- t = urgency

```
decision = (w_q·q + w_f·f + w_t·t) · (1 − 0.6 · goneBefore)
```

**Blend weights.** Starting from a 55/30/15 heuristic and stress-tested:

| Mode | Quality | Fit | Timing |
|---|---|---|---|
| Adaptive, rounds 1–3 | .75 | .10 | .15 |
| Adaptive, rounds 4–6 | .55 | .30 | .15 |
| Adaptive, rounds 7–10 | .45 | .35 | .20 |
| Adaptive, rounds 11+ | .40 | .40 | .20 |
| Best Player Available | .85 | 0 | .15 |
| Team Fit | .35 | .55 | .10 |
| Optimize Selected Build | .45 | .40 | .15 |

Without draft timing (slot unknown), q and f are renormalised.

**Quality floors** (guardrail against the "bench-specialist trap"):

- Decision lane: VORP ≥ VORP_ref − max(1.5, 0.35·|VORP_ref|)
- Fit lane: VORP ≥ VORP_ref − max(2.0, 0.5·|VORP_ref|)

Fit can reorder closely valued players but cannot promote a waiver-level specialist over a clearly better player. Players excluded by the floor are listed as context in the comparison note, not recommended.

**Complete lines only.**
- Players missing FG/FT volume rank after every complete player in Best Overall.
- They are not eligible for the Decision or Fit lanes while complete players are available. The live draft passes only complete players to the lanes and build simulation.

**Lineup feasibility guard.**
- This uses ESPN's default slots (§13).
- Once *picks left ≤ open position-specific starter slots*, every remaining pick must fill one of them.
- A candidate who fills none is kept out of the Decision and Fit lanes.
- Its explanation says so: "Can't fill an open starter slot (PG, SG) and you have only 3 picks left".
- Before that point positions do not constrain recommendations. Category needs already steer away from stacking one position.

**Three lanes:**

- **Best Overall** = quality only.
- **Best Team Fit** = fit, within the fit floor.
- **Best Draft Decision** = the blend above, within the decision floor.

**Locked builds:**

- Change only the category weights used for fit: hard punt → 0, soft punt → 0.35 (configurable).
- **Never** change quality. This is tested.

**Explanations** (`explainCandidate`, `compareForFit`) are deterministic templates filled from these numbers. An example: *"A offers +3.1 more 9-cat value than B. B would add more REB, but that gain is comparatively replaceable (9 similar sources among the top 36 available)…"*

**Stress tests** (`tests/unit/recommend.test.ts`):

- A Trey-Murphy-like wing vs. a rebound-only specialist on a guard-heavy roster: the wing wins in Adaptive *and* Team Fit modes, and the specialist is below the floor.
- Two near-equal wings: the one that fills the weak category wins.
- Round 1: the top decision is a top-3 value.

## 10. Builds (`builds.ts`)

**Candidates:**

- Balanced.
- All nine single punts.
- Double punts only for category pairs whose z-scores correlate positively in the reference pool (r ≥ 0.15, top 8). Players weak in one tend to be weak in the other, so sacrificing both concentrates value (e.g. REB+BLK, FG%+REB, FT%+3PM, AST+STL).
- Once ≥ 4 picks are made, the roster's own two weakest categories are added.
- No triple punts.

**Simulation** (per build, deterministic):

- Opponents take players in ADP order (value rank when ADP is missing).
- At each of my remaining picks I take the player with the largest weighted gain in category edges against a *stage-matched* typical team.
- A pure best-player-available simulation provides the opportunity-cost baseline.

**Reported metrics:**

- Categories ahead of a typical finished team.
- Expected "edges" Σ Φ(margin).
- Change vs. balanced.
- Opportunity cost (raw value given up vs. best-player-available).
- Value already *wasted* in punted categories, and the existing deficit a punt *aligns* with.
- Relative thin spots, and the top targets at my next pick.

**Viability is relative to balanced**, because the absolute edge count inherits optimism from the simulation's opponent model:

| Label | Rule |
|---|---|
| unlikely | fewer than 5 categories ahead (whatever the relative score) |
| strong | ≥ +0.2 vs balanced |
| viable | ≥ −0.25 vs balanced |
| fragile | otherwise, or when the build abandons > 1.5 z already drafted in its punted categories |

Builds are sorted by tier, then by edges, then by compatibility.

**Confidence** follows the stage labels; at ≤ 2 picks the lab says "Exploratory only". **Nothing is ever locked automatically.**

## 11. Pick timing

ADP is a single point estimate, so 9dub does **not** compute survival probabilities. The logistic urgency in §9 is used only:

- internally, for ordering;
- as coarse labels: *Likely gone* (≥ 0.7), *At risk* (≥ 0.4), *Likely there*.

These are always marked as a heuristic. "±ADP" is simply current pick − ADP.

**Partial logs.** If earlier picks were not recorded, the undrafted players most likely taken in those gaps are flagged *possibly taken* rather than shown as safely available. That is the top ⌈1.5 × gaps⌉ by ADP with ADP < current pick + 6. They stay available — only a recorded pick removes a player.

**Which ADP.** Timing uses ESPN ADP only:
- ESPN Live Draft Trends `AVG PICK` (snake), or a user-merged ESPN ADP;
- else the FantasyPros-republished ESPN ordinal (badged †).

Exclusions:
- AVG PICK values at ESPN's ≈140 ceiling (≥ 139.5) mean "rarely drafted" and are not used.
- Yahoo, blended and Fantasy Edge ADPs are shown but never used for timing.
- ESPN's numbers come from its own public drafts; ESPN doesn't publish the league sizes behind them. 9dub compares AVG PICK directly to your pick number without rescaling, so treat it as relative order around your pick, not exact 12-team pick numbers.

## 12. Category readout (`readout.ts`)

The margin is in σ units vs. the league average of the actual teams.

| Margin | Label |
|---|---|
| ≥ 0.6 | strength |
| ≥ 0.2 | solid |
| > −0.2 | neutral |
| below that | weak · recoverable |

A weak category becomes a **punt candidate** only when all of these hold:

- at least 4 picks are made;
- the margin is ≤ −0.6;
- a viable top-3 build punts it, **or** the deficit is ≤ −1.5σ late in the draft (effectively sacrificed by construction).

## 13. Positions

- ESPN's default slots are PG, SG, SF, PF, C, G, F, UTIL×3 and BE×3. A maximum bipartite matching fills them.
- Real-data positions are ESPN's eligibility (Fantasy Edge and FantasyPros tags are kept per source).
- 9dub **warns** about unfilled starter positions and guard-/big-heavy rosters. The warning escalates when only as many picks remain as open slots.
- Recommendations apply the feasibility guard in §9.
- Drafting is only blocked when *Enforce roster size* is enabled.

## 14. Weekly matchups (`matchup.ts`)

- **Games:** for each day of the matchup, a player counts only if his NBA team plays that day (the NBA schedule, from ESPN or `npm run data:schedule`). Free agents never count for a team.
- **Players without a projection** (often fresh waiver pickups) still play their games and take lineup seats. They count at a **stand-in line** from their actual ESPN stats (`standIn.ts`), labelled *est.*:
  - minutes per game from this season, with the last 15 days counted twice (a bigger role shows up within a few games) and 3 games of last season's minutes (or a typical player's) so one game can't set a role;
  - per-minute production from this season blended with 300 minutes of last season's rates, or replacement-level rates when last season is too short (under 200 minutes). Makes and attempts blend separately, so FG% and FT% shrink by volume too;
  - no games yet this season: last season's per-game line (10+ games), else replacement level, labelled *repl.*
  
  Stand-ins are used only for weekly matchups and pickups. They are never valued or recommended in the draft tools, and ESPN's own projections are never used.
- **Lineups:** each day is set like ESPN's Quick Lineup. The players with games fill ESPN's 10 starting slots by maximum matching, best 9-cat value first; nobody with a game sits unless every slot he fits is taken. Anyone left over is **benched** for that day, and the benched games are shown.
- **Open seats and streaming:** each day's open seats are the starting slots nobody with a game fills. A probe player of each position, added last, shows which positions would add a start (when only the C slot is open, only a C helps). Team suggestions count each NBA team's games on open nights from today on, rank teams by nights where any position starts, and flag consecutive open nights they cover (back-to-backs). There are no player picks; the manager chooses by category need.
- **Displayed lineup:** each player has a usual slot (the best lineup by 9-cat value). Every day the players who start keep their usual slot where possible; bench players with a game move into the seats of starters without one, taking an empty seat before anyone is reshuffled. Players without a game only fill seats that are still empty, their own slot first. This changes only where players are shown, never who counts.
- **Injuries:** a player marked out contributes nothing through his *until* date (or indefinitely) and is listed in an IR slot when one is free.
- **Trade lab:** gives leave and gets arrive. When all incoming players come from one team, the gives go to that team, so its matchups change too; otherwise (pickups) the gives are dropped. This week and every remaining week are re-projected.
- **Totals:** per-game line × started games. FG% and FT% are total makes ÷ total attempts. *Expect missed games* optionally scales each game by projected GP ÷ 82.
- **Live totals:** for the week in progress, ESPN's category totals so far are added to a projection of only the games that haven't tipped off (from the sync's day on, minus teams whose game had started). Makes and attempts are summed, so FG% and FT% combine correctly.
- **Spread:** the final margin's uncertainty comes only from what is still to be played.
  - Counting categories are sums of independent rare events (Poisson), so a total's variance equals its mean.
  - Points are a weighted sum of made 2s, 3s and free throws (compound Poisson): variance = 4·2PM + 9·3PM + 1·FTM, about 2.3× the points total.
  - FG% and FT% use the binomial spread of the remaining attempts as a share of the week's attempts.
  - Minutes, rest days and injuries add more swing than this, so the bands are, if anything, too sure.
- **Outlook:** margin ÷ spread (z). |z| < 0.5 is a *toss-up*; 0.5–1.5 is *ahead*/*behind*; beyond 1.5 is *safe*/*far behind*. These are labels, not win probabilities.
- **Share (internal):** Φ(z), the model share of the category (ties count half; the margin is treated as normal, following the normal approximation of weekly category margins in [Rosenof 2023](https://arxiv.org/abs/2307.02188)). It ranks options and is never displayed: it has not been checked against real results.
- **Chase or let go** (H2H each category, so every category won counts and a move is worth its change in expected categories won, Σ shares):
  - Every free agent (on no roster as of the last ESPN sync, not marked out) is tried for the rest of the week in place of the player you'd drop. The default drop is your lowest-value active player; you can pick another. The remaining days are re-projected with the daily lineup engine, so a pickup only counts on nights he'd actually start, and the drop's remaining games are lost.
  - A category you're not winning is **Chase** when the best single pickup lifts its share by at least 0.15, and **Let go** when you're behind and none does. Toss-ups with no strong pickup and categories you lead get no verdict.
  - **Pickups this week** lists the top three by the change in expected categories won that move at least one category's outlook up, with the outlook changes (↑/↓) they cause. *Try* loads the pickup and the drop into the trade lab.
  - Limits: the free-agent pool is only as fresh as the last sync; players dropped in the last day may still be on waivers; the league's add limit is not modelled.
- **Flip hints:** for FG% and FT%, the extra makes needed on the same attempts.
- **Unscheduled games:** the PDF lists 80 games per team, so 30 games come later (NBA Cup knockout games and games for teams that don't advance). 9dub finds the Nov–Dec stretch with no games listed (2026-27: Dec 4–11) and flags weeks that overlap it. Both sides are undercounted there; 9dub does not guess which teams advance.

## 15. Known approximations

- σ_c treats players as independent and ignores weekly variance. It is a construction scale, not a weekly H2H model.
- The build simulation assumes ADP-ordered opponents. Its absolute numbers are optimistic, which is why labels are relative.
- Single-point ADP gives no real availability probabilities.
- Overrides recompute the reference pool from the edited data (a user edit, not a draft event).

All intermediate values (pool, means/SDs, baselines, replacement band, σ, scarcity, fit weights, blend weights, floors and per-candidate components) are visible in **Settings & Data → Diagnostics**. That page also lists market-relevant players the engine cannot fully value.

## 16. Validation on real data

From `tests/unit/realData.test.ts` and the ingest audit, run on a private 2026–27 snapshot (Fantasy Edge + ESPN, captured 2026-10-17). The suite runs only where such a snapshot exists; no data is in the repository.

- **Agreement with Fantasy Edge:** 9dub's per-game ranking vs Fantasy Edge's published 9-cat order has Spearman **0.997** on the 200 shared players. FE uses the same family of method (per-game z, attempt-weighted FG/FT, inverted TO, top-156 baselines). Differences are baseline and SD choices; the largest gaps are ≈15 ranks.
- **Reference pool:** 156 vs 200 gives identical ordering over the top 200 (Spearman 1.000), so the default stays 200.
- **Quality vs fit:**
  - Trey Murphy III stays in the top 2 of the Decision lane for a guard-heavy, rebound-light roster.
  - Mitchell Robinson, Daniel Gafford and Jusuf Nurkić are below the floor and appear in no lane.
- **Punts:** no punt candidate is ever called after one or two picks.
- **Positions:** guard-heavy rosters get bigs and big-heavy rosters get guards/wings, without position rules. The feasibility guard removes the leftover misfits late.
- **Simulated drafts:** in full 12 × 13 drafts against ESPN-ADP opponents, following the Decision lane yields legal, lineup-feasible rosters ranked in the league's top 4.
- **Calibration:** no weights or floors were retuned for real data; the existing calibration passed.
