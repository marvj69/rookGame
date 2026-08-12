# Competitive AI Roadmap and Promotion Record

The current champion is `champion-2026-08-11`, promoted from the shipped Strong bot after beating `champion-2026-07-02` on public, broad, and fresh private suites. The old July champion remains frozen and importable for historical comparisons.

## Completed foundation

- [x] Freeze named, self-contained AI snapshots instead of benchmarking against moving source.
- [x] Support moving challenger, old heuristic baseline, previous champion, and current champion engines.
- [x] Mirror every deal across both team orientations and emit deterministic fingerprints.
- [x] Hide opponent hands and kitty contents from live and benchmark search.
- [x] Reject any benchmark containing an illegal bid, discard, or play.
- [x] Compare every legal play on the same sampled hidden deal; discard partial samples that could favor card order.
- [x] Benchmark the engine-specific shipped `live` profile rather than silently applying one shared search config.
- [x] Require fixed-work deterministic evidence, minimum sample sizes, Wilson confidence bounds, positive margin, and defensible contract results.
- [x] Separate tuning seeds from exposed public regression seeds.
- [x] Require a fresh, untracked private seed file for promotion; checked-in seeds cannot satisfy the promotion gate.
- [x] Record approximate Elo, bidder/defender results, and early/middle/endgame trick performance.
- [x] Add exact endgame oracle fixtures for making a bid, setting a bidder, and a contract-swing trump decision.
- [x] Validate production browser search in normal, 4x-throttled, and forced-timeout modes.
- [x] Add CI for dependency audit, deterministic tests, champion parity smoke, production build, browser worker completion, and fallback recovery.

## 2026-08-11 promotion

- [x] Public validation: 178/200 wins (89.0%), +470.6 average margin, 0 illegal moves.
- [x] Broad promotion suite: 720/800 wins (90.0%), +476.2 average margin, 87.7% Wilson lower bound, 0 illegal moves.
- [x] Fresh private holdout: 732/800 wins (91.5%), +500.0 average margin, 89.4% Wilson lower bound, 0 illegal moves.
- [x] Private seed commitment: `fb5ff0acb3803fcb7dbc2c0a6e5250bbdc1f64f3b1385925c92cf6d33049c5f7`.
- [x] Freeze the validated implementation as `scripts/champions/strong-search-2026-08-11.mjs`.
- [x] Make the promoted snapshot the default opponent for future advancement gates.

## Still needed for a human-superhuman claim

- [x] Add a provenance-aware schema and validator for externally supplied expert decisions.
- [ ] Obtain actual labels or ranked decisions from demonstrably strong human Rook players for bidding, trump, kitty, and play scenarios. The current source count is zero.
- [ ] Collect complete strong-human games under the exact rules implemented here and evaluate the frozen champion against them.
- [ ] Expand the oracle pack with adversarial multi-trick cases and independently review their rule assumptions.
- [ ] Repeat browser reliability on representative low-end physical phones if mobile latency becomes a release criterion.

## Implemented v3-v6 challenger program, not promoted

- [x] Weight hidden-deal particles using bounded public auction and play evidence.
- [x] Add adaptive paired candidate racing and an information-set tree tie-break.
- [x] Evaluate all legal bid contracts directly and compare kitty plans on shared worlds.
- [x] Add match-aware and must-win-by-bid terminal utility.
- [x] Add paired/seed-cluster bootstrap intervals, opponent leagues, adversarial probes, rule variants, percentile browser latency, and an external-expert evidence gate.
- [x] Expand the exact tactical pack from 3 to 8 cases.
- [x] Add optimized exact-five/six search with alpha-beta bounds, shared transpositions, policy-first ordering, safe equivalent-card pruning, and exhaustive equivalence tests.
- [x] Add a three-card exact handoff inside early sampled rollouts so early choices include the live endgame policy.
- [x] Add a cryptographic blinded-consideration runner that writes only aggregate evidence and a seed commitment, then deletes raw seeds in `finally`.
- [x] Reject v4 after exposed consideration: 105/200 (52.5%), +15.8, conservative lower bound 48.5%.
- [x] Reject v5 after fresh blinded consideration: 108/200 (54.0%), +40.3, conservative lower bound 49.0%.
- [x] Pass the fresh v6 200-game consideration gate: 116/200 (58.0%), +65.9, conservative lower bound 53.0%, candidate/champion bid make 72.9%/65.6%, zero illegal or unfinished games.
- [x] Validate v6 in normal, 4x CPU-throttled, forced-timeout, and `/rookGame/` Pages browser runs with zero illegal/stale/worker errors.
- [ ] Pass a fresh private promotion holdout. Do not generate one before tuning stops.

Current v6 evidence is 27/40 (67.5%) with +85.0 average margin across two independent training waves plus a fresh blinded 116/200 consideration PASS. This promises a substantial gain over the frozen project champion under the simulator, but is not promotion or human-superhuman evidence. The incumbent remains `champion-2026-08-11`; see `NEXT_LEVEL_AI_HANDOFF.md`.

The repository now proves that the August bot is substantially stronger than the best prior bot in this project. It does not yet prove superiority over elite human Rook players.

## Future challenger flow

```sh
npm test
npm run build
npm run ai:benchmark -- --mode=quick --profile=live --candidate=challenger --opponent=champion-2026-08-11 --parallel --seed=20260811
npm run ai:benchmark -- --mode=standard --profile=live --candidate=challenger --opponent=champion-2026-08-11 --gate=consideration --parallel --seed=20260811
npm run ai:benchmark:acceptance -- --profile=live --candidate=challenger --opponent=champion-2026-08-11 --gate=promotion --workers=auto
ROOK_PRIVATE_HOLDOUT_FILE=/absolute/path/to/new-private-seeds.txt npm run ai:holdout -- --candidate=challenger --opponent=champion-2026-08-11 --gate=promotion --workers=auto --strict --output=benchmarks/private-holdout-YYYY-MM-DD.json
npm run test:browser
```

Do not tune on a private holdout after seeing its result. If a candidate fails, return to the declared training/public data and generate an entirely new private set only after the next candidate is frozen.
