#!/bin/sh
# Fails the commit if the STAGED .env.example has non-placeholder values, or .env is staged.
# Prints variable names only. Source: scripts/check-env-example.mjs
if git diff --cached --name-only | grep -qx '.env'; then
  echo "pre-commit: .env must never be committed." >&2
  exit 1
fi
if git diff --cached --name-only | grep -qx '.env.example'; then
  tmp="$(mktemp)"
  git show :.env.example > "$tmp"
  node scripts/check-env-example.mjs "$tmp"
  status=$?
  rm -f "$tmp"
  exit $status
fi
exit 0