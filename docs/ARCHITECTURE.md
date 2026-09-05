# Architecture

## Decision

SillyTavern N is a TypeScript modular monolith with a microkernel-style extension boundary and hexagonal ports/adapters.

```text
React/Vite web
      │ REST + SSE
Fastify application
      │
      ├─ application commands and queries
      ├─ prompt engine and provider ports
      ├─ conversation model-tool catalog and policy
      └─ compatibility/import adapters
      │
SQLite/WAL + file assets

Trusted browser compatibility runtime
      ├─ card/preset scripts in the main page
      └─ unsandboxed same-origin message iframes
```

This is a greenfield implementation. The upstream repository is not a source dependency.

## Domain boundaries

### Cards and conversations

The role card is one user-facing content type. It collects the setting, opening
messages, prompt fields, compatible extension data, and any embedded lorebook
needed to start a chat. Legacy format tags may be retained inside compatibility
payloads and internal schemas, but they do not create separate card categories
in the product. Persona is the user's separate identity configuration.

Every conversation belongs to exactly one card. The primary navigation is:
select a card, then open one of that card's histories or create a new chat.
Participants found inside a card are prompt inputs, not independently selected
chat owners or separate message-stream speakers. The live storage model uses
`Conversation.cardId`; broader compatibility schemas are not the UI or database
contract.

### Lorebooks

SQLite is authoritative. Import/export adapters interpret legacy JSON shapes;
preserved compatibility payloads also remain in storage and are consumed by the
compatibility runtime. Every lorebook has:

- monotonically increasing `revision`;
- entries with independent revision, stable legacy UID, and their own
  `agentEditable` permission whose default and imported value is always
  `false`;
- explicit bindings to cards, conversations, participants, personas, or global scope.

The deprecated book-level `agentEditable` value is retained only as
compatibility metadata and never authorizes a model tool write.

### Prompt assembly

The prompt engine emits ordered `PromptSegment` values with source, role,
priority, token estimate, and truncation policy. Imported presets retain every
prompt definition, including disabled and legacy unordered options. Users edit
and enable entries individually; only enabled entries enter assembly. Enabling
an unordered legacy entry assigns it a stable final order so current execution,
SillyTavern export, and re-import agree. Native extensions modify segments through
ordered hooks. Trusted legacy scripts have their separate browser runtime and
prompt lifecycle contract described below.

### Providers

Providers implement a capability-described port. Native structured tools are
supplied as part of ordinary chat generation when the selected Provider
supports them. Plain text Providers remain valid for ordinary chat without
tools. Provider events are schema-validated before entering the application.
Generation uses bounded input, output, event, choice, tool-call, tool-argument,
and SSE-frame budgets. Only one generation may be active per conversation;
the server owns that generation after accepting the request, so an SSE client
disconnect does not cancel Provider work. Active and recently completed tasks
are queryable by conversation, allowing a reloaded client to restore the busy
state, refresh the persisted result, and finish browser-side compatibility
processing before acknowledging the task. Explicit user cancellation, server
shutdown, and budget exhaustion still abort Provider work. Connected SSE writes
honor stream backpressure, while writes become no-ops after the client detaches.

### History pagination

Conversation and message collections use versioned opaque cursors rather than
unbounded responses. Conversation cursors are ordered by `updated_at DESC, id`;
message pages use `created_at DESC, rowid DESC`, with the cursor's message ID
resolving the insertion-order tie-breaker. Each returned page is reversed for
display. Message swipes and compatibility context are
loaded in batches so query count does not grow per message. The web client
loads only the selected conversation's latest page and prepends older pages
while preserving the scroll anchor.

### Bounded workers

Imported compatibility regexes execute outside the server and browser main
threads. Worker batches have script, pattern, input, output, and wall-clock
limits; a timed-out or crashed worker is terminated and replaced. Prompt
assembly is asynchronous because it crosses this worker boundary.

Uploads are parsed with streaming multipart limits and staged in random
temporary files that are cleaned on every route outcome. Archive and compressed
metadata parsing must remain behind entry-count, compressed/uncompressed-size,
time, and worker-memory limits before normalized data reaches a database
transaction.

### Conversation model tools

The model never receives direct repositories. Ordinary conversation generation
selects tools from a conversation-scoped catalog; server policy validates the
actor, conversation, participant, worldbook permission, and arguments;
revision-guarded transactions perform the change; the audit record and inverse
patch commit atomically with it. `AgentStore` and the Agent run tables are
internal execution names, not a separate user-facing Agent or objective flow.

Every non-read tool requires human confirmation. New worldbook entries are
read-only by default; updating or deleting an existing entry also requires its
own `agentEditable` permission. Book-level compatibility metadata never grants
that permission. The model cannot toggle it. Undo is a human-requested action,
not a tool offered to the model.

### Extensions

Native extensions use an `ExtensionRuntimeTransport`; production registration
requires a Worker transport. Requests and responses are structured-cloned and
limited to 2 MiB. Hook and lifecycle timeouts terminate and quarantine the
failed extension for the application session without blocking later extensions.
The inline adapter is reserved for tests and built-in trusted implementations.

Imported card, preset, and Tavern Helper script sources have a separate trust
model. They start disabled. Trust is granted to the entire source rather than
to individual capabilities. Once trusted, background JavaScript executes in the
main page. Regex-generated frontend documents execute in unsandboxed,
same-origin `srcdoc` iframes and receive direct `window.parent`, main DOM,
browser storage, `TavernHelper`, `Mvu`, and `SillyTavern` access. This is an
old-SillyTavern compatibility contract, not a security boundary. Provider
credentials and direct database handles remain server-only because they are
never placed in the browser runtime.

## Data placement

- SQLite: normalized metadata, messages, prompt presets, permissions, revisions, artifacts, Agent runs, and audit records.
- Files: imported originals, PNG/CharX assets, user-provided images, and locally installed extension bundles.
- Server configuration: authentication and Provider secrets; keep the data directory private.
- Shared preset/Provider selection: server-side workspace preferences in SQLite.
- Browser storage: selected card/conversation and unsent drafts. Trusted legacy
  scripts can also use ordinary browser storage; it is not isolated or restricted
  to application UI preferences.

## Runtime ports

- `4173`: Vite web development.
- `4710`: main Fastify API.
- `4711`: optional pinned legacy plugin host; not used by trusted card/preset
  scripts or regex frontends.
