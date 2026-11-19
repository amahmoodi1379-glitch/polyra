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
# The content packs (content/<language>/, written by Claude) load in the background while the app starts,
# at a low CPU priority: only what is new since the last start, approved and published when ready.
# CONTENT_PACKS=off skips it.
if [ "${CONTENT_PACKS:-on}" != "off" ]; then
  (nice -n 10 node node_modules/tsx/dist/cli.mjs scripts/content/load.ts || echo "The content packs were not loaded.") &
fi
# The machine-voice generator (scripts/audio/worker.ts) runs beside the app so learners never wait for it:
# on one processor (Piper then speaks with one thread), at the lowest CPU priority, using the disk only
# when nothing else does, and resting between files. If it stops it starts again a minute later and
# carries on where it left off. AUDIO_GENERATOR=off keeps it from starting.
if [ "${AUDIO_GENERATOR:-on}" != "off" ]; then
  low="nice -n 19"
  cpu=$(taskset -pc $$ 2>/dev/null | sed -n 's/.*: *\([0-9][0-9]*\).*/\1/p')
  if [ -n "$cpu" ] && taskset -c "$cpu" true 2>/dev/null; then low="taskset -c $cpu $low"; fi
  if ionice -c 3 true 2>/dev/null; then low="$low ionice -c 3"; fi
  (
    while true; do
      $low node --import tsx scripts/audio/worker.ts || echo "The machine-voice generator stopped; it starts again in a minute."
      sleep 60
    done
  ) &
fi
# exec: Next.js becomes the main process and shuts down cleanly when the host stops it.
exec node node_modules/next/dist/bin/next start --port "${PORT:-3000}"
