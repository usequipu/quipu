#!/usr/bin/env bash
# PostToolUse hook for Read tool — loads FRAME sidecar if it exists.
# Receives JSON on stdin with tool_input.file_path and cwd.
# Outputs FRAME contents to stdout (appended to Claude's context).

set -euo pipefail

# Read the hook event JSON from stdin
INPUT=$(cat)

# Extract the file path that was just read
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Exit silently if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Determine workspace root (use cwd as workspace root)
WORKSPACE="$CWD"

# Compute relative path
REL_PATH="${FILE_PATH#"$WORKSPACE"/}"

# Skip if the file is already inside .quipu/meta (avoid recursive loading)
if [[ "$REL_PATH" == .quipu/meta/* ]]; then
  exit 0
fi

# Compute FRAME path
FRAME_PATH="${WORKSPACE}/.quipu/meta/${REL_PATH}.frame.json"

# If FRAME exists, output its contents
if [ -f "$FRAME_PATH" ]; then
  echo ""
  echo "--- FRAME context for ${REL_PATH} ---"
  cat "$FRAME_PATH"
  echo ""
  echo "--- End FRAME ---"
fi

exit 0
