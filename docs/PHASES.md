# Phase plan and acceptance

## Phase 0 — Foundation

- npm workspaces, strict TypeScript, lint, test, and build.
- Clean-room import boundary.
- Self-authored compatibility fixtures.
- Product tokens and platform-general information architecture.

Exit: `npm run verify` succeeds and no code imports from SillyTavernNG.

## Phase 1 — Local domain and compatibility import

- SQLite/WAL schema and migrations.
- Cards use one product type and retain legacy format distinctions only as
  compatibility metadata.
- JSON, character PNG, CharX, lorebook, and chat import adapters.
- Unknown compatible fields preserved in `legacyPayload`.
- Imported lorebooks always force `agentEditable=false`.

Exit: round-trip, transaction rollback, malicious archive, unknown-field, and revision-conflict tests pass.

## Phase 2 — Conversation workspace

- Card-first library with per-card chat history.
- Conversation creation always starts from and remains bound to one card.
- Message, swipe, and branch persistence.
- Lorebook permission UI and collapsible context rail.
- Responsive desktop-first interface.

Exit: the core offline flow works without a Provider and refreshes without state loss.

## Phase 3 — Prompt engine

- Deterministic prompt segments and source trace.
- Worldbook keyword matching and recursion guard.
- Token budget estimation and priority-aware truncation.
- Native extension prompt hooks.

Exit: golden tests cover cards whose prompt content describes one person,
several people, a narrator, or a world without changing the card/chat model.

## Phase 4 — Providers and streaming

- Provider capability model.
- OpenAI-compatible chat adapter and deterministic fake adapter.
- SSE text deltas, structured tool-call events, abort, timeout, and error handling.
- Server-owned generation continues after an SSE client disconnect; a reloaded
  client restores task state and consumes the persisted result.
- Providers without native structured tool calling continue with ordinary text generation.

Exit: interrupted, cancelled, truncated, or resource-limited generation with
visible content persists atomically with an explicit state and finish reason;
empty interrupted output does not create a message.

## Phase 5 — Prompt presets

- Detect, preview, import, apply, edit, export, and conflict handling.
- SillyTavern OpenAI/Prompt Manager and text-generation setting compatibility.
- Preserve disabled and unordered optional prompt entries; users can enable,
  disable, and edit each entry without replacing the rest of the preset.
- Unknown fields preserved without prototype pollution.

Exit: fixture round-trips preserve optional-entry state and order, and an
applied preset changes the trace predictably.

## Phase 6 — Extension microkernel and trusted legacy runtime

- Native manifest/capability API.
- Whole-source trust for card/preset scripts plus old-style same-origin DOM,
  storage, network, Tavern Helper/MVU, and rich-message iframe execution.
- Exact URL-tree ESM facade contracts for:
  - JS-Slash-Runner `49efcca50809be8d48bfb1776bacf952ef16991b`;
  - ST-Prompt-Template `c80a572839f99a2aaf3d91cf9b7ebfc202c4ef0b`.
- User-installed plugin bundles only; no vendoring.

Exit: pinned smoke fixtures load, settings persist, prompt events are ordered,
and trusted sources can use the old browser capability surface.

## Phase 7 — In-conversation model tools

- Conversation-bound run state machine and tool catalog.
- Worldbook list/get/search/create/update/delete.
- Ordered conversation message listing, chat summary, and participant profile artifacts.
- Revision guard, confirmation, cancellation, idempotency, audit, diff, and undo.
- Permission is stored per lorebook entry; model tools cannot toggle it and
  imported permission metadata is ignored.
- Tool definitions travel with ordinary chat generation; there is no separate
  Agent chat, objective, or planning surface. Pending writes are recovered from
  the server-side waiting run and reviewed in the shared proposal modal.

Exit: the end-to-end fake tool-calling run proves proposal → human confirmation
→ authorized entry write → audit → undo, plus summary/profile creation and
cancellation.
