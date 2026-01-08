---
name: Parameterized column types (contract + type emission)
status: draft
owners:
  - sql-family
  - framework
  - extensions
source:
  linear: TBD
---

## Summary

Introduce a **target-agnostic** way to represent **parameterized column types** in the Prisma Next contract and in
`contract.d.ts` emission.

This unblocks correct, precise types for parameterized/custom types such as:

- Vectors (pgvector): avoid permanently “fudging” vector columns as `number[]`; support an optional dimension parameter
  (e.g. `Vector<1536>`), without hard-coding pgvector semantics into SQL core.
- Future parameterized types (including enums): types that share a codec ID but differ by per-column params must be able
  to render distinct TS types.

Crucially, the SQL family emitter must not branch on adapter-specific codec IDs (e.g. `pg/enum@1`). Codecs remain the
runtime mechanism for encoding/decoding, while parameterization is contract-owned metadata.

## Motivation / problem statement

Today, the emitted TypeScript model field types are derived from `codecId`:

- `CodecTypes['some/codec@1']['output']`

This works for scalar codecs where a codec ID maps to a single stable JS output type (e.g. `int4 → number`).

It fails when one codec ID represents a family of values that differ per column:

- Enums (future): a generic enum codec output is `string`, but correctness requires a finite union defined by params.
- Vectors: `pg/vector@1` output is `number[]`, but desired types include the vector dimension \(N\).
- Numeric: `numeric(p,s)` precision/scale are per column.

Attempts to fix enum typing by special-casing a particular codec ID in the SQL family emitter violate layering:
the SQL family cannot be coupled to Postgres (or any adapter’s codec registry) to compute types.

## Goals

### Product goals

- Users get **precise** types in `contract.d.ts` for parameterized columns.
- Vector columns can optionally reflect dimension metadata, improving safety and enabling better tooling later.
- The system can support future parameterized types (including enums) without changing SQL core for each new type.

### Technical goals

- Add a contract-level representation for parameterized column types.
- Ensure the SQL contract emitter can compute model field types without branching on codec IDs.
- Provide an extension mechanism for type-level mapping of parameterized types (e.g. pgvector can define `Vector<N>`).

## Non-goals (v1)

- Planner/verifier behaviors beyond recognizing/round-tripping the metadata (those can follow in separate work).
- Inferring missing params from runtime values (e.g. vector dimension from `number[]`).

## Key design decision

**Parameters live in the contract, but their meaning is owned by the codec/extension package.**

- The contract carries **opaque, codec-owned JSON** alongside the codec ID.
- The codec package provides:
  - **Param validation** (schema)
  - **Parameterized TypeScript type rendering** for `contract.d.ts`
  - **Runtime initialization** that receives the contract/type params (so it can enforce constraints)
  - Optional **schema helper factories** for ergonomic user APIs (e.g. `schema.types.MyType.someMember`)

## Alignment decisions (Phase 0)

These decisions are intended to be stable constraints for implementation, and are designed to be compatible with the
existing **no-emit / zero-emit workflow** (TS-authored contract objects used directly in app code).

### Contract fields (pure data, JSON-serializable)

- `StorageColumn.typeParams?: Record<string, unknown>`
  - Opaque, codec-owned **JS/type-surface parameters** only (not DB-native type params).
- `SqlStorage.types?: Record<string, StorageTypeInstance>`
  - Named registry of codec-owned type instances for schema ergonomics and reuse.
- `StorageColumn.typeRef?: string`
  - Optional reference to a key in `storage.types`.
  - **Mutually exclusive with** `typeParams` on the same column (avoid ambiguous precedence).

### Named type instance referencing (`typeRef` vs “magic keys”)

Columns reference `storage.types` via an explicit `typeRef` string field.
We explicitly do **not** reserve convention keys inside `typeParams` (e.g. `typeParams.typeName`) because that would
force a global namespace in a codec-owned param bag.

### Emission plumbing (declarative, no adapter coupling)

- SQL family emitter must not branch on concrete codec IDs (no `pg/*` special-casing).
- Parameterized type emission is driven by **declarative descriptor metadata** + **types-only imports** (safe for tooling):
  - tooling can assemble import/type info from descriptors the same way it already does for `codecTypes` and `operationTypes`.
- "No runtime module execution" constraint applies to emitted artifacts:
  - `contract.json` and `contract.d.ts` contain **no executable code**.

### Consolidated codec typing surface

`ComponentMetadata.types.codecTypes` is a **single, unified surface** for both scalar and parameterized codecs:

- **Scalar codecs**: Just specify `import` (as today).
- **Parameterized codecs**: Add a `parameterized` map keying `codecId` to a `TypeRenderer`.

There is no separate `parameterizedCodecTypes` property. All codecs flow through `codecTypes`.

```typescript
readonly codecTypes?: {
  readonly import: TypesImportSpec;
  /**
   * Optional renderers for parameterized codecs owned by this component.
   * Key is codecId (e.g., 'pg/vector@1'), value is the type renderer.
   */
  readonly parameterized?: Record<string, TypeRenderer>;
};
```

This applies consistently to `ComponentMetadata`, `EmitOptions`, and any options passed to `generateContractTypes`.

### TypeRenderer normalization lifecycle

`TypeRenderer` supports author-friendly authoring (template strings or functions):

```typescript
type TypeRenderer =
  | { kind: 'template'; template: string }       // e.g., 'Vector<{{length}}>'
  | { kind: 'function'; render: RenderFn };      // full control
```

**Normalization happens at pack assembly time** (when `createSqlFamilyInstance` or similar is called), not at emission time:

1. **Authoring**: Descriptor author can use template strings for ergonomics.
2. **Assembly**: Templates are compiled to render functions; emitter receives only normalized (function-form) renderers.
3. **Emission**: Emitter calls the normalized render functions - no template parsing at emit time.

This follows the existing pattern where `assembleOperationRegistry`, `extractCodecTypeImports`, etc. process descriptors during instance creation.

### Duplicate codecId is a hard error

When multiple descriptors provide a parameterized renderer for the same `codecId`, assembly **throws an error** rather than silently overriding:

- **Explicit is better than implicit** - silent overrides are dangerous in a composition system.
- **Consistent** - the framework requires explicit component composition elsewhere.
- **Debuggable** - errors surface immediately with clear context.

If there is ever a legitimate need to override (e.g., testing), that should be an explicit opt-in mechanism, not the default behavior.

### Runtime + `schema()` helper surface (bounded by explicit declarations)

- `schema(context)` keeps `tables` unchanged and adds a `types` namespace: `{ tables, types }`.
- `schema(context).types` surfaces named instances declared in `storage.types`:
  - **Typing**: Statically typed from `contract.d.ts` (literal types for each instance).
  - **Runtime value**: If the codec provides an `init` hook, the runtime context calls it during initialization to produce a helper object. Otherwise, the type instance metadata is exposed directly.
  - This is a **bounded set** (only what's declared in `storage.types`), not "one entry per column".
- **Codec-owned factories** (e.g. `schema.types.vector(1536)`) are a separate extension mechanism that codecs MAY provide for creating type instances dynamically. These are contributed by extension instances during runtime context creation, not from `storage.types`.

**Summary**: `schema.types` reflects `storage.types` (typed from contract, optionally initialized via codec hooks). Codec-owned factories are an additional API, not a replacement.

### No-emit / zero-emit compatibility

This design must support TS-first, no-emit dev loops where lanes read a typed contract object directly:

- All fields are plain data, preserving literal types via `as const` in TS auth flows.
- Parameterized typing is derivable from types-only imports and the TS contract object shape (no runtime registries required
  for typing).

### Normalization behavior

Contract normalization (in `validateContract`) intentionally **does not** touch `typeParams`, `typeRef`, or `storage.types`:

- These fields are optional and have no default values.
- `typeParams`/`typeRef` on columns are only present when explicitly set.
- `storage.types` is only present when the contract declares named type instances.
- Deterministic key ordering is NOT enforced at the normalization layer. If key ordering is needed for canonical hashing, it should be handled at the authoring/canonicalization layer (e.g., contract builder or emitter).

## Proposed design

### 1) Extend `StorageColumn` with opaque, codec-owned **type params**

Add optional, codec-owned JSON **type params** to `StorageColumn`. Core does not interpret these params.

Important: these are **parameters to the JS/type surface**, not database-native type parameters.

```typescript
export type StorageColumn = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly nullable?: boolean;
  readonly typeParams?: Record<string, unknown>;
};
```

Notes:

- `nativeType` remains the primary “storage truth” field (consistent with existing architecture).
- `typeParams` are opaque to SQL core; only the codec/extension that owns `codecId` defines their shape and semantics.
- Database-level parameters (e.g. `numeric(10,2)`, `varchar(255)`, `vector(1536)`) are **not** `typeParams`.
  - Today those are typically encoded in `nativeType` (string) and/or handled by the target adapter and schema IR.
  - If we later want them structured, they should live in a separate, target-owned field (e.g. `nativeTypeParams`), not in
    this codec-owned parameter surface.

### 2) Add a named “custom type instances” registry in storage (for schema ergonomics)

To support APIs like `schema.types.MyType.foo`, the contract needs a place to define **named, parameterized type
instances** (not just per-column inline params).

Introduce `storage.types` (name TBD):

```typescript
export type StorageTypeInstance = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
};

export type SqlStorage = {
  readonly tables: Record<string, StorageTable>;
  readonly types?: Record<string, StorageTypeInstance>;
};
```

Columns can then reference a named instance by convention via type params (e.g. `typeParams.typeName = 'MyType'`) or via an
explicit `typeRef` string field (name TBD). The exact referencing mechanism is a key detail to decide in implementation.

### 3) Parameterized codec interface: validate params + render TS types + initialize runtime

Extend the codec ecosystem with an optional “parameterization” capability. Conceptually, a parameterized codec provides:

```typescript
type ParamSchema = unknown; // arktype schema in implementation

type RenderTypeContext = {
  readonly contractTypeName: 'Contract';
  readonly codecTypesName: 'CodecTypes';
};

export interface ParameterizedCodecDescriptor {
  readonly codecId: string;
  readonly paramsSchema: ParamSchema;

  // Returns a TypeScript type expression string (e.g. 'Role', 'Vector<1536>', 'Decimal<2>')
  renderOutputType(params: unknown, ctx: RenderTypeContext): string;

  // Optional: render input type if different from output
  renderInputType?(params: unknown, ctx: RenderTypeContext): string;

  // Runtime: called during context/schema initialization with the contract JSON + resolved params
  // to produce validator/enforcer/helpers.
  init?(args: { contract: unknown; params: unknown }): unknown;
}
```

This is owned by the adapter/extension package that owns the codec. SQL core only orchestrates.

### 4) Contract emission: use codec-provided type renderers (no adapter coupling in SQL emitter)

The SQL family emitter should not branch on `pg/*` codec IDs. Instead:

- It reads `StorageColumn.codecId` + `StorageColumn.typeParams`.
- It asks the owning package’s `ParameterizedCodecDescriptor` (provided through descriptor metadata) to produce the
  field type expression string.
- If no parameterized descriptor exists, it falls back to `CodecTypes[codecId].output`.

This makes parameterized/custom types first-class instances of “type params + type renderer”.

### 5) Runtime + `schema()`: initialize helpers from parameterized type instances

At runtime, codecs are currently stateless. To support parameter enforcement and helper objects:

- During runtime context initialization, build a map of resolved parameterized type instances from:
  - `storage.types` (named instances)
  - column inline params (if present)
- For each instance, call the owning package’s `init(...)` hook to build helpers.
- `schema()` can expose those helpers in codec-owned namespaces, e.g.:
  - pgvector codec contributes `schema.vectors` or `schema.types.vector(...)`
  - a future enum codec could contribute `schema.enums`

The contract emission and runtime schema surface stay aligned because both are driven by the same contract params and
the same codec-owned descriptor metadata.

## Testing strategy

- Add emitter tests that verify:
  - Vector-typed model fields resolve to a parameterized TS type when dimension metadata exists.
  - A second reference parameterized type (test-only or another extension) proves that the framework is generic.

## Alternatives considered

### A) Special-case codec IDs (rejected)

Branching on codec IDs (e.g. `pg/enum@1`) in SQL family code couples core to adapters and does not generalize to
parameterized non-enum types (vectors, numeric, varchar).

### B) Encode parameters into `nativeType` strings (discouraged)

Example: `nativeType: 'vector(1536)'`.

This pushes parsing logic into many places (planner/verifier/emitter), makes normalization harder, and is error-prone.
Structured metadata is preferred.

## Risks / open questions

- How to plumb parameterized codec descriptors into emission without requiring runtime module execution (prefer using
  descriptor metadata / pack refs).
- How to represent “named type instances” and how columns reference them (explicit field vs params convention).
- How to scope and version param schemas to avoid breaking existing contracts.

## Rollout plan (high level)

1. Add contract schema support for `StorageColumn.typeParams` and `storage.types` (+ validation).
2. Add a parameterized codec descriptor surface in adapter/extension descriptor metadata.
3. Update authoring builders and a first reference implementation (pgvector and/or a test-only parameterized codec) to
   emit type params and named instances.
4. Update SQL emitter to use codec-provided type renderers.
5. Update runtime initialization + `schema()` to surface codec-provided helper objects.
6. Add tests and regenerate demo artifacts.


