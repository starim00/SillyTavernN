# Prototype Instructions

Run the local server yourself and open the preview with Codex Browser or the
connected Chrome browser. Prefer Chrome when the user's existing tab, session,
or extension state matters; otherwise use the in-app Browser. Do not launch a
standalone Playwright browser unless the user explicitly requests Playwright,
CLI trace/test artifacts are required, or both Browser and Chrome have been
confirmed unavailable. Do not give the user server-start instructions when you
can run it.

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
  capability. Preserve and execute the card/preset data contracts they target.
  Imported script buttons belong below the native composer, and prompt
  processing belongs in the native request pipeline. After the user trusts the
  whole card, preset, or script source, use the old SillyTavern execution model:
  background scripts run in the main page and regex-generated frontend
  documents run in unsandboxed same-origin iframes with direct `window.parent`,
  main DOM, browser storage, Tavern Helper/MVU globals, and ordinary browser
  networking. Do not infer per-capability grants, rewrite script source, proxy
  DOM/storage access, or present those iframes as security boundaries. Provider
  secrets and direct database handles remain server-only.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
