## TS‑Only Authoring Mode — Brief

### Objective

Enable teams and agents to author contracts purely in TypeScript with no separate emit step while preserving:

- Deterministic, code‑free runtime artifacts (the in‑memory contract object mirrors `contract.json`)
- Strong compile‑time typing for query lanes and operators
- Clean separation of concerns between types (`.d.ts` surface when present), runtime codec implementations, and the JSON contract model

This brief specifies the minimal API, invariants, and integration points so an agent can implement TS‑only authoring end‑to‑end.

### Background & Design References

- Architecture overview: [docs/Architecture Overview.md](../Architecture%20Overview.md)
- Data contract: [docs/architecture docs/subsystems/1. Data Contract.md](../architecture%20docs/subsystems/1.%20Data%20Contract.md)
- Contract emission & types (context for types‑only surface): [docs/architecture docs/subsystems/2. Contract Emitter & Types.md](../architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md)
- Query lanes and Plan typing rules: [docs/architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- Ecosystem extensions & packs (codec/types ownership): [docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md](../architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md)
- No‑emit workflow: [docs/architecture docs/subsystems/9. No-Emit Workflow.md](../architecture%20docs/subsystems/9.%20No-Emit%20Workflow.md)
- Codecs registry & plan type hints (MVP slice): [docs/briefs/Slice-Codecs-Registry-and-Plan-Types.md](./Slice-Codecs-Registry-and-Plan-Types.md)

### Scope

- Author a contract in TS using a builder API.
- Produce an in‑memory contract object (JSON‑serializable) with literal types, scalars, and optional extension decorations (e.g., `typeId`).
- Provide compile‑time types for lane inference without relying on runtime registries or a disk emit step.
- Runtime composes adapter/packs codec registry for encode/decode and validates declared `typeId`s.

Out of scope: generating files on disk, codegen of runtime clients, SQL parsing.

### High‑Level Model

- Packs/adapters publish two things:
  - Runtime codecs (implementations) registered by adapter/runtime
  - TypeScript codec type maps (ID → `{ input; output }`) exported as types only
- The TS builder is generic over the composed codec type map, enabling compile‑time validation of `typeId` literals and projection result inference.
- The contract object returned by the builder is the canonical JSON shape in memory; hashing/validation can occur in memory.

### Minimal API Sketch

```ts
// Pack/adapter exports TS types (pure types, no runtime code)
export type PgCoreCodecTypes = {
  readonly 'core/string@1': { readonly input: string; readonly output: string };
  readonly 'core/int@1': { readonly input: number; readonly output: number };
  readonly 'core/iso-datetime@1': { readonly input: Date | string; readonly output: string };
};

// Application composes packs
type CodecTypes = PgCoreCodecTypes; // later: & PgVectorCodecTypes & PostGISCodecTypes

// TS‑only builder surface
import { defineContract } from '@prisma-next/contract-builder';

const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', t =>
    t
      .column('id', 'int4', { typeId: 'core/int@1', nullable: false })
      .column('email', 'text', { typeId: 'core/string@1', nullable: false })
      .column('createdAt', 'timestamptz', { typeId: 'core/iso-datetime@1', nullable: false }),
  )
  .build(); // returns JSON‑serializable contract with literal typeIds

// Lane typing (no emit required)
import { sql, schema, type ResultType } from '@prisma-next/sql';
const tables = schema(contract).tables;

const plan = sql({ contract, adapter })
  .from(tables.user)
  .select({ id: tables.user.columns.id, createdAt: tables.user.columns.createdAt })
  .build();

type Row = ResultType<typeof plan>; // { id: number; createdAt: string } with nullability from storage
```

### Separation of Concerns

- Contract object (runtime data): JSON‑serializable; contains models, storage (scalars, nullability), and optionally extension decorations (e.g., per‑column `typeId` under a namespaced extension). No codec implementations or registries are embedded.
- Type surface (compile time): Provided via the builder generic `CodecTypes`. It maps codec IDs to TS types for input/output. Lanes use this to infer `ResultType`. No runtime lookups.
- Runtime: Adapter provides a `CodecRegistry`; runtime composes adapter + packs registries. At execute time, it resolves codecs per Plan precedence and encodes/decodes values.

### Codec Resolution & Typing Rules

- Compile time (lanes):
  - If a column has a declared `typeId` (extension decoration or builder prop), use `CodecTypes[typeId].output` for projection typing.
  - Else, fall back to scalar→JS mapping per target family (see ADR 020 in Query Lanes).
  - Nullability is taken from storage column metadata.
- Runtime (execution):
  - Precedence (see Codecs slice):
    1) Plan hint `annotations.codecs[alias|param]`
    2) Contract‑declared `typeId`
    3) Runtime override config
    4) Registry by scalar
    5) Driver/native value (advisory path)
  - Validate that every declared `typeId` is present in the composed registry; fail with a stable error if missing.

### No‑Emit Workflow

- Editors/agents import the builder and construct the contract at app startup (or module load).
- Lanes and operators use the in‑memory contract for refs/projection and the builder’s generic for types.
- Optional: a helper `hash(contract)` computes `coreHash`/`profileHash` in memory; runtime verifies these against the DB marker per [Architecture Overview](../Architecture%20Overview.md).
- No on‑disk `contract.json`/`contract.d.ts` are required for typing or execution in this mode.

### Extension Integration (Future‑proofing)

- Packs add extension‑owned decorations (e.g., per‑column `typeId`) using the extension encoding model (see [Extensions & Packs](../architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md)).
- Packs ship:
  - TS `CodecTypes` maps for compile time
  - Runtime codecs for execution
- Apps compose both: `type CodecTypes = PgCore & PgVector & PostGIS;` and runtime `registry = composeRegistries(adapter, pgvectorPack, postgisPack)`.

### Invariants & Validation

- Contract object is pure data; serializable and hashable.
- Every declared `typeId` must be a key of the composed `CodecTypes` at compile time and must be present in the runtime registry at execution time.
- Builder ensures referential integrity (tables/columns), stable key ordering for hash, and optional capability declarations used for `profileHash`.

### Acceptance Criteria

- Authoring:
  - Build a contract entirely in TS; no file emission required for typing or runtime.
  - Using a declared `typeId` narrows column projection types to the codec output type.
- Lanes:
  - `schema(contract)` exposes tables/columns from the in‑memory contract.
  - `ResultType<typeof plan>` reflects codec output types and nullability.
- Runtime:
  - Composes adapter codecs; validates `typeId` presence; encodes params and decodes rows deterministically per precedence.
- Tests:
  - Type‑level tests assert `ResultType` for codec‑annotated columns.
  - Runtime integration test executes a plan using adapter codecs with `typeId` validation.

### Tasks (Agent Checklist)

1. Implement `defineContract<CodecTypes>()` builder that returns a JSON‑serializable contract object with literal `typeId`s (optional per column).
2. Ensure `schema(contract)` and DSL builders accept the in‑memory contract (no emit).
3. Update lane typing to use `CodecTypes[typeId].output` when present; fall back to scalar mapping otherwise; preserve nullability.
4. Add runtime validation that all declared `typeId`s exist in the composed registry; error if missing.
5. Add examples and type tests demonstrating TS‑only authoring and `ResultType` inference.


