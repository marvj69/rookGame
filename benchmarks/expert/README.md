# External expert evidence

This directory is reserved for independently supplied Rook decisions and complete-game records. Engineered fixtures and labels created by the bot authors do not count as external expert evidence.

Each evidence JSON file must contain:

- a stable source identifier and ruleset identifier;
- the expert's qualification description;
- whether consent permits aggregate publication;
- scenarios with the complete public information state, legal choices, the expert choice, and an optional ranked list;
- a SHA-256 commitment to any private source material retained outside the repository.

Run `npm run ai:expert` to validate available files. Run `npm run ai:expert -- --require-expert` when a release claim requires at least one qualified external source. Do not add fabricated or internally inferred expert labels just to satisfy that gate.
