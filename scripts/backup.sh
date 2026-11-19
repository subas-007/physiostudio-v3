#!/usr/bin/env bash
# Nightly encrypted backup of database + uploads. Cron: 15 1 * * * /opt/physiostudio/scripts/backup.sh
set -euo pipefail
DATA="${DATA_DIR:-/var/lib/physiostudio/data}"; UP="${UPLOAD_DIR:-/var/lib/physiostudio/uploads}"
OUT="${BACKUP_DIR:-/var/backups/physiostudio}"; KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p "$OUT"; ts=$(date +%Y%m%d-%H%M)
sqlite3 "$DATA/physiostudio.db" ".backup '$OUT/db-$ts.sqlite'"          # consistent online snapshot
tar -czf "$OUT/ps-$ts.tar.gz" -C "$OUT" "db-$ts.sqlite" -C "$(dirname "$UP")" "$(basename "$UP")"
rm -f "$OUT/db-$ts.sqlite"
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" -c "$OUT/ps-$ts.tar.gz" && rm "$OUT/ps-$ts.tar.gz"
fi
find "$OUT" -name 'ps-*' -mtime +"$KEEP_DAYS" -delete
echo "Backup written to $OUT"
# Copy off-site too (e.g. rclone to Google Drive / S3) – a backup on the same server is not a backup.
