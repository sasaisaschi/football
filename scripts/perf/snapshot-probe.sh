#!/usr/bin/env bash
# Copies the current sources into a frozen measurement folder and runs the multi-seed probe there, so that editing the
# working tree during the (≈ 10 min) run cannot change seeds that start later. Usage: snapshot-probe.sh <dir> <out> [probe args]
set -e
dir="$1"; out="$2"; shift 2
root="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$dir/src" "$dir/scripts"
mkdir -p "$dir"
cp -r "$root/src" "$root/scripts" "$dir/"
cp "$root/package.json" "$root/vite.config.ts" "$root/tsconfig.json" "$dir/"
[ -e "$dir/node_modules" ] || cmd //c mklink //J "$(cygpath -w "$dir/node_modules")" "$(cygpath -w "$root/node_modules")" > /dev/null
cd "$dir" && node scripts/probe.mjs "$@" > "$out" 2>&1
