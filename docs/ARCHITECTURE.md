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

Separate origin
Legacy extension realm
      │ typed postMessage/RPC
      └─ capability broker in Fastify
```

This is a greenfield implementation. The upstream repository is not a source dependency.

## Domain boundaries

### Cards and conversations

`Card` is one user-facing content type. It collects the persona, opening
messages, prompt fields, compatible extension data, and any embedded lorebook
needed to start a chat. Legacy format tags may be retained inside compatibility
payloads, but they do not create separate card categories in the product.

Every conversation belongs to exactly one card. The primary navigation is:
select a card, then open one of that card's histories or create a new chat.
Participants found inside a card are prompt inputs, not independently selected
chat owners or separate message-stream speakers.

### Lorebooks

SQLite is authoritative. Compatibility JSON lives only in import/export
adapters. Every lorebook has:

- monotonically increasing `revision`;
- entries with independent revision, stable legacy UID, and their own
  `agentEditable` permission whose default and imported value is always
  `false`;
- explicit bindings to cards, conversations, personas, or global scope.

The deprecated book-level `agentEditable` value is retained only as
compatibility metadata and never authorizes a model tool write.

### Prompt assembly

The prompt engine emits ordered `PromptSegment` values with source, role,
priority, token estimate, and truncation policy. Imported presets retain every
prompt definition, including disabled and legacy unordered options. Users edit
and enable entries individually; only enabled entries enter assembly. Enabling
an unordered legacy entry assigns it a stable final order so current execution,
SillyTavern export, and re-import agree. Extensions modify segments through
deterministic hooks rather than raw global mutation.

### Providers

Providers implement a capability-described port. Native structured tools are
supplied as part of ordinary chat generation when the selected Provider
supports them. Plain text Providers remain valid for ordinary chat without
tools. Provider events are schema-validated before entering the application.
Generation uses bounded input, output, event, choice, tool-call, tool-argument,
and SSE-frame budgets. Only one generation may be active per conversation;
client disconnect, explicit cancellation, and budget exhaustion share one
abort path. SSE writes honor stream backpressure.

### History pagination

Conversation and message collections use versioned opaque cursors rather than
unbounded responses. Conversation cursors are ordered by `updated_at DESC, id`;
message cursors use `created_at DESC, id` and each returned page is restored to
chronological display order. Message swipes and compatibility context are
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

### Extensions

Native extensions use an `ExtensionRuntimeTransport`; production registration
requires a Worker transport. Requests and responses are structured-cloned and
limited to 2 MiB. Hook and lifecycle timeouts terminate and quarantine the
failed extension for the application session without blocking later extensions.
The inline adapter is reserved for tests and built-in trusted implementations.
Legacy extensions run on another origin with an old-DOM shell and exact-path
ESM facades. The realm cannot access the main DOM, storage, database, or
Provider secrets.

## Data placement

- SQLite: normalized metadata, messages, prompt presets, permissions, revisions, artifacts, Agent runs, and audit records.
- Files: imported originals, PNG/CharX assets, user-provided images, and locally installed extension bundles.
- Browser storage: ephemeral UI preferences only.

## Runtime ports

- `4173`: Vite web development.
- `4710`: main Fastify API.
- `4711`: isolated legacy extension realm.
