# SillyTavern N

SillyTavern N is a clean-room, compatibility-first AI role-playing workspace. It keeps the portable content ecosystem—role cards, lorebooks, prompt presets, and trusted legacy extensions—while rebuilding the runtime around explicit domains, typed ports, transactional storage, and auditable model tools inside ordinary conversations.

## Status

Development currently covers the Phase 0–7 vertical slice:

- clean-room monorepo and compatibility fixtures;
- normalized cards, conversations, lorebooks, presets, and artifacts;
- SQLite/WAL repositories with revision checks;
- card-first chat history, conversation workspace, and prompt assembly;
- OpenAI-compatible and deterministic fake providers;
- preset import/export with preserved optional entries, per-entry enablement,
  and user-editable prompt content;
- isolated legacy-extension realm contracts for JS-Slash-Runner and ST-Prompt-Template;
- Ordinary conversation worldbook, message-list, summary, and participant-profile tools with confirmation, audit, and undo.

See [docs/PHASES.md](docs/PHASES.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts the complete local vertical slice: the React workspace,
Fastify API, SQLite storage, deterministic fake Provider, and the separate-origin
legacy realm. Development seed data is enabled by default; use
`STN_SEED_DEMO=false npm run dev` to verify first-run and empty-workspace flows.

The default endpoints are:

- Web: `http://localhost:4173`
- API: `http://localhost:4710`
- Legacy realm: `http://localhost:4711`

Use `.env.example` to override local paths and ports.

The browser workspace is connected to the real local API for conversation
creation, portable imports, message persistence, SSE generation, prompt trace,
Provider connections, per-entry worldbook permissions, in-conversation model
tool proposals, per-entry preset editing, confirmation, audit, cancellation,
and undo. Run the complete repository gate with:

```bash
npm run verify
```

## User-installed compatibility plugins

Plugin source is not part of this repository. Open **插件** in the workspace and
choose **安装固定版本** to fetch the reviewed repository and exact commit into
the runtime-only data directory:

- `${STN_DATA_DIR:-./data}/extensions/JS-Slash-Runner/`
- `${STN_DATA_DIR:-./data}/extensions/ST-Prompt-Template/`

The installer stages the checkout, verifies the commit, manifest, entry point,
every runtime-served asset, static import surfaces, and SHA-256 locks, then
atomically moves it into place and records `.stn-install.json`. Assets are
re-read and re-hashed before each response; unlisted files and symbolic links
are not served. An existing unverified directory is never overwritten.

Installation only makes the verified bundle available. It does not trust or
enable the plugin, create its isolated realm, grant it card/preset read
capabilities, or execute imported scripts. Host enablement is persisted
separately, defaults to false, and can only be changed by the main application
origin. Those actions remain separate, explicit user choices. A manually
obtained checkout in the same directory is also accepted only when it passes the
same verification.

## Clean-room policy

No source code from the upstream SillyTavern repository or either target plugin is copied into this project. The plugins are installed by the user at pinned revisions and loaded only inside the legacy compatibility realm.

License selection for the new project is intentionally pending an explicit maintainer decision.
