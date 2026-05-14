#!/usr/bin/env bash
# Spike test: confirm kiro-cli works headlessly with piped stdio.
# Usage: ./scripts/spike-kiro.sh
set -euo pipefail

KIRO="${KIRO_BIN:-kiro-cli}"
TIMEOUT=30

echo "=== Spike: kiro-cli headless stdio test ==="
echo "Binary: $(which "$KIRO" 2>/dev/null || echo "$KIRO (not on PATH)")"
echo ""

# Test 1: --no-interactive with a simple prompt piped via argument
echo "--- Test 1: single prompt via argument + --no-interactive ---"
START=$(date +%s)
OUTPUT=$("$KIRO" chat --no-interactive --trust-all-tools "Reply with exactly: SPIKE_OK" 2>&1 | head -100)
END=$(date +%s)
ELAPSED=$((END - START))

echo "Elapsed: ${ELAPSED}s"
echo "Output (first 500 chars):"
echo "$OUTPUT" | head -20
echo ""

if echo "$OUTPUT" | grep -q "SPIKE_OK"; then
  echo "✅ Test 1 PASSED — got SPIKE_OK in output"
else
  echo "⚠️  Test 1 — SPIKE_OK not found verbatim (model may have wrapped it)"
  echo "   Check output above to confirm kiro responded."
fi

echo ""
echo "--- Test 2: piped stdin (echo into kiro) ---"
START=$(date +%s)
OUTPUT2=$(echo "Reply with exactly: PIPE_OK" | "$KIRO" chat --no-interactive --trust-all-tools 2>&1 | head -100)
END=$(date +%s)
ELAPSED=$((END - START))

echo "Elapsed: ${ELAPSED}s"
echo "Output (first 500 chars):"
echo "$OUTPUT2" | head -20
echo ""

if echo "$OUTPUT2" | grep -q "PIPE_OK"; then
  echo "✅ Test 2 PASSED — got PIPE_OK in output"
else
  echo "⚠️  Test 2 — PIPE_OK not found verbatim"
  echo "   Check output above to confirm kiro responded."
fi

echo ""
echo "=== Spike complete ==="
