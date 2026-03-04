# Summary

Bring PSL-first SQL contract authoring (`@prisma-next/sql-contract-psl/provider`) to parity with TypeScript contract authoring for the behaviors exercised by `examples/prisma-next-demo`, specifically around extension pack metadata/capabilities and pgvector dimensioned vector storage types, and close a PSL relation attribute compatibility gap encountered during emit.

# Description

We migrated the Prisma Next demo app’s emitted contract workflow from TypeScript contract authoring (`prisma/contract.ts`) to PSL contract authoring (`prisma/schema.prisma`) using `prismaContract('./prisma/schema.prisma', ...)`.

During that migration we hit three concrete gaps/bugs:

1. **Missing `extensionPacks` + missing `capabilities` in the emitted contract**
  The PSL provider emits a structurally valid `contract.json` for storage/models/relations, but (today) does not populate:
  - `contract.extensionPacks` (pack metadata required by runtime extension-pack requirement checks and downstream tooling)
  - `contract.capabilities` (capability matrix used to enable capability-gated operations and features)
   In the demo, this showed up as “contract looks correct but is missing extensions/capabilities”, which breaks real-world expectations for a “complete” contract artifact.
2. **pgvector dimensioned vectors generate invalid DDL in migrations**
  Using PSL `types { Embedding1536 = Bytes @pgvector.column(length: 1536) }` and a column `embedding Embedding1536?` produced contract storage with a vector column, but migrations failed during `dbInit` with:
  - `type "vector(1536)" does not exist`
   Root cause observed in generated DDL:
  - The column type was rendered as `"vector(1536)"` (quoted identifier), which Postgres interprets as a type name, not the `vector` extension type with a dimension parameter.
   This indicates a mismatch between the contract representation emitted by the PSL interpreter and what the Postgres migration planner expects for parameterized native types.
3. **Prisma `@relation(..., map: "...")` argument rejected (current limitation)**
  PSL schema fields that use Prisma’s relation `map` argument (to name the FK constraint) fail interpretation with:
  - `PSL_INVALID_RELATION_ATTRIBUTE` complaining about unsupported argument `map`

  When the FK-side relation is rejected, backrelation list fields can become “orphaned” as a secondary diagnostic (`PSL_ORPHANED_BACKRELATION_LIST`), which is confusing for users because the schema is otherwise valid Prisma PSL.

  **Requirement (this spec):** Add support for Prisma-style `@relation(..., map: "<fk_name>")` on FK-side relations. The interpreter must accept the argument, record it in contract storage as the FK constraint name, and ensure the name is carried through migrations/verify.

This spec captures the desired behavior for PSL-first authoring so the demo (and similarly shaped apps) can use PSL as the contract source of truth without requiring post-processing in app config.

## Why we didn’t catch this with tests earlier (working theory)

- Most existing coverage (and the demo) primarily exercises **TypeScript-authored contract IR** (`defineContract()...build()`), not the **PSL provider** (`prismaContract(...)`).
- The pgvector DDL failure was specific to **dimensioned** vectors authored via PSL named types (e.g. `Embedding1536 = Bytes @pgvector.column(length: 1536)`), which produced a contract storage shape that led the Postgres planner to render `"vector(1536)"`. The TS demo contract used `vectorColumn` (unparameterized `vector`) and therefore didn’t trigger this path.
- We lacked an integration test that runs the full pipeline: **PSL emit → contract.json → dbInit (planner+runner)** on a schema containing a dimensioned vector.

# Requirements

## Functional Requirements

1. PSL provider can emit a contract that includes **extension pack metadata** when the user composes extension packs (e.g. pgvector).
2. PSL provider can emit a contract that includes an appropriate **capability matrix** for the configured target + composed extension packs (at minimum the capabilities required for the demo’s pgvector cosine query and standard Postgres features it uses).
3. PSL pgvector support must emit storage such that the Postgres migration planner renders valid DDL for dimensioned vectors:
  - Column types must render as `vector(1536)` (unquoted), not `"vector(1536)"`.
4. PSL interpreter must support Prisma-style `@relation(..., map: "<fk_name>")` for FK-side relations and propagate the FK constraint name into contract storage (e.g. `storage.tables.<table>.foreignKeys[].name`) so emitted artifacts preserve user intent and the planner/runner can create the FK with the expected name.
5. Resulting contract artifacts emitted via `prisma-next contract emit` must support:
  - `prisma-next db init` (planner + runner) successfully creating tables including vector columns
  - runtime schema building exposing vector operations as expected when extension packs are present and relevant capabilities exist
6. **End-to-end demo parity**: By the end of this work, `examples/prisma-next-demo` must be able to switch its contract source between:
  - TypeScript (`prisma/contract.ts`), and
  - PSL (`prisma/schema.prisma` via `@prisma-next/sql-contract-psl/provider`)

  with **no other behavioral changes required** for the demo to function. This includes:
  - all demo tests passing
  - running the demo by hand (CLI + seed/db init flows) working as documented

  The switch mechanism must be simple and explicit (e.g. two config files, or a single config file with a clearly documented toggle/uncommented line), and must demonstrate that PSL can produce an *equivalent* contract (relations, capabilities, extension packs) for real usage.

## Non-Functional Requirements

- **Determinism**: For equivalent PSL inputs, emitted `contract.json` must remain stable/deterministic (ordering rules should remain consistent with existing PSL interpreter determinism guarantees).
- **Diagnostics quality**: When inputs are unsupported, diagnostics must be actionable and use the preferred wording for extension namespace availability (e.g. “unrecognized namespace” and guidance to add to `extensionPacks`).
- **Backwards compatibility**: Existing PSL contracts without extension packs/capabilities must continue to work, but new behavior should be opt-in only if there’s risk of changing hashes unexpectedly. (See Open Questions.)
- **Test coverage**: Add regression tests that exercise the PSL provider end-to-end (emit + dbInit) so these classes of errors are caught in CI if reintroduced:
  - missing `capabilities` / missing `extensionPacks` in emitted contracts
  - invalid DDL for parameterized native types (pgvector `vector(N)` specifically)
  - unsupported-but-expected PSL surface area for parity (e.g. `@relation(..., map: "...")`)

## Non-goals

- Full parity with Prisma ORM PSL surface area (e.g. implicit many-to-many) beyond the specific gaps above.
- Changing demo behavior; the goal is to fix the PSL provider/interpreter so app-level workarounds are unnecessary.
- Adding new extension packs or new SQL operations beyond what’s needed for pgvector parity.

# Acceptance Criteria

- `**extensionPacks` emitted**: When the PSL provider is configured with composed pgvector, `contract.json` contains `extensionPacks.pgvector` with pack metadata (id, version, capabilities, type imports metadata) matching `@prisma-next/extension-pgvector/pack`.
- `**capabilities` emitted**: `contract.json` contains a `capabilities.postgres` object that enables the demo’s expected behaviors (at minimum includes `pgvector/cosine`; other required capabilities must be explicitly enumerated by the implementation and validated by tests).
- **Vector DDL valid**: Running `dbInit` on a contract emitted from a PSL schema containing `Embedding1536 = Bytes @pgvector.column(length: 1536)` succeeds and creates a column with type `vector(1536)` (unquoted).
- **Vector contract shape compatible with migrations**: Storage for vector columns uses a representation that the migration planner expands correctly (e.g. `nativeType: "vector"` + `typeParams.length: 1536`) and does not trigger the “quoteIdentifier(nativeType)” pathway that produces `"vector(1536)"`.
- **Relation `map` supported**: PSL schema containing `@relation(fields: ..., references: ..., map: "post_userId_fkey")` is accepted and produces a foreign key with that name in contract storage.
- **No regression**: Existing PSL interpreter tests pass, and new tests cover the above behaviors.
- **New end-to-end test coverage**: CI includes at least one test that runs **PSL provider → emitted artifacts → dbInit** on a schema containing a dimensioned pgvector column, and asserts the migration runner succeeds (i.e. no `type "vector(1536)" does not exist` failure mode).
- **New metadata regression coverage**: Tests assert PSL-emitted contracts include `extensionPacks` + `capabilities` for composed packs/target, preventing silent `{}` regressions.
- **New relation-parity regression coverage**: Add a PSL provider test fixture that uses `@relation(..., map: "post_userId_fkey")` and asserts:
  - interpretation succeeds (no `PSL_INVALID_RELATION_ATTRIBUTE`)
  - the emitted contract includes the FK name in storage
  - `dbInit` succeeds and creates the FK with the expected name (where observable via introspection)
- **Demo can run in either mode**: There is an end-to-end test (in the demo app, not only in package/unit tests) that proves the demo test suite passes when configured to use:
  - TS contract source, and
  - PSL contract source

  This test must fail if either mode produces an incomplete/non-equivalent contract (missing relations, missing capabilities/extension packs, invalid DDL).

# Other Considerations

## Security

- Ensure native type handling remains safe against SQL injection. The planner already has native type and default-expression safety checks; any changes to quoting rules must preserve those safety properties.

## Cost

- No meaningful runtime cost. Build-time/emit-time overhead should remain small (single schema parse + interpret + small amount of metadata wiring).

## Observability

- Prefer adding targeted unit/integration tests over logging. Diagnostics should be the primary “observability” surface for bad inputs.

## Data Protection

- Not applicable; this is authoring/tooling behavior.

## Analytics

- Not applicable.

# References

- Demo contract TS source: `examples/prisma-next-demo/prisma/contract.ts`
- Demo PSL source: `examples/prisma-next-demo/prisma/schema.prisma`
- PSL provider/interpreter: `packages/2-sql/2-authoring/contract-psl/`
- pgvector pack metadata: `packages/3-extensions/pgvector/src/core/descriptor-meta.ts` and `packages/3-extensions/pgvector/src/exports/pack.ts`
- Postgres migration type rendering: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` (`buildColumnTypeSql`)

# Open Questions

1. **Capabilities source of truth**: Should PSL provider:
  - (A) derive capabilities automatically from composed extension packs + known target features, or
  - (B) require explicit capabilities configuration in `prisma-next.config.ts` (like TS contract builder does), or
  - (C) support both with deterministic merge rules?
2. **Hash stability / rollout**: Emitting additional fields (`extensionPacks`, `capabilities`) will change `profileHash` (and possibly other hashes). Do we:
  - gate this behind an option (e.g. `includeFrameworkMetadata: true`), or
  - treat this as a bugfix and update expectations/fixtures accordingly?
3. **Vector type representation**: For PSL named types representing `vector(N)`, should the contract:
  - remove `typeRef` on columns and inline `typeParams` always, or
  - keep `typeRef` for type-level typing but teach the planner a special-case for parameterized typeRefs, or
  - introduce a clearer contract representation for “named type aliases” vs “storage types that must be identifier-quoted”?
4. **Relation `map` semantics**: Prisma PSL uses `map` for constraint naming. Do we need additional relation arguments (e.g. `name`) and how do we map these to contract FK naming fields in a stable way?

