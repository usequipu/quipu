---
description: Read, create, or update the FRAME (per-file AI context) for a source file
argument-hint: [filepath]
allowed-tools: Read, Write, Bash(mkdir *), Bash(cat *)
---

# FRAME Command

Work with the FRAME (Feedback-Referenced Active Modification Envelope) for the specified file.

## Target File

`$ARGUMENTS`

If no file path is provided, use the most recently read or discussed file in this conversation.

## Instructions

1. **Compute the FRAME path**: `.quipu/meta/{relative-file-path}.frame.json`
2. **Read the FRAME** if it exists (use the Read tool on the computed path)
3. **If no FRAME exists**, create one with this template:

```json
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
```

4. **Display the FRAME** contents to the user in a readable format
5. **Ask what to update**: annotations, instructions, or just review

## Creating directories

Before writing a new FRAME, ensure the parent directory exists:

```bash
mkdir -p .quipu/meta/path/to/directory/
```

## Rules

- Use the `frame` skill for schema details and field reference
- All timestamps: ISO 8601 UTC
- History capped at 20 entries (remove oldest when exceeded)
- Annotations use `type`: review, todo, bug, question, instruction
- Store summaries in history, not full responses
