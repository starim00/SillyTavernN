# Test strategy and suite audit

The repository uses three feedback levels. Choose the narrowest level that can
disprove the change, and reserve the complete gate for integration, release,
and CI.

| Situation                              | Command                               | Scope                                                                     |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| Normal working-tree change             | `npm run test:changed`                | Tests affected by uncommitted changes and the current Git change set      |
| One or more named implementation files | `npm run test:related -- <paths...>`  | Tests connected through Vitest's import graph                             |
| One named test file or test name       | `npm test -- <test-file> -t '<name>'` | Explicit focused regression                                               |
| Complete source regression             | `npm test`                            | Every authored Vitest test under `apps/*/src` and `packages/*/src`        |
| Integration or release gate            | `npm run verify`                      | Format, lint, types, builds, source regression, and Sites packaging tests |

Vitest resolves every `@stn/*` workspace import to its TypeScript source. This
keeps focused and changed-file runs honest without rebuilding all packages
first. Build correctness remains an explicit part of `npm run verify`.

## Collection boundary

Only authored source tests are collected. Generated `dist/**/*.test.js` files
are excluded explicitly, and package/server build configurations no longer emit
test files beside production output. The explicit Vitest exclusion also handles
stale artifacts left by an older build. Web Sites packaging tests use Node's
test runner and remain part of `npm run verify`, outside the Vitest collection.

Live Responses tests in
`packages/providers/src/responses.integration.test.ts` are useful credentialed
smoke tests. They remain opt-in through their provider environment variables and
skip when no complete live configuration is present; local protocol behavior is
covered by deterministic provider tests.

## Audit criteria

A test remains in the suite when it protects at least one of these boundaries:

- a domain invariant, authorization rule, or transactional data guarantee;
- an imported/exported compatibility format or provider wire contract;
- a failure, cancellation, concurrency, rollback, or resource-limit path;
- user-visible state, rendering, or API normalization behavior;
- a previously observed regression with a plausible recurrence path.

Tests should be removed or rewritten when they only repeat an identical
assertion at the same layer, assert private implementation structure with no
observable contract, cover behavior that no longer exists, or cannot fail when
the protected behavior is broken.

## 2026-08-20 inventory

Before this audit, the default collector reported 590 passing tests. Of those,
239 came from generated `dist` files and matched source test names one-for-one.
The authored source suite contains 351 passing Vitest tests; the generated
duplicates are now outside the collection boundary.

| Area                 |   Tests | Why it remains                                                                                                                                              |
| -------------------- | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy host          |      23 | Pin/hash verification, path and origin rejection, safe mode, atomic install, and persisted enablement                                                       |
| Server               |      62 | Public API contracts, prompt assembly, imports, trusted compatibility routes, tool continuations, streaming failure states, workers, and secret persistence |
| Web                  |     112 | API/SSE normalization, reducer invariants, prompt and Tavern Helper compatibility, realm isolation, and rendered workspace behavior                         |
| Core                 |      83 | Portable imports, preset format round-trips, prompt goldens, macro behavior, token budgets, worldbook activation, and regex compatibility                   |
| Extension SDK        |      11 | Capabilities, worker quarantine, manifests, commands, settings, events, and ordered UI slots                                                                |
| Legacy compatibility |      10 | Exact locked surfaces, import rewriting, event ordering, and actor/capability enforcement                                                                   |
| Providers            |      21 | Chat/Responses payloads, stream termination, reasoning/tool continuations, diagnostics, and token estimates                                                 |
| Storage              |      29 | Migrations, revisions, transactions, cascades, Swipes, generation persistence, Agent authorization, and undo                                                |
| **Total**            | **351** | Authored deterministic Vitest regression suite                                                                                                              |

The four Sites tests are unique packaging/runtime checks and are counted only in
the complete `verify` gate. The live Responses suite contributes a dynamic
provider case for each complete credentialed configuration and is not included
in the deterministic count above.

Static review found no identical authored test bodies, no focused `.only`
tests, no pending `todo` placeholders, and no Vitest case without a direct
assertion. Similar behavior tested at different layers was retained only where
the layer adds a distinct contract—for example parser normalization, server
persistence, and web API normalization are separate failure boundaries.
