## Requirements

### Summary

Refactor execution/runtime-plane composition so that **static context** (query roots, contract, codecs/operations registries, type helpers) can be created **without instantiating** runtime framework components (adapter/extension instances). This enables an ergonomic demo setup split into:

- `examples/prisma-next-demo/src/prisma/context.ts` — static setup + query roots
- `examples/prisma-next-demo/src/prisma/runtime.ts` — dynamic runtime wiring (instantiates stack + driver) used by `main.ts`

### Functional requirements

1. **Descriptor-level static contributions (required + consistent)**
   - Targets, adapters, and extension packs must expose the same required static contributions methods:
     - `codecs(): CodecRegistry`
     - `operationSignatures(): ReadonlyArray<SqlOperationSignature>`
     - `parameterizedCodecs(): ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>`
   - These methods are **never optional**. If a descriptor has nothing to contribute, it returns empty values.
   - Static context creation must not require calling `descriptor.create()` for:
     - target
     - adapter
     - extension packs
   - `@prisma-next/sql-runtime` must not “normalize” missing contributions (no `?.()` / `?? empty`). Empty defaults are provided at descriptor definition sites.

2. **Static context creation**
   - Provide a function to create the lane `ExecutionContext` from:
     - a validated contract value (emit or no-emit)
     - an execution stack of descriptors (framework domain)
   - The resulting context must include:
     - `contract`
     - `operations`
     - `codecs`
     - `types` (non-optional; may be empty)

3. **Runtime construction**
   - `createRuntime` is a wafer-thin factory and consumes:
     - an `ExecutionStackInstance` (adapter/extensions instantiated by caller)
     - a precomputed `ExecutionContext` (created from descriptors by caller)
     - a `SqlDriver` instance (constructed by caller)
   - `createRuntime` must not:
     - instantiate stack components
     - derive context
     - construct a driver from options
     - default to an offline driver
   - Any changes to attach a driver onto `ExecutionStackInstance` are out of scope and deferred until after TML-1837.

4. **Operations representation (remove manifest hangover; keep framework clean)**
   - Remove the obsolete “manifest” representation for operations:
     - strip `OperationManifest` / `LoweringSpecManifest` from `@prisma-next/contract/*`
     - remove `ComponentMetadata.operations` from `@prisma-next/contract/framework-components`
   - Keep the framework operation building blocks:
     - `OperationSignature` and `OperationRegistry` remain in `@prisma-next/operations` and must stay family-agnostic (no lowering).
   - Make family-owned operation definitions the source of truth:
     - SQL uses `SqlOperationSignature` (extends `OperationSignature` + adds SQL `lowering`) in `@prisma-next/sql-operations`.
     - SQL descriptors expose operation definitions via required `operationSignatures(): ReadonlyArray<SqlOperationSignature>`.
   - Contract emission/type generation must continue to work:
     - keep `types.operationTypes` import specs on component metadata for `contract.d.ts` generation
     - if any tooling needs an operation registry, it must assemble `OperationRegistry` from SQL descriptor `operationSignatures()` (not from framework metadata).

4. **Demo refactor**
   - Add `examples/prisma-next-demo/src/prisma/context.ts`:
     - validates/loads contract
     - defines configuration for static context
     - exports query roots (`sql`, `orm`, `schema`, `tables`)
     - exports any helper needed by runtime constructor (e.g., contract, stack descriptors)
   - Update `examples/prisma-next-demo/src/prisma/runtime.ts`:
     - imports from `context.ts`
     - constructs runtime (instantiates adapter/driver as needed)
   - `examples/prisma-next-demo/src/main.ts` continues to:
     - validate env/config (arktype)
     - call runtime constructor
     - close runtime

### Non-functional requirements

- **Symmetry with control plane**: keep the execution-plane “stack as descriptors-only + defaulting helper” story consistent with `ControlPlaneStack`.
- **No new user terminology**: demo should emphasize “setup → query roots” and “create runtime”, not “stack/stack instance”.
- **No-emit compatibility**: static context must work whether contract comes from JSON validation or TS builders.

### Out of scope

- Full repo-wide renaming between `Runtime*` and `Execution*` prefixes.
- New seeding system (we can refactor the demo seed script opportunistically, but it is not required for this spec unless explicitly included as a deliverable).

