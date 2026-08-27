#!/usr/bin/env bash
# Capacitor currently logs some copy failures without returning a non-zero status.
# Capture the output so CI cannot publish a partially synced native bundle.
set -euo pipefail

SYNC_LOG="$(mktemp -t street-circuit-cap-sync.XXXXXX)"
trap 'rm -f "$SYNC_LOG"' EXIT

set +e
npx cap sync ios 2>&1 | tee "$SYNC_LOG"
SYNC_STATUS=${PIPESTATUS[0]}
set -e

if (( SYNC_STATUS != 0 )) || grep -Eq '(^|[[:space:]])(failed!|\[error\])' "$SYNC_LOG"; then
  echo "Capacitor iOS sync failed; refusing to continue with a partial native bundle." >&2
  exit 1
fi
