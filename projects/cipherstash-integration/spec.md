# CipherStash integration — Umbrella

Production-grade CipherStash/ZeroKMS integration for Prisma Next: searchable application-layer field-level encryption on Postgres, plus the supporting framework gaps the integration shaves on its way through. The umbrella decomposes into three components shipped as independent project workstreams under this directory:

| Component | Path | Scope |
|---|---|---|
| Project 1 — Searchable-encryption MVP | [`project-1/spec.md`](project-1/spec.md) | `EncryptedString` with `eq` + `ilike`, full PSL + TS authoring parity, hand-authored migration files, end-to-end on live Postgres + EQL |
| Project 2 — Planner-driven DDL + expanded surface | [`project-2/spec.md`](project-2/spec.md) | `planTypeOperations` integration; `EncryptedNumber` / `EncryptedDate` / `EncryptedBoolean` / `EncryptedJson`; `orderAndRange` + `searchableJson` operators |
| `sql-raw-factory` — Public `raw\`...\`` factory | [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md) | User-facing tagged-template raw SQL factory layered on the `RawSqlExpr` AST node Project 1 ships |

The [umbrella plan](plan.md) sequences the three components and tracks status across them.

# Why an umbrella

The three components share a single product narrative ("ship CipherStash for Prisma Next") and a tightly entangled dependency graph — Project 2 is a strict expansion of Project 1, and `sql-raw-factory` consumes the `RawSqlExpr` AST node that Project 1 introduces because cipherstash's migration factories needed it first. Treating them as one umbrella with three components rather than three independent projects:

- **Single sequencing surface.** The umbrella plan answers "what lands first, what's in flight, what's blocked" for the whole integration in one place.
- **Single Linear surface.** The existing `cipherstash-integration` Linear project is the umbrella; sub-issues are organized by component.
- **Bounded scope per component.** Each component has its own spec/plan and ships on its own PR cadence. The umbrella doesn't add coordination overhead; it just reflects the relationships that already exist.

# Background

CipherStash provides searchable application-layer encryption for Postgres: plaintext is encrypted client-side via ZeroKMS (network KMS), stored as `eql_v2_encrypted` JSONB, and queried via the EQL Postgres extension which exposes encrypted-aware operators (`eql_v2.eq`, `eql_v2.ilike`, etc.) backed by per-column index configuration.

The CipherStash team built a first-attempt Prisma Next integration in their `cipherstash/stack` repo (`prisma-next` branch) and produced a [framework-gaps assessment](../../reference/framework-gaps.md) cataloguing the framework limitations that integration ran into. This umbrella is the *production* integration — superseding the first attempt — built on the framework seams those gaps motivated. Several of those seams have already merged on `main` ([PR #400](https://github.com/prisma/prisma-next/pull/400) — codec call context; [PR #402](https://github.com/prisma/prisma-next/pull/402) — unified `CodecDescriptor<P>`); others are in flight ([PR #404](https://github.com/prisma/prisma-next/pull/404) — invariant-aware ref routing; [PR #409](https://github.com/prisma/prisma-next/pull/409) — middleware `intercept` hook).

**Users.** Application teams using Prisma Next on Postgres who need searchable application-layer field-level encryption — typically PII columns (`email`, `name`, `address`) under regulatory requirements (HIPAA, GDPR, SOC2) where database-at-rest encryption is insufficient because the threat model includes the database operator.

# Components

## Project 1 — Searchable-encryption MVP

The shippable MVP. One column type (`EncryptedString`), two operators (`eq`, `ilike`), full PSL + TypeScript-contract authoring parity, hand-authored migration files using extension-provided factories. End-to-end-tested against live Postgres + EQL. Includes the `RawSqlExpr` AST node + lowerer arm — extracted from the migration-factories needs but generally useful and consumed downstream by `sql-raw-factory`.

See [`project-1/spec.md`](project-1/spec.md) for the full requirements, acceptance criteria, and task-spec breakdown.

## Project 2 — Planner-driven DDL + expanded surface

Promotes cipherstash from "ships with hand-authored migration files" to "the migration planner generates the per-column DDL automatically from the contract." Expands the type and operator surface to match the full first-attempt scope. Out of scope for Project 1.

See [`project-2/spec.md`](project-2/spec.md) — currently a stub; will be shaped properly after Project 1 ships and the framework dependencies it consumes ([TML-2338](https://linear.app/prisma-company/issue/TML-2338) / [TML-2339](https://linear.app/prisma-company/issue/TML-2339)) are merged.

## `sql-raw-factory` — Public `raw\`...\`` SQL factory

The user-facing tagged-template factory the framework's type declarations have been promising at `packages/2-sql/4-lanes/relational-core/src/types.ts:259` but never shipped. Layers a typed-template-literal API on top of the `RawSqlExpr` AST node Project 1 introduces, with type-level rejection of bare values, an `identifier(...)` escape hatch, and proper SQL-injection defense by construction.

`sql-raw-factory` is in the cipherstash umbrella because its existence is motivated by cipherstash's needs (and the AST node it consumes is shipped by Project 1). It is *not* a Project 1 dependency — Project 1 constructs `RawSqlExpr` instances directly via the package-internal API.

See [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md).

# Scope of the umbrella

This document is the **map of the umbrella**. Per-component specs own their own scope, requirements, and acceptance criteria; this document only owns:

- Why the three components form one umbrella (the dependency graph that ties them together).
- The component overview table and status (delegated to [`plan.md`](plan.md)).
- Cross-component design decisions that affect multiple components.
- The umbrella's relationship to in-flight framework PRs that affect more than one component.

# Cross-component design decisions

Three decisions are recorded at the umbrella level because they affect multiple components and would otherwise require duplicated rationale across the per-component specs.

## `RawSqlExpr` AST node lives in Project 1, not in `sql-raw-factory`

Project 1's migration factories need to issue raw EQL function calls (`SELECT eql_v2.add_search_config(...)`) inside `DataTransformOperation` bodies. The right shape for that — agreed in design discussion — is a first-class AST node (`RawSqlExpr`) joining the `AnyQueryAst` union, with a Postgres lowerer arm that parameterizes embedded `ParamRef`s through the standard codec pipeline.

The AST node is owned by Project 1 (the [`raw-sql-ast-node.spec.md`](project-1/specs/raw-sql-ast-node.spec.md) task spec) so Project 1 is unblocked without waiting on `sql-raw-factory`. `sql-raw-factory` consumes that AST node and adds the user-facing typed-template-literal surface on top. The cleavage is precise:

- **Project 1's task spec ships:** the AST node, the Postgres lowerer arm, and a small `planFromAst` envelope helper. Construction is package-internal — `RawSqlExpr.of(fragments, args)` directly.
- **`sql-raw-factory` ships:** the `raw\`...\`` template-literal factory; the `RawArg` type union (Expression | ParamRef | RawSqlIdentifier); the `identifier(...)` escape hatch and its lowerer arm; type-level rejection of bare values; the `param()` ergonomic re-export of `ParamRef.of`.

`sql-raw-factory` can ship before, after, or alongside Project 1. If it ships first, the AST work simply moves up into it; if Project 1 ships first (the expected order), `sql-raw-factory` consumes the AST node as-published.

## Migration factories produce `DataTransformOperation`s, not `rawSql({...})`

Project 1's migration factories (`cipherstash.addSearchConfig`, `cipherstash.activatePendingSearches`) produce `DataTransformOperation`s carrying `invariantId`s — not `rawSql({...})` `SqlMigrationPlanOperation`s. This decision is recorded in the [migration-factories task spec](project-1/specs/migration-factories.spec.md); it is also relevant to Project 2, which will compose the same operation shape via the planner. The reason is that PR #404's invariant-aware ref routing only routes through `operationClass: 'data'` ops; search-config installs need to be referenceable from future migrations.

## Project 1's MVP scope is bounded by "ship only what's tested end-to-end"

The umbrella adopts a strict end-to-end-test gate as the cleavage between Project 1 and Project 2: every public surface that Project 1 ships must have a passing integration test against live Postgres + EQL. Anything that doesn't (other column types, other operators, planner-driven DDL) defers to Project 2. This avoids the failure mode where Project 1 ships PSL constructors for `EncryptedNumber` / `EncryptedDate` / etc. that compile fine but break at runtime because the corresponding codec / search-operator paths weren't in scope.

# Out of scope (for the umbrella)

- **Other KMS backends.** Vault, AWS KMS, etc. would each ship as separate extension packages with their own envelope classes if there's demand. They're not in this umbrella.
- **Re-implementing the CipherStash SDK.** All three components wrap the existing SDK. SDK shape mismatches are coordination with the CipherStash team.
- **A general "encrypted columns" framework primitive.** The pattern (envelope class + parameterized codec + bulk-amortizing middleware + bulk-read utility) is the *canonical shape* for any future KMS-backed extension, but the framework offers no first-class "encrypted column" primitive. If multiple KMS backends ship, a future ADR captures the pattern.

# In-flight framework dependencies

PRs and Linear tickets affecting more than one component:

| PR | Linear | Subject | Status | Relevance |
|---|---|---|---|---|
| [#400](https://github.com/prisma/prisma-next/pull/400) | [TML-2330](https://linear.app/prisma-company/issue/TML-2330) | Codec call context + per-query `AbortSignal` (ADR 207) | Merged 2026-05-01 | Project 1 codec & middleware; Project 2 inherits |
| [#402](https://github.com/prisma/prisma-next/pull/402) | [TML-2229](https://linear.app/prisma-company/issue/TML-2229) | Unified `CodecDescriptor<P>` (ADR 208) | Merged 2026-05-01 | Project 1 codec; Project 2 inherits |
| [#404](https://github.com/prisma/prisma-next/pull/404) | — | Invariant-aware ref routing (M4) + self-edge support | Open | Project 1 migration factories carry `invariantId`; routing benefit is retroactive when #404 lands. Not a Project 1 dependency. |
| [#409](https://github.com/prisma/prisma-next/pull/409) | — | `intercept` hook + `contentHash` on middleware | Open | Edits the same `RuntimeMiddleware` types as Project 1's middleware-param-transform task; whichever lands first, the other rebases. Not a Project 1 dependency. |
| — | [TML-2338](https://linear.app/prisma-company/issue/TML-2338) | `(table, column)` to `planTypeOperations` | Not started | Project 2 only |
| — | [TML-2339](https://linear.app/prisma-company/issue/TML-2339) | Prior-state contract for destructive `planTypeOperations` | Not started | Project 2 only |
| — | [TML-2360](https://linear.app/prisma-company/issue/TML-2360) | Envelope-codec runtime pattern | Not started | Project 1 (consumer of param-transform seam) |
| — | [TML-2359](https://linear.app/prisma-company/issue/TML-2359) | Mutable `beforeExecute` middleware (param-transform seam) | Not started | Project 1 framework SPI change |
| — | [TML-2292](https://linear.app/prisma-company/issue/TML-2292) | Unify `DataTransformOperation` and `SqlMigrationPlanOperation` | Not started | Project 2 soft-dep; deferred |

# Linear tracking

Linear ticket redesign is deferred until the umbrella's plan stabilizes. The existing [Linear `cipherstash-integration` project](https://linear.app/prisma-company/project/cipherstash-integration-2c4f190e96ae) is the umbrella; child issues will be reorganized as work moves into the active phase.

# References

- [Framework gaps assessment](../../reference/framework-gaps.md) — the source-of-truth catalogue motivating the umbrella.
- [pgvector extension](../../packages/3-extensions/pgvector/) — the extension pattern Project 1 mirrors.
- [First-attempt integration](../../reference/cipherstash/stack/packages/stack/src/prisma/) — the CipherStash team's prior integration.
- Component specs: [`project-1/spec.md`](project-1/spec.md), [`project-2/spec.md`](project-2/spec.md), [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md).
- [Umbrella plan](plan.md) — sequencing across components.
