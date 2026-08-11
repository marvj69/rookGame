# Competitive AI evidence

This directory stores aggregate, reproducible evidence for named Rook bot candidates. Private holdout artifacts must contain only the seed count and a SHA-256 commitment—never the raw private seeds.

Promotion evidence is valid only when all of the following are true:

- the candidate uses the shipped `live` search profile with deterministic fixed-work sampling;
- games are mirrored across both team orientations;
- all bids, kitty discards, and plays are legal;
- the configured minimum game count and 95% Wilson lower-bound gate pass;
- private seeds are generated after tuning ends and are not checked into the repository;
- browser-worker validation passes in normal, throttled, and forced-timeout modes.

Checked-in public validation seeds are regression data, not secret holdout data and not sufficient for champion promotion.
