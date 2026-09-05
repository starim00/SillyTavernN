# Project instructions

Product and interaction rules are collected in
[docs/DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md). Keep architecture,
compatibility, and acceptance documents aligned with those rules and the
verified implementation; do not retain contradictory implementation plans.

## Clean-room boundary

- This repository is a new implementation. Do not import, copy, or vendor source code from `/Users/hutiance/SillyTavernNG`.
- The old repository may only be inspected to understand observable formats and compatibility behavior.
- Compatibility fixtures must be newly authored, minimal, and free of private conversations or credentials.
- Do not vendor JS-Slash-Runner or ST-Prompt-Template. Store only URL, pinned commit, manifest metadata, hashes, and clean-room host contracts.

## Product model

- The user-facing primary object is a role card. A card is one unified content
  bundle containing setting, opening content, prompt fields, and any embedded
  worldbook; do not expose card kinds such as character, ensemble, scenario, or
  world.
- Every conversation belongs to exactly one card. The primary flow is card
  selection, then that card's chat history or a new chat.
- A card's content may still describe several people, a narrator, or an entire
  setting. Do not turn those contents into separate speaker messages or expose
  a singleton `currentCharacter`.
- Every imported worldbook entry is created with `agentEditable=false`, even if
  imported metadata claims otherwise. A legacy book-level flag is compatibility
  metadata only and never authorizes a write.

## Frontend direction

- Use a generic, restrained workspace layout. Character artwork is optional content supplied by imported cards, never structural UI.
- Palette: warm white, pale blue, mint status, coral primary action, cool grey borders, deep blue-grey text.
- Keep the message stream dominant. Context, prompt trace, worldbook hits, and Agent activity are collapsible supporting surfaces.
- Use Phosphor icons. Do not use emoji, hand-drawn SVGs, CSS illustration, or decorative placeholder art.
- Keep a fresh light-novel tone, platform-general and suitable for multi-character or world-only cards.

## Browser validation

- Codex Browser and connected Chrome are available for this project. Use the
  in-app Browser for ordinary local UI inspection, and use Chrome when the
  user's existing tab, session, extension state, or an explicit Chrome request
  matters.
- Do not start a standalone Playwright CLI/browser for interactive QA merely
  because the app is local. Use standalone Playwright only when the user asks
  for it, the task specifically requires CLI traces or Playwright test
  artifacts, or Browser and Chrome have both been confirmed unavailable.
- Historical notes that mention Playwright screenshots describe past evidence,
  not a preferred browser-control route. Browser APIs named `playwright` inside
  Codex Browser/Chrome still belong to those Codex browser surfaces and do not
  justify launching standalone Playwright.

## Agent and extension safety

- Model tool writes are server-authorized and must re-check actor, the target
  entry's `agentEditable` value (when a target entry exists), revision,
  confirmation, and run cancellation inside the write transaction.
- Model tool code cannot toggle an entry's `agentEditable` value.
- Imported executable content is controlled by whole-source user trust. Once a
  card, preset, or legacy script source is trusted, run it with the old
  SillyTavern execution model: same-origin access to the main DOM, browser
  storage, Tavern Helper/MVU globals, and ordinary browser networking. Do not
  add per-capability grants or treat an iframe as a security boundary. Provider
  secrets and direct database handles remain server-only.
- Legacy script actor and Agent actor are distinct. One permission must never imply the other.

## Git workflow

- This repository uses `main` for routine changes; do not create feature branches.
- After reviewing the scoped staged changes and running relevant checks, commit and push directly to `origin/main`.
- Do not create or push another branch unless the user explicitly requests it.

## NAS deployment

- The live NAS deployment is `/volume1/docker/sillytavern-n/app` on
  `hutiance@192.168.50.244`; its `data` directory is persistent host storage.
- After pushing an application change to `origin/main`, run
  `scripts/update-nas.ps1` via PowerShell to synchronize and verify the NAS
  deployment. Do not leave the live NAS deployment behind the repository after
  a user-facing change unless the user explicitly asks not to deploy it.
- The update script must preserve the NAS `.env`, `data`, and UGREEN Docker
  panel registration. Never replace the deployment with an unregistered
  Compose project or an anonymous data volume.
