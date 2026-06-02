#!/usr/bin/env bash
set -euo pipefail

# Pre-release gate for qulib. Run before `gh release create`.
# Usage: scripts/pre-release.sh <version>   e.g. scripts/pre-release.sh 0.8.3
#
# Publishing uses OIDC trusted publishing via publish.yml (GitHub Actions).
# DO NOT run `npm publish` locally — the OIDC token only exists in GHA context.
# One-time human setup: npmjs.com → @qulib/core + @qulib/mcp → Settings →
#   Trusted Publisher → GitHub Actions → TapeshN/qulib / publish.yml

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>  (e.g. $0 0.8.3)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1${2:+: $2}" >&2; FAIL=1; }

echo ""
echo "[pre-release] qulib v${VERSION}"
echo ""
echo "── checks ──────────────────────────────"

# 1. Must be on main
BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == "main" ]]; then pass "on branch main"; else fail "on branch main" "currently on '$BRANCH'"; fi

# 2. Must be up to date with origin/main
git -C "$ROOT" fetch origin main --quiet 2>/dev/null || true
BEHIND=$(git -C "$ROOT" rev-list HEAD..origin/main --count 2>/dev/null || echo "0")
if [[ "$BEHIND" == "0" ]]; then pass "up to date with origin/main"; else fail "up to date with origin/main" "$BEHIND commit(s) behind — git pull first"; fi

# 3. Clean working tree
STATUS=$(git -C "$ROOT" status --porcelain)
if [[ -z "$STATUS" ]]; then pass "clean working tree"; else fail "clean working tree" "uncommitted changes"; fi

# 4. core version == argument
CORE_VER=$(node -p "require('$ROOT/packages/core/package.json').version" 2>/dev/null || echo "ERR")
if [[ "$CORE_VER" == "$VERSION" ]]; then pass "@qulib/core version == $VERSION"; else fail "@qulib/core version" "package.json says $CORE_VER, expected $VERSION"; fi

# 5. mcp version == argument
MCP_VER=$(node -p "require('$ROOT/packages/mcp/package.json').version" 2>/dev/null || echo "ERR")
if [[ "$MCP_VER" == "$VERSION" ]]; then pass "@qulib/mcp version == $VERSION"; else fail "@qulib/mcp version" "package.json says $MCP_VER, expected $VERSION"; fi

# 6. mcp @qulib/core dep == argument (dependency alignment)
MCP_CORE_DEP=$(node -p "require('$ROOT/packages/mcp/package.json').dependencies['@qulib/core'] || 'missing'" 2>/dev/null || echo "ERR")
if [[ "$MCP_CORE_DEP" == "$VERSION" ]]; then pass "@qulib/mcp dep on @qulib/core == $VERSION"; else fail "@qulib/mcp dep on @qulib/core" "currently $MCP_CORE_DEP, expected $VERSION — bump packages/mcp/package.json"; fi

# 7. CHANGELOG has [X.Y.Z] section
if grep -qE "^\[${VERSION}\]" "$ROOT/CHANGELOG.md" 2>/dev/null; then
  pass "CHANGELOG [$VERSION] section exists"
else
  fail "CHANGELOG [$VERSION] section" "no [${VERSION}] entry in CHANGELOG.md — promote [Unreleased] first"
fi

# 8. Tag does not already exist on remote
if git -C "$ROOT" ls-remote --tags origin "refs/tags/v${VERSION}" 2>/dev/null | grep -q "v${VERSION}"; then
  fail "tag v${VERSION} not yet pushed" "tag already on remote — was this already released?"
else
  pass "tag v${VERSION} not yet on remote"
fi

# 9. Build + test
echo ""
echo "── build + test ─────────────────────────"
if (cd "$ROOT" && npm ci --silent 2>&1 && npm run build --silent 2>&1 && npm test 2>&1); then
  pass "npm ci + build + test"
else
  fail "npm ci + build + test" "see output above"
fi

echo ""
echo "── result ───────────────────────────────"
if [[ $FAIL -ne 0 ]]; then
  echo "[pre-release] FAIL — fix the issues above before releasing."
  echo ""
  exit 1
fi

echo "[pre-release] PASS — all checks green."
echo ""
echo "Run this to publish (triggers publish.yml via GitHub Actions):"
echo ""
echo "  gh release create v${VERSION} --title 'qulib v${VERSION}' --notes-from-tag"
echo ""
echo "Then monitor:"
echo "  gh run watch"
echo ""
echo "Then verify:"
echo "  npm view @qulib/core version && npm view @qulib/mcp version"
echo ""
echo "Prerequisite (one-time per package, on npmjs.com):"
echo "  @qulib/core + @qulib/mcp → Settings → Trusted Publisher → GitHub Actions"
echo "  Repository: TapeshN/qulib   Workflow: publish.yml"
echo ""
