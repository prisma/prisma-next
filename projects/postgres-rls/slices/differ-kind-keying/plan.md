# Plan: differ pairs siblings by `(nodeKind, id)`

One cohesive substrate change. The interface change ripples across framework + SQL targets + Mongo nodes in a single compile unit — removing `SchemaDiffIssue.message` breaks the sqlite consumer immediately, and requiring `nodeKind` breaks Mongo's `implements DiffableNode` immediately — so it cannot be split into independently-compiling dispatches. One implementer dispatch (tests-first), one adversarial review, rework as needed.

Ticket: TML-3008. Branch: `slice/differ-nodekind-keying` off `origin/main` (this worktree switched to it; #950's branch is committed + pushed, safe to park). Commits: `tml-3008:` prefix, bot identity + DCO double sign-off.

## D1 — implementer (Sonnet-4.6-mid), tests-first

Execute in this order so intermediate states are coherent:

1. **Differ unit tests first** (`framework-components/test/schema-diff.test.ts`, 278 lines today):
   - same-name / different-`nodeKind` siblings (role `public` + namespace `public`) diff without throwing;
   - genuine same-`nodeKind` / same-id duplicate still throws `diffSchemas: duplicate id among siblings`;
   - every existing pairing unchanged; issues no longer carry `message`.
2. **Framework** (`control/schema-diff.ts`): `DiffableNode` gains `readonly nodeKind: string`; `diffChildren`/`insertNode` key on the `(nodeKind, id)` pair via a **single combined-key `Map`** (NOT a nested map) so insertion-order iteration — and therefore issue order — is byte-identical to today. Remove `message` from `SchemaDiffIssue`; delete `pathMessage`/its use. Rewrite the interface + `insertNode` docstrings (per-kind uniqueness, not global).
3. **Postgres role node** (`schema-ir/postgres-role-schema-node.ts`): delete `ROLE_ID_SIGIL`; `id` returns bare `name`; `nodeKind` already `= PostgresSchemaNodeKind.role` (satisfies the interface). Fix `isEqualTo`'s comment/logic (compares by identity, no sigil).
4. **Postgres diff** (`migrations/diff-database-schema.ts`): delete `withCleanRoleMessage` and its `.map(...)`.
5. **Sqlite** (`migrations/operations/tables.ts:212`): build the joined string from `path`/`reason` instead of `i.message`.
6. **Mongo nodes** (`2-mongo-family/3-tooling/mongo-schema-ir/`): each concrete node declares a genuine per-node `nodeKind` literal; the base keeps the `DiffableNode` conformance whole. Mongo's diff algorithm is untouched.
7. **CLI verify output tests**: update expected path segments where the `role:` sigil previously appeared — now bare names.
8. **ADR** (`projects/postgres-rls/specs/adr-schema-diff-over-structured-ir.md`): amend per spec AC-6.

Validate before returning (save output to files, read once):
- `pnpm build` (framework-components is consumed downstream — refresh dist),
- forced typecheck, whole `pnpm lint` on touched packages, `pnpm lint:deps`,
- `pnpm test:packages` + `test:integration` + `test:e2e`,
- `pnpm fixtures:check`,
- **golden `plan()` diff byte-identical** on existing examples (no migration op moves — this is verify/diff-shape only),
- multi-space guards.

Return: diff summary, the new/changed differ tests, and the validation evidence (paths + tail).

## D2 — reviewer (Opus-4.8-mid), adversarial

Focus: (a) issue **order** unchanged for every non-role case (byte-identity risk lives here); (b) `nodeKind` keying can't mis-pair anything that used to pair — confirm no existing slot had cross-kind same-id children that now *stop* pairing; (c) Mongo `nodeKind` values are genuine, not a shared constant; (d) no stray `message` reader remains; (e) the ADR edit matches the code. Verify the golden `plan()` diff is actually empty, not asserted-empty.

## D3+ — rework

Address review + any CI/CodeRabbit findings; fix the class, not the instance. Re-run the full gate before green.

## DoD

Spec AC 1–6 met; sigil, `withCleanRoleMessage`, `SchemaDiffIssue.message` gone; full gate green; golden `plan()` diff byte-identical; PR opened; merge order coordinated so this lands before #950 rebases.
