# Next-Level AI Handoff

## Read this first

The frozen incumbent is still `champion-2026-08-11`. Do not edit anything under
`scripts/champions/`, and do not copy moving source into a new champion snapshot
without a fresh promotion-sized private holdout and browser proof.

Moving source is currently the unpromoted
`live-challenger-v6-exact-6-rollout-3` candidate. It combines:

- the incumbent's auction, kitty, and heuristic play behavior;
- 32 deterministic public-information hidden-deal samples;
- optimized exact alpha-beta search when the largest remaining hand has six
  cards or fewer; and
- an exact-three handoff inside earlier heuristic rollouts, so an early choice
  is evaluated against the strong endgame that the bot will actually use.

The worktree began from commit `43c4974` and contains intentional uncommitted
implementation and evidence changes. Neither a commit nor a push was requested.

## Current evidence

The v6 candidate passed its fresh blinded consideration gate. This is the
predeclared evidence that it promises a substantial gain over the frozen
project champion; it is not champion promotion or human-superhuman evidence.

| Suite | Games | Wins | Win rate | Avg margin | Illegal / unfinished |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original training wave (`20260621`-`20260630`) | 20 | 14 | 70.0% | +132.0 | 0 / 0 |
| Second training wave (`20260821`-`20260830`) | 20 | 13 | 65.0% | +38.0 | 0 / 0 |
| Combined training | 40 | 27 | 67.5% | +85.0 | 0 / 0 |
| Fresh blinded consideration | 200 | 116 | 58.0% | +65.9 | 0 / 0 |

The corresponding v5 exact-six candidate scored 23/40 (57.5%) with +74.3
average margin. Shipped `challenger` and diagnostic `ablation-search-v3` were
behavior-identical on the v6 parity check: 3/4, -42.5 margin, identical bid-make
rates and decision counts, and zero illegal or unfinished games.

A fresh blinded 200-game v6 consideration run completed with:

```sh
npm run ai:consideration:blinded -- \
  --output=benchmarks/blinded-consideration-v6-2026-08-12.json
```

The result was 116/200 (58.0%) with a 53.0%-62.5% conservative paired/seed-
cluster interval, +65.9 points/game, candidate/champion bid-make rates of
72.9%/65.6%, no search fallbacks or timeouts, and zero illegal or unfinished
games. It passed every consideration check. The aggregate artifact is
`benchmarks/blinded-consideration-v6-2026-08-12.json`; its seed commitment is
`9b9eaf340ccd06150045599820ada8cfd4c3c62fbf0ba759853c26e16f5b339f`.
The artifact has no raw seed values or paths. A mode-600 seed file left by an
earlier interrupted attempt was found by metadata-only inspection and deleted;
the runner now also cleans up on `SIGINT`, `SIGTERM`, and `SIGHUP`.

## Consumed validation evidence

These results are already exposed and cannot become private promotion evidence:

| Candidate | Suite | Result | Decision |
| --- | --- | --- | --- |
| v4 exact-five | Exposed public 200-game consideration | 105/200 (52.5%), +15.8 margin, conservative lower bound 48.5%, 0 illegal | FAIL |
| v5 exact-six | Fresh blinded 200-game consideration | 108/200 (54.0%), +40.3 margin, conservative lower bound 49.0%, 0 illegal | FAIL |
| v6 exact-six + exact-three rollout handoff | Fresh blinded 200-game consideration | 116/200 (58.0%), +65.9 margin, conservative lower bound 53.0%, 0 illegal | PASS |

The v5 blinded commitment is
`5a828e5bb88767806c0d4aece406fdd371aeb1517c16afb87c5d74d6c6d730d7`.
Its aggregate artifact is
`benchmarks/blinded-consideration-v5-2026-08-12.json`; it contains no raw seeds.

The v5 category totals were directionally useful but must not be overfit:

- candidate early trick points: 37,010 versus 38,460;
- middle: 43,475 versus 41,745;
- endgame: 34,430 versus 33,300;
- candidate bid make: 71.9% versus 68.4%.

## Why v6 is different

The incumbent and v5 already use identical random hidden-hand construction and
heuristic rollouts before the exact threshold. Merely increasing exact depth
improves sampled endgame decisions, but early rollouts still assumed heuristic
play all the way through the round. v6 changes that mismatch: every early
candidate's rollout hands the final three cards to the same optimized exact
solver. This produced independent 70% and 65% training-wave results.

The exact solver changes are behavior-preserving on exhaustive fixtures:

- alpha-beta bounds and a transposition table shared across root candidates;
- heuristic-first move ordering;
- conservative equivalent-card sequence pruning; and
- immutable projection-state sharing.

Across 32 randomized equivalence fixtures, exact scores stayed identical while
nodes fell from 15,406 to 9,743. The authored tactical pack also passes.

## Live behavior versus diagnostics

Only the following behavioral changes are live:

- six-card exact threshold;
- exact ordering/sequence-pruning optimizations; and
- exact-three handoff inside earlier rollouts.

The following implemented capabilities remain disabled in `LIVE_SEARCH_CONFIG`
because experiments did not establish gains:

- auction-likelihood particle weighting;
- adaptive candidate racing;
- the information-set tree tie-break;
- match-state utility bonuses;
- direct-EV auction replacement and shared-world kitty replacement;
- risk, median, CVaR, plurality, Borda, and pairwise root aggregation;
- bounded current-trick adversarial lookahead;
- stratified/matching hidden-hand sampling;
- confidence/phase/seat/void gating; and
- bounded opponent-policy exact search.

Do not remove the diagnostic code casually: it is unit-tested and makes failed
hypotheses reproducible. Do not turn it on live without new multi-wave evidence.

## Experiment record

Directional screens below used mirrored games, the frozen August champion, and
zero-legality tolerance. Small screens are not promotion claims.

| Experiment | Best observed result | Decision |
| --- | ---: | --- |
| Full v3 package | 16/40 (40.0%) | Reject |
| v3 search only | 14/40 (35.0%) | Reject |
| v3 auction/kitty only | 21/40 (52.5%), negative margin | Restore incumbent behavior |
| Exact five, 32 samples | 12/20 (60.0%), +123.8 | Advanced to v4, then failed exposed gate |
| Exact six, 32 samples | 23/40 (57.5%), +74.3 | Advanced to v5, then narrowly failed blinded gate |
| Exact six, 64 samples | 23/40 (57.5%), +100.1, about 4x cost | Reject brute-force increase |
| Exact seven variants | 50%-60%, much slower | Reject |
| Root aggregation | Borda 6/10, +1.5; others 40%-50% | Reject |
| Pure three-ply/two-branch trick lookahead | 8/10 on one wave, but 6/20 on independent wave; latency spikes | Reject false positive |
| Exact-six start at trick four | 12/20 on original wave, 10/20 on wave two | Reject |
| Opening/paired confidence gates | Inconsistent preferred thresholds across waves | Reject |
| Stratified sampling | Correctness tests pass; pathological exact-tree runtime in tournament | Reject |
| Exact/policy value blend | 7/12 at best versus control 6/12; weak margins | Reject |
| Seat, known-void, and opponent-branch gates | Speed gains without win gains | Reject for strength |
| Early rollout to exact-three handoff | 27/40 (67.5%), +85.0 | Retain as v6 |

## Blinded gate protocol

`scripts/ai-blinded-consideration.mjs` generates 20 cryptographic seeds in a
permission-restricted temporary file outside the repository, runs five games
per seed per orientation (200 total), writes only aggregate evidence and a
SHA-256 commitment, and deletes the temporary directory in `finally` and on
normal termination signals.

The consideration gate requires all of the following:

- at least 55% wins;
- conservative paired/seed-cluster 95% lower bound at least 50%;
- positive average margin;
- candidate bid-make rate no more than five percentage points below incumbent;
- zero illegal bids, discards, or plays; and
- zero unfinished games.

A consideration PASS means the bot *promises* a substantial project-bot gain.
It does not promote the candidate and does not prove superiority over strong
humans. Promotion still requires the 800-game gate, a newly generated private
promotion holdout, full tests/build/audit, and normal/throttled/fallback browser
proof.

## Required follow-up after the v6 gate

1. [x] Confirm the temporary private directory is gone and the artifact has no
   raw seeds.
2. [x] Run `npm test`, `npm audit --audit-level=high`, and `npm run build`.
3. [x] Bump the service-worker cache identity after the final runtime is frozen.
4. [x] Run normal and forced-timeout browser reliability; include throttled
   proof before any promotion.
5. [x] Keep `champion-2026-08-11` as incumbent until an 800-game promotion gate
   and fresh promotion holdout pass.

The v6 blinded seeds are now consumed. Never tune against them or describe this
consideration result as promotion evidence. Any later promotion attempt must
generate an entirely fresh private set after the implementation is frozen.

Final browser evidence for this worktree:

- normal root build: 39/39 completed, 0 fallback/timeout/illegal/stale/worker
  errors, 3.56-second p99;
- 4x CPU throttle: 39/39 completed, 0 fallback/timeout/illegal/stale/worker
  errors, 2.04-second p99;
- forced timeout: 39/39 took the legal fallback with 0 illegal/stale/worker
  errors; and
- `/rookGame/` Pages build: 39/39 completed with 0 fallback/timeout/error and
  correct scoped app/worker assets.

All four runs confirmed `rook-game-cache-v9`. `npm test`, both root and Pages
production builds, `npm audit --audit-level=high`, and `git diff --check` pass.

## Useful commands

```sh
node scripts/validate-search-prototype.mjs
node scripts/validate-tactical-endgames.mjs
node scripts/validate-belief-model.mjs
node scripts/validate-tournament-config.mjs

npm run ai:tournament -- \
  --candidates=challenger \
  --opponent=champion-2026-08-11 \
  --seed-group=tuning-training-2026-08-wave2 \
  --games=1 --workers=auto --search-config=live

npm test
npm audit --audit-level=high
npm run build
npm run test:browser
```

## Claim boundary

The repository has no qualified external human labels or strong-human game
corpus. Exact tactical fixtures are engineered oracle cases. Say “stronger than
the frozen project champion” only when the relevant gate passes; never describe
this work as human-superhuman.
