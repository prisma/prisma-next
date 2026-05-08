# Project 1 — Searchable-encryption MVP

> Project 1 of the [cipherstash-integration umbrella](../spec.md). The umbrella has three components: this project (Project 1, MVP), [Project 2](../project-2/spec.md) (expanded type/operator surface), and [`sql-raw-factory`](../sql-raw-factory/spec.md) (public `raw\`...\`` factory). See the umbrella plan for sequencing.

# Summary

Ship `@prisma-next/extension-cipherstash`: a CipherStash/ZeroKMS-backed extension pack that delivers searchable application-layer field-level encryption end-to-end on Postgres. Project 1 scope is intentionally narrow — one column type (`EncryptedString`), two operators (`eq`, `ilike`), full PSL + TypeScript-contract authoring parity, contract-space-managed schema (no hand-authored migration factories), all of it tested end-to-end against live Postgres + EQL.

# Foundation: contract spaces (TML-2397)

Project 1 is **rebased onto `tml-2397-cipherstash-contract-space`** ([TML-2397](https://linear.app/prisma-company/issue/TML-2397)) — the framework-level project that introduced **contract spaces** as the architectural seam for extensions to contribute schema objects to the user's database. TML-2397 already shipped:

- The contract-space mechanism (per-space planner / runner / verifier / pinned per-space artefacts on disk).
- The codec lifecycle hook (`onFieldEvent` on `CodecControlHooks`) that fires per-field-delta during emit and emits migration ops into the application's migration JSON.
- A **stub cipherstash extension** (`packages/3-extensions/cipherstash/`) that wires the contract-space side: contract IR for `eql_v2_configuration`, baseline migration installing the vendored EQL bundle byte-for-byte, and a `cipherstash:string@1` codec lifecycle hook that emits `add_search_config` / `remove_search_config` / `rotate-search-config` ops.

What TML-2397 did **not** ship: the runtime half — `EncryptedString` envelope, the `CipherstashSdk` interface, codec encode/decode, the bulk-encrypt middleware, the PSL constructor, the TS contract factory, and the wire-format fix for the `eql_v2_encrypted` composite type. Project 1 delivers that runtime layer on top of the stub control plane TML-2397 left in place.

What this means for the original Project 1 scope:

- **Migration factories are gone.** The original spec called for `cipherstash.addSearchConfig({ ... })` / `cipherstash.activatePendingSearches()` factories that users would invoke from hand-authored `migration.ts` files. Contract spaces' codec lifecycle hook supersedes this entirely — when a user adds an `Encrypted<string>` column with `searchable: true`, the cipherstash codec hook emits the `add_search_config` op into the user's app-space migration automatically. No factory call site, no hand-authored migration. The [`migration-factories.spec.md`](specs/migration-factories.spec.md) sub-spec is **obsolete** and stays in the tree only as a pointer at the codec hook on TML-2397.
- **EQL bundle install is contract-space-managed.** The original spec installed the bundle via `databaseDependencies.init`. That mechanism was removed by TML-2397 (project FR13). The bundle is now the body of one migration op (`cipherstash:install-eql-bundle-v1`) inside cipherstash's contract space; the runner applies it the same way it applies any other migration op.
- **Strict `dbInit` is preserved.** The mid-execution regression that loosened `strictVerification` to allow extension-installed schema objects (commit `2d96d154c` on the prior branch) is dropped — TML-2397's per-space verifier handles this correctly: each space owns its own slice of the database; strict mode is preserved per space (project NFR1).

# Description

CipherStash provides searchable application-layer encryption for Postgres: plaintext is encrypted client-side via ZeroKMS (network KMS), stored as `eql_v2_encrypted` JSONB, and queried via the EQL Postgres extension which exposes encrypted-aware operators (`eql_v2.eq`, `eql_v2.ilike`, etc.) backed by per-column index configuration. The CipherStash team built a first-attempt Prisma Next integration in their `cipherstash/stack` repo (`prisma-next` branch) and produced a [framework-gaps assessment](../../../reference/framework-gaps.md) cataloguing the framework limitations that integration ran into.

This project is the *production* integration — superseding the first attempt — built on the framework seams those gaps motivated. Project 1 closes the gaps that allow a coherent searchable-encryption slice to ship: codec call context (already merged via [TML-2330](https://linear.app/prisma-company/issue/TML-2330) / PR #400), a mutable `beforeExecute` middleware seam (param-transform), the envelope-codec runtime pattern, a PSL constructor surface, a `RawSqlExpr` AST node (extracted from cipherstash's migration-factory needs but generally useful), and — via the TML-2397 foundation — a codec lifecycle hook that emits per-column search-config ops automatically.

[Project 2](../project-2/spec.md) extends the column-type and operator surface (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`, `orderAndRange`, `searchableJson`). Out of scope here.

**Users:** Application teams using Prisma Next on Postgres who need searchable application-layer field-level encryption — typically PII columns (`email`, `name`, `address`) under regulatory requirements (HIPAA, GDPR, SOC2) where database-at-rest encryption is insufficient because the threat model includes the database operator.

**Linear:** [TML-2373](https://linear.app/prisma-company/issue/TML-2373) tracks Project 1 at the component level. Milestone-level breakdown lives in [`plan.md`](plan.md); per-task specs are in [`specs/`](specs/). Component-level tracking only — no per-task or per-milestone Linear sub-issues.

# Status

> Milestone-level breakdown lives in [`plan.md`](plan.md). Last updated 2026-05-08 (post-TML-2397-rebase).

| Task spec | Status |
|---|---|
| [raw-sql-ast-node](specs/raw-sql-ast-node.spec.md) — `RawSqlExpr` AST node + Postgres lowerer arm + `planFromAst` envelope helper | **Cherry-picked onto contract-spaces base** in M1 (15 ACs PASS; AC-E2E1/AC-E2E2 originally migration-factories-coupled and now obsolete with the migration-factories spec) |
| [middleware-param-transform](specs/middleware-param-transform.spec.md) — mutable `beforeExecute` seam | **Cherry-picked onto contract-spaces base** in M1 (14 ACs PASS; Mongo runtime wiring deferred to [TML-2376](https://linear.app/prisma-company/issue/TML-2376)) |
| [psl-encrypted-string-constructor](specs/psl-encrypted-string-constructor.spec.md) — PSL `cipherstash.EncryptedString(...)` constructor + parity test | **Re-authored** in M2 against TML-2397 stub (was 12 ACs PASS in PR #416's M2.b; needs re-validation against new package shape) |
| [envelope-codec-extension](specs/envelope-codec-extension.spec.md) — runtime envelope + codec encode/decode + bulk-encrypt middleware + operator lowering | **Re-authored** in M2 against TML-2397 stub. EQL bundle install + `databaseDependencies.init` portions are obviated (TML-2397 owns); envelope + codec runtime + middleware + operator lowering remain as Project 1 work |
| ~~[migration-factories](specs/migration-factories.spec.md)~~ | **OBSOLETE** — superseded by TML-2397's codec lifecycle hook (`onFieldEvent` on `CodecControlHooks`); the cipherstash codec hook on TML-2397 already emits `add_search_config` / `remove_search_config` / rotate ops automatically. Sub-spec retained as a redirect only. |

# Requirements

## Functional Requirements

### EQL bundle installation as a contract-space migration

Provided by the TML-2397 foundation:

- The cipherstash extension declares a `contractSpace` whose baseline migration carries the vendored EQL bundle SQL byte-for-byte as the body of the `cipherstash:install-eql-bundle-v1` op.
- The runner applies that op as part of the cipherstash space's migration sequence — the same shape as any other extension-space op (project AC7).
- Strict `dbInit` is preserved per space (project NFR1, AC1): the verifier sees `eql_v2_configuration`, `eql_v2_encrypted`, `eql_v2_configuration_state`, `ore_*` composites, and the domains, recognises them as expected (because cipherstash's contract space declared them), and rejects unexpected extras as drift.
- Idempotency, install order, transaction control, and re-application semantics are all framework concerns delivered by TML-2397's per-space runner — Project 1 inherits them and adds no install-side surface.

### One column type: `EncryptedString`

- Available in **two authoring surfaces**:
  - **PSL constructor** — `cipherstash.EncryptedString(equality: Bool, freeTextSearch: Bool)` usable inline at field positions and inside `types {}` blocks. Same shape and grammar that `pgvector.Vector(length: Int)` already supports.
  - **TypeScript contract factory** — `encryptedString({ equality, freeTextSearch })` from `@prisma-next/extension-cipherstash/column-types`.
- Both surfaces produce **byte-identical** `ColumnTypeDescriptor` IR — enforced by a parity integration test of the same shape as `test/integration/test/authoring/parity/pgvector-named-type/`.
- Three argument shapes are end-to-end-validated:
  - `EncryptedString({})` — storage-only, no search config (codec hook emits no ops).
  - `EncryptedString({ equality: true })` — codec hook emits `add_search_config` for the `'unique'` index; exercises the `eq` operator path.
  - `EncryptedString({ equality: true, freeTextSearch: true })` — codec hook emits `add_search_config` for both `'unique'` and `'match'` indices; exercises the `ilike` operator path.
- Both nullable (`EncryptedString(...)?`) and non-nullable variants are supported and individually tested.

### Envelope-codec runtime pattern

- The user-facing input/output type for an `EncryptedString` column is an `EncryptedString` envelope class (not a raw `string`).
- Writes: users construct envelopes via `EncryptedString.from(plaintext)`. Bulk-encrypt middleware coalesces all envelopes in a query into one `bulkEncrypt({ signal })` call to the CipherStash SDK before `codec.encode` runs. Codec encode is identity (extracts the populated ciphertext from the envelope's internal handle).
- Reads: `codec.decode` returns a fresh envelope wrapping the wire ciphertext + the column identity supplied by `SqlCodecCallContext.column` (from [TML-2330](https://linear.app/prisma-company/issue/TML-2330)). Per-cell `await envelope.decrypt({ signal })` triggers a single-cell SDK call; bulk read-side decryption is via a standalone `decryptAll(rows, { signal })` utility that walks recursively and issues one `bulkDecrypt` call per SDK routing key.
- Decryption is **always explicit** — never lazy on field access, never streamed mid-iteration.
- Implementation rides on the post-#402 `RuntimeParameterizedCodecDescriptor<P>` machinery (the same shape pgvector uses — `paramsSchema` declared via arktype, separate from the codec body itself which keeps the existing `codec({ typeId, targetTypes, encode, decode, ... })` shape).

### Search operators: cipherstash-namespaced (`cipherstashEq`, `cipherstashIlike`)

> **Decision (2026-05-08).** Cipherstash columns expose their search operators under a **cipherstash-namespaced** API — not by extending or overriding the framework's built-in `eq` / `ilike`. Two reasons:
>
> 1. The framework's built-in `eq` lowers to `"col" = $1`, which is wrong on `eql_v2_encrypted` columns (EQL ciphers carry randomized nonces; two encryptions of the same plaintext don't byte-equal). Trait-based dispatch onto the built-in `eq` would silently produce wrong-SQL.
> 2. The codec exposes its own EQL operators (`eql_v2.eq`, `eql_v2.ilike`), which are semantically distinct from the relational `=` / `LIKE`. Surfacing them under cipherstash-namespaced names makes the difference explicit at the call site rather than hiding it behind a transparent-overload that would surprise users when behavior diverged.
>
> Concretely: the cipherstash codec declares **no traits** at registration time. The framework's built-in trait-gated operators (`eq`, `neq`, `in`, `notIn`, `like`, `ilike`) are therefore **not reachable** on cipherstash columns — calling `email.eq(...)` is a type error. Equality and free-text search go through `email.cipherstashEq(...)` and `email.cipherstashIlike(...)` respectively.

- Lowering for `cipherstashEq` on encrypted columns: `email.cipherstashEq($1)` lowers to `eql_v2.eq("email", $1::eql_v2_encrypted)` (the EQL canonical form). The middleware bulk-encrypts `$1`'s plaintext into ciphertext before encode runs.
- Lowering for `cipherstashIlike` on encrypted columns: `email.cipherstashIlike($1)` lowers to `eql_v2.ilike("email", $1::eql_v2_encrypted)` similarly.
- Null check: `email.isNull()` and `email.isNotNull()` lower to `IS [NOT] NULL` directly via the framework's `NullCheckExpr` — the operator registry is not consulted, so the cipherstash namespacing has no effect on null handling.
- Both operators are integration-tested against live Postgres + EQL: a query `db.from(User).where(({ email }) => email.cipherstashEq('alice@example.com'))` and a parallel `cipherstashIlike(...)` round-trip from authored contract → encoded query → real database execution → decoded result.
- Operators register through the existing `queryOperations` mechanism that pgvector uses for distance operators — same SPI, no new framework surface, no method-name collisions.

### Per-column search config: emitted automatically by the codec lifecycle hook

Provided by the TML-2397 foundation:

- The cipherstash codec lifecycle hook (`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts` on the contract-spaces base) is a synchronous plan-time function that fires per-field-delta as the application emitter diffs prior vs new contracts.
- On `'added'` of an `Encrypted<string>` field with `typeParams.searchable === true`: the hook emits `cipherstash-codec:<table>.<field>:add-search-config@v1` carrying `SELECT eql_v2.add_search_config('<table>', '<field>', …)`.
- On `'dropped'` of a previously-`searchable: true` field: the hook emits `cipherstash-codec:<table>.<field>:remove-search-config@v1`.
- On `'altered'` (e.g. `searchable` flipping or `typeParams` changing while `searchable` stays true): the hook emits a rotate op carrying drop-then-add SQL.
- The emitted ops are inlined into the **app-space** migration's `ops.json`, alongside the user's structural ops. Cipherstash's contract-space marker row stays untouched by per-column activity (project AC9).

What's left for Project 1 to wire on top of the codec hook stub: confirm the `add_search_config` call shape against EQL's expectations (the stub uses a conservative `(table, column, 'match', 'text')` default — see [`cipherstash-codec.ts:53-77`](../../../packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts) on the contract-spaces base), and align the public flag names (`equality`, `freeTextSearch`) with EQL's internal index names (`'unique'`, `'match'`). This is a small adjustment inside the existing hook, not a new mechanism.

### `RuntimeMiddleware` SPI changes

Already cherry-picked onto the contract-spaces base in M1:

- `beforeExecute(plan, ctx, params)` carries a third parameter `params: SqlParamRefMutator` (the param-transform seam — see [middleware-param-transform task spec](specs/middleware-param-transform.spec.md)).
- `MiddlewareContext.signal: AbortSignal | undefined` carries the per-query signal, identity-equal to the codec call context's signal from [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- TML-2397's contract-spaces base already lands PR #409's `intercept` and `contentHash` on `RuntimeMiddlewareContext`. The cherry-pick of our `signal` and `params` onto that base merged cleanly (signal sits next to contentHash; both fields populate at construction).

## Non-Functional Requirements

- **Bulk amortization on both write and read sides.** A query inserting N rows × M cipherstash columns sharing one routing key issues exactly **one** `bulkEncrypt` call. A `decryptAll(rows)` over K envelopes across one routing key issues exactly **one** `bulkDecrypt` call. Verified per-test with mock SDK call counters.
- **No regression in the no-cipherstash hot path.** When no middleware in the chain mutates `ParamRef`s, the runtime forwards `plan.params` to `encodeParams` by reference identity — no allocation, no copy. Verified by an identity-equality assertion in an integration test.
- **Cooperative cancellation throughout.** Every SDK call (single-cell decrypt, `bulkEncrypt`, `bulkDecrypt`) forwards `ctx.signal` (or `opts.signal`). Already-aborted signals at codec or middleware entry surface `RUNTIME.ABORTED { phase }` per ADR 207 / 208.
- **No `any`, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`.** Type casts minimized; `as unknown as T` only as last resort with justifying comment.
- **Package layering.** Extension lives at `packages/3-extensions/cipherstash/` mirroring `extension-pgvector`. `pnpm lint:deps` passes.
- **Authoring parity is byte-equal.** PSL-source and TS-source must produce identical `contract.json` (parity integration test asserts this).
- **Tree-shakable control vs runtime planes.** The cipherstash package separates control-plane exports (descriptor, codec lifecycle hooks, contract-space artefacts — consumed at migration time) from runtime exports (envelope class, encode/decode codec, bulk-encrypt middleware, `decryptAll` — consumed at query time). Apps that only emit migrations against cipherstash never load the runtime; apps that only run queries never load the migration-time descriptor.

## Non-goals

The Project 1/Project 2 cleavage is on two axes:

**Out of scope: anything not exercised end-to-end.** Per the project's "ship only what's tested end-to-end" principle, every shipped surface must have a passing integration test against live Postgres + EQL. This explicitly excludes:

- **Other column types** — `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson` ship in Project 2; each instantiates Project 1's pattern (envelope + codec + PSL constructor + TS factory + parity test + operator lowering + end-to-end test). Adding them to Project 1's PSL constructor surface without their full pattern coverage would create "this constructor exists but breaks at runtime" failure modes.
- **Other operator families** — `orderAndRange` (`gt`/`gte`/`lt`/`lte`), `searchableJson`. Project 2.

**Out of scope: hand-authored migration factories.** Originally a Project 1 feature; superseded by TML-2397's codec lifecycle hook. Users no longer write `cipherstash.addSearchConfig(...)` calls in `migration.ts`; the codec hook emits the equivalent op automatically when the user adds / drops / alters an `Encrypted<string>` column with `searchable: true` typeParams.

**Edge cases of the codec hook deferred to Project 2.** The hook covers added / dropped / typeParams-altered for `Encrypted<string>`. Cross-type transitions (e.g. flipping a column from plain `string` to `Encrypted<string>` with rows in place — which requires re-encrypting existing data) and mode-flag downgrade policy (warn vs error vs silent drop when a search index is removed and downstream consumers may exist) are Project 2 concerns that apply across all encrypted types, not Project-1-specific.

**Other non-goals:**

- **No KMS provider abstraction.** This package is CipherStash-specific. Vault, AWS KMS, etc. would each ship as separate packages with their own envelope classes if there's demand.
- **No re-implementation of the CipherStash SDK.** The extension wraps the existing SDK. If the SDK lacks bulk-call shapes that fit cleanly, that's coordination with the CipherStash team.
- **No automatic plaintext zeroing on the envelope's plaintext slot.** Documented expectation: users with strict secrets-hygiene requirements dispose envelopes promptly.
- **No re-encryption migration support.** Adopting CipherStash for an existing column requires a data migration (re-encrypt existing rows) which users handle via Prisma Next's general migration tooling and a one-off script. A "rotate codec" migration primitive is a future concern.
- **No streaming-time decryption.** The framework's streaming path doesn't try to decrypt envelopes mid-iteration. Users either call `decrypt()` per cell or buffer first then call `decryptAll`.
- **No selective-by-column `decryptAll`.** First-pass utility decrypts every envelope it walks. Users wanting selective decrypt write their own walker.

# Acceptance Criteria

The umbrella's acceptance criteria are the union of the (still-active) task specs' criteria — see each task spec for fine-grained criteria. The umbrella-level integration tests are:

- [ ] **AC-UMB1**: Round-trip integration test against live Postgres + EQL: contract authored in **PSL** declares a `User` model with an `EncryptedString({ equality: true, freeTextSearch: true })` column. `prisma-next migrate` produces app-space + cipherstash-space migrations (codec hook emits `add_search_config` for both `unique` and `match` index modes). `db apply` runs both spaces in a single transaction. Insert via `db.insert(User, { email: EncryptedString.from('alice@example.com') })`. A query using `email.cipherstashEq('alice@example.com')` returns the row. A parallel query using `email.cipherstashIlike('%alice%')` returns the row. `decryptAll(rows)` materializes plaintext. **Note on the unrelated `equality: true` author-time flag**: this remains the user-facing flag for declaring an encrypted column supports equality search at the contract / DDL level (drives the `add_search_config` op for the `unique` index). It is *not* the same as the framework's `equality` *trait*, which the cipherstash codec deliberately does not declare (see § Search operators).
- [ ] **AC-UMB2**: The same scenario authored via the **TypeScript contract** (`encryptedString({...})`) produces a `contract.json` byte-identical to the PSL version (parity test).
- [ ] **AC-UMB3**: Bulk amortization verified: inserting 10 rows × 1 encrypted column issues exactly **one** `bulkEncrypt` mock-SDK call. `decryptAll` over a 10-row result set issues exactly **one** `bulkDecrypt` mock-SDK call.
- [ ] **AC-UMB4**: Nullable variant: `email: EncryptedString({ equality: true })?` round-trips correctly with a mix of null and non-null rows. A query using `email.isNull()` lowers to `WHERE email IS NULL` directly via `NullCheckExpr` (not an `eql_v2.eq` call); the operator registry is not consulted.
- [ ] **AC-UMB5**: Cancellation: an aborted `signal` at any phase (`beforeExecute`, codec encode, codec decode, single-cell `decrypt`, `decryptAll`) surfaces `RUNTIME.ABORTED { phase }` promptly per ADR 207 / 208.
- [ ] **AC-UMB6**: `pnpm lint:deps` passes for `packages/3-extensions/cipherstash/`.
- [ ] **AC-UMB7**: An example app under `examples/` demonstrates the pattern with realistic shapes (PSL schema + a few queries + a `decryptAll` site).
- [ ] **AC-UMB8**: Strict `dbInit` (no `strictVerification: false`, no allowlist) succeeds against the resulting database; an extra column added by hand to `eql_v2_configuration` causes `dbInit` to fail with a strict-mode error. Inherits TML-2397 AC1 — Project 1 verifies it remains true with a real cipherstash runtime in place.
- [ ] **AC-UMB9**: Tree-shaking is real: a build that imports only `@prisma-next/extension-cipherstash/control` does not pull in `EncryptedString`, the codec encode/decode, the bulk-encrypt middleware, or the SDK interface. A build that imports only `@prisma-next/extension-cipherstash/runtime` does not pull in the contract-space artefacts (`cipherstashContract`, `cipherstashBaselineMigration`).

# Other Considerations

## Security

- **Threat model.** Database operator and any party with raw database access cannot read encrypted columns. Network attackers cannot read encrypted columns in transit (already covered by TLS to Postgres). Application-layer compromise is not in scope — by definition the application must decrypt to operate.
- **Plaintext exposure window.** Plaintext lives on the envelope's internal handle from `from(plaintext)` until the envelope is GC'd. Project 1 does not zero the plaintext slot post-encrypt (see `envelope-codec-extension.spec.md` § Open Question 5 for the decision record); a write-side envelope's `decrypt()` therefore returns the original plaintext synchronously without an SDK round-trip. Strict-hygiene users dispose envelopes promptly. An explicit `dispose()` API is a phase-2 add-on.
- **Routing keys / dataset identifiers.** ZeroKMS routes bulk calls by `(dataset, keyId)`. The handle captures these from `SqlCodecCallContext.column` plus extension config. Misconfigured routing produces auth failures from ZeroKMS — not silent data corruption.
- **EQL extension privileges.** EQL install requires database superuser (creates schemas, types, functions, operators). The contract-space runner applies the install op under whatever role the user supplies; failure surfaces a clear DDL error. Documented prerequisite.
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
| [TML-2397](https://linear.app/prisma-company/issue/TML-2397) | Contract spaces — first-class schema contributions from extensions | **Foundation** — Project 1 rebases onto `tml-2397-cipherstash-contract-space`; TML-2397 owns the cipherstash control plane (descriptor, codec lifecycle hook, contract-space artefacts, EQL bundle install). |
| [#400](https://github.com/prisma/prisma-next/pull/400) (was [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) | Codec call context + per-query `AbortSignal` (ADR 207) | **Direct, satisfied** — merged 2026-05-01; codec consumes `SqlCodecCallContext.column` |
| [#402](https://github.com/prisma/prisma-next/pull/402) (was [TML-2229](https://linear.app/prisma-company/issue/TML-2229)) | Unified `CodecDescriptor<P>` + per-library JSON extensions (ADR 208) | **Direct, satisfied** — merged 2026-05-01; `paramsSchema` plumbing for `EncryptedString` config |
| [#404](https://github.com/prisma/prisma-next/pull/404) | Invariant-aware ref routing (M4) + self-edge support | **Realized via TML-2397** — contract spaces consume `findPathWithDecision` for per-space `db init`/`db update`. Project 1 inherits the routing benefit; no direct dependency on the original migration-factories invariantId design (which is now obsolete). |
| [#409](https://github.com/prisma/prisma-next/pull/409) | `intercept` hook on middleware + `contentHash` | **Already on contract-spaces base** — TML-2397's branch was based after #409 merged; our middleware-param-transform cherry-pick added `signal` next to `contentHash` cleanly. |
| [#411](https://github.com/prisma/prisma-next/pull/411) | Current draft holding initial spec drafts (this project's predecessor) | Replaced by this umbrella |

## Sibling components in the umbrella

- [`sql-raw-factory`](../sql-raw-factory/spec.md) — sibling component that ships the public user-facing `raw\`...\`` template-literal factory **on top of** the `RawSqlExpr` AST node defined by [raw-sql-ast-node task spec](specs/raw-sql-ast-node.spec.md). Project 1 does not depend on `sql-raw-factory`; `sql-raw-factory` depends on Project 1's AST node. If both ship independently in either order, `sql-raw-factory`'s consumption of the AST node is straightforward.
- [`project-2`](../project-2/spec.md) — sibling component covering the expanded type/operator surface. Out of scope for Project 1; documented at the umbrella level.

## Internal references

- [Framework gaps assessment](../../../reference/framework-gaps.md) — the source-of-truth catalogue motivating this project.
- [TML-2397 project spec](../../extension-contract-spaces/spec.md) — the contract-spaces foundation. Will migrate to `docs/architecture docs/` at TML-2397 close-out; this transient link will be replaced.
- [pgvector extension](../../../packages/3-extensions/pgvector/) — the extension pattern this project mirrors (column type, codec, control descriptor, parity test under `test/integration/test/authoring/parity/pgvector-named-type/`).
- [PSL parser README](../../../packages/2-sql/2-authoring/contract-psl/README.md) — namespaced extension constructor support (`pgvector.Vector(...)` shape).
- [ADR 207 — codec call context](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the codec-side context this extension consumes.
- [ADR 208 — unified `CodecDescriptor<P>`](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — the parameterized-codec descriptor shape `EncryptedString` rides on.
- [First-attempt integration](../../../reference/cipherstash/stack/packages/stack/src/prisma/) — the CipherStash team's prior integration; `eql-bundle.ts`, `database-dependencies.ts`, `operation-templates.ts` are the concrete artifacts this project supersedes / lifts from.

# Open Questions

1. **Operator lowering — pre-emit vs adapter-time.** EQL operators (`eql_v2.eq`, `eql_v2.ilike`) have to enter the SQL stream somehow. Options: (a) the extension's `queryOperations` rewrites the operator at lowering time when the column's codec id is `cipherstash/string@1`; (b) a Postgres-target post-processor wraps the canonical SQL operator. (a) is the pgvector-distance-operator precedent; default is (a) unless the EQL surface forces (b).
2. **Codec hook flag-name mapping.** TML-2397's stub codec hook uses a single conservative `'match'` index name in its emitted `add_search_config` call ([`cipherstash-codec.ts:53-77`](../../../packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts)). Project 1's `EncryptedString({ equality, freeTextSearch })` typeParams need a small extension to that hook so each enabled flag emits its corresponding EQL index (`equality → 'unique'`; `freeTextSearch → 'match'`) — possibly as two ops per `(table, field)`, or one op with multi-statement `execute[]`. Confirm against EQL's expectations during M2 implementation.
3. **PSL parity test location.** Parity tests live at `test/integration/test/authoring/parity/<extension-named-type>/`. Same convention for cipherstash, or co-locate under `test/integration/test/authoring/cipherstash/`? Default: same convention.
4. ~~**Routing-key surface.**~~ Resolved 2026-05-06: routing key is `{ table, column }`, derived from the envelope handle's slots. See § Open items 5 in `plan.md` for the decision record.
5. ~~**Plaintext zeroing default.**~~ Resolved 2026-05-06: do not zero. See § Open items 6 in `plan.md`.
