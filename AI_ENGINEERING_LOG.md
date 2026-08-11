# Rook AI Engineering Log

## Current result

`champion-2026-08-11` is the new frozen project champion. It is substantially better than the previous best project bot, `champion-2026-07-02`, under the implemented rules and deterministic simulator. The strongest evidence is the fresh private holdout: 732 wins in 800 mirrored games (91.5%), +500.0 average final margin, 89.4%-93.2% Wilson interval, approximately +413 Elo, and zero illegal moves.

This is not evidence that the bot is stronger than elite human Rook players. There is no qualified human game corpus or external expert label set in the repository. The tactical fixtures are exhaustive, engineered oracle cases—not external human opinions.

## Retained architecture

The shipped Strong bot uses `live-challenger-v2`:

- 32 fixed hidden-deal samples for every play with more than one legal card;
- the same sampled deal is scored for every legal candidate, and a partial candidate set is discarded;
- full-round heuristic rollouts instead of stopping at a shallow leaf for early/middle play;
- exact minimax search once the largest remaining hand has three cards;
- a 20,000-node exact-search cap;
- deterministic public-state seeds and no access to hidden hands or kitty cards;
- a five-second worker watchdog in the app, with a legal heuristic fallback if the worker fails or times out.

The `timeLimitMs: 120` field remains part of the profile, but fixed-work mode completes the declared sample count rather than truncating candidates by wall clock. Production browser validation, not benchmark timing, is the watchdog proof.

Strong is now the default for new games. Fast remains available as an explicit low-compute option. Existing saved games retain an explicitly saved strength choice; older saves with no strength field inherit Strong.

## Experiments

Small tuning matches are directional only; promotion decisions came from the 800-game suites.

| Experiment | Result against July champion | Decision |
| --- | ---: | --- |
| Original shipped live search: 3 samples, rollout only at 7 cards or fewer | 20/40, 50.0%, margin 0 | Replace |
| 12 samples, full-round rollout, exact at 4 | 36/40, 90.0%, +482.9 | Strong first gain |
| 16 samples, minimum 3, 180 ms profile | 32/40, 80.0%, +377.5 | Reject |
| 20 samples, exact at 3 | 37/40, 92.5%, +517.9 | Good, but below retained profile |
| 32 samples, exact at 3 | 38/40, 95.0%, +530.0 on one tuning seed; 34/40, 85.0%, +412.5 on another | Retain |
| 64 samples, exact at 3 | 36/40, 90.0%, +497.3 and materially slower | Reject |
| Exact threshold 4 instead of 3 | Identical decisions at higher cost | Reject |
| More conservative partner-point dumping | 35/40, 87.5%, +460.4 and slower | Reject |
| Bid ceiling +5 | 36/40, 90.0%, +473.6 | Reject |
| Bid ceiling -5 | 38/40, 95.0%, +522.5 | Reject; lower margin than retained profile |
| Kitty search expanded to 10 candidates x 6 samples | 35/40, 87.5%, +481.4 | Reject |

No rejected behavioral experiment remains in moving source.

## Promotion evidence

| Suite | Games | Wins | Win rate | 95% lower bound | Avg margin | Candidate/champion bid make | Illegal | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Public validation, exposed seeds | 200 | 178 | 89.0% | 83.9% | +470.6 | 77.8% / 39.5% | 0 | Consideration PASS |
| Broad mirrored promotion suite | 800 | 720 | 90.0% | 87.7% | +476.2 | 80.7% / 40.9% | 0 | Promotion PASS |
| Fresh private 20-seed holdout | 800 | 732 | 91.5% | 89.4% | +500.0 | 80.6% / 38.8% | 0 | Promotion PASS |

The private artifact is `benchmarks/private-holdout-2026-08-11.json`. It contains the aggregate fingerprint and seed commitment, but none of the 20 raw seed values. The permission-restricted temporary raw seed file was deleted after leakage and artifact-integrity checks. Future promotion attempts must generate a fresh private set.

Private category totals show the gain is broad:

- contract play: 1,502/1,863 made (80.6%) versus 1,174/3,027 (38.8%);
- defense: 1,853 sets in 3,027 defenses versus 361 in 1,863;
- trick points, candidate versus July champion: early 215,645/188,550; middle 173,245/124,740; endgame 99,285/78,735;
- 254,280 searched play decisions, 3,550,623 samples, 0 fallbacks, 0 search timeouts, and 0 illegal bids/discards/plays.

## Browser and product proof

- Production build: Vite 8 build passed.
- Final normal browser hand: 39/39 searches completed, 0 fallbacks/timeouts/errors, average worker time 20.40 ms.
- 4x CPU-throttled page: 39/39 completed, 0 fallbacks/timeouts/errors.
- Forced timeout: 39/39 searches took the legal timeout fallback, with 0 illegal/stale/worker errors.
- Service-worker cache advanced to `rook-game-cache-v6`, and the harness verifies current app, worker, stylesheet, and cache identities.
- Playwright is a local dev dependency; CI installs Chromium and runs both completion and fallback paths.
- `npm audit --audit-level=high` reports zero vulnerabilities as of promotion.

## Rules for future agents

1. Never edit a frozen directory under `scripts/champions/`.
2. Tune only the moving `src/ai/` implementation and declared training data.
3. Use `--profile=live` for strength claims. Benchmark-only profiles are diagnostic.
4. Keep mirrored orientations, zero-legality tolerance, minimum game counts, and Wilson gates intact.
5. Checked-in public seeds are exposed regression data, never private evidence.
6. Generate private seeds only after tuning stops and keep the raw file outside the repository. Store only the aggregate commitment/artifact in the repo; the runner rejects in-repository seed files.
7. After a successful promotion, copy the exact validated source to a new named snapshot and move `CHAMPION_ENGINE_ID` forward without deleting older champions.
8. Do not call the bot human-superhuman until qualified human evidence exists.
