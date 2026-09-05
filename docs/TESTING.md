# Test strategy

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

## Reporting checks

Report the commands actually run, their results, and any skipped credentialed
or platform-specific checks. Test counts belong to that run's output, not to a
permanent capability claim in this document.

For documentation-only changes, inspect referenced implementation contracts,
check local Markdown links, run Prettier on the changed documents, and run
`git diff --check`. Source tests and browser QA are needed when executable
behavior or rendered UI changes, not solely because a design document changes.
