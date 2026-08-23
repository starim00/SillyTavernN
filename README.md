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
- source-trusted old-style runtime contracts for JS-Slash-Runner, MVU, rich
  regex frontends, and ST-Prompt-Template;
- Ordinary conversation worldbook, message-list, summary, and participant-profile tools with confirmation, audit, and undo.

See [docs/PHASES.md](docs/PHASES.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Development

### Login password

The server protects workspace API access with a single password and an HttpOnly
session cookie. On the first startup it creates `data/config.json`, stores a
scrypt password hash there, and prints the generated password once in the
server log. Use the lock button in the web interface to change the password or
sign out. Changing the password invalidates previously issued sessions.

Keep `data/config.json` private. If the generated password is lost, stop the
server, remove only the `auth` object from that file, and start the server to
generate a new password without affecting the remaining configuration or
workspace data.

```bash
npm install
npm run dev
```

`npm run dev` starts the complete local vertical slice: the React workspace,
Fastify API, SQLite storage, deterministic fake Provider, and the optional
legacy plugin host. Trusted card and preset scripts execute in the web app and
do not use that host. Development seed data is enabled by default; use
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
and undo.

For ordinary changes, run only tests affected by the current working tree:

```bash
npm run test:changed
```

To test one or more implementation files and their import dependants, pass the
paths explicitly:

```bash
npm run test:related -- packages/core/src/prompt/assemble.ts
```

`npm test` runs the complete source regression suite. Run the slower build,
format, lint, type, source-test, and Sites packaging gate before integration or
release work:

```bash
npm run verify
```

See [docs/TESTING.md](docs/TESTING.md) for the test tiers and the latest suite
audit.

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
execute imported card/preset scripts. Script trust is a separate whole-source
user choice. Once trusted, compatible scripts execute with the old browser
model: direct page DOM, browser storage, Tavern Helper/MVU globals, and ordinary
networking. A manually obtained checkout in the same directory is accepted only
when it passes the same verification.

## Clean-room policy

No source code from the upstream SillyTavern repository or either target plugin
is copied into this project. Plugins remain user-installed at pinned revisions;
the clean-room host contract reproduces observable old-project behavior for
sources the user trusts.

All new implementation and project documentation belongs in this
`SillyTavernN` repository. The sibling `SillyTavernNG` checkout is a read-only
reference for observable formats and compatibility behavior.

License selection for the new project is intentionally pending an explicit maintainer decision.
