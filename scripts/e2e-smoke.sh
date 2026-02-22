#!/usr/bin/env bash
#
# End-to-end smoke test for Hyper-Pi.
#
# Starts hypivisor + Pi-DE, loads Pi-DE in a browser via surf,
# verifies no console errors on load and after clicking an agent.
#
# Prerequisites: cargo build, npm install in pi-de, surf CLI installed.
#
# Usage:
#   ./scripts/e2e-smoke.sh          # run test
#   ./scripts/e2e-smoke.sh --keep   # keep services running after test
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEEP=false
[[ "${1:-}" == "--keep" ]] && KEEP=true

cleanup() {
  if ! $KEEP; then
    tmux kill-session -t hypi-e2e-hv 2>/dev/null || true
    tmux kill-session -t hypi-e2e-de 2>/dev/null || true
  fi
}
trap cleanup EXIT

FAIL=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAIL=1; }

echo "e2e: building..."
(cd "$ROOT/hypivisor" && cargo build) > /dev/null 2>&1
(cd "$ROOT/pi-socket" && npx tsc) > /dev/null 2>&1

echo "e2e: starting services..."
# Kill any prior e2e sessions
tmux kill-session -t hypi-e2e-hv 2>/dev/null || true
tmux kill-session -t hypi-e2e-de 2>/dev/null || true
rm -rf "$ROOT/pi-de/node_modules/.vite"

tmux new-session -d -s hypi-e2e-hv "$ROOT/hypivisor/target/debug/hypivisor"
tmux new-session -d -s hypi-e2e-de "cd $ROOT/pi-de && npx vite --port 5199"

# Wait for services
echo "e2e: waiting for services..."
for i in $(seq 1 30); do
  if lsof -i :31415 -i :5199 2>/dev/null | grep -q LISTEN && \
     lsof -i :5199 2>/dev/null | grep -q LISTEN; then
    break
  fi
  sleep 1
done

if ! lsof -i :31415 2>/dev/null | grep -q LISTEN; then
  fail "hypivisor not listening on :31415"
  exit 1
fi
if ! lsof -i :5199 2>/dev/null | grep -q LISTEN; then
  fail "Pi-DE not listening on :5199"
  exit 1
fi
pass "services started"

echo "e2e: loading Pi-DE..."
surf navigate "http://localhost:5199" > /dev/null 2>&1
sleep 4

# Check 1: page renders (has interactive elements)
ELEMENTS=$(surf page.read --compact 2>&1 | grep -c 'button\|link' || true)
if [ "$ELEMENTS" -gt 0 ]; then
  pass "page rendered ($ELEMENTS interactive elements)"
else
  fail "page did not render (no interactive elements found)"
fi

# Check 2: no console exceptions on load
EXCEPTIONS=$(surf console --level error 2>&1 | grep -ci 'exception' || true)
if [ "$EXCEPTIONS" -eq 0 ]; then
  pass "no console exceptions on load"
else
  fail "$EXCEPTIONS console exception(s) on load"
  surf console --level error 2>&1 | grep -i exception | head -5
fi

# Check 3: click first agent (if any agents are connected)
AGENT_BUTTONS=$(surf page.read --compact 2>&1 | grep -c '^button \[' || true)
if [ "$AGENT_BUTTONS" -gt 1 ]; then
  # Re-read to get fresh refs, click the first agent (not Spawn Agent)
  FIRST_REF=$(surf page.read --compact 2>&1 | grep '^button \[' | head -1 | sed 's/.*\[\(e[0-9]*\)\].*/\1/')
  surf click --ref "$FIRST_REF" > /dev/null 2>&1
  sleep 4

  # Check 4: no console exceptions after click
  POST_EXCEPTIONS=$(surf console --level error 2>&1 | grep -ci 'exception' || true)
  if [ "$POST_EXCEPTIONS" -eq 0 ]; then
    pass "no console exceptions after agent click"
  else
    fail "$POST_EXCEPTIONS console exception(s) after agent click"
    surf console --level error 2>&1 | grep -i exception | head -5
  fi

  # Check 5: agent-interface rendered (message input appeared)
  HAS_INPUT=$(surf page.read --compact 2>&1 | grep -c 'textbox.*message\|Type a message' || true)
  if [ "$HAS_INPUT" -gt 0 ]; then
    pass "agent-interface rendered (message input present)"
  else
    fail "agent-interface did not render (no message input found)"
  fi
else
  echo "  ⊘ no agents connected — skipping agent click tests"
fi

echo ""
if [ $FAIL -ne 0 ]; then
  echo "e2e: FAILED"
  exit 1
fi
echo "e2e: all checks passed ✓"
