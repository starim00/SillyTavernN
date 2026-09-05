# Compatibility targets

## Principles

- Compatibility means accepting portable content and reproducing the old
  browser execution path for sources the user explicitly trusts.
- Adapters normalize old JSON shapes while preserving compatibility payloads
  for export and the trusted runtime. Core operations use normalized types.
- Executable templates and scripts are detected during import and remain disabled until explicitly trusted.
- Worldbook hits in each before-card or after-card prompt slot are joined into
  one message in insertion order, retaining their individual trace sources.
  This grouping applies even when `squash_system_messages` is false; separate
  preset entries and chat messages keep their own boundaries.
- Trust is source-wide for card, preset, regex, and Tavern Helper scripts; there
  are no per-capability grants inside a trusted source. Conversation model-tool
  writes remain a distinct server-authorized actor.

## JS-Slash-Runner

- Repository: `https://gitlab.com/novi028/JS-Slash-Runner`
- Pinned commit: `49efcca50809be8d48bfb1776bacf952ef16991b`
- Manifest version: `4.8.19`
- `dist/index.js` SHA-256: `14a920868d1081dd9cd5bb0a17c3cc54e7fbf4c3eed8d74a4e4712645c8fafab`
- Local install directory: `${STN_DATA_DIR:-./data}/extensions/JS-Slash-Runner/`
- Realm URL tree: `/scripts/extensions/third-party/JS-Slash-Runner/`
- Distribution: user-installed; do not vendor because its AFPL terms require separate review.

The workspace can install this exact revision from the plugin panel. The
server-side installer fetches the pinned commit into a staging directory,
verifies every locked asset and reviewed external ESM surface, writes a local
installation receipt, and only then atomically publishes the directory. Card
and preset Tavern Helper envelopes are executed by the first-party compatible
runtime in the main web page; they do not pass through a capability broker.

Portable cards and presets keep JS-Slash-Runner data in the original Tavern
Helper envelopes:

- card: `data.extensions.tavern_helper.scripts` and `.variables`;
- preset: `extensions.tavern_helper.scripts` and `.variables`;
- legacy aliases such as `TavernHelper_scripts` and the historical `variales`
  typo are accepted on import but are not invented during export.

Folders and script records are preserved as data. Import reports their counts
and creates a separate, disabled `stn.tavern-helper` source setting. The user
may trust the whole card or preset source. Once trusted, enabled background
scripts execute in the main page with Tavern Helper/MVU globals, DOM and browser
storage access, and ordinary browser networking. Revoking source trust disposes
that source on the next runtime reload.

Tavern Regex data remains a separate `regex_scripts` array. It is never merged
with executable Tavern Helper scripts. Imported card- and preset-scoped regexes
start disabled and transform prompt/display copies only after an explicit
source grant; stored message bodies are unchanged. Full HTML documents produced
for display run as trusted, unsandboxed same-origin iframes. Their source is not
rewritten and can directly access `window.parent`, main DOM, local storage,
Tavern Helper/MVU globals, and external networks.

## ST-Prompt-Template

- Repository: `https://github.com/zonde306/ST-Prompt-Template`
- Pinned commit: `c80a572839f99a2aaf3d91cf9b7ebfc202c4ef0b`
- Manifest version: `1.17.6.8`
- Local install directory: `${STN_DATA_DIR:-./data}/extensions/ST-Prompt-Template/`
- Realm URL tree: `/scripts/extensions/third-party/ST-Prompt-Template/`
- Distribution: user-installed; do not vendor its AGPL bundle into the core build.

The native template pipeline implements EJS rendering, variable scopes, prompt
lifecycle events, and lorebook directives; its dependency version is declared
in `apps/web/package.json`. Pinned plugin asset contracts separately preserve
the reviewed worker/chunk paths. The native runtime does not execute through
the optional legacy host, and these contracts do not promise every upstream API.

## Trust posture

Imported executable content is unsafe by design until the user trusts its
source. After trust, the application intentionally provides old-project
compatibility rather than isolation:

- background scripts run in the main page;
- rich message iframes are same-origin and have no `sandbox` attribute;
- scripts can read and mutate the main DOM and browser storage;
- scripts can use ordinary browser networking and load remote modules;
- Tavern Helper, MVU, SillyTavern, jQuery, lodash, Vue, YAML, Zod, and toast
  globals are bridged directly where available;
- no script text rewriting, fake local storage, DOM proxy, or per-capability RPC
  is inserted between a trusted source and the browser.

Provider secrets and direct SQLite/database handles remain server-only and are
not browser globals. That server-side data placement is not presented as a
sandbox for trusted browser code.
