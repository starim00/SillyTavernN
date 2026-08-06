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
tools.

### Conversation model tools

The model never receives direct repositories. Ordinary conversation generation
selects tools from a conversation-scoped catalog; server policy validates the
actor, conversation, participant, worldbook permission, and arguments;
revision-guarded transactions perform the change; the audit record and inverse
patch commit atomically with it. `AgentStore` and the Agent run tables are
internal execution names, not a separate user-facing Agent or objective flow.

### Extensions

Native extensions run in workers or sandboxed iframes with typed capabilities. Legacy extensions run on another origin with an old-DOM shell and exact-path ESM facades. The realm cannot access the main DOM, storage, database, or Provider secrets.

## Data placement

- SQLite: normalized metadata, messages, prompt presets, permissions, revisions, artifacts, Agent runs, and audit records.
- Files: imported originals, PNG/CharX assets, user-provided images, and locally installed extension bundles.
- Browser storage: ephemeral UI preferences only.

## Runtime ports

- `4173`: Vite web development.
- `4710`: main Fastify API.
- `4711`: isolated legacy extension realm.
