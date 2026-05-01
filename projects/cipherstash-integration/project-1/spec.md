# Project 1 — Searchable-encryption MVP

> Project 1 of the [cipherstash-integration umbrella](../spec.md). The umbrella has three components: this project (Project 1, MVP), [Project 2](../project-2/spec.md) (planner-driven DDL + expanded surface), and [`sql-raw-factory`](../sql-raw-factory/spec.md) (public `raw\`...\`` factory). See the umbrella plan for sequencing.

# Summary

Ship `@prisma-next/extension-cipherstash`: a CipherStash/ZeroKMS-backed extension pack that delivers searchable application-layer field-level encryption end-to-end on Postgres. Project 1 scope is intentionally narrow — one column type (`EncryptedString`), two operators (`eq`, `ilike`), full PSL + TypeScript-contract authoring parity, hand-authored migration files using extension-provided factories — all of it tested end-to-end against live Postgres + EQL.

# Description

CipherStash provides searchable application-layer encryption for Postgres: plaintext is encrypted client-side via ZeroKMS (network KMS), stored as `eql_v2_encrypted` JSONB, and queried via the EQL Postgres extension which exposes encrypted-aware operators (`eql_v2.eq`, `eql_v2.ilike`, etc.) backed by per-column index configuration. The CipherStash team built a first-attempt Prisma Next integration in their `cipherstash/stack` repo (`prisma-next` branch) and produced a [framework-gaps assessment](../../../reference/framework-gaps.md) cataloguing the framework limitations that integration ran into.

This project is the *production* integration — superseding the first attempt — built on the framework seams those gaps motivated. Project 1 closes the gaps that allow a coherent searchable-encryption slice to ship: codec call context (already merged via [TML-2330](https://linear.app/prisma-company/issue/TML-2330) / PR #400), a mutable `beforeExecute` middleware seam (param-transform), the envelope-codec runtime pattern, a PSL constructor surface, a `RawSqlExpr` AST node (extracted from cipherstash's migration-factory needs but generally useful), and migration factories that ride on PR #404's `DataTransformOperation` to let users hand-author per-column search-config DDL.

[Project 2](../project-2/spec.md) automates the per-column DDL via `planTypeOperations` integration and extends the column-type and operator surface (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`, `orderAndRange`, `searchableJson`). Out of scope here.

**Users:** Application teams using Prisma Next on Postgres who need searchable application-layer field-level encryption — typically PII columns (`email`, `name`, `address`) under regulatory requirements (HIPAA, GDPR, SOC2) where database-at-rest encryption is insufficient because the threat model includes the database operator.

**Linear:** [TML-2373](https://linear.app/prisma-company/issue/TML-2373) tracks Project 1 at the component level. Milestone-level breakdown lives in [`plan.md`](plan.md); per-task specs are in [`specs/`](specs/). Component-level tracking only — no per-task or per-milestone Linear sub-issues.

# Status

| Task spec | Status |
|---|---|
| [envelope-codec-extension](specs/envelope-codec-extension.spec.md) — runtime pattern + codec + EQL bundle install + operator lowering | Drafted |
| [middleware-param-transform](specs/middleware-param-transform.spec.md) — mutable `beforeExecute` seam | Drafted |
| [psl-encrypted-string-constructor](specs/psl-encrypted-string-constructor.spec.md) — PSL `cipherstash.EncryptedString(...)` constructor + parity test | Drafted |
| [raw-sql-ast-node](specs/raw-sql-ast-node.spec.md) — `RawSqlExpr` AST node + Postgres lowerer arm + `planFromAst` envelope helper | Drafted |
| [migration-factories](specs/migration-factories.spec.md) — `addSearchConfig` / `activatePendingSearches` as `DataTransformOperation`s carrying `invariantId`s | Drafted |

# Requirements

## Functional Requirements

### EQL bundle installation as an extension dependency

- The extension's control descriptor declares a `databaseDependencies.init` entry that installs the EQL Postgres extension by executing the vendored EQL install SQL bundle (already present in the first-attempt repo as `reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts`, ~170 KB).
- Install is idempotent: pre-check probes `cs_configuration_v2` table existence; post-check confirms the EQL schema is reachable.
- Same install dependency mechanism that pgvector uses for `CREATE EXTENSION vector` — proven shape, no new framework surface required.

### One column type: `EncryptedString`

- Available in **two authoring surfaces**:
  - **PSL constructor** — `cipherstash.EncryptedString(equality: Bool, freeTextSearch: Bool)` usable inline at field positions and inside `types {}` blocks. Same shape and grammar that `pgvector.Vector(length: Int)` already supports.
  - **TypeScript contract factory** — `encryptedString({ equality, freeTextSearch })` from `@prisma-next/extension-cipherstash/column-types`.
- Both surfaces produce **byte-identical** `ColumnTypeDescriptor` IR — enforced by a parity integration test of the same shape as `test/integration/test/authoring/parity/pgvector-named-type/`.
- Three argument shapes are end-to-end-validated:
  - `EncryptedString({})` — storage-only, no search config.
  - `EncryptedString({ equality: true })` — exercises the `eq` operator path.
  - `EncryptedString({ equality: true, freeTextSearch: true })` — exercises the `ilike` operator path.
- Both nullable (`EncryptedString(...)?`) and non-nullable variants are supported and individually tested.

### Envelope-codec runtime pattern

- The user-facing input/output type for an `EncryptedString` column is an `EncryptedString` envelope class (not a raw `string`).
- Writes: users construct envelopes via `EncryptedString.from(plaintext)`. Bulk-encrypt middleware coalesces all envelopes in a query into one `bulkEncrypt({ signal })` call to the CipherStash SDK before `codec.encode` runs. Codec encode is identity (extracts the populated ciphertext from the envelope's internal handle).
- Reads: `codec.decode` returns a fresh envelope wrapping the wire ciphertext + the column identity supplied by `SqlCodecCallContext.column` (from [TML-2330](https://linear.app/prisma-company/issue/TML-2330)). Per-cell `await envelope.decrypt({ signal })` triggers a single-cell SDK call; bulk read-side decryption is via a standalone `decryptAll(rows, { signal })` utility that walks recursively and issues one `bulkDecrypt` call per SDK routing key.
- Decryption is **always explicit** — never lazy on field access, never streamed mid-iteration.
- Implementation rides on the post-#402 `RuntimeParameterizedCodecDescriptor<P>` machinery (the same shape pgvector uses — `paramsSchema` declared via arktype, separate from the codec body itself which keeps the existing `codec({ typeId, targetTypes, encode, decode, ... })` shape).

### Search operators: `eq` and `ilike`

- Lowering for `eq` on encrypted columns: `WHERE email = $1` lowers to `WHERE eql_v2.eq(email, eql_v2.encrypt($1, ...))` (or the EQL canonical form — confirm against EQL operator templates in the first-attempt repo's `operation-templates.ts`).
- Lowering for `ilike` on encrypted columns: similarly via `eql_v2.ilike(...)`.
- Both operators are integration-tested against live Postgres + EQL: a `findMany({ where: { email: { equals: 'x' } } })` and `findMany({ where: { email: { contains: 'foo' } } })` round-trip from authored contract → encoded query → real database execution → decoded result.
- Operators are wired through the existing `queryOperations` mechanism that pgvector uses for distance operators — no new framework surface.

### Migration factories: `addSearchConfig` / `activatePendingSearches`

- Per-column search-mode configuration is **not** automatically planned by `dbInit` / `dbUpdate` in Project 1. Users hand-author `migration.ts` files that invoke extension-provided factories:
  - `cipherstash.addSearchConfig({ table, column, equality?, freeTextSearch? })` — produces one closure per enabled mode, each closure returning a `SqlQueryPlan` containing a `RawSqlExpr` AST that renders `SELECT eql_v2.add_search_config(...)` (one for `equality` mapped to EQL's `'unique'` index, one for `freeTextSearch` mapped to EQL's `'match'` index — the public flag names map to EQL's internal index names internally).
  - `cipherstash.activatePendingSearches()` — produces a closure for the EQL pending-activation function.
- The closures fit `dataTransform({ run: [...] })`'s `DataTransformClosure` signature, so the user invokes `this.dataTransform(endContract, name, { invariantId, run: [...] })` in their `migration.ts`. The resulting `DataTransformOperation` carries `operationClass: 'data'` and an `invariantId` for invariant-aware ref routing per [PR #404](https://github.com/prisma/prisma-next/pull/404).
- The factories construct `RawSqlExpr` AST nodes directly via the package-internal API delivered by [raw-sql-ast-node task spec](specs/raw-sql-ast-node.spec.md), wrap them via `planFromAst(ast, contract)`, and hand the resulting `SqlQueryPlan` to `dataTransform`. There is no dependency on the [`sql-raw-factory`](../sql-raw-factory/spec.md) component — that component ships the public user-facing `raw\`...\`` template-literal factory on top of the *same* AST node, but cipherstash's own migration factories don't need the public surface. The factories are exported from `@prisma-next/extension-cipherstash/migration`.

### `RuntimeMiddleware` SPI changes

- `beforeExecute(plan, ctx, params)` gains a third parameter `params: SqlParamRefMutator` (the param-transform seam — see [middleware-param-transform task spec](specs/middleware-param-transform.spec.md)).
- `MiddlewareContext.signal: AbortSignal | undefined` carries the per-query signal, identity-equal to the codec call context's signal from [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- Coordinated with PR #409 (`cache-middleware-intercept`) which lands `intercept` and `contentHash` on `RuntimeMiddlewareContext` — both projects mutate the same SPI surface; the eventual landing order determines who rebases.

## Non-Functional Requirements

- **Bulk amortization on both write and read sides.** A query inserting N rows × M cipherstash columns sharing one routing key issues exactly **one** `bulkEncrypt` call. A `decryptAll(rows)` over K envelopes across one routing key issues exactly **one** `bulkDecrypt` call. Verified per-test with mock SDK call counters.
- **No regression in the no-cipherstash hot path.** When no middleware in the chain mutates `ParamRef`s, the runtime forwards `plan.params` to `encodeParams` by reference identity — no allocation, no copy. Verified by an identity-equality assertion in an integration test.
- **Cooperative cancellation throughout.** Every SDK call (single-cell decrypt, `bulkEncrypt`, `bulkDecrypt`) forwards `ctx.signal` (or `opts.signal`). Already-aborted signals at codec or middleware entry surface `RUNTIME.ABORTED { phase }` per ADR 207 / 208.
- **No `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`.** Type casts minimized; `as unknown as T` only as last resort with justifying comment.
- **Package layering.** Extension lives at `packages/3-extensions/cipherstash/` mirroring `extension-pgvector`. `pnpm lint:deps` passes.
- **Authoring parity is byte-equal.** PSL-source and TS-source must produce identical `contract.json` (parity integration test asserts this).

## Non-goals

The Project 1/Project 2 cleavage is on two axes:

**Out of scope: anything not exercised end-to-end.** Per the project's "ship only what's tested end-to-end" principle, every shipped surface must have a passing integration test against live Postgres + EQL. This explicitly excludes:

- **Other column types** — `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson` ship in Project 2 alongside their planner integration. Adding them to Project 1's PSL constructor surface without their codec round-trip + search operator + migration test coverage would create "this constructor exists but breaks at runtime" failure modes.
- **Other operator families** — `orderAndRange` (`gt`/`gte`/`lt`/`lte`), `searchableJson`. Project 2.

**Out of scope: planner-driven per-column DDL.** Project 1 ships hand-authored `migration.ts` for `addSearchConfig`. Project 2 makes `dbInit` / `dbUpdate` automatically plan these per the contract's column declarations:

- No `planTypeOperations` integration for cipherstash codecs in Project 1.
- No consumption of the per-column `planTypeOperations` framework prerequisites (`(table, column)` input shape; prior-state contract for destructive DDL — both Project 2 concerns).
- No automatic detection of *changes* to search-mode flags between contract revisions — users hand-author the corresponding migration. Project 2.

**Other non-goals:**

- **No KMS provider abstraction.** This package is CipherStash-specific. Vault, AWS KMS, etc. would each ship as separate packages with their own envelope classes if there's demand.
- **No re-implementation of the CipherStash SDK.** The extension wraps the existing SDK. If the SDK lacks bulk-call shapes that fit cleanly, that's coordination with the CipherStash team.
- **No automatic plaintext zeroing on the envelope's plaintext slot.** Documented expectation: users with strict secrets-hygiene requirements dispose envelopes promptly.
- **No re-encryption migration support.** Adopting CipherStash for an existing column requires a data migration (re-encrypt existing rows) which users handle via Prisma Next's general migration tooling and a one-off script. A "rotate codec" migration primitive is a future concern.
- **No streaming-time decryption.** The framework's streaming path doesn't try to decrypt envelopes mid-iteration. Users either call `decrypt()` per cell or buffer first then call `decryptAll`.
- **No selective-by-column `decryptAll`.** First-pass utility decrypts every envelope it walks. Users wanting selective decrypt write their own walker.

# Acceptance Criteria

The umbrella's acceptance criteria are the union of the four task specs' criteria — see each task spec for fine-grained criteria. The umbrella-level integration tests are:

- [ ] **AC-UMB1**: Round-trip integration test against live Postgres + EQL: contract authored in **PSL** declares a `User` model with an `EncryptedString({ equality: true, freeTextSearch: true })` column. `dbInit` succeeds (creates table; EQL extension installed via `databaseDependencies.init`). Hand-authored `migration.ts` calls `cipherstash.addSearchConfig({ ... })` + `cipherstash.activatePendingSearches()`; migration runs successfully. Insert via `db.insert(User, { email: EncryptedString.from('alice@example.com') })`. `findMany({ where: { email: { equals: 'alice@example.com' } } })` returns the row. `findMany({ where: { email: { contains: 'alice' } } })` returns the row. `decryptAll(rows)` materializes plaintext.
- [ ] **AC-UMB2**: The same scenario authored via the **TypeScript contract** (`encryptedString({...})`) produces a `contract.json` byte-identical to the PSL version (parity test).
- [ ] **AC-UMB3**: Bulk amortization verified: inserting 10 rows × 1 encrypted column issues exactly **one** `bulkEncrypt` mock-SDK call. `decryptAll` over a 10-row result set issues exactly **one** `bulkDecrypt` mock-SDK call.
- [ ] **AC-UMB4**: Nullable variant: `email: EncryptedString({ equality: true })?` round-trips correctly with a mix of null and non-null rows. `findMany({ where: { email: null } })` lowers to `WHERE email IS NULL` (not an `eql_v2.eq` call).
- [ ] **AC-UMB5**: Cancellation: an aborted `signal` at any phase (`beforeExecute`, codec encode, codec decode, single-cell `decrypt`, `decryptAll`) surfaces `RUNTIME.ABORTED { phase }` promptly per ADR 207 / 208.
- [ ] **AC-UMB6**: `pnpm lint:deps` passes for `packages/3-extensions/cipherstash/`.
- [ ] **AC-UMB7**: An example app under `examples/` demonstrates the pattern with realistic shapes (PSL schema + a few queries + a `decryptAll` site).

# Other Considerations

## Security

- **Threat model.** Database operator and any party with raw database access cannot read encrypted columns. Network attackers cannot read encrypted columns in transit (already covered by TLS to Postgres). Application-layer compromise is not in scope — by definition the application must decrypt to operate.
- **Plaintext exposure window.** Plaintext lives on the envelope's internal handle from `from(plaintext)` until the envelope is GC'd. Bulk-encrypt middleware overwrites the handle's plaintext slot with `undefined` after writing the ciphertext (memory-hygiene default — see open question in envelope spec).
- **Routing keys / dataset identifiers.** ZeroKMS routes bulk calls by `(dataset, keyId)`. The handle captures these from `SqlCodecCallContext.column` plus extension config. Misconfigured routing produces auth failures from ZeroKMS — not silent data corruption.
- **EQL extension privileges.** EQL install requires database superuser (creates schemas, types, functions, operators). The `databaseDependencies.init` install runs under whatever role the user supplies; failure surfaces a clear DDL error. Documented prerequisite.
- **No new ADR.** Threat model and trust boundaries are an extension-package concern, documented in the package README. A future "encrypted columns ADR" can capture the pattern across extensions if Vault / AWS-KMS extensions land.

## Cost

- **CI cost.** Integration tests against Postgres + EQL bundle install run in `withDevDatabase`-style harness already used by pgvector. EQL bundle install adds ~1-2s to each integration test's cold spin-up; total CI delta is small (existing pgvector tests do similar).
- **Runtime cost.** ZeroKMS round-trips are the dominant cost; bulk amortization collapses the per-query cost to O(1) network round-trip per direction per routing key. Per-cell overhead (envelope class allocation, handle storage) is negligible vs. the network call.
- **No infrastructure cost** for the framework. Users provide their own ZeroKMS instance and EQL-capable Postgres. CipherStash-side cost is the user's concern.

## Observability

- **Bulk-call counters in tests.** Mock SDK exposes `bulkEncrypt.callCount` / `bulkDecrypt.callCount` to assert amortization.
- **Real-runtime instrumentation.** Out of scope for Project 1 — extension hooks into existing Prisma Next observability surface (codec timing, middleware timing). No bespoke metrics.
- **Error attribution.** SDK errors propagate with the codec call context's `(table, column)` so error logs identify which column triggered a failed bulk call. Already plumbed by ADR 207.

## Data Protection

- **Encrypted-at-the-column-layer.** Application-layer encryption is *the* data-protection mechanism this extension provides — values stored in `eql_v2_encrypted` JSONB are opaque to anyone with database-only access.
- **Backups inherit the encryption.** Postgres backups, replication, log shipping all preserve the encrypted form; recovery requires the same ZeroKMS access.
- **Personal data handling.** Encrypted columns are the recommended location for PII. The extension does not classify which columns are PII — that's the application's data model concern.
- **Right-to-erasure.** Crypto-shredding (revoke the column's key in ZeroKMS) renders the column un-decryptable. Documented capability; not a new framework primitive in Project 1.

## Analytics

No analytics events. The extension is a runtime / control-plane integration, not a user-facing product.

# References

## In-flight dependencies

| PR / Project | Subject | Project 1 dependency |
|---|---|---|
| [#400](https://github.com/prisma/prisma-next/pull/400) (was [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) | Codec call context + per-query `AbortSignal` (ADR 207) | **Direct, satisfied** — merged 2026-05-01; codec consumes `SqlCodecCallContext.column` |
| [#402](https://github.com/prisma/prisma-next/pull/402) (was [TML-2229](https://linear.app/prisma-company/issue/TML-2229)) | Unified `CodecDescriptor<P>` + per-library JSON extensions (ADR 208) | **Direct, satisfied** — merged 2026-05-01; `paramsSchema` plumbing for `EncryptedString` config |
| [#404](https://github.com/prisma/prisma-next/pull/404) | Invariant-aware ref routing (M4) + self-edge support | **Coordinate** — migration factories populate `invariantId` on emitted ops; routing benefit is retroactive when #404 lands |
| [#409](https://github.com/prisma/prisma-next/pull/409) | `intercept` hook on middleware + `contentHash` | **Coordinate** — same SPI surface; merge order determines who rebases |
| [#411](https://github.com/prisma/prisma-next/pull/411) | Current draft holding initial spec drafts (this project's predecessor) | Replaced by this umbrella |

## Sibling components in the umbrella

- [`sql-raw-factory`](../sql-raw-factory/spec.md) — sibling component that ships the public user-facing `raw\`...\`` template-literal factory **on top of** the `RawSqlExpr` AST node defined by [raw-sql-ast-node task spec](specs/raw-sql-ast-node.spec.md). Project 1 does not depend on `sql-raw-factory`; `sql-raw-factory` depends on Project 1's AST node. If both ship independently in either order, `sql-raw-factory`'s consumption of the AST node is straightforward.
- [`project-2`](../project-2/spec.md) — sibling component covering planner-driven DDL and the expanded type/operator surface. Out of scope for Project 1; documented at the umbrella level.

## Internal references

- [Framework gaps assessment](../../../reference/framework-gaps.md) — the source-of-truth catalogue motivating this project.
- [pgvector extension](../../../packages/3-extensions/pgvector/) — the extension pattern this project mirrors (column type, codec, control descriptor with `databaseDependencies.init`, parity test under `test/integration/test/authoring/parity/pgvector-named-type/`).
- [PSL parser README](../../../packages/2-sql/2-authoring/contract-psl/README.md) — namespaced extension constructor support (`pgvector.Vector(...)` shape).
- [ADR 207 — codec call context](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the codec-side context this extension consumes. **Forthcoming** with PR #400; the file does not yet exist on `main` or this branch.
- [ADR 208 — unified `CodecDescriptor<P>`](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — the parameterized-codec descriptor shape `EncryptedString` rides on. **Forthcoming** with PR #402; ADR number was renumbered from 207→208 post-collision per commit `b813ea362`.
- [First-attempt integration](../../../reference/cipherstash/stack/packages/stack/src/prisma/) — the CipherStash team's prior integration; `eql-bundle.ts`, `database-dependencies.ts`, `operation-templates.ts` are the concrete artifacts this project supersedes / lifts from.

# Open Questions

1. **Operator lowering — pre-emit vs adapter-time.** EQL operators (`eql_v2.eq`, `eql_v2.ilike`) have to enter the SQL stream somehow. Options: (a) the extension's `queryOperations` rewrites the operator at lowering time when the column's codec id is `cipherstash/string@1`; (b) a Postgres-target post-processor wraps the canonical SQL operator. (a) is the pgvector-distance-operator precedent; default is (a) unless the EQL surface forces (b).
2. **Migration factory naming.** `cipherstash.addSearchConfig` / `cipherstash.activatePendingSearches` is the working name. The first-attempt's `planEncryptedTypeOperations` produced different config-row JSON shapes for "pending" vs "activate"; we may want to expose a single factory that produces both ops in sequence (`cipherstash.installSearchConfig`) rather than two ops to compose. Confirm against EQL's actual two-step config protocol.
3. **PSL parity test location.** Parity tests live at `test/integration/test/authoring/parity/<extension-named-type>/`. Same convention for cipherstash, or co-locate under `test/integration/test/authoring/cipherstash/`? Default: same convention.
4. **Routing-key surface.** ZeroKMS bulk calls group by `(dataset, keyId)`. The dataset identifier is per-extension config; the key id is per-column. The handle captures both, but the *factory* `encryptedString({ ... })` doesn't yet have a slot for column-specific key id — does the user supply this in PSL/TS, or is it always derived from `(table, column)`? Default: always derived. Confirm with CipherStash team.
5. ~~**Project 2 on-disk slug.**~~ Resolved: Project 2 lives at [`../project-2/`](../project-2/spec.md) under the same umbrella.
6. ~~**Linear ticket redesign.**~~ Resolved: one ticket per component — Project 1 = [TML-2373](https://linear.app/prisma-company/issue/TML-2373), `sql-raw-factory` = [TML-2374](https://linear.app/prisma-company/issue/TML-2374), Project 2 = [TML-2375](https://linear.app/prisma-company/issue/TML-2375). No per-task or per-milestone sub-issues; tracking lives in this repo.
