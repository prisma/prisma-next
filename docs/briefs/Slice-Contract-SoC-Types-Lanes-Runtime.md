## Separation of Concerns — Contract JSON, Contract.d.ts, Lanes, and Runtime

### Objective

Define a clear separation of concerns between:

- `contract.json` (canonical, code‑free runtime artifact)
- `contract.d.ts` (types‑only surface for compile‑time inference)
- Query lanes (type inference and plan creation without runtime coupling)
- Runtime (adapter/packs codec registry and execution)

Specify how the emit operation gathers the contract type map for codecs, how lanes consume types, and why lanes must not depend on runtime composition. Provide enough detail for an agent to implement this end‑to‑end.

### Design References

- Architecture overview: [../Architecture Overview.md](../Architecture%20Overview.md)
- Data contract: [../architecture docs/subsystems/1. Data Contract.md](../architecture%20docs/subsystems/1.%20Data%20Contract.md)
- Contract emitter & types: [../architecture docs/subsystems/2. Contract Emitter & Types.md](../architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md)
- Query lanes & result typing: [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- Ecosystem extensions & packs: [../architecture docs/subsystems/6. Ecosystem Extensions & Packs.md](../architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md)
- No‑emit workflow: [../architecture docs/subsystems/9. No-Emit Workflow.md](../architecture%20docs/subsystems/9.%20No-Emit%20Workflow.md)
- Codecs registry & plan types (MVP): [./Slice-Codecs-Registry-and-Plan-Types.md](./Slice-Codecs-Registry-and-Plan-Types.md)

### Artifacts and Responsibilities

- `contract.json` (runtime data)
  - Canonical JSON: models, relations, storage (tables/columns with scalar ids and nullability), capabilities, and extension payloads.
  - Optional per‑column type references live as extension‑owned decorations (e.g., `payload: { typeId: 'ns/name@v' }`).
  - Contains no codec implementations, no registry contents, no TypeScript types.
  - Deterministic and hashable; consumed by lanes and runtime.

- `contract.d.ts` (types‑only)
  - Exposes tables/models and a minimal codec type map for the codec IDs actually referenced by the contract.
  - References pack/adapter type exports (e.g., `@prisma-next/adapter-postgres/codec-types`) rather than duplicating type logic.
  - Enables lanes (and editors/CI) to infer `ResultType` without runtime composition.

- Query lanes
  - Build Plans from `contract.json` (refs/projection) and use `contract.d.ts` for compile‑time inference.
  - Do not import or receive runtime registries or adapter instances for typing; avoid environment coupling.

- Runtime
  - Composes a `CodecRegistry` from adapter and installed packs.
  - Encodes params/decodes rows using precedence (plan hints → declared `typeId` → overrides → by‑scalar → driver/native).
  - Validates that every declared `typeId` in the contract has a registered codec implementation; fails with a stable error otherwise.

### Emit Operation — Gathering the Contract Type Map

At emit time (PSL‑first or TS‑first with emit enabled):

1. Parse and normalize authoring inputs to contract IR (see Emitter doc).
2. Validate core + extensions; canonicalize for deterministic JSON.
3. Discover used codec type IDs:
   - Walk extension decorations on columns to collect `typeId` string literals.
   - De‑duplicate and sort deterministically.
4. Resolve type definitions for each `typeId` from pack/adapter type surfaces:
   - Packs/adapters publish a TS map: `type CodecTypes = { 'ns/name@v': { input: X; output: Y } }`.
   - The emitter generates a minimal `contract.d.ts` that references these types via imports, containing only the used IDs.
5. Write `contract.json` and `contract.d.ts` side‑by‑side. The JSON remains code‑free; the `.d.ts` is types‑only.

Notes:

- No runtime registries are constructed at emit time; the emitter only emits types.
- If no codec `typeId`s are present, the emitted `.d.ts` may omit the codec map entirely; lanes fall back to scalar→JS mapping (per target family rules).

### How Lanes Consume Types (Not Runtime)

- Lanes import the contract type (or its codec type map) from `contract.d.ts`.
- Typing rules:
  - If a projected column has a declared `typeId`, lanes map to `CodecTypes[typeId].output`.
  - Otherwise, lanes map storage scalar → JS type per the lane’s static mapping for the target (see Query Lanes ADR 020).
  - Nullability is derived from storage column metadata.
- Lanes never read a runtime `CodecRegistry` for typing. This ensures:
  - Deterministic editor/CI types without installed packs or adapters at runtime.
  - No dependency on import order or environment when computing types.
  - Stable separation of planning (lanes) from execution (runtime).

### Why Runtime Is Not Passed to Lanes

- Determinism & portability: compile‑time types must be stable across environments and not depend on dynamic registry composition.
- Editor/CI ergonomics: typechecking must work with just `contract.json` + `contract.d.ts` (or builder generics in no‑emit TS‑only mode).
- Thin core, fat targets: dialect/codec implementation lives in adapters/packs at runtime; lanes remain target‑agnostic plan producers.
- Hash stability: avoiding accidental coupling prevents hidden differences when switching lanes or environments.

### TS‑Only (No‑Emit) Mode Compatibility

- When no emit is possible, the builder carries the codec type map at the type level (generic) and returns a JSON‑serializable contract object with literal `typeId`s.
- Lanes infer types from the builder’s generics; runtime composes registries and validates `typeId` presence at execution.
- This mirrors the emit‑time split without writing `.d.ts` to disk (see [../architecture docs/subsystems/9. No-Emit Workflow.md](../architecture%20docs/subsystems/9.%20No-Emit%20Workflow.md) and [./Slice-TS-Only-Authoring-Mode.md](./Slice-TS-Only-Authoring-Mode.md)).

### Invariants & Validation

- `contract.json` is canonical, code‑free, and contains no runtime registry data.
- `contract.d.ts` is types‑only and contains a minimal codec type map for used IDs, referencing pack types.
- Lanes do not consume runtime registries for type inference.
- Runtime validates `typeId` coverage in the composed registry before execution.

### Acceptance Criteria

- Emit:
  - Emitter discovers used codec IDs from extensions and generates a minimal `contract.d.ts` that references pack types.
  - `contract.json` contains no codec implementations or registry dumps.
- Lanes:
  - Compile‑time inference uses `.d.ts` (or builder generics in no‑emit) to map `typeId` → output type; fall back to scalar mapping.
  - No runtime objects are required for typechecking.
- Runtime:
  - Composes adapter/packs registries and validates `typeId` presence.
  - Respects plan precedence for codec selection and performs encode/decode deterministically.

### Tasks (Agent Checklist)

1. Update emitter to collect `typeId`s from extension decorations, resolve pack type references, and generate minimal `contract.d.ts` codec map.
2. Ensure `contract.json` remains code‑free; confirm canonicalization and hashing unchanged by type emission.
3. Confirm lane typing path uses `.d.ts` (or builder generic) and never the runtime registry.
4. Implement runtime validation for declared `typeId` coverage and error reporting.
5. Add tests:
   - Golden emit: JSON unchanged; `.d.ts` includes only used IDs and imports pack types.
   - Lane type tests: `ResultType` reflects codec output types and nullability.
   - Runtime: missing codec for declared `typeId` yields a stable error.


