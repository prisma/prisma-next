# PR #261 — Walkthrough

## Sources
- PR: [#261](https://github.com/prisma/prisma-next/pull/261)
- Commit range: `origin/main...HEAD`

## Intent

This PR redesigns the TypeScript contract authoring surface from a low-level, storage-first builder into a staged DSL that lets users define contracts in terms of models, fields, and relations — then lowers that through a shared semantic intermediate representation into the existing contract IR. The goal is to make TS-first contract authoring feel natural (object-literal `defineContract(...)`, typed model tokens, inline field helpers) while preserving exact structural parity with the PSL authoring path.

## The story

1. **Introduce a semantic intermediate representation** — A new `SqlSemanticContractDefinition` interface ([packages/2-sql/2-authoring/contract-ts/src/semantic-contract.ts](packages/2-sql/2-authoring/contract-ts/src/semantic-contract.ts) — lines 1–87) defines a target-agnostic, model-centric representation with nodes for fields, primary keys, unique constraints, indexes, foreign keys, and relations. This IR becomes the shared meeting point between TS authoring, PSL interpretation, and the existing contract builder.

2. **Build the staged DSL surface** — A new `staged-contract-dsl.ts` ([packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) — lines 1–1499) introduces `model()`, `field.*`, and `rel.*` factory functions. Models are defined as object literals with typed fields and relations, then further refined via `.attributes(...)` for semantic constraints (id, uniques) and `.sql(...)` for storage-specific overrides (table name, indexes, foreign keys). The design separates semantic intent from SQL-specific concerns into distinct chaining stages.

3. **Extract the lowering pipeline** — `staged-contract-lowering.ts` ([packages/2-sql/2-authoring/contract-ts/src/staged-contract-lowering.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-lowering.ts) — lines 1–706) takes a `StagedContractInput` and produces an `SqlSemanticContractDefinition`. It resolves naming strategies, maps fields to columns, lowers relations (belongsTo, hasMany, hasOne, manyToMany) into semantic nodes, validates constraints, and emits warnings for type-safety fallbacks. A companion `buildSqlContractFromSemanticDefinition` in contract-builder.ts then converts semantic nodes into the existing `ContractIR` by driving the legacy builder imperatively.

4. **Drive field helpers from shared preset descriptors** — Portable SQL field presets (`text`, `timestamp`, `createdAt`, `uuid`, etc.) are declared as pure-data `AuthoringFieldPresetDescriptor` objects in `@prisma-next/sql-contract/authoring` ([packages/2-sql/1-core/contract/src/authoring.ts](packages/2-sql/1-core/contract/src/authoring.ts) — lines 1–80+). The staged DSL's `field.text()`, `field.createdAt()`, etc. are generated from these descriptors at module load time. Target and extension packs can contribute additional field/type helpers via `authoring` metadata on their pack refs, composed at `defineContract()` time by `createComposedAuthoringHelpers()` ([packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts](packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts) — lines 1–60+).

5. **Add authoring contributions to the framework component model** — `AuthoringContributions`, `AuthoringTypeConstructorDescriptor`, `AuthoringFieldPresetDescriptor`, and related types are added to `framework-components.ts` ([packages/1-framework/0-foundation/contract/src/framework-components.ts](packages/1-framework/0-foundation/contract/src/framework-components.ts) — lines 206–376+). This lets pack refs carry pure-data authoring metadata that higher-level packages project into helper functions, keeping the framework core free of runtime helpers.

6. **Align PSL interpreter to emit via the semantic IR** — The PSL interpreter ([packages/2-sql/2-authoring/contract-psl/src/interpreter.ts](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts)) is refactored to produce `SqlSemanticModelNode[]` and call `buildSqlContractFromSemanticDefinition()` instead of driving the old dynamic builder protocol. The interpreter's internal types (`DynamicTableBuilder`, `DynamicModelBuilder`, `DynamicContractBuilder`) are removed, replaced by the shared semantic types. It now also resolves named type refs through `AuthoringTypeConstructorDescriptor` and parses constraint `map` arguments for id/unique name preservation.

7. **Prove TS ↔ PSL structural parity** — A new parity test suite ([packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts](packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts) — lines 1–257) defines matching schemas in both PSL and the staged TS DSL, then asserts deep equality of the generated contract IR. This proves the two authoring paths converge on the same semantic output. A separate parity test ([packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.parity.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.parity.test.ts) — lines 1–369) proves staged DSL output matches the legacy builder's output for naming, defaults, foreign keys, and named types.

8. **Harden runtime safety** — Multiple hardening changes across the branch: duplicate model/table/column naming detection in the lowering pipeline, prototype pollution guards in authoring helper runtime ([packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts](packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts) — lines 32–39), stricter template value resolution for type constructors, deterministic `.d.ts` emitter output via sorted iteration, and self-referential/circular relation validation.

## Behavior changes & evidence

- **New staged `defineContract(definition)` overload accepts object-literal contract definitions**: Before, `defineContract()` only returned a chaining builder. Now it also accepts a `StagedContractInput` object with `target`, `models`, `types`, `naming`, etc. and returns a fully-typed contract directly. The legacy zero-argument overload is preserved.
  - **Why**: The chaining builder requires separate `.table()` and `.model()` declarations — verbose and disconnected from the domain. The staged overload lets users declare models, fields, and relations as a single cohesive structure.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts](packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts) — lines 1785–1882
    - [packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) — lines 159–1499
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — lines 1–902
    - [test/integration/test/contract-builder.test.ts](test/integration/test/contract-builder.test.ts) — lines 1–680
    - [test/integration/test/contract-builder.types.test-d.ts](test/integration/test/contract-builder.types.test-d.ts) — lines 1–520

- **Typed model tokens enable cross-model references**: `model('User', { fields: ... })` returns a `StagedModelBuilder` with a `.refs` property that provides `TargetFieldRef` tokens (e.g., `User.refs.id`). These tokens carry type-level model and field name information, enabling typed cross-model foreign key and relation declarations like `constraints.foreignKey(cols.userId, User.refs.id)`.
  - **Why**: String-based cross-model references are error-prone and lose type information. Tokens let TypeScript catch mismatched model/field names at compile time.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) — lines 540–835
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — lines 60+
    - [packages/2-sql/2-authoring/contract-ts/test/staged-contract-warnings.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-warnings.test.ts) — lines 1–440

- **Pack-contributed field and type helpers are composed at contract definition time**: When `defineContract()` receives a staged definition with a target pack and optional extension packs, it calls `createComposedAuthoringHelpers()` which walks the packs' `authoring.field` and `authoring.type` namespaces, producing callable helper functions (e.g., `helpers.field.text()`, `helpers.types.pgvector.vector(1536)`).
  - **Why**: Field presets and type constructors are declared as pure data on pack refs. The composition layer bridges data descriptors to the callable helpers users need, keeping the pack ref protocol JSON-serializable.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts](packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts) — lines 1–268
    - [packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts](packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts) — lines 1–139
    - [packages/2-sql/2-authoring/contract-ts/src/authoring-type-utils.ts](packages/2-sql/2-authoring/contract-ts/src/authoring-type-utils.ts) — lines 1–168
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-ts/test/authoring-helper-runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/authoring-helper-runtime.test.ts) — lines 1–273
    - [packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.helpers.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.helpers.test.ts) — lines 1–657

- **PSL interpreter converges with TS authoring through the shared semantic IR**: The PSL interpreter no longer drives its own imperative builder protocol. Instead it builds `SqlSemanticModelNode[]` arrays (the same type the staged lowering produces) and calls `buildSqlContractFromSemanticDefinition()`. This also adds named-type resolution via `AuthoringTypeConstructorDescriptor` and constraint-name preservation for `@id(map: ...)` and `@unique(map: ...)`.
  - **Why**: Two separate builder protocols meant two independent translation paths — divergence risk. Converging on a shared IR guarantees structural parity and reduces maintenance surface.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) — lines 49–152+
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts](packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts) — lines 1–257
    - [packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts](packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts) — lines changed

- **Deterministic `.d.ts` emitter output**: The emitter now sorts model/table entries alphabetically before generating type declarations, preventing non-deterministic output order when the contract object's key order varies between runs.
  - **Why**: Unstable ordering caused unnecessary diffs in emitted `.d.ts` files, making it harder to verify CI fixtures and detect real changes.
  - **Implementation**:
    - [packages/2-sql/3-tooling/emitter/src/index.ts](packages/2-sql/3-tooling/emitter/src/index.ts) — four `Object.entries(...).sort(...)` additions
  - **Tests**:
    - [packages/2-sql/3-tooling/emitter/test/emitter-hook.generation.advanced.test.ts](packages/2-sql/3-tooling/emitter/test/emitter-hook.generation.advanced.test.ts) — fixture alignment

- **Duplicate naming collision detection**: The lowering pipeline now rejects contracts where two models map to the same table name, two fields within a model map to the same column name, or a model token name doesn't match its object key.
  - **Why**: Silent naming collisions produced corrupted contracts. Fail-fast validation surfaces the problem at authoring time with clear error messages.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/staged-contract-lowering.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-lowering.ts) — lines 616–665
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-ts/test/staged-contract-dsl.runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-dsl.runtime.test.ts) — lines 1–237
    - [packages/2-sql/2-authoring/contract-ts/test/staged-contract-lowering.runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-lowering.runtime.test.ts) — lines 1–447

- **Prototype pollution guards on authoring helpers**: `createFieldHelpersFromNamespace` and `createTypeHelpersFromNamespace` reject `__proto__`, `constructor`, and `prototype` as helper path segments.
  - **Why**: Pack-provided authoring namespaces are untrusted input. Without guards, a malicious namespace could override prototype properties.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts](packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts) — lines 32–39
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-ts/test/authoring-helper-runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/authoring-helper-runtime.test.ts) — blocked key tests

- **Warning batching for fallback type-safety hints**: When the staged DSL detects fields using string-based model references or unresolvable named type instances (instead of typed tokens), it emits `process.emitWarning()` suggesting typed alternatives. Warnings above a threshold are batched to prevent stderr flooding.
  - **Why**: The DSL accepts both typed tokens and plain strings for gradual adoption. Warnings guide users toward the type-safe path without blocking.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/staged-contract-warnings.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-warnings.ts) — lines 1–245
  - **Tests**:
    - [packages/2-sql/2-authoring/contract-ts/test/staged-contract-warnings.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-warnings.test.ts) — lines 1–440

- **No behavior change — refactored type utilities**: Shared type-level utilities (`UnionToIntersection`, `NamedConstraintSpec`, `FieldHelpersFromNamespace`, etc.) extracted to `authoring-type-utils.ts` to eliminate duplication between DSL, helpers, and builder.
  - **Implementation**:
    - [packages/2-sql/2-authoring/contract-ts/src/authoring-type-utils.ts](packages/2-sql/2-authoring/contract-ts/src/authoring-type-utils.ts) — lines 1–168

## Compatibility / migration / risk

- **Backward compatible**: The legacy `defineContract<CodecTypes>()` zero-argument chaining API is fully preserved. Existing code using `.target().table().model().build()` continues to work unchanged.
- **New API is additive**: The staged DSL (`defineContract({ target, models, ... })`) is a new overload, not a replacement.
- **PSL output is structurally identical**: The parity tests prove that PSL interpretation produces the same contract IR through the new semantic path as it did through the old builder protocol.
- **Risk — type complexity**: The staged DSL accumulates significant type-level state (conditional types, mapped types over model/field/relation generics). This is inherent to tracking field-level nullability, column names, and constraint names through chaining. Compile-time performance on very large contracts should be monitored.

## Follow-ups / open questions

- **Composition API for the factory overload**: `defineContract(scaffold, factory)` receives helpers but the user API ergonomics (e.g., destructuring `{ field, types }` from helpers) need further refinement.
- **Self-referential relation tests added but M:N self-referential not yet covered**: Current tests cover self-referential belongsTo/hasMany/hasOne but manyToMany with `through` pointing at the same model is not fully exercised.
- **`ifDefined()` migration incomplete**: Some call sites were migrated to `ifDefined()` for optional property spreading, but not all contract-builder paths have been updated.

## Non-goals / intentionally out of scope

- **Migration tooling**: No automated migration from legacy builder to staged DSL is provided. Users adopt the new API voluntarily.
- **Document-family support**: The staged DSL is SQL-specific. Document-family contract authoring is not addressed.
- **Runtime query behavior**: This PR changes only the authoring/emission pipeline. Query execution, SQL generation, and adapter behavior are unchanged.
