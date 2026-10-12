# Engine

Pure functions only (PRD §15.3): input in, output out. No database, server, app, network or clock
access; time and the random generator are passed in. A lint rule in `eslint.config.mjs` enforces
this. Every number comes from `engine_setting` and is passed in as a settings object.
