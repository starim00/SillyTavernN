# Compatibility targets

## Principles

- Compatibility means accepting portable content and running explicitly trusted extensions, not reproducing the upstream internal architecture.
- Old JSON shapes terminate at adapters. Internal code uses normalized types.
- Executable templates and scripts are detected during import and remain disabled until explicitly trusted.
- Legacy plugin writes are capability-authorized and use a distinct actor from Agent runs.

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
installation receipt, and only then atomically publishes the directory. The
bundle imports a broad old-SillyTavern ESM surface and executes trusted
JavaScript. It therefore runs only in the legacy realm and starts disabled.
Host enablement is stored separately from discovery, survives restarts, and can
only be changed by a request from the configured main-app origin.

Portable cards and presets keep JS-Slash-Runner data in the original Tavern
Helper envelopes:

- card: `data.extensions.tavern_helper.scripts` and `.variables`;
- preset: `extensions.tavern_helper.scripts` and `.variables`;
- legacy aliases such as `TavernHelper_scripts` and the historical `variales`
  typo are accepted on import but are not invented during export.

Folders and script records are preserved as data. Import reports their counts
and creates a separate, disabled `stn.tavern-helper` source setting. Installing
or trusting JS-Slash-Runner never grants imported scripts permission to execute.
When the plugin is explicitly enabled, its isolated realm may receive a minimal,
host-scoped read projection of the current card/preset extension fields. That
projection recursively removes Tavern Helper envelopes and legacy script
aliases, so stored script source is not handed to the `legacy-plugin` actor.
The full source remains available for round-trip export; any future execution
path must use the distinct `embedded-script` actor and its own authorization.

Tavern Regex data remains a separate `regex_scripts` array. It is never merged
with executable Tavern Helper scripts. Imported card- and preset-scoped regexes
start disabled and can only transform prompt/display copies after an explicit
scope grant; stored message bodies are unchanged.

## ST-Prompt-Template

- Repository: `https://github.com/zonde306/ST-Prompt-Template`
- Pinned commit: `c80a572839f99a2aaf3d91cf9b7ebfc202c4ef0b`
- Manifest version: `1.17.6.8`
- Local install directory: `${STN_DATA_DIR:-./data}/extensions/ST-Prompt-Template/`
- Realm URL tree: `/scripts/extensions/third-party/ST-Prompt-Template/`
- Distribution: user-installed; do not vendor its AGPL bundle into the core build.

The compatibility contract covers EJS 3.1.9 syntax, variable scopes, prompt lifecycle events, lorebook decorators, stable imported object references, and its exact worker/chunk paths.

## Security posture

Legacy “sandbox” settings in either plugin are not treated as security boundaries. The NG realm:

- uses a separate origin;
- exposes stable in-memory mirrors through ESM facades;
- sends mutations through typed RPC;
- enforces per-plugin capabilities;
- exposes no network-egress broker in the current vertical slice; any future
  domain access must require an explicit per-plugin grant;
- never exposes Provider secrets or main-origin storage;
- can be terminated without losing the main chat draft.

Installing a verified bundle only marks it loadable by the compatibility host.
The main workspace does not create the realm until the user separately trusts
and enables the plugin, and imported executable content still requires its own
actor-specific authorization. Plugin assets are served only from the exact
required-asset lock and are re-read, containment-checked, and SHA-256 verified
for the response bytes.
