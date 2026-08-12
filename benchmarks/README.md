# Competitive AI evidence

This directory stores aggregate, reproducible evidence for named Rook bot candidates. Private holdout artifacts must contain only the seed count and a SHA-256 commitment—never the raw private seeds.

Promotion evidence is valid only when all of the following are true:

- the candidate uses the shipped `live` search profile with deterministic fixed-work sampling;
- games are mirrored across both team orientations;
- all bids, kitty discards, and plays are legal;
- the configured minimum game count and conservative 95% paired/seed-cluster lower-bound gate pass (Wilson remains a descriptive cross-check);
- private seeds are generated after tuning ends and are not checked into the repository;
- browser-worker validation passes in normal, throttled, and forced-timeout modes.

Checked-in public validation seeds are regression data, not secret holdout data and not sufficient for champion promotion.

`ai:consideration:blinded` is the preferred one-shot challenger screen. It creates 20 cryptographic seeds in a permission-restricted temporary file outside the repository, runs 200 mirrored games, exposes only the aggregate SHA-256 commitment, and deletes the raw file in `finally`. A consideration pass is evidence to continue toward promotion; it is not itself a champion promotion.

Consumed blinded artifacts must never become tuning data. `blinded-consideration-v5-2026-08-12.json` records a failed 108/200 v5 attempt. `blinded-consideration-v6-2026-08-12.json` records a passing 116/200 v6 consideration attempt with a 53.0% conservative lower bound and +65.9 average margin. Both intentionally contain commitments and aggregate evidence only—no raw seeds—and neither seed set may be reused for tuning or promotion.

`expert/` is a separate provenance-aware intake format for independently supplied human decisions. A valid empty pipeline is not human evidence; `npm run ai:expert -- --require-expert` must fail until at least one qualified external source is present.
