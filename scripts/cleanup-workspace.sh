#!/bin/bash
# Size-gated workspace cleanup for codex_auth_switch.
# Rust target dirs are only wiped once they exceed their threshold, so day-to-day
# incremental builds stay fast. Run manually (npm run clean) or via the weekly
# launchd job (com.lucifer.codex-auth-switch.cleanup).
set -u

ROOT="/Volumes/Acer/Dev/codex_auth_switch"
DESKTOP_TARGET_LIMIT_GB=10
CLI_TARGET_LIMIT_GB=2
LOG_FILE="$HOME/Library/Logs/codex-auth-switch-cleanup.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"
}

# External volume may not be mounted; do nothing in that case.
[ -d "$ROOT" ] || exit 0

clean_target_if_large() {
  local dir="$1" limit_gb="$2"
  [ -d "$dir" ] || return 0
  local size_gb
  size_gb=$(du -sg "$dir" 2>/dev/null | cut -f1)
  if [ "${size_gb:-0}" -ge "$limit_gb" ]; then
    rm -rf "$dir"
    log "removed $dir (${size_gb}GB >= ${limit_gb}GB limit)"
  else
    log "kept $dir (${size_gb:-0}GB < ${limit_gb}GB limit)"
  fi
}

clean_target_if_large "$ROOT/src-tauri/target" "$DESKTOP_TARGET_LIMIT_GB"
clean_target_if_large "$ROOT/cli/target" "$CLI_TARGET_LIMIT_GB"

# Finder metadata and stray local bundles never belong in the workspace.
find "$ROOT" -name ".DS_Store" -not -path "*/node_modules/*" -delete 2>/dev/null
for dmg in "$ROOT"/*.dmg; do
  [ -f "$dmg" ] || continue
  rm -f "$dmg"
  log "removed stray bundle $dmg"
done

log "cleanup finished"
