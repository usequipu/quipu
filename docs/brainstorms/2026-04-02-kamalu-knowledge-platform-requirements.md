---
date: 2026-04-02
topic: kamalu-knowledge-platform
---

# Kamalu: Distributed Knowledge Management Platform

## Problem Frame

Teams and individuals accumulate knowledge across many tools (Notion, scattered docs/ folders in repos, wikis, blog platforms) with no unified way to:

1. **Access slices of a shared knowledge base** — a project repo needs only its ADRs, the product team needs "product land", a public blog is just one folder. Today this requires either cloning everything or maintaining copies.
2. **Collaborate in realtime on documents** while keeping content as real, readable files.
3. **Let AI agents index and reason over relevant knowledge** without giving them access to the entire corpus.
4. **Control visibility** — some content is public (blog, open-source docs), some is team-scoped, some is private.

Existing tools fail because:
- **Notion/Confluence** — proprietary format, no file-based access, no partial sync, poor AI ergonomics
- **Wiki.js/GitBook** — read-heavy, weak collaboration, no CLI-first workflow for developers
- **Obsidian** — local-first single-user, no server-side permissions or partial sync
- **Git** — full history bloat, merge-conflict model is wrong for concurrent editing, no native permissions, thousands of daily edits don't map to commits
- **Yjs/Hocuspocus alone** — no files on disk (content lives as binary CRDT blobs in a database), no partial sync of file collections, no CLI workflow

Kamalu solves this by combining a **filesystem-first knowledge base** (real .md files on the server) with a **Yjs CRDT overlay for live collaboration**, a **PostgreSQL optimization layer** (permissions, search, metadata, versioning), and a **custom sync protocol** that delivers permission-filtered partial file sets to CLI users and desktop clients.

## System Overview

```
                    kamalu-server (Go)
                           |
            +--------------+--------------+
            |              |              |
     Kamalu Protocol    REST/WS API    Publishing API
     (partial sync)    (web UI + Yjs)  (public pages)
            |              |              |
       kamalu-cli     kamalu (site)    Public pages
       Quipu desktop  React + Yjs     Blog / Docs
            |              |
            +----- PostgreSQL -----+
                   (optimization layer)
                   - permissions & ACLs
                   - search index (tsvector)
                   - Yjs CRDT state (live sessions)
                   - user accounts & teams
                   - file metadata cache
                   - version snapshots
                          |
                   Filesystem (source of truth)
                   - .md / .quipu files
                   - images, PDFs, diagrams
                   - FRAME annotations (.frame.json)
                   - profiles (config files)
```

## Requirements

**Core Knowledge Model**

- R1. All content is stored as real files on the server filesystem. Markdown (`.md`) is the primary format. `.quipu` (TipTap JSON) and binary files (images, diagrams, PDFs) are also supported. The filesystem is the source of truth for content at rest.
- R2. PostgreSQL acts as an optimization and metadata layer: caches file content for fast access, stores permissions/ACLs, Yjs collaboration state for active editing sessions, search index, user accounts, version snapshots, and FRAME annotation metadata.
- R3. Documents support FRAME annotations — structured human and AI context stored as sidecar `.frame.json` files alongside the content file. FRAME annotations are metadata, not part of the collaborative editing envelope. FRAME annotations are excluded from realtime Yjs editing sessions; annotation changes are applied server-side outside the CRDT layer. FRAME read/write permissions follow the same path-glob + per-document ACL model as file content.
- R4. The system supports Google Docs-style version history: auto-snapshots on meaningful save events (session close, explicit save, periodic intervals) plus user-named snapshots. Snapshots are stored in PostgreSQL, not as a full commit DAG. Users can browse and restore previous versions.

**Partial Access & Permissions**

- R5. The server enforces path-based access control with per-document overrides. The default permission model uses path-glob patterns (e.g., `engineering/adrs/*`, `product/**`). Individual documents can have explicit ACL overrides that take precedence over path-glob rules (e.g., restricting a sensitive ADR to the security team even though `engineering/**` is broadly readable).
- R6. When a CLI user or Quipu desktop syncs from the server, they receive only the files their permissions allow — a server-enforced partial sync. This works through the Kamalu sync protocol (not Git).
- R7. The web UI respects the same permission model — users only see and navigate content they have access to.
- R8. Content can be marked as public (accessible without authentication) for publishing use cases like blogs and documentation sites.

**kamalu-cli**

- R9. The CLI speaks the Kamalu sync protocol — a custom protocol optimized for partial file sync with permissions. Commands include `kamalu clone`, `kamalu sync`, `kamalu push`, `kamalu pull`. Standard `git` commands do not apply.
- R10. The CLI also provides commands for managing permissions, profiles, server configuration, and version history (e.g., `kamalu history`, `kamalu snapshot`, `kamalu restore`).
- R11. Profiles (named sets of paths to sync) are stored as config files on the server and shareable. A user activates a profile to get a specific slice (e.g., `kamalu clone myserver/kb --profile=engineering`). Profiles are manageable from both the CLI and the web UI admin panel.

**kamalu-server**

- R12. The server is written in Go, hosts multiple knowledge bases per instance, and exposes three API surfaces: Kamalu sync protocol (for CLI/desktop), REST/WebSocket API (for the web UI and Yjs collaboration), and a publishing/content API (for public pages). Each knowledge base has independent permissions, profiles, and publishing configuration.
- R13. The server manages Yjs document synchronization for realtime collaborative editing: loads file content into a Yjs document when editing begins, synchronizes between connected clients via WebSocket, and flushes the Yjs state back to the filesystem file when the editing session ends (or periodically during long sessions).
- R14. The server maintains a full-text search index (PostgreSQL tsvector) over all content, respecting permissions in search results.
- R15. The server handles bidirectional sync: web UI edits flush to filesystem files; CLI pushes update the filesystem, invalidate the PostgreSQL cache, and notify connected web clients. When a CLI push modifies a file currently being edited in the web UI, the server merges the change into the active Yjs document (CRDT merge) rather than overwriting.

**kamalu (web site)**

- R16. The web interface provides a Notion-like document browsing and editing experience, reusing Quipu's TipTap editor, file explorer, and UI components as extracted shared packages.
- R17. Realtime collaborative editing with Google Docs-style multiple cursors and live presence, powered by Yjs/CRDT via Hocuspocus (or a Go-native Yjs provider).
- R18. The web UI supports publishing: designated paths can be rendered as a public-facing site (blog, documentation) with a basic theme. Content in designated public paths is automatically published when saved. Users with publish permissions can designate/un-designate paths as public. Customizable themes are deferred.
- R19. The web UI provides admin interfaces for managing users, teams, permissions, profiles, and version history.

**Quipu Desktop Integration**

- R20. Quipu desktop can connect to a Kamalu server as a remote, receiving only the content the user has permission to access via the Kamalu sync protocol.

**Shared Component Extraction (prerequisite)**

- R23. Quipu's TipTap editor, file explorer, and UI components are extracted into shared packages with a clean adapter/provider interface (no imports of WorkspaceContext, fileSystem.js, or frameService.js). Both Quipu desktop and Kamalu web depend on the same shared packages. This is a prerequisite for R16 and must be completed before Kamalu web UI development begins.

**AI & Indexing**

- R21. AI agents can authenticate and sync specific slices of the knowledge base via the CLI or a dedicated API, enabling RAG and reasoning over relevant documents.
- R22. FRAME annotations provide AI-readable context per document, making the knowledge base natively consumable by AI tools.
- R24. Documents should have a description field in their frontmatter (encouraged or mandatory). This description is indexed and serves as the basis for future AI discovery features. (MVP: store and index the description. Future features built on this foundation are deferred — see Future Vision below.)

## Success Criteria

- A developer can `kamalu clone myserver/kb --profile=engineering` and receive only the engineering docs as real .md files on disk — no sparse checkout setup required.
- A product manager can open the web UI, edit a document collaboratively with a colleague in realtime, and see the file updated on the server filesystem.
- A blog post written in the web UI is automatically published to a public URL.
- An AI agent can authenticate and pull only the `engineering/adrs/` slice to reason about architectural decisions.
- A user can browse version history of a document, see auto-snapshots and named snapshots, and restore a previous version.
- Quipu desktop can open a Kamalu remote workspace and edit files that sync back to the server.

## Scope Boundaries

- **In scope:** Three repos (kamalu-cli, kamalu-server, kamalu), the core knowledge model, permissions, partial sync protocol, web editor with collab, publishing, AI access, version snapshots.
- **Not in scope for MVP:** Mobile apps, offline-first web (beyond what Yjs provides naturally), custom themes for published sites (basic theme only), migration tools from Notion/Confluence, end-to-end encryption, Git compatibility.
- **Not in scope:** Full Git-style version control — Kamalu provides document snapshots/history, not a commit DAG with branches and merge commits.
- **Deferred:** Video/audio content, advanced analytics/usage tracking, plugin/extension system, Quipu "live editing" toggle (R20 covers basic remote workspace), AI context engineering features (see Future Vision).

## Future Vision: AI-Native Context Engineering

> This section describes a deferred capability that the MVP architecture should **enable** but not implement. The key MVP foundations are: mandatory description frontmatter (R24), the Kamalu sync protocol's tree API, and the permission model.

**Browse-before-clone pattern:** An AI agent (or a user in a chatbot) types a partial path (e.g., `engineering/adrs/`) and the Kamalu server returns the remote tree structure + frontmatter metadata for all matching documents — without cloning any content. The agent sees descriptions, tags, and relationships, then decides which documents to pull full content for.

**Frontmatter RAG index:** All document frontmatter (especially `description`) is indexed and searchable via a semantic/RAG API. An agent can ask "what do we know about authentication?" and get back a ranked list of relevant document metadata with paths — then selectively sync the ones it needs.

**On-demand content access:** Agents don't need to clone files to disk. The Kamalu API serves individual document content on request, respecting permissions. An agent can read `engineering/adrs/007-auth.md` via API without syncing the entire engineering slice.

**Permission-scoped AI views:** Different agents see different knowledge. A product AI sees product docs. An engineering AI sees ADRs and runbooks. Same knowledge base, permission-filtered views — context engineering at the organizational level.

## Key Decisions

- **Filesystem source of truth:** Real .md files on the server, not a database-only model. This means content is always human-readable, browsable, and portable — even if the server dies, you have files. PostgreSQL is an optimization layer, not the canonical store.
- **No Git:** Git's merge model, full-history-by-default, and commit-per-change paradigm are wrong for a collaborative knowledge base with thousands of daily edits and concurrent multi-user editing. Kamalu uses its own sync protocol instead.
- **Custom sync protocol (Kamalu protocol):** Optimized for partial file sync with server-side permission filtering. Simpler than Git's pack protocol because it syncs current file state, not a DAG of objects. The server knows what each user can access and sends only that.
- **Yjs for live collaboration:** Yjs is the CRDT layer for realtime editing. During active editing sessions, the Yjs document is the live state. When the session ends, Yjs state is serialized back to the markdown/quipu file on the filesystem. Hocuspocus (TipTap's official Yjs backend) provides authentication hooks and per-document access control.
- **Go for the server:** Good WebSocket support, strong filesystem handling, single-binary deployment. Kamalu-server is a new Go service (not an extension of Quipu's existing server/main.go).
- **Google Docs-style versioning:** Auto-snapshots on meaningful events + user-named snapshots stored in PostgreSQL. No full commit history. Users can browse and restore versions.
- **Quipu component extraction:** Editor, file explorer, and UI components are extracted as shared packages (not a fork). Kamalu and Quipu depend on the same packages but are separate products.
- **Path-glob + per-document overrides for permissions:** Path-glob patterns are the primary access control mechanism. Per-document ACL overrides allow exceptions. This balances simplicity with real-world flexibility.
- **Multi-repo per server:** A single Kamalu server instance hosts multiple knowledge bases, each with its own file tree, permissions, and configuration. Mirrors GitHub's model.
- **Profiles editable from both CLI and web UI:** Profiles define which paths to sync. Stored as config files on the server. Editable from CLI and web admin panel.

## Dependencies / Assumptions

- TipTap v3 Yjs integration (Hocuspocus / y-prosemirror) is stable enough for production collaborative editing
- Yjs state can be reliably serialized to/from markdown without data loss for typical editing workflows
- The Kamalu sync protocol can be built as a straightforward file-diff protocol (current file checksums + delta transfer) without needing Git's complexity
- Quipu component extraction requires decoupling Editor.jsx, FileExplorer.jsx, and related components from WorkspaceContext, fileSystem.js, and frameService.js — this is a significant refactor
- CLI push to a file currently being edited in the web UI can be merged via CRDT (Yjs ingests the new file state as a change)

## Outstanding Questions

### Resolved During Brainstorm

- **Why not Git?** Git's model is wrong for this use case: merge conflicts are the norm in concurrent editing (not the exception), thousands of daily edits don't map to commits, full history creates bloat, and filtering Git objects for partial access while maintaining protocol compatibility is infeasible without rewriting tree/commit hashes.
- **Permission granularity:** Path-glob patterns as default + per-document ACL overrides.
- **Profile management:** Both CLI and web UI.
- **Multi-repo architecture:** One server hosts multiple repos, each with independent configuration.
- **Storage model:** Filesystem source of truth + PostgreSQL optimization layer. Not database-only, not Git.
- **Versioning model:** Google Docs-style snapshots, not Git commit DAG.

### Deferred to Planning

- [Affects R9][Needs research] Kamalu sync protocol design: file-checksum-based delta sync, transport layer (WebSocket? HTTP/2?), conflict resolution for concurrent CLI + CLI sync operations.
- [Affects R13][Technical] Yjs-to-markdown serialization fidelity: how to handle round-trip lossy conversions (e.g., TipTap extensions that don't have markdown equivalents).
- [Affects R13][Technical] Yjs session lifecycle: when to create/destroy Yjs documents, garbage collection of idle sessions, memory management with many concurrent documents.
- [Affects R15][Technical] Merge strategy when a CLI push modifies a file with an active Yjs session: inject as a Yjs update? Lock the file? Notify and let the user decide?
- [Affects R4][Technical] Snapshot storage schema: how to store version snapshots efficiently in PostgreSQL (full file copy vs. diff-based).
- [Affects R16][Technical] Package extraction strategy for Quipu components — monorepo with workspaces vs. published npm packages.
- [Affects R18][Needs research] Publishing architecture — static site generation from markdown vs. server-rendered pages.
- [Affects R12][Technical] Go-native Yjs provider vs. running Hocuspocus (Node.js) as a sidecar. Go has no mature Yjs implementation — may need a Node sidecar for Yjs/Hocuspocus.

## Next Steps

→ `/ce:plan` for structured implementation planning
