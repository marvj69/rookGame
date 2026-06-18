# Super-Human AI TODO

Goal: make the Rook bot stronger than strong human play while preserving legal play, browser responsiveness, and the existing app API.

Current baseline:
- Runtime AI entry points are `chooseBotBid`, `chooseBotKittyPlan`, and `chooseBotPlay` in `src/ai.js`.
- The app already has heuristic bidding, exhaustive legal kitty-discard selection, void tracking, and one-trick projection.
- Benchmark entry point is `npm run ai:benchmark`.
- A quick sanity run on 2026-06-18 used `npm run ai:benchmark -- --games=20 --seed=20260618` and produced 36/40 candidate wins, +479.9 average margin, and a 77.7% bid make rate. Treat this as smoke evidence only, not a statistical target.

Non-negotiables:
- Never let the AI inspect hidden cards directly during live play.
- Keep exported functions compatible with `src/App.jsx`.
- Every strategy change must pass legality checks, `npm run test`, `npm run build`, and AI benchmark comparison.
- Use deterministic seeds for reproducible regressions.
- Keep browser decisions time-boxed. Any expensive search must run in a worker or degrade to the current heuristic path.

## Phase 0 - Lock Down Correctness

- [ ] Add deterministic unit-style scenario tests for `chooseBotBid`, `chooseBotKittyPlan`, and `chooseBotPlay`.
- [ ] Add regression fixtures for legal follow-suit behavior, Rook-as-trump behavior, kitty discard restrictions, and last-trick scoring.
- [ ] Add an illegal-move counter to `scripts/benchmark-ai.mjs` and fail fast on any illegal bid, discard, or play.
- [ ] Add benchmark output fields for runtime per game and average decision count.
- [ ] Acceptance: `npm run test`, `npm run build`, and `npm run ai:benchmark -- --games=20 --seed=20260618` pass.

## Phase 1 - Make Benchmarking Fast Enough

- [ ] Split benchmark simulation helpers out of `scripts/benchmark-ai.mjs` into reusable modules.
- [ ] Add a quick benchmark mode for edit-loop work, such as 20 games per orientation.
- [ ] Add a full benchmark mode for confidence work, such as 1000+ mirrored games.
- [ ] Parallelize benchmark games with Node worker threads or process sharding.
- [ ] Print candidate win rate, average margin, round-score average, bid win count, bid make rate, illegal move count, and elapsed time.
- [ ] Acceptance: full benchmark can run in a practical amount of time on this machine and produces deterministic results for a fixed seed.

## Phase 2 - Build an Imperfect-Information Model

- [x] Create a belief-state module, likely `src/ai/belief.js`, that derives known cards, unseen cards, known voids, possible voids, and team context from public game state.
- [x] Generate random hidden-hand assignments consistent with observed cards and known voids.
- [x] Add validation that generated hidden deals preserve hand sizes, card uniqueness, follow-suit evidence, and current public trick state.
- [x] Add tests using fixed trick histories where specific players must be void in specific colors.
- [x] Acceptance: sampled deals are legal, deterministic under a seed, and do not include cards known to be in the acting player's hand or already played.

## Phase 3 - Add Time-Boxed Search for Play Decisions

- [x] Create a search module, likely `src/ai/search.js`, that evaluates each legal card using sampled hidden deals.
- [x] Start with Monte Carlo rollouts using the existing heuristic policy as the rollout policy.
- [ ] Add exact endgame search when the remaining card count is small enough.
- [ ] Score outcomes by round EV: made/missed bid, point swing, set potential, and current score context.
- [x] Keep a strict decision budget, for example 50-150 ms in live browser play and larger budgets in benchmarks.
- [x] Return the current heuristic choice when search has too little time or too few valid samples.
- [x] Add benchmark-only sampled-search candidate mode with search metrics and no live browser integration.
- [x] Add regression coverage proving hidden opponent card mutations do not change sampled-search output for the same public state and seed.
- [ ] Acceptance: search never blocks the UI, never returns illegal cards, and beats the current baseline over a fixed full benchmark suite.

## Phase 4 - Upgrade Bidding and Kitty with Rollout EV

- [ ] Evaluate bid ceilings by simulated expected value rather than only static hand strength.
- [ ] Include partner/opponent bidding context, dealer position, current score, and risk of going set.
- [ ] Score trump choice and kitty discards by rollout outcomes after legal discard enumeration.
- [ ] Preserve the existing exhaustive legal-discard guard as the final legality check.
- [ ] Acceptance: bid make rate improves or remains stable while average margin improves over the benchmark suite.

## Phase 5 - Tune Through Self-Play

- [ ] Move hand-evaluation and rollout weights into a single config object.
- [ ] Add a tournament script that compares candidate configs against the checked-in baseline.
- [ ] Use seeded self-play to tune weights before considering neural models.
- [ ] Store winning config changes with benchmark output in the PR or commit message.
- [ ] Acceptance: each merged tuning change has reproducible benchmark evidence and does not rely on a single lucky seed.

## Phase 6 - Browser Integration

- [ ] If search is expensive, move it to a Web Worker and keep `chooseBotPlay` compatible through an async wrapper in `src/App.jsx`.
- [ ] Add a setting or internal difficulty flag so the current heuristic can remain available as a fallback.
- [ ] Add timeout handling, worker failure fallback, and telemetry/logging for search timeouts in development.
- [ ] Smoke test a live game in the browser after any integration change.
- [ ] Acceptance: local gameplay remains responsive on desktop and mobile viewports, with no console errors.

## Candidate File Layout

- [ ] Keep `src/ai.js` as the public compatibility facade.
- [ ] Consider moving existing heuristic helpers into `src/ai/heuristics.js`.
- [x] Add `src/ai/belief.js` for public-state inference and sampled hidden deals.
- [x] Add `src/ai/search.js` for Monte Carlo and endgame search.
- [ ] Add `src/ai/evaluation.js` for scoring functions and tunable weights.
- [x] Add `scripts/ai-benchmark-worker.mjs` if benchmark parallelism uses worker threads.
- [ ] Add `scripts/ai-tournament.mjs` for config-vs-config comparison.

## Definition of Working Correctly

- [ ] No illegal moves, illegal discards, or non-terminating bidding in benchmark runs.
- [ ] The AI does not use hidden information that would be unavailable to a real player.
- [ ] `npm run test` passes.
- [ ] `npm run build` passes.
- [ ] Quick benchmark passes every edit loop.
- [ ] Full benchmark shows statistically meaningful improvement over `scripts/current-ai-baseline.mjs`.
- [ ] Browser smoke test confirms bots complete bidding, kitty, trump selection, and multiple tricks without UI stalls.
