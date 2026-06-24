# Dispatch D2 — Generic differ + `DiffableNode` (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 2 of 7. Implementer tier: sonnet. Builds on D1 (clean substrate, commit `a49991c19`).

## Task

Build the **RLS-agnostic** generic differ in the framework, and make the Postgres RLS IR nodes diffable. Authoritative detail: **slice spec §6-B (differ) and §6-C (nodes)** — follow the shapes given there exactly.

**Part 1 — framework differ (spec §6-B).** New file `packages/1-framework/1-core/framework-components/src/control/schema-diff.ts` (confirm the dir next to `control-result-types.ts`):
- `SchemaDiffOutcome = 'missing' | 'extra' | 'mismatch'`.
- `interface SchemaDiffIssue { coordinate: EntityCoordinate; outcome: SchemaDiffOutcome; message: string }` (import `EntityCoordinate` from the framework IR — confirm path, research said `../ir/storage`).
- `interface DiffableNode { identity(): EntityCoordinate; isEqualTo(other: DiffableNode): boolean }`.
- `function diffNodes(expected: readonly DiffableNode[], actual: readonly DiffableNode[]): readonly SchemaDiffIssue[]` — index both sides by a stable string key from `identity()` (e.g. `` `${entityKind}\0${namespaceId}\0${entityName}` ``); expected-only → `missing`; actual-only → `extra`; in both → `expected.isEqualTo(actual) === false` → `mismatch`. Deterministic: sort the returned issues by that key.
- Export all three (`SchemaDiffIssue`, `DiffableNode`, `diffNodes`) from the framework control entrypoint (`exports/control.ts`).
- **This file contains zero RLS knowledge** — it is generic over `DiffableNode`.

**Part 2 — Postgres nodes implement `DiffableNode` (spec §6-C).** In `packages/3-targets/3-targets/postgres/src/core/postgres-rls-policy.ts` and `postgres-role.ts`, implement the framework `DiffableNode` interface:
- `PostgresRlsPolicy.identity()` → `{ plane: 'storage', namespaceId: <this policy's namespace>, entityKind: 'rlsPolicy', entityName: this.name }` (the full wire name). `isEqualTo(other)` → narrow `other` to `PostgresRlsPolicy` (assert kind), return `this.name === other.name` (the wire name encodes the body — content-addressed equality).
- `PostgresRole.identity()` → `{ …, entityKind: 'role', entityName: this.name }`; `isEqualTo(other)` → `this.name === other.name`.
- The classes call `freezeNode`; define the methods on the **prototype** (class methods), not as frozen own-properties, so they survive the freeze. Confirm the policy node carries (or can derive) its `namespaceId` for the coordinate; if it doesn't, surface (don't invent storage).

## Scope

**In:** the differ file + exports + the two nodes implementing `DiffableNode` + unit tests for both. **Out:** introspection (D3), PSL (D4), planner (D5), verify wiring (D6), the integration test (D7). Do not call `diffNodes` from any verify/plan path yet.

## Completed when

- [ ] `schema-diff.ts` exports the three symbols; a framework unit test over synthetic `DiffableNode` arrays asserts each outcome (missing / extra / mismatch / clean) and deterministic ordering.
- [ ] `PostgresRlsPolicy`/`PostgresRole` implement `DiffableNode`; a Postgres unit test asserts: same body → same wire-name identity + `isEqualTo` true; different body → different wire name → `isEqualTo` false; role name equality.
- [ ] Gates (run once): package typechecks for framework-components + target-postgres; the two new unit tests; `pnpm lint:deps` (the framework differ must not import anything Postgres; the Postgres nodes import the framework `DiffableNode` — downward, allowed).

## Standing instruction

Tests-first. Stay on goal; the differ stays generic (no RLS). If making the policy node diffable needs data it doesn't hold (e.g. namespaceId), surface rather than inventing.

## Halt conditions

- The framework has no suitable `EntityCoordinate` to reuse, or it can't represent `entityKind: 'rlsPolicy'`/`'role'` — surface (spec §5 says reuse it).
- Defining methods on the frozen node classes is not possible cleanly — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push.

## References

- **Authoritative:** slice spec §6-B, §6-C, and §5 (settled decisions: reuse `PostgresRlsPolicy`/`PostgresRole` + `EntityCoordinate`; identity = wire name).
- Design: `../../../specs/design-generic-schema-differ.md` §2–§3.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — bounded: one generic module + two interface implementations + unit tests.
- **Time-box:** ~45 min. Overrun → halt and surface.
