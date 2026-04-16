# Quipu

A knowledge workspace for humans and AI agents. Local, markdown-first, and built around the idea that context should persist — not disappear into chat history.

<p align="center">
  <img src="screenshot.png" alt="Quipu Screenshot" style="border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,0.12),0 12px 40px rgba(0,0,0,0.2),0 40px 80px rgba(0,0,0,0.12);" width="100%" />
</p>

## Why Quipu

Most AI tools give you a chat window. Quipu gives you a workspace where knowledge accumulates. Your files carry context: annotations, instructions, AI history. Agents can read, update, and build on it over time.

This is closer to a living internal wiki than a retrieval system.

## Features

- **WYSIWYG Markdown Editing** — Rich text editing powered by TipTap. Write in a visual editor, get clean markdown output.
- **FRAME Annotations** — Per-file AI context. Annotate any text with comments; Claude picks them up via `/frame`. Instructions and history live in `.quipu/meta/`, never inside your source files.
- **Inline Comments** — Select any text and attach a comment. Comments display in a sidebar alongside your document, and travel with the file.
- **Integrated Terminal** — Full shell access within the app. Run builds, tests, or launch Claude directly from the editor.
- **File Explorer** — Browse, create, rename, and delete files and folders from the sidebar.
- **Custom `.quipu` Format** — Saves editor state (formatting, comments, metadata) as JSON. Also reads and writes plain `.md` and `.txt` files.
- **Keyboard Shortcuts** — `Ctrl+S` to save, `Ctrl+B` to toggle sidebar, `Ctrl+Shift+L` to send files to Claude.

## FRAME

FRAME is Quipu's per-file AI context layer. Every file in your workspace can carry:

- **Annotations** — Comments anchored to specific lines, visible to both you and your AI tools
- **Instructions** — Persistent context that tells agents how this file should be treated
- **History** — A log of every AI interaction on the file, so you can trace what changed and why

FRAME metadata lives in `.quipu/meta/` and never modifies your source files. Any tool (Claude, Copilot, your own scripts) can read and write them.

```bash
# In the integrated terminal, give Claude context on any file:
claude /frame project-proposal.md
```

## Tech Stack

- **Electron** — Desktop shell
- **React** + **Vite** — UI and build tooling
- **TipTap** — Rich text / WYSIWYG editor
- **xterm.js** — Terminal emulator
- **Go** — Optional backend server for browser mode

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode (Vite + Electron)
npm start
```

## Build

```bash
# Production build
npm run build

# Package as desktop app
npm run electron:pack
```

## Browser Mode

Quipu can also run in a browser with a Go backend providing file system access and a terminal over WebSocket.

```bash
npm run build
cd server && go run main.go -addr localhost:3000
```

## Project Structure

```
electron/          Electron main process and preload scripts
server/            Go backend for browser mode
src/
  components/      Editor, FileExplorer, Terminal, FolderPicker
  context/         React Context for workspace state
  services/        File system abstraction (Electron / browser)
```
