import fs from './fileSystem';

// Template content for FRAME skill
const FRAME_SKILL = `---
name: frame
description: >
  This skill should be used when the user asks to "read a frame", "create a frame",
  "update annotations", "add file context", "check file metadata", or mentions FRAME,
  .quipu/meta, or per-file AI context. It teaches how to work with FRAME (Feedback-Referenced
  Active Modification Envelope) sidecar JSON files that store annotations, AI instructions,
  and conversation history for each source file.
triggers:
  - frame
  - FRAME
  - file annotations
  - file context
  - .quipu/meta
  - per-file metadata
  - sidecar
---

# FRAME (Feedback-Referenced Active Modification Envelope)

Use this skill when reading, creating, or updating FRAME metadata files for source files in the workspace.

## What is a FRAME?

A FRAME is a JSON sidecar file that stores per-file metadata:
- **Annotations**: Line-level notes (review comments, TODOs, bugs, questions)
- **Instructions**: Persistent AI context about what the file does and how to handle it
- **History**: Log of past AI interactions about this file (capped at 20 entries)

## File Location

FRAME files mirror the workspace folder structure under \`.quipu/meta/\`:

\`\`\`
workspace/
  src/
    components/
      Editor.jsx          # Source file
  .quipu/
    meta/
      src/
        components/
          Editor.jsx.frame.json   # Its FRAME sidecar
\`\`\`

**Path formula**: \`{workspacePath}/.quipu/meta/{relativePath}.frame.json\`

## JSON Schema (v1) — canonical

\`\`\`json
{
  "version": 1,
  "type": "frame",
  "id": "uuid-v4",
  "filePath": "src/components/Editor.jsx",
  "createdAt": "2026-03-01T12:00:00Z",
  "updatedAt": "2026-03-01T14:30:00Z",
  "annotations": [
    {
      "id": "uuid-v4",
      "line": 42,
      "text": "Refactor this to use useCallback",
      "type": "review",
      "author": "user",
      "selectedText": "const handleClick = () => { ... }",
      "timestamp": "2026-03-01T12:00:00Z",
      "responses": [
        {
          "id": "uuid-v4",
          "author": "assistant",
          "body": "Agreed. Wrapping in useCallback with [] deps since there are no closures over props.",
          "createdAt": "2026-03-01T14:30:00Z"
        }
      ]
    }
  ],
  "instructions": "This file handles the TipTap editor setup. Always preserve the comment mark extension when modifying.",
  "history": [
    {
      "id": "uuid-v4",
      "prompt": "Review this file for performance issues",
      "summary": "Found unnecessary re-renders in useEffect...",
      "timestamp": "2026-03-01T13:00:00Z"
    }
  ]
}
\`\`\`

### Field Reference

| Field | Type | Description |
|---|---|---|
| \`version\` | number | Always \`1\` for now |
| \`type\` | string | Always \`"frame"\` |
| \`id\` | string | UUID v4 for this FRAME |
| \`filePath\` | string | Relative path from workspace root |
| \`annotations[].type\` | string | One of: \`comment\`, \`review\`, \`todo\`, \`bug\`, \`question\`, \`instruction\` |
| \`annotations[].author\` | string | \`"user"\` or \`"assistant"\` |
| \`annotations[].text\` | string | The comment body (note: comments use \`text\`, responses use \`body\`) |
| \`annotations[].timestamp\` | string | ISO 8601 UTC |
| \`annotations[].responses[]\` | array | **Threaded replies** — see rules below |
| \`annotations[].responses[].body\` | string | Reply body (**\`body\`, not \`text\`**) |
| \`annotations[].responses[].createdAt\` | string | ISO 8601 UTC (**\`createdAt\`, not \`timestamp\`**) |
| \`annotations[].responses[].author\` | string | \`"user"\` or \`"assistant"\` |
| \`history[]\` | array | Capped at 20 entries (FIFO). Managed by the Quipu UI — don't write here unless asked. |
| \`instructions\` | string | Persistent context Claude should know about this file |

## Threaded replies (the \`responses\` array)

When the user asks you to **reply to a comment** in a FRAME, append to the target annotation's \`responses\` array. The schema is strict:

- The array **must** be named \`responses\` — not \`replies\`, not \`comments\`.
- Each response object has exactly these fields: \`id\`, \`author\`, \`body\`, \`createdAt\`.
  - \`body\` (not \`text\`, not \`content\`)
  - \`createdAt\` (not \`timestamp\`, not \`date\`)
  - \`author\`: use \`"assistant"\` when you write a reply
  - \`id\`: a fresh UUID v4
- Preserve every existing annotation and response. **Append only** — never reorder, modify, or remove existing entries unless the user explicitly asks.
- Do not touch the top-level \`history\` array when adding a reply. The Quipu UI manages history separately.

### Worked example

Input frame (one user question, no replies yet):

\`\`\`json
{ "version": 1, "type": "frame", "id": "...", "filePath": "notes.md",
  "createdAt": "...", "updatedAt": "...",
  "annotations": [
    { "id": "a1", "line": 3, "text": "What's the time complexity?",
      "type": "question", "author": "user", "timestamp": "..." }
  ],
  "instructions": "", "history": [] }
\`\`\`

After you reply to annotation \`a1\`:

\`\`\`json
{ "version": 1, "type": "frame", "id": "...", "filePath": "notes.md",
  "createdAt": "...", "updatedAt": "<now>",
  "annotations": [
    { "id": "a1", "line": 3, "text": "What's the time complexity?",
      "type": "question", "author": "user", "timestamp": "...",
      "responses": [
        { "id": "r1", "author": "assistant",
          "body": "O(n log n) — the sort dominates the loop.",
          "createdAt": "<now>" }
      ]
    }
  ],
  "instructions": "", "history": [] }
\`\`\`

Note: only \`updatedAt\` and the new response changed.

## How to Read a FRAME

To check if a file has a FRAME, compute the path and read it:

\`\`\`bash
# Given a file path, compute the FRAME path
FILE="src/components/Editor.jsx"
FRAME_PATH=".quipu/meta/\${FILE}.frame.json"

# Read it (returns the JSON or fails if not found)
cat "$FRAME_PATH" 2>/dev/null
\`\`\`

Or use the Read tool directly on the computed path.

## How to Create/Update a FRAME

1. Read the existing FRAME (or start with an empty one)
2. Modify the annotations, instructions, or history
3. Update \`updatedAt\` to current ISO 8601 timestamp
4. Ensure \`history\` has at most 20 entries (remove oldest if over)
5. Write the JSON back to the FRAME path
6. Create intermediate directories if they don't exist (\`mkdir -p\`)

## Rules

1. **Always use relative paths** in \`filePath\` (relative to workspace root)
2. **All timestamps** must be ISO 8601 UTC (e.g., \`2026-03-01T12:00:00Z\`)
3. **History cap**: Maximum 20 entries. When adding a new entry that would exceed 20, remove the oldest.
4. **Annotations use line numbers** as approximate anchors. They may become stale after edits — re-resolve by searching for nearby content.
5. **Never store full AI responses** in history. Use \`summary\` (1-3 sentences).
6. **Create directories** before writing: \`mkdir -p .quipu/meta/path/to/\`
7. **FRAME files are gitignored** — they contain per-developer context and should not be committed.

## When a FRAME is Auto-Loaded

A PostToolUse hook on the \`Read\` tool automatically checks for a FRAME when you read a file. If one exists, its contents are appended to your context. You do not need to manually load FRAMEs — they are injected automatically.

## Service Layer (for UI integration)

The \`src/services/frameService.js\` module provides programmatic access:

\`\`\`javascript
import frameService from './services/frameService.js';

// Read
const frame = await frameService.readFrame(workspacePath, filePath);

// Create (idempotent — returns existing if present)
const frame = await frameService.createFrame(workspacePath, filePath);

// Add annotation
await frameService.addAnnotation(workspacePath, filePath, {
  line: 42, text: 'Needs refactor', type: 'review', author: 'user'
});

// Add history entry
await frameService.addHistoryEntry(workspacePath, filePath, {
  prompt: 'Review for bugs', summary: 'Found null check missing on line 55'
});

// Update instructions
await frameService.updateInstructions(workspacePath, filePath,
  'This file handles auth. Always validate tokens before proceeding.'
);
\`\`\`
`;

// Template content for FRAME command
const FRAME_COMMAND = `---
description: Read, create, or update the FRAME (per-file AI context) for a source file
argument-hint: [filepath]
allowed-tools: Read, Write, Bash(mkdir *), Bash(cat *)
---

# FRAME Command

Work with the FRAME (Feedback-Referenced Active Modification Envelope) for the specified file.

## Target File

\`$ARGUMENTS\`

If no file path is provided, use the most recently read or discussed file in this conversation.

## Instructions

1. **Compute the FRAME path**: \`.quipu/meta/{relative-file-path}.frame.json\`
2. **Read the FRAME** if it exists (use the Read tool on the computed path)
3. **If no FRAME exists**, create one with this template:

\`\`\`json
{
  "version": 1,
  "type": "frame",
  "id": "<generate-uuid>",
  "filePath": "<relative-path>",
  "createdAt": "<now-iso8601>",
  "updatedAt": "<now-iso8601>",
  "annotations": [],
  "instructions": "",
  "history": []
}
\`\`\`

4. **Display the FRAME** contents to the user in a readable format
5. **Ask what to update**: annotations, instructions, or just review

## Creating directories

Before writing a new FRAME, ensure the parent directory exists:

\`\`\`bash
mkdir -p .quipu/meta/path/to/directory/
\`\`\`

## Rules

- Use the \`frame\` skill for schema details and field reference
- All timestamps: ISO 8601 UTC
- History capped at 20 entries (remove oldest when exceeded)
- Annotations use \`type\`: comment, review, todo, bug, question, instruction
- Store summaries in history, not full responses

## Annotation Type Behaviors

| Type | Behavior |
|------|----------|
| \`comment\` | Informational note. Read and acknowledge, no action unless imperative. |
| \`review\` | Mixed feedback — evaluate each point and propose improvements. |
| \`todo\` | Actionable task. Attempt to complete the described work. |
| \`bug\` | Reported defect. Investigate, confirm, and fix. |
| \`question\` | Author needs clarification. Answer referencing code context. |
| \`instruction\` | Persistent directive to follow when modifying this file. |

**Priority**: bug > todo > instruction > review > question > comment
`;

// Template content for load-frame hook script
const LOAD_FRAME_SCRIPT = `#!/usr/bin/env bash
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
REL_PATH="\${FILE_PATH#"$WORKSPACE"/}"

# Skip if the file is already inside .quipu/meta (avoid recursive loading)
if [[ "$REL_PATH" == .quipu/meta/* ]]; then
  exit 0
fi

# Compute FRAME path
FRAME_PATH="\${WORKSPACE}/.quipu/meta/\${REL_PATH}.frame.json"

# If FRAME exists, output its contents
if [ -f "$FRAME_PATH" ]; then
  echo ""
  echo "--- FRAME context for \${REL_PATH} ---"
  cat "$FRAME_PATH"
  echo ""
  echo "--- End FRAME ---"
fi

exit 0
`;

// Hook configuration to merge into settings.json
interface FrameHookEntry {
  type: string;
  command: string;
  timeout: number;
}

interface FrameHookConfig {
  matcher: string;
  hooks: FrameHookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: Array<{
      matcher: string;
      hooks?: Array<{ command?: string }>;
    }>;
  };
  [key: string]: unknown;
}

const FRAME_HOOK: FrameHookConfig = {
  matcher: 'Read',
  hooks: [
    {
      type: 'command',
      command: 'bash .claude/scripts/load-frame.sh',
      timeout: 5,
    },
  ],
};

async function installFrameSkills(workspacePath: string): Promise<void> {
  if (!workspacePath) return;

  const claudeDir = workspacePath + '/.claude';
  const skillsDir = claudeDir + '/skills';
  const commandsDir = claudeDir + '/commands';
  const scriptsDir = claudeDir + '/scripts';

  // Create directories
  await fs.createFolder(skillsDir);
  await fs.createFolder(commandsDir);
  await fs.createFolder(scriptsDir);

  // Write template files (skip if already exist)
  const files = [
    { path: skillsDir + '/frame.md', content: FRAME_SKILL },
    { path: commandsDir + '/frame.md', content: FRAME_COMMAND },
    { path: scriptsDir + '/load-frame.sh', content: LOAD_FRAME_SCRIPT },
  ];

  for (const file of files) {
    // Always write to ensure templates are up-to-date
    await fs.writeFile(file.path, file.content);
  }

  // Merge settings.json (add hook if not present)
  const settingsPath = claudeDir + '/settings.json';
  let settings: ClaudeSettings = {};
  let existingContent = '';

  try {
    existingContent = await fs.readFile(settingsPath);
    settings = JSON.parse(existingContent) as ClaudeSettings;
  } catch {
    // If file exists but has invalid JSON, don't overwrite it
    if (existingContent && existingContent.trim()) {
      console.warn('Skipping settings.json merge: existing file has invalid JSON');
      return;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = [];
  }

  // Check if our Read/load-frame hook already exists
  const hasReadHook = settings.hooks.PostToolUse.some(
    (entry) =>
      entry.matcher === 'Read' &&
      entry.hooks?.some((h) => h.command?.includes('load-frame.sh'))
  );

  if (!hasReadHook) {
    settings.hooks.PostToolUse.push(FRAME_HOOK);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }
}

export interface ClaudeInstallerService {
  installFrameSkills: (workspacePath: string) => Promise<void>;
}

const claudeInstaller: ClaudeInstallerService = {
  installFrameSkills,
};

export default claudeInstaller;
