#!/usr/bin/env bash
# Copies every photo/icon the new site references from the current physiostudio.com.np into ./uploads,
# so the site no longer depends on the old host. Safe to re-run.
set -euo pipefail
BASE="${LEGACY_ASSET_BASE:-https://physiostudio.com.np}"
DEST="${UPLOAD_DIR:-$(cd "$(dirname "$0")/.." && pwd)/uploads}"
DB="${DATA_DIR:-$(cd "$(dirname "$0")/.." && pwd)/data}/physiostudio.db"
command -v sqlite3 >/dev/null || { echo "Install sqlite3 first (apt install sqlite3)"; exit 1; }
paths=$(sqlite3 "$DB" "SELECT value FROM content_blocks WHERE value LIKE '/uploads/%'
  UNION SELECT value FROM settings WHERE value LIKE '/uploads/%'
  UNION SELECT image FROM services WHERE image LIKE '/uploads/%'
  UNION SELECT photo FROM staff WHERE photo LIKE '/uploads/%'
  UNION SELECT photo FROM testimonials WHERE photo LIKE '/uploads/%'
  UNION SELECT cover FROM posts WHERE cover LIKE '/uploads/%'
  UNION SELECT icon FROM why_us WHERE icon LIKE '/uploads/%'
  UNION SELECT icon FROM body_areas WHERE icon LIKE '/uploads/%';")
ok=0; fail=0
for p in $paths; do
  case "$p" in /uploads/cms/*) continue;; esac
  out="$DEST/${p#/uploads/}"
  [ -s "$out" ] && { ok=$((ok+1)); continue; }
  mkdir -p "$(dirname "$out")"
  if curl -fsSL --max-time 30 "$BASE$p" -o "$out.tmp"; then mv "$out.tmp" "$out"; ok=$((ok+1)); echo "✓ $p"; else rm -f "$out.tmp"; fail=$((fail+1)); echo "✗ $p"; fi
done
echo "Done: $ok available locally, $fail failed."
