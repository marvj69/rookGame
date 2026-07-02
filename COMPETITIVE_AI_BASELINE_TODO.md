# Competitive AI Baseline TODO

Goal: freeze the current Strong/search AI as the first named champion baseline, then require every future AI change to beat that champion under deterministic, legal, and browser-safe conditions.

Baseline snapshot intent:
- Snapshot commit: `5a0dbcd` (`Complete superhuman AI TODOs`).
- Snapshot role: current champion, not an experimental candidate.
- Future work should compare challenger AI against this snapshot competitively.
- The moving implementation in `src/ai.js` must not be treated as the baseline after new AI work begins.

Current evidence from 2026-07-02:
- `npm test` passed.
- `npm run build` passed.
- Fast/current AI beat the frozen old baseline 226/400 games, 56.5%, +78.6 average margin, 0 illegal moves.
- Strong/search AI beat the frozen old baseline 271/400 games, 67.8%, +172.5 average margin, 0 illegal moves.
- Three-seed Strong/search tournament beat the old baseline 89/120 games, 74.2%, +215.8 average margin, 77.2% bid make rate, 0 illegal moves.
- Strong browser reliability passed 39/39 search completions with 0 fallbacks, 0 timeouts, and 0 illegal/stale/worker errors.

## Phase 1 - Freeze the Champion Snapshot

- [x] Copy the current AI implementation into a named champion module, for example `scripts/champions/strong-search-2026-07-02.mjs`.
- [x] Include every dependency needed for deterministic champion behavior: heuristics, search config, evaluation weights, and any helper logic that could drift later.
- [x] Add a small metadata export with champion name, source commit, date, default search config, and validation commands.
- [x] Make the champion importable by benchmark and tournament scripts without relying on the moving `src/ai.js` implementation.
- [x] Acceptance: changing `src/ai.js` after the snapshot does not change champion benchmark behavior.

## Phase 2 - Upgrade Benchmark Scripts to Support Champion Play

- [ ] Add benchmark flags such as `--opponent=champion-2026-07-02` and `--candidate=challenger`.
- [ ] Keep the old baseline available, but make the champion snapshot the default competitive opponent for future AI work.
- [ ] Print both old-baseline and champion-baseline summaries when requested.
- [ ] Add deterministic fingerprint output for champion-vs-champion runs.
- [ ] Acceptance: champion vs itself produces a stable 50/50 mirrored result fingerprint for fixed seeds.

## Phase 3 - Define Advancement Gates

- [ ] Require 0 illegal bids, discards, and plays in every run.
- [ ] Require no hidden-card access in live play or benchmark search.
- [ ] Require challenger to beat champion by at least 55% over a standard holdout suite before considering it an improvement.
- [ ] Require challenger to beat champion by at least 60% over a larger full suite before replacing the champion.
- [ ] Require average margin and bid make rate to improve or remain defensible; do not accept a higher win rate caused by reckless bidding variance alone.
- [ ] Require `npm test`, `npm run build`, quick benchmark, full benchmark, tournament, and browser Strong-mode reliability before promoting a new champion.

## Phase 4 - Build a Holdout Seed Protocol

- [ ] Create training seeds for tuning.
- [ ] Create locked holdout seeds that are never used for tuning.
- [ ] Store seed groups in a checked-in config file so future agents cannot accidentally cherry-pick a lucky seed.
- [ ] Run champion replacement only on holdout seeds.
- [ ] Add a benchmark command that prints whether the challenger passes, fails, or needs more games for confidence.
- [ ] Acceptance: the same challenger produces the same pass/fail result for fixed holdout seeds and config.

## Phase 5 - Add Elo-Style Competitive Tracking

- [ ] Add a tournament ladder file listing old baseline, current champion, and candidate engines.
- [ ] Compute approximate Elo deltas from mirrored match results.
- [ ] Store tournament result JSON for promoted champions.
- [ ] Track performance by category: bidding, kitty/trump, early trick play, midgame, endgame, bid defense, and bid protection.
- [ ] Acceptance: a future agent can see whether a candidate is broadly better or only exploiting one benchmark weakness.

## Phase 6 - Improve Toward Actual Superhuman Evidence

- [ ] Create expert scenario packs for hard bidding, trump choice, kitty discard, and trick-play decisions.
- [ ] Add labeled expected choices or ranked choice rubrics for those scenarios.
- [ ] Add adversarial scenarios where naive point chasing loses the bid or fails to set opponents.
- [ ] Add double-dummy/endgame fixtures where exact optimal play is known.
- [ ] If possible, collect games or decisions from strong human players and score the champion against those.
- [ ] Acceptance: champion strength is supported by old-baseline wins, champion-ladder wins, tactical fixtures, and human/expert decision evidence.

## Phase 7 - Promotion Rules for the Next Champion

- [ ] A challenger can become champion only if it beats the current champion on locked holdout seeds.
- [ ] Promotion must create a new named snapshot module instead of editing the previous champion.
- [ ] Promotion must record source commit, benchmark commands, results, browser reliability summary, and known weaknesses.
- [ ] Keep at least the last three champions available for regression tournaments.
- [ ] Acceptance: future AI work always has a stable, historically comparable opponent.

## Immediate Next Command Set

After the champion module exists, the expected validation flow should look like:

```sh
npm test
npm run build
npm run ai:benchmark -- --mode=standard --candidate=challenger --opponent=champion-2026-07-02 --parallel --seed=20260702
npm run ai:tournament -- --seeds=<locked-holdout-seeds> --games=<holdout-games> --candidates=champion-2026-07-02,challenger --workers=auto --no-json
npm run ai:browser-reliability -- --games=1 --hands=1 --no-json
```

## Working Definition

This snapshot should become the first serious competitive champion. That does not prove it is superhuman. It gives the project a stable opponent strong enough that future AI improvements must win real games, legally, repeatedly, and without benchmark drift.
