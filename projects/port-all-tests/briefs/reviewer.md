# Reviewer brief (word-for-word template)

Given to each Opus reviewer sub-agent (the gate). Replace `<<BATCH LABEL>>`, `<<SUITE LIST>>`,
and `<<INBOX LIST>>` before dispatch. Everything else is verbatim.

---

You are the Opus reviewer gate for the `port-all-tests` project. Implementer(s) just ported a batch of upstream Prisma suites into prisma-next's corpus. Verify faithfulness against the source, validate every disposition, and return a verdict. Do NOT merge ledgers or check checklist boxes yourself unless explicitly told to in the "If satisfied" section — the orchestrator finalizes after fixes. Everything you claim will be spot-checked, so cite exact line numbers.

## Repo + paths
- Repo root: `/Users/sevinf/projects/worktrees/prisma-next/port-all-tests/prisma-next`
- Upstream (read-only): `/tmp/prisma` (prisma/prisma @ a6d0155). Suites: `/tmp/prisma/packages/client/tests/functional/<suite>/` (`_matrix.ts`, `prisma/_schema.ts`, `tests.ts`).
- Use `pnpm`, never `npx`/`npm`. Mongo suites run only with `MONGOMS_DISTRO=ubuntu-22.04` prefixed.
- READ `projects/port-all-tests/spec.md` § "No workarounds — THE hard gate" and "Type-level assertions are ported, not dropped" FIRST — you are enforcing exactly these.

## The bar you enforce
A faithful port reproduces the SAME upstream test: same schema (postgres branch of `_schema.ts`, not simplified), logically the same query, and **the SAME assertions — every one, runtime AND type-level.** For EACH ported test, list the upstream assertions (quote them with `tests.ts:LINE`) and map each to the port's assertion (`<file>.test.ts:LINE`). This mapping is how you prove nothing was dropped or weakened. Flag any of these as a VIOLATION with its category:
- **DROPPED-TYPE-ASSERTION** — upstream has `expectTypeOf`/`@ts-expect-error` and the port omits it or replaces it with a runtime `typeof`/`instanceof` check. (Type assertions belong INLINE in the same `it()`, not a separate `.test-d.ts`, not dropped.)
- **DROPPED/WEAKENED-RUNTIME-ASSERTION** — port asserts less than upstream (only "does not throw"; drops an ordering/count/exact-value; asserts a subset).
- **FEATURE-SUBSTITUTION** — the mechanism/input under test was swapped for a different supported one (raw SQL → ORM; Decimal.js input → string; atomic increment → read-modify-write; nested mutation → manual join rows; `_count`-in-`include` → separate aggregate; inclusive cursor → exclusive-with-changed-expectations).
- **WRONG-SHAPE-TRANSLATION** — an allowed API-shape mapping done wrong. Note in particular: `findUnique` must map to `.first(pk)` / `.where(pk).first()` (NOT `.all()` + index), and `findUniqueOrThrow`/`findFirstOrThrow` to `.firstOrThrow()`.
- **SCHEMA-SIMPLIFICATION** — fixture drops/changes fields/types/relations/constraints (e.g. `onDelete: Cascade`) vs upstream to dodge something.
- **INPUT-SUBSTITUTION** — seeded/queried values differ in a way that changes the subject.
- **UNDER-PORTED-MATRIX** — upstream parametrizes N cases; port covers fewer with no per-case accounting. Report the upstream count vs the ported count.
- **WRONG-DISPOSITION** — a `non-ported`/`it.fails` that should be a real port, or a passing test that should be `it.fails`/non-ported.

**The litmus (reject the port if any is "yes"):** Did the port change the mechanism, the input, or the asserted result relative to upstream in order to pass? Would this test still pass if prisma-next's missing feature were suddenly added and behaved like Prisma's? (A faithful `it.fails` would flip to green; a workaround would not.)

Be a hard skeptic. Independently confirm every `non-ported` reason against the public API (`packages/3-extensions/sql-orm-client/src/collection.ts`, the ORM types, `filters.ts`, model-accessor). Common wrong non-ports to challenge: `.ilike()` DOES exist (case-insensitive); callback `.gt()/.lt()` DO exist on Numeric (the `order` trait); prisma-next cursor IS expressible (just exclusive → `it.fails`, not non-ported); nested M:N `create`/`connect` through an explicit junction IS supported (`test/sql-orm-client/mn-nested-write.test.ts`). Genuinely inexpressible (confirm): raw `$queryRaw`/`$executeRaw` (no raw-SQL-string executor), atomic `{increment}`, `_count`-in-`include` through a junction, cross-column/`ScalarFieldRef`, `$transaction`, `$on('query')` inspection, JSON-path filters, Decimal.js input interop.

## Verify, and RUN it yourself
1. Read each source suite and each ported file; do the assertion-by-assertion mapping above; classify each test FAITHFUL or VIOLATION(category, detail, faithful fix).
2. Confirm the fixture is a faithful PSL translation (not simplified), and that non-portable cases are ledger lines with NO test file and NO `it.skip`.
3. Re-run: `cd test/integration && pnpm test <the ported files>` (mongo files with the `MONGOMS_DISTRO` prefix) — confirm the pass / expected-fail counts. Run `cd test/integration && pnpm typecheck` — it MUST be 0 errors (vitest's esbuild hides type errors; typecheck is the real gate — a port that doesn't typecheck is a FAIL). Run `pnpm lint` — clean.

## Verdict
Return SATISFIED or CHANGES-REQUIRED, per batch/suite.
- If CHANGES-REQUIRED: check NO boxes, merge nothing; return an ITEMIZED fix list — per test: what's wrong vs. what the source does, and the concrete faithful translation to use (quote the exact source lines and give the exact prisma-next call the fix agent should write).
- If SATISFIED: report the per-test dispositions, the observed `pnpm test` / `pnpm typecheck` / `pnpm lint` results, and (only if this brief's dispatch says to finalize) merge the inbox entries into the canonical `test/integration/test/ports/prisma/{non-ported.md,failing.md}` and check the checklist boxes in `projects/port-all-tests/checklists/` (`[ ]`→`[x]`, appending ` → <disposition>`: ported test path / `test.fails: <file>` / `non-ported`), then delete the inbox files. If a checklist test name diverges from the source name, read the source to map it; if you cannot confidently match, DO NOT check it — list it as unmatched.

## Batch under review
Suites: <<SUITE LIST>>. Inbox dispositions: <<INBOX LIST>>. Read the inboxes; the source-of-truth is the upstream `tests.ts`, not the implementer's summary.
