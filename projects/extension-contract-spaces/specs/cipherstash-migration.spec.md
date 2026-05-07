# Summary

Implementation contract for **authoring the cipherstash extension as a contract space** on the new framework mechanism. Drives [Milestone M3](../plan.md#milestones) of the project plan. This is *new authoring* — cipherstash is not a workspace package today (it lives as in-flight design under `projects/cipherstash-integration/`); M3 produces the first actual `packages/3-extensions/cipherstash/` package, built directly on top of contract spaces. Reads on top of [the project spec](../spec.md) and the [framework-mechanism sub-spec](./framework-mechanism.spec.md).

**Parent project spec:** [`projects/extension-contract-spaces/spec.md`](../spec.md).

# Description

The cipherstash extension is the *driving consumer* of the contract-space mechanism. Its scope:

- A `~3-5 KB` (pretty-printed) contract describing the typed objects EQL exposes (one composite type, one enum, three domains, several `ore_*` composites, one configuration table).
- A baseline migration that installs the EQL bundle SQL (the existing vendored `~5,750 lines` produced by the cipherstash team) plus the configuration table and types, all carrying `cipherstash:*` invariantIds.
- A `cipherstash:string@1` codec implementing the lifecycle hook from the framework-mechanism sub-spec, emitting `add_search_config` / `remove_search_config` ops on field added / dropped events for `searchable: true` `Encrypted<string>` columns.
- A descriptor that exposes `contractSpace: { contractJson, migrations, headRef }` per the framework-mechanism sub-spec.

Because cipherstash never used `databaseDependencies` in shipped code (the spike confirmed it's all in-flight design), there's nothing to *migrate from*. The work is greenfield authoring against the new mechanism. The existing in-flight artefacts under `projects/cipherstash-integration/` are reference material — design intent for the EQL bundle, the `eql_v2_configuration` table, the codec hook semantics — but not source-of-truth code.

# Requirements

## 1. Package layout

Location: `packages/3-extensions/cipherstash/`. Mirrors `packages/3-extensions/pgvector/`'s structure:

```
packages/3-extensions/cipherstash/
├── package.json                            # @prisma-next/extension-cipherstash, public
├── tsdown.config.ts
├── tsconfig.json
├── tsconfig.prod.json
├── vitest.config.ts
├── biome.jsonc
├── README.md
├── src/
│   ├── core/
│   │   ├── cipherstash-codec.ts            # codec definition + lifecycle hook impl
│   │   ├── eql-bundle.sql                  # vendored EQL bundle (byte-for-byte)
│   │   ├── pack-meta.ts
│   │   └── contract-space/
│   │       ├── contract.json               # authored, source of truth
│   │       ├── contract.d.ts               # authored / co-emitted from PSL or TS schema
│   │       └── migrations/
│   │           ├── 20260601T0000_install_eql_bundle/
│   │           │   ├── manifest.json
│   │           │   ├── ops.json            # references eql-bundle.sql via build step
│   │           │   └── contract.json       # snapshot per ADR 197
│   │           └── (additional migrations as cipherstash bumps)
│   └── exports/
│       ├── control.ts                      # extension descriptor with contractSpace wired
│       └── runtime.ts                      # codec runtime (encoding/decoding)
└── test/
    └── …
```

`contract.json` and `migrations/*/ops.json` are committed source-of-truth. The build step (`tsdown`) inlines `eql-bundle.sql` into the `installEqlBundle` op's body so the published package's descriptor exposes self-contained migration JSON values to the framework's emit pipeline (per FR1).

## 2. Contract IR contents

`contract.json` declares the typed objects EQL exposes that user columns can name as `nativeType`. Per the project spec § "IR vocabulary boundary":

| Object | Kind | Notes |
|---|---|---|
| `eql_v2_configuration` | table | columns: `id` (text PK), `state` (eql_v2_configuration_state enum), `data` (jsonb) |
| `eql_v2_configuration_state` | enum | values: `'pending' \| 'active'` |
| `eql_v2_encrypted` | composite type | the `nativeType` user `Encrypted<string>` columns reference |
| `eql_v2.bloom_filter` | domain | (under `eql_v2` schema) |
| `eql_v2.hmac_256` | domain | |
| `eql_v2.blake3` | domain | |
| `eql_v2.ore_block_u64_8_256` | composite type | |
| `eql_v2.ore_cclw_u64_8` | composite type | |
| (further `ore_*` composites used by encrypted-column nativeTypes) | composite type | enumerated by the EQL bundle |

**Not in IR** (carried inside the `installEqlBundle` op as opaque DDL): the `eql_v2` schema, all 169 functions, 46 operators, 4 casts, 9 operator classes / families. These are not expressible as column-level `nativeType`s, so they live below the IR vocabulary boundary (project spec FR9, AC8).

The exact list of `ore_*` composites should be derived by reading the EQL bundle SQL. T3.1 in the plan covers authoring this contract; the implementer should enumerate the composites mechanically from the bundle's `CREATE TYPE` statements.

## 3. Baseline migration

`20260601T0000_install_eql_bundle/`:

- `manifest.json`: standard ADR 197 shape.
- `contract.json`: snapshot of the contract above.
- `ops.json`: an ordered list of operations:
  - `cipherstash:install-eql-bundle-v1` — body = full EQL bundle SQL byte-for-byte.
  - `cipherstash:create-eql_v2_configuration-v1` — `CREATE TABLE eql_v2_configuration (...)`.
  - One op per typed object listed in § 2 not covered by the bundle (`cipherstash:create-eql_v2_configuration_state-v1`, etc.).

**Bundle byte-equivalence (NFR4 / AC7).** The EQL bundle SQL must be inlined into `ops.json` byte-for-byte from the cipherstash team's vendored file. Implementation choices:

- **(a) Build-time inline.** `tsdown` (or a small build script) reads `src/core/eql-bundle.sql` and substitutes its content into `ops.json` as a string literal. The on-disk `ops.json` source has a placeholder; the published `dist/` carries the inlined version. *Pro:* source files stay diffable. *Con:* the on-disk source `ops.json` doesn't equal what the framework reads.
- **(b) Authored-once inline.** `ops.json` carries the bundle inline from the start. Updating cipherstash's bundle = updating `ops.json` directly + creating a new migration. *Pro:* WYSIWYG even at the cipherstash source level. *Con:* `ops.json` is large, less reviewable.

Recommendation: **(a)** — keeps `ops.json` reviewable and the bundle reviewable separately. Build-step contract: emit `ops.json` with the bundle inlined; the descriptor's `contractSpace.migrations` exposes the post-build (inlined) JSON.

`headRef`:

```json
{
  "hash": "<canonical hash of contract.json above>",
  "invariants": [
    "cipherstash:install-eql-bundle-v1",
    "cipherstash:create-eql_v2_configuration-v1",
    "cipherstash:create-eql_v2_configuration_state-v1",
    "cipherstash:create-eql_v2_encrypted-v1"
    // … plus ore_* type invariants …
  ]
}
```

Invariants array is sorted alphabetically per the framework-mechanism sub-spec § 3 canonicalization rule.

## 4. Codec lifecycle hook (`cipherstash:string@1`)

Implements `CodecControlHooks.onFieldEvent` per [framework-mechanism sub-spec § 5](./framework-mechanism.spec.md#5-codec-lifecycle-hook-t21-t22).

Behaviour:

| Event | Trigger condition | Emitted ops |
|---|---|---|
| `'added'` | new field uses `cipherstash:string@1` codec AND `typeParams.searchable === true` | `cipherstash-codec:<table>.<field>:add-search-config@v1` — `SELECT eql_v2.add_search_config('<table>', '<field>', …)` |
| `'dropped'` | prior field used `cipherstash:string@1` codec AND `typeParams.searchable === true` | `cipherstash-codec:<table>.<field>:remove-search-config@v1` — `SELECT eql_v2.remove_search_config('<table>', '<field>')` |
| `'altered'` | both fields use `cipherstash:string@1`, `typeParams.searchable` differs OR other typeParams change | rotate sequence: drop-then-add, with invariantId `cipherstash-codec:<table>.<field>:rotate-search-config@v1` (or pair of drop + add) |

For `'added'` / `'dropped'` where `searchable !== true`, the hook returns `[]` (no DDL needed — the column type is the only concern, handled by the structural ops the user emits).

`invariantId` template: `cipherstash-codec:<table>.<field>:<action>@v1`. Stable across regenerations (deterministic from `(table, field, action)`).

The hook is synchronous and operates only on the table IR passed in. It does *not* read cipherstash's contract-space contract or marker — those advance independently via M1's per-space mechanism.

## 5. Descriptor wiring

`src/exports/control.ts`:

```ts
import { cipherstashContractJson } from '../core/contract-space/contract';
import { cipherstashMigrations } from '../core/contract-space/migrations';
import { cipherstashHeadRef } from '../core/contract-space/head-ref';
import { cipherstashCodecHooks } from '../core/cipherstash-codec';

export const cipherstashExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...cipherstashPackMeta,
  types: {
    ...cipherstashPackMeta.types,
    codecTypes: {
      ...cipherstashPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [CIPHERSTASH_STRING_CODEC_ID]: cipherstashCodecHooks,
      },
    },
  },
  contractSpace: {
    contractJson: cipherstashContractJson,
    migrations: cipherstashMigrations,
    headRef: cipherstashHeadRef,
  },
  // intentionally no `databaseDependencies` — superseded by `contractSpace`
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};
```

The descriptor never imports build-time-only material; everything it exposes is in-memory JSON values plus the codec runtime functions.

## 6. End-to-end integration test (T3.6, T3.7)

Test file: `packages/3-extensions/cipherstash/test/cipherstash.e2e.test.ts` (or under the integration test harness — `packages/.../tests/integration/`).

**Scenario A (initial setup):**

1. Fresh Postgres database (PGlite via `@prisma/dev` per AGENTS.md).
2. Application config `extensionPacks: [cipherstashExtensionDescriptor]`.
3. PSL: `model User { id String @id; email Encrypted<String, { searchable: true }> }`.
4. Run `prisma-next migrate`.
5. Assert directory layout:
   - `migrations/<timestamp>_initial/{manifest, ops, contract}.json` exists; `ops.json` contains the user's `CREATE TABLE` op + the codec-emitted `cipherstash-codec:User.email:add-search-config@v1` op.
   - `migrations/cipherstash/{contract.json, contract.d.ts, refs/head.json}` written; bytes match descriptor's `contractSpace`.
   - `migrations/cipherstash/20260601T0000_install_eql_bundle/{manifest, ops, contract}.json` exists; `ops.json` body equals the vendored bundle byte-for-byte.
6. Run `prisma-next db apply`.
7. Assert single transaction (use Postgres logging or the runner's transaction wrapper).
8. Assert marker rows: `(space='app', hash=<app-hash>, invariants=['app:create-table-User-v1', 'cipherstash-codec:User.email:add-search-config@v1'])`, `(space='cipherstash', hash=<cipherstash-hash>, invariants=[<all 'cipherstash:*' invariants>])`.
9. Assert `dbInit` runs in strict mode without `strictVerification: false` and succeeds.
10. Insert + select an `Encrypted<String>` value to confirm the codec's runtime path still works.

**Scenario B (drop column):**

1. Continue from Scenario A.
2. Remove the `email` field from PSL. Re-run `migrate` + `apply`.
3. Assert the new app-space migration carries `cipherstash-codec:User.email:remove-search-config@v1`.
4. Assert `cipherstash` marker row unchanged (no extension-space migration).

**Scenario C (extension bump):**

1. Continue from Scenario A.
2. Author a second cipherstash migration in `src/core/contract-space/migrations/20260615T0000_add_audit_column/` (e.g. adds a column to `eql_v2_configuration`).
3. Bump cipherstash's `headRef` to point at the new contract.
4. Re-run `migrate`.
5. Assert pinned `migrations/cipherstash/{contract.json, contract.d.ts, refs/head.json}` updated in place.
6. Assert new `migrations/cipherstash/20260615T0000_add_audit_column/` directory created.
7. Run `db apply`. Assert cipherstash marker row advances; app-space marker unchanged.

**Scenario D (revert workaround — T3.7, T3.8):**

1. Audit `packages/` and `examples/` for `strictVerification: false` flags introduced under the cipherstash project's first attempt.
2. Remove all such flags.
3. Confirm `pnpm test:e2e` (or the cipherstash test) still passes — strict mode now succeeds because cipherstash's typed objects are recognized as expected via its contract space.

## 7. Bump-cipherstash diff test (T3.7 in plan / Scenario C above)

Repeat Scenario C as a pure-fixture test (without live Postgres), asserting the file-system diff produced by `migrate`:

- `migrations/cipherstash/contract.json`: changed.
- `migrations/cipherstash/contract.d.ts`: changed.
- `migrations/cipherstash/refs/head.json`: changed (`hash` and `invariants` updated).
- `migrations/cipherstash/20260615T0000_add_audit_column/`: created.
- No file outside `migrations/cipherstash/` (and any incidental app-space changes) is touched.

This test is fast and runs in CI without database dependencies.

# Acceptance Criteria

Implementation-level acceptance criteria for cipherstash on contract spaces:

- [ ] **AC3.1.** `packages/3-extensions/cipherstash/` exists with the layout in § 1; `package.json` published as `@prisma-next/extension-cipherstash`.
- [ ] **AC3.2.** Contract IR enumerates the typed objects in § 2; does not include functions / operators / casts / op classes (project AC8).
- [ ] **AC3.3.** Baseline migration's `installEqlBundle` op carries the vendored bundle byte-for-byte (project AC7).
- [ ] **AC3.4.** Codec hook implements all four behaviours in § 4; invariantId templates match.
- [ ] **AC3.5.** Descriptor exposes `contractSpace` per § 5; carries no `databaseDependencies`.
- [ ] **AC3.6.** Scenario A passes (initial setup, strict-mode dbInit succeeds, marker rows correct, codec ops landed).
- [ ] **AC3.7.** Scenario B passes (drop searchable column emits `remove_search_config` in app-space; cipherstash marker unchanged).
- [ ] **AC3.8.** Scenario C passes (cipherstash bump advances pinned files + cipherstash marker; app-space untouched).
- [ ] **AC3.9.** Scenario D passes (`strictVerification: false` workaround removed; tests still green).
- [ ] **AC3.10.** Bump-diff test passes (file-system diff matches § 7 exactly).

These map onto the project spec's AC1, AC2, AC3, AC7, AC8, AC9, AC12, AC14 and the plan's TC-1 through TC-7, TC-12, TC-14, TC-21, TC-23, TC-25, TC-29.

# Other Considerations

## Cipherstash team coordination

The cipherstash team owns the EQL bundle SQL (vendored as `eql-bundle.sql`). Bumping the bundle = creating a new cipherstash migration. The team should be looped in on:

- The `cipherstash:*` invariantId namespace and immutability rules (FR11) — once published, an invariantId cannot be renamed.
- The codec hook semantics (§ 4) — they may want input on the rotate-search-config behaviour.
- The migration directory naming convention (`<timestamp>_<name>/`).

This coordination is captured separately as TML-2373's deliverable — the cipherstash umbrella project. M3 does *not* require cipherstash team approval on every artefact; it requires the artefacts to be correct against EQL's semantics.

## Test data

Scenario A's `User.email` value should be a real `Encrypted<String>` payload (not a stub), so the round-trip exercises both the contract-space schema and the codec runtime path. Use the existing `Encrypted<String>` test helpers if present, or construct a minimal encrypted payload with the EQL bundle's helper SQL functions.

## Build-time bundle inlining (§ 3 (a))

The build step (`tsdown` plugin or pre-build script) needs to:

1. Read `src/core/eql-bundle.sql`.
2. Find the `installEqlBundle` op's `execute[0].sql` placeholder in `src/core/contract-space/migrations/20260601T0000_install_eql_bundle/ops.json`.
3. Substitute the bundle content (escaping appropriately for JSON string-literal embedding).
4. Write the substituted JSON to `dist/` (and to wherever the descriptor imports `migrations` from).

If `tsdown`'s plugin model doesn't support this cleanly, a small standalone Node script run before `tsdown` is acceptable.

# References

- [Project spec](../spec.md) — design rationale, ACs.
- [Project plan](../plan.md) — task breakdown, validation gates.
- [Framework-mechanism sub-spec](./framework-mechanism.spec.md) — the mechanism this milestone consumes.
- `projects/cipherstash-integration/project-1/` — reference material from the in-flight cipherstash design (specs, handover, team-facing design doc). Not source-of-truth code.
- `packages/3-extensions/pgvector/` — reference shape for the new cipherstash package.
- ADR 197 — Migration packages snapshot their own contract.
- ADR 208 — Invariant-aware migration routing.

# Open Questions

1. **EQL bundle inlining mechanism.** § 3 recommends (a) build-time inline; confirm during T3.2 implementation. If (b) authored-once inline is chosen, document why and update CI to validate `ops.json`'s bundle bytes match the vendored source.
2. **`ore_*` composite enumeration.** The exact set of `ore_*` composites in the IR (§ 2) needs to be derived from the EQL bundle. Implementer reads the bundle's `CREATE TYPE` statements during T3.1.
3. **Rotate-search-config semantics.** § 4 specifies a drop-then-add sequence for `'altered'` events that change `searchable` or other typeParams. Confirm with the cipherstash team that this matches EQL's expectations (vs an in-place update primitive, if one exists). Defer to TML-2373 review.
4. **Test extension reuse.** Scenarios A-D could potentially reuse the synthetic test extension from T1.10 alongside cipherstash to cover multi-extension interactions. Out of scope for M3 (multi-extension is a project non-goal); flag as a future enhancement.
