#!/usr/bin/env bash
set -euo pipefail

# Build the skills CLI with a baked-in Skills server address, pack it into a
# tarball, and drop that tarball into public/ so it is served straight from the
# Next.js app at  <SERVER>/skills-cli-<version>.tgz
#
# This is the ONE place you change to point the CLI at a different server.
#
# Usage:
#   scripts/release-cli.sh http://35.165.188.177:3000     # AWS  (now)
#   scripts/release-cli.sh http://10.20.30.40:3000        # intranet (later)
#
# After it finishes:
#   1. commit  public/skills-cli-*.tgz  (+ the cli/ changes the first time)
#   2. redeploy the app
#   3. share the printed `npx ...` command with users

SERVER="${1:-}"
if [[ -z "$SERVER" ]]; then
  echo "Usage: $0 <SKILLS_SERVER_URL>" >&2
  echo "  e.g. $0 http://35.165.188.177:3000" >&2
  exit 1
fi
SERVER="${SERVER%/}"   # strip any trailing slash

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/cli"

# Bump the patch version so every release produces a unique tarball filename.
# This sidesteps npx's cache reusing an older tarball at the same URL.
npm version patch --no-git-tag-version >/dev/null
VER="$(node -p "require('./package.json').version")"

echo "▶ Building CLI v$VER  (default registry baked in: $SERVER)"
SKILLS_DEFAULT_REGISTRY="$SERVER" pnpm build

echo "▶ Packing tarball"
npm pack >/dev/null
TGZ="$(ls -t skills-community-cli-*.tgz | head -1)"

mkdir -p "$ROOT/public"
cp "$TGZ" "$ROOT/public/skills-cli-$VER.tgz"   # versioned: guaranteed-fresh, cache-proof
cp "$TGZ" "$ROOT/public/skills-cli.tgz"        # stable alias: used by the website install snippet
rm -f "$TGZ"

cat <<EOF

✅ Released CLI v$VER

   Served at (stable):    $SERVER/skills-cli.tgz       <- website uses this
   Served at (versioned): $SERVER/skills-cli-$VER.tgz   <- share when you need to bust npx cache

   Users run:
     npx $SERVER/skills-cli.tgz install <skill-slug>

   Next steps:
     git add public/skills-cli.tgz public/skills-cli-$VER.tgz cli/
     git commit -m "release cli v$VER -> $SERVER"
     # then redeploy / restart the app  (see docs/cli-release.md)
EOF
