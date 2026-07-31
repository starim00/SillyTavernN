# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable workspace direction

- The 2026-07-29 reference image is a palette reference only: warm white, pale blue, mint, coral, cool grey, and deep blue-grey. Do not reproduce its character-poster composition.
- Role cards are a single user-facing type: a bundle of persona, opening
  content, prompt fields, and embedded worldbook. Do not show character,
  ensemble, scenario, or world card categories.
- Navigation is card-first: select a role card, then choose one of its chat
  histories or create a new chat. A chat cannot exist outside a card.
- Card contents may describe several people, a narrator, or an entire setting.
  Never split model prose into separate speaker messages or expose a singleton
  `currentCharacter`.
- The message stream is the primary surface. Participants are dynamic chips/lists, while context, lorebook matches, prompt trace, and Agent activity are supporting collapsible surfaces.
- Messages use their natural content height in one continuous stream; the
  message stream is the only conversation scrollbar. The composer starts at
  one compact line and grows with the user's draft, up to a practical cap.
- The user explicitly stopped further image generation for this implementation. Use code-native layout and Phosphor icons; do not add generated character art or decorative placeholder artwork.
- Tavern Helper and Prompt Template compatibility is a native product
  capability. Preserve and execute the card/preset data contracts they target,
  but do not make the ordinary chat flow depend on either third-party plugin's
  iframe, settings panel, modal layout, or generated DOM. Imported script
  buttons belong below the native composer, and prompt processing belongs in
  the native request pipeline. After the user trusts the whole card or preset
  script source, execute it through the first-party Tavern Helper-compatible
  browser API; do not infer per-capability grants or route card/preset scripts
  through the legacy plugin sandbox. Provider secrets and direct database
  handles remain server-only.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
