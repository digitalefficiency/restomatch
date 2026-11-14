#!/usr/bin/env bash
# SessionStart hook: make the Graphify CLI available in Claude Code cloud sessions.
#
# Graphify (https://github.com/Graphify-Labs/graphify, PyPI "graphifyy") maps the repo into a
# knowledge graph that agents query instead of grepping. Code is parsed locally with tree-sitter
# (no LLM, nothing leaves the machine, no telemetry). The version is pinned on purpose: bump it in
# one reviewed PR, never float it.
#
# This hook never blocks a session: every failure path exits 0, and the PreToolUse hooks in
# .claude/settings.json skip themselves when the CLI is missing.
set -u
GRAPHIFY_VERSION="0.9.99"

# Cloud sessions only; a local machine installs it once by hand (see CLAUDE.md).
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

if command -v graphify >/dev/null 2>&1 && graphify --version 2>/dev/null | grep -q "${GRAPHIFY_VERSION}"; then
  exit 0
fi
command -v uv >/dev/null 2>&1 || exit 0
timeout 150 uv tool install --quiet "graphifyy==${GRAPHIFY_VERSION}" >/dev/null 2>&1 || exit 0
exit 0
