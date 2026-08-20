# Project instructions

## Clean-room boundary

- This repository is a new implementation. Do not import, copy, or vendor source code from `/Users/hutiance/SillyTavernNG`.
- The old repository may only be inspected to understand observable formats and compatibility behavior.
- Compatibility fixtures must be newly authored, minimal, and free of private conversations or credentials.
- Do not vendor JS-Slash-Runner or ST-Prompt-Template. Store only URL, pinned commit, manifest metadata, hashes, and clean-room host contracts.

## Product model

- The user-facing primary object is a role card. A card is one unified content
  bundle containing persona, opening content, prompt fields, and any embedded
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
- Durable user feedback on 2026-07-29: fresh light-novel tone, but platform-general and suitable for multi-character or world-only cards.

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
