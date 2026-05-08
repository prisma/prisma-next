# CipherStash integration — Umbrella

Production-grade CipherStash/ZeroKMS integration for Prisma Next: searchable application-layer field-level encryption on Postgres, plus the supporting framework gaps the integration shaves on its way through. The umbrella decomposes into three components shipped as independent project workstreams under this directory:

| Component | Path | Scope |
|---|---|---|
| Project 1 — Searchable-encryption MVP | [`project-1/spec.md`](project-1/spec.md) | `EncryptedString` with `eq` + `ilike`, full PSL + TS authoring parity, end-to-end on live Postgres + EQL. Per-column DDL emitted automatically by the codec lifecycle hook (TML-2397). |
| Project 2 — Expanded type/operator surface | [`project-2/spec.md`](project-2/spec.md) | `EncryptedNumber` / `EncryptedDate` / `EncryptedBoolean` / `EncryptedJson`; `orderAndRange` + `searchableJson` operators. Each new type/operator instantiates Project 1's pattern. |
| `sql-raw-factory` — Public `raw\`...\`` factory | [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md) | User-facing tagged-template raw SQL factory layered on the `RawSqlExpr` AST node Project 1 ships |

The [umbrella plan](plan.md) sequences the three components and tracks status across them.

# Why an umbrella

The three components share a single product narrative ("ship CipherStash for Prisma Next") and a tightly entangled dependency graph — Project 2 is a strict expansion of Project 1's pattern, and `sql-raw-factory` consumes the `RawSqlExpr` AST node that Project 1 introduces. Treating them as one umbrella with three components rather than three independent projects:

- **Single sequencing surface.** The umbrella plan answers "what lands first, what's in flight, what's blocked" for the whole integration in one place.
- **Single Linear surface.** The existing `cipherstash-integration` Linear project is the umbrella; one ticket tracks each component ([TML-2373](https://linear.app/prisma-company/issue/TML-2373), [TML-2374](https://linear.app/prisma-company/issue/TML-2374), [TML-2375](https://linear.app/prisma-company/issue/TML-2375)).
- **Bounded scope per component.** Each component has its own spec/plan and ships on its own PR cadence. The umbrella doesn't add coordination overhead; it just reflects the relationships that already exist.

# Background

CipherStash provides searchable application-layer encryption for Postgres: plaintext is encrypted client-side via ZeroKMS (network KMS), stored as `eql_v2_encrypted` JSONB, and queried via the EQL Postgres extension which exposes encrypted-aware operators (`eql_v2.eq`, `eql_v2.ilike`, etc.) backed by per-column index configuration.

The CipherStash team built a first-attempt Prisma Next integration in their `cipherstash/stack` repo (`prisma-next` branch) and produced a [framework-gaps assessment](../../reference/framework-gaps.md) cataloguing the framework limitations that integration ran into. This umbrella is the *production* integration — superseding the first attempt — built on the framework seams those gaps motivated. Several of those seams have already merged on `main` ([PR #400](https://github.com/prisma/prisma-next/pull/400) — codec call context; [PR #402](https://github.com/prisma/prisma-next/pull/402) — unified `CodecDescriptor<P>`; [PR #404](https://github.com/prisma/prisma-next/pull/404) — invariant-aware ref routing; [PR #409](https://github.com/prisma/prisma-next/pull/409) — middleware `intercept` hook). The largest framework gap — extensions contributing schema objects to the user's database — was closed by [TML-2397](https://linear.app/prisma-company/issue/TML-2397) (contract spaces); see § Foundation below.

**Users.** Application teams using Prisma Next on Postgres who need searchable application-layer field-level encryption — typically PII columns (`email`, `name`, `address`) under regulatory requirements (HIPAA, GDPR, SOC2) where database-at-rest encryption is insufficient because the threat model includes the database operator.

# Foundation: contract spaces (TML-2397)

All three components in this umbrella are rebased onto `tml-2397-cipherstash-contract-space`. [TML-2397](https://linear.app/prisma-company/issue/TML-2397) introduced **contract spaces** — disjoint `(contract.json, migration-graph)` units that let extensions contribute schema objects to the user's database as first-class participants. The framework's planner / runner / verifier all operate per-space, with a per-space marker row and pinned per-space artefacts on disk.

For the cipherstash umbrella this dissolves three concerns the original specs had to handle by hand:

- **EQL bundle install.** Cipherstash's contract space owns its own slice of the database, declares its IR (`eql_v2_configuration` and friends), and carries the EQL bundle SQL byte-for-byte as the body of one op in its baseline migration. The framework's per-space runner applies it the same way it applies any other migration op. The original umbrella's `databaseDependencies.init` machinery is gone (project FR13 of TML-2397).
- **Per-column search-config DDL.** A codec lifecycle hook (`onFieldEvent` on `CodecControlHooks`) fires per-field-delta during emit and produces `add_search_config` / `remove_search_config` / rotate ops directly into the user's app-space migration. This is the framework-wide replacement for what the original Project 2 was going to deliver via `planTypeOperations` integration. **Users never write `addSearchConfig(...)` calls** — the codec hook does it from the contract diff. (See § Cross-component design decisions below.)
- **Strict `dbInit` preserved by construction.** TML-2397's per-space verifier handles extension-contributed schema correctly: each space owns its slice; strict mode is preserved per space (project NFR1 / AC1 of TML-2397). No `strictVerification: false`, no allowlists.

The cipherstash extension's control plane (descriptor, codec lifecycle hook, contract-space artefacts, EQL bundle vendored SQL) ships on the TML-2397 branch as a stub — already in `packages/3-extensions/cipherstash/`. The umbrella's components add the runtime layer (envelope + codec encode/decode + bulk-encrypt middleware + PSL constructor + TS factory + operator lowering + end-to-end tests) on top.

# Components

## Project 1 — Searchable-encryption MVP

The shippable MVP. One column type (`EncryptedString`), two operators (`eq`, `ilike`), full PSL + TypeScript-contract authoring parity. Per-column DDL emitted automatically by the codec lifecycle hook (TML-2397) — no hand-authored migration files. End-to-end-tested against live Postgres + EQL. Includes the `RawSqlExpr` AST node + lowerer arm consumed downstream by `sql-raw-factory`.

See [`project-1/spec.md`](project-1/spec.md) for the full requirements, acceptance criteria, and task-spec breakdown.

## Project 2 — Expanded type/operator surface

Expands cipherstash's column-type and operator surface to match the full first-attempt scope: `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`; `orderAndRange` + `searchableJson` operators. Each new type/operator instantiates Project 1's pattern (envelope class + parameterized codec + bulk-encrypt middleware participation + PSL constructor + TS factory + parity test + operator lowering + end-to-end test). Out of scope for Project 1.

The original Project 2 mandate to implement `planTypeOperations` integration (and its framework prerequisites — per-column input, prior-state contract for destructive DDL) is obsolete: TML-2397's codec lifecycle hook is the framework-wide planner-integration mechanism, and each new type wires its own `onFieldEvent` arm the same way `cipherstash:string@1` does on the contract-spaces base.

See [`project-2/spec.md`](project-2/spec.md) — currently a stub; tracked by [TML-2375](https://linear.app/prisma-company/issue/TML-2375). Will be shaped properly after Project 1 ships, since each new type rides on the patterns Project 1 establishes.

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

Project 1 needs the AST node to support raw-SQL composition inside the `SqlQueryPlan` machinery. The right shape — agreed in design discussion — is a first-class AST node (`RawSqlExpr`) joining the `AnyQueryAst` union, with a Postgres lowerer arm that parameterizes embedded `ParamRef`s through the standard codec pipeline.

The AST node is owned by Project 1 (the [`raw-sql-ast-node.spec.md`](project-1/specs/raw-sql-ast-node.spec.md) task spec) so Project 1 is unblocked without waiting on `sql-raw-factory`. `sql-raw-factory` consumes that AST node and adds the user-facing typed-template-literal surface on top. The cleavage is precise:

- **Project 1's task spec ships:** the AST node, the Postgres lowerer arm, and a small `planFromAst` envelope helper. Construction is package-internal — `RawSqlExpr.of(fragments, args)` directly.
- **`sql-raw-factory` ships:** the `raw\`...\`` template-literal factory; the `RawArg` type union (Expression | ParamRef | RawSqlIdentifier); the `identifier(...)` escape hatch and its lowerer arm; type-level rejection of bare values; the `param()` ergonomic re-export of `ParamRef.of`.

`sql-raw-factory` can ship before, after, or alongside Project 1. If it ships first, the AST work simply moves up into it; if Project 1 ships first (the expected order), `sql-raw-factory` consumes the AST node as-published.

## Per-column search-config DDL is emitted by the codec lifecycle hook

Per-column EQL `add_search_config` / `remove_search_config` / rotate ops are emitted automatically by cipherstash's codec lifecycle hook (the `onFieldEvent` arm shipped on `tml-2397-cipherstash-contract-space`) — not by user-authored migration factories. The emitted ops land inline in the user's app-space migration's `ops.json` alongside the user's structural ops; they carry `invariantId`s of the form `cipherstash-codec:<table>.<field>:<verb>@v<n>` so they remain referenceable by future migrations.

This decision affects both Project 1 and Project 2: Project 1 wires the hook arm for `cipherstash:string@1`'s `equality` and `freeTextSearch` flags; Project 2 extends the same arm (or adds new arms) for `EncryptedNumber` / `EncryptedDate` / `EncryptedBoolean` / `EncryptedJson` and their per-type search modes. There is no separate "user-authored migration factory" surface for either component to ship.

## Project 1's MVP scope is bounded by "ship only what's tested end-to-end"

The umbrella adopts a strict end-to-end-test gate as the cleavage between Project 1 and Project 2: every public surface that Project 1 ships must have a passing integration test against live Postgres + EQL. Anything that doesn't (other column types, other operators) defers to Project 2. This avoids the failure mode where Project 1 ships PSL constructors for `EncryptedNumber` / `EncryptedDate` / etc. that compile fine but break at runtime because the corresponding codec / search-operator paths weren't in scope.

# Out of scope (for the umbrella)

- **Other KMS backends.** Vault, AWS KMS, etc. would each ship as separate extension packages with their own envelope classes if there's demand. They're not in this umbrella.
- **Re-implementing the CipherStash SDK.** All three components wrap the existing SDK. SDK shape mismatches are coordination with the CipherStash team.
- **A general "encrypted columns" framework primitive.** The pattern (envelope class + parameterized codec + bulk-amortizing middleware + bulk-read utility) is the *canonical shape* for any future KMS-backed extension, but the framework offers no first-class "encrypted column" primitive. If multiple KMS backends ship, a future ADR captures the pattern.

# In-flight framework dependencies

External PRs / projects affecting more than one component:

| Source | Subject | Status | Relevance |
|---|---|---|---|
| [TML-2397](https://linear.app/prisma-company/issue/TML-2397) | Contract spaces — first-class extension schema contributions, codec lifecycle hook, per-space verifier | **Foundation, satisfied** — the umbrella rebases onto `tml-2397-cipherstash-contract-space`. Dissolves the original Project 2 planner-integration mandate and the original `databaseDependencies.init` EQL bundle install. |
| [#400](https://github.com/prisma/prisma-next/pull/400) | Codec call context + per-query `AbortSignal` (ADR 207) — was [TML-2330](https://linear.app/prisma-company/issue/TML-2330) | Merged 2026-05-01 | Project 1 codec & middleware; Project 2 inherits |
| [#402](https://github.com/prisma/prisma-next/pull/402) | Unified `CodecDescriptor<P>` (ADR 208) — was [TML-2229](https://linear.app/prisma-company/issue/TML-2229) | Merged 2026-05-01 | Project 1 codec; Project 2 inherits |
| [#404](https://github.com/prisma/prisma-next/pull/404) | Invariant-aware ref routing (M4) + self-edge support | Merged | Already on the contract-spaces base. Codec-hook-emitted ops carry `invariantId` and are referenceable from future migrations through the per-space planner's path resolver. |
| [#409](https://github.com/prisma/prisma-next/pull/409) | `intercept` hook + `contentHash` on middleware | Merged | Already on the contract-spaces base. The umbrella's `middleware-param-transform` cherry-pick added `signal` next to `contentHash` cleanly. |

# Linear tracking

The [Linear `cipherstash-integration` project](https://linear.app/prisma-company/project/cipherstash-integration-2c4f190e96ae) holds three umbrella tickets, one per component:

| Component | Linear |
|---|---|
| Project 1 — Searchable-encryption MVP | [TML-2373](https://linear.app/prisma-company/issue/TML-2373) |
| `sql-raw-factory` — Public `raw\`...\`` factory | [TML-2374](https://linear.app/prisma-company/issue/TML-2374) |
| Project 2 — Planner-driven DDL + expanded surface | [TML-2375](https://linear.app/prisma-company/issue/TML-2375) |

Milestone-level breakdown lives in the per-component `plan.md` files; Linear tracks at the component level only.

# References

- [Framework gaps assessment](../../reference/framework-gaps.md) — the source-of-truth catalogue motivating the umbrella.
- [pgvector extension](../../packages/3-extensions/pgvector/) — the extension pattern Project 1 mirrors.
- [First-attempt integration](../../reference/cipherstash/stack/packages/stack/src/prisma/) — the CipherStash team's prior integration.
- Component specs: [`project-1/spec.md`](project-1/spec.md), [`project-2/spec.md`](project-2/spec.md), [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md).
- [Umbrella plan](plan.md) — sequencing across components.
