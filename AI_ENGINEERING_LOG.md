# Rook AI Engineering Log

## Current result

`champion-2026-08-11` is the new frozen project champion. It is substantially better than the previous best project bot, `champion-2026-07-02`, under the implemented rules and deterministic simulator. The strongest evidence is the fresh private holdout: 732 wins in 800 mirrored games (91.5%), +500.0 average final margin, 89.4%-93.2% Wilson interval, approximately +413 Elo, and zero illegal moves.

Moving source now contains the unpromoted `live-challenger-v6-exact-6-rollout-3` work described in `NEXT_LEVEL_AI_HANDOFF.md`. Across two independent training waves it scored 27/40 (67.5%) with +85.0 average margin against the August champion, versus v5's 23/40 (57.5%) and +74.3. It then passed a fresh blinded 200-game consideration gate at 116/200 (58.0%), +65.9 average margin, and a conservative 53.0% lower bound, with zero illegal or unfinished games. This satisfies the predeclared “promises a substantial project-bot gain” threshold, but it must remain a challenger until the later promotion/private/browser sequence passes.

This is not evidence that the bot is stronger than elite human Rook players. There is no qualified human game corpus or external expert label set in the repository. The tactical fixtures are exhaustive, engineered oracle cases—not external human opinions.

## Frozen incumbent architecture

The frozen August champion uses `live-challenger-v2`. Moving source uses the experimental `live-challenger-v6-exact-6-rollout-3` profile:

- 32 fixed hidden-deal samples for every play with more than one legal card;
- the same sampled deal is scored for every legal candidate, and a partial candidate set is discarded;
- full-round heuristic rollouts instead of stopping at a shallow leaf for early/middle play;
- optimized exact minimax search once the largest remaining hand has six cards;
- a 10,000-node exact-search cap with alpha-beta bounds, transpositions, move ordering, and safe equivalent-card pruning;
- early heuristic rollouts that hand the final three cards to the exact solver instead of assuming heuristic play through the end;
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

Moving source retains disabled, unit-tested diagnostic implementations for rejected v3-v6 hypotheses. Only the exact-six solver and exact-three rollout handoff are enabled in the live profile. See `NEXT_LEVEL_AI_HANDOFF.md` before enabling any diagnostic feature.

## 2026-08-12 challenger program

The advancement standard was deliberately stricter than a favorable training aggregate:

| Candidate | Development evidence | Independent gate | Decision |
| --- | --- | --- | --- |
| v4 exact-five | 13/20 (65.0%) on its best training screen | Exposed 105/200 (52.5%), +15.8, conservative lower 48.5% | Reject |
| v5 exact-six | 23/40 (57.5%), +74.3 across two training waves | Fresh blinded 108/200 (54.0%), +40.3, conservative lower 49.0% | Reject |
| v6 exact-six + rollout exact-three handoff | 27/40 (67.5%), +85.0; independently 14/20 and 13/20 | Fresh blinded 116/200 (58.0%), +65.9, conservative lower 53.0%, bid make 72.9% / 65.6% | Consideration PASS; not promoted |

All three candidate lines recorded zero illegal and zero unfinished games. The v5 private artifact contains only aggregate evidence and seed commitment `5a828e5bb88767806c0d4aece406fdd371aeb1517c16afb87c5d74d6c6d730d7`; the v6 artifact contains only aggregate evidence and commitment `9b9eaf340ccd06150045599820ada8cfd4c3c62fbf0ba759853c26e16f5b339f`. Their raw seeds were deleted and must never become tuning data. A stale mode-600 seed file from an interrupted v6 attempt was also removed, and the blinded runner now cleans up on normal termination signals.

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

- Final v6 normal browser hand: 39/39 searches completed, 0 fallbacks/timeouts/errors, 3.56-second p99 under the five-second watchdog.
- Final v6 4x CPU-throttled hand: 39/39 completed, 0 fallbacks/timeouts/errors, 2.04-second p99.
- Final v6 forced-timeout hand: all 39 searches took the legal fallback with 0 illegal/stale/worker errors.
- Final v6 `/rookGame/` Pages hand: 39/39 completed with 0 fallbacks/timeouts/errors and correctly scoped app/worker assets.
- Production build: Vite 8 build passed.
- Final normal browser hand: 39/39 searches completed, 0 fallbacks/timeouts/errors, average worker time 20.40 ms.
- 4x CPU-throttled page: 39/39 completed, 0 fallbacks/timeouts/errors.
- Forced timeout: 39/39 searches took the legal timeout fallback, with 0 illegal/stale/worker errors.
- The v2 promotion used `rook-game-cache-v7`; the finalized v6 worktree advances it to `rook-game-cache-v9`, and the harness verifies current app, worker, stylesheet, and cache identities.
- GitHub Pages now receives the repository-scoped `/rookGame/` production build from GitHub Actions rather than serving the Vite source tree directly.
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
9. Read `NEXT_LEVEL_AI_HANDOFF.md` before changing the moving challenger; it records the consumed v4/v5 gates, rejected variants, v6 architecture, and current non-promotion evidence.
