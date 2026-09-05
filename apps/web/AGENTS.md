# Frontend instructions

Follow the repository [development rules](../../AGENTS.md) and
[product and design principles](../../docs/DESIGN_PRINCIPLES.md).

## Implementation

- Build the application UI in `src/`. Reuse the existing CSS tokens and
  Phosphor icons.
- Keep navigation card-first and the message stream dominant. Card content may
  describe several people or a world without introducing separate card kinds
  or model-message speakers.
- Preset adjustments are frequent: keep the desktop preset editor directly
  visible on the left. History switching needs a menu entry, not a persistent
  sidebar. Put infrequent Persona switching in workspace settings, outside the
  primary toolbar and composer.
- Messages use natural content height in one continuous stream. Keep one
  conversation scrollbar and a compact composer that grows with its draft.
- Use code-native layout. Do not add generated character art or decorative
  placeholders. A visual reference only governs the scope explicitly selected
  by the user; it does not override the product model.
- Imported script buttons belong below the native composer; prompt processing
  belongs in the native request pipeline.
- Trusted card/preset scripts run in the main page. Trusted rich-message
  documents use unsandboxed same-origin iframes with direct parent DOM,
  browser storage, Tavern Helper/MVU globals, and ordinary networking.
  Do not add per-capability grants, source rewriting, or DOM/storage proxies.
  Provider secrets and direct database handles remain server-only.

## Validation

For rendered UI changes, start the local server and inspect the app using the
in-app Browser. Use connected Chrome when existing tabs, sessions, or extension
state matter. Apply the root instructions for standalone Playwright exceptions.

Check desktop and narrow layouts plus the affected interaction using
[the design checklist](../../design-qa.md). Pure documentation changes do not
require starting a server or browser.

## Sites packaging

Keep `.openai/hosting.json`, `worker/index.js`,
`scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact.
Before a Sites handoff, run `npm run build --workspace @stn/web` and
`npm run test:sites --workspace @stn/web` from the repository root. The build
must leave `dist/client/index.html`, `dist/server/index.js`, and
`dist/.openai/hosting.json` under `apps/web/`.
