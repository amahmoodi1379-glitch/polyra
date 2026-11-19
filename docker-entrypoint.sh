#!/bin/sh
# Start-up on the server: bring the database to the latest migration, refresh settings, then serve.
# If a migration fails the app does not start, so it never runs against an old database shape.
set -e
node node_modules/prisma/build/index.js migrate deploy
node node_modules/tsx/dist/cli.mjs scripts/seed/index.ts
# DEMO_CONTENT=fr puts the French demo in for testers once; DEMO_CONTENT=remove takes it out (with testers'
# progress on it) before teachers build the real French content. A failure here never keeps the app down.
if [ "${DEMO_CONTENT:-}" = "fr" ]; then
  node node_modules/tsx/dist/cli.mjs scripts/demo.ts load || echo "The demo was not loaded."
elif [ "${DEMO_CONTENT:-}" = "remove" ]; then
  node node_modules/tsx/dist/cli.mjs scripts/demo.ts remove || echo "The demo was not removed."
fi
# The content packs (content/<language>/, written by Claude) load in the background while the app starts:
# only what is new since the last start, approved and published when ready. CONTENT_PACKS=off skips it.
if [ "${CONTENT_PACKS:-on}" != "off" ]; then
  (node node_modules/tsx/dist/cli.mjs scripts/content/load.ts || echo "The content packs were not loaded.") &
fi
# exec: Next.js becomes the main process and shuts down cleanly when the host stops it.
exec node node_modules/next/dist/bin/next start --port "${PORT:-3000}"
