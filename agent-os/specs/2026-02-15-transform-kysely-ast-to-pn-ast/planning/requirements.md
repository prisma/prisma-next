## Requirements

### Summary

Extend the Kysely query lane so it produces **Prisma Next SQL AST** (`QueryAst`) and **resolved plan metadata** (refs + param descriptors), enabling runtime plugins to inspect Kysely-authored plans without depending on Kysely internals.

The acceptance-scope for supported SQL features is defined by the demo app: we will recreate all queries in `examples/prisma-next-demo/src/queries` under `examples/prisma-next-demo/src/kysely`.

### Functional requirements

1. **PN AST attachment**
   - Every Kysely-authored plan must attach a SQL-family PN AST at `plan.ast` (type `QueryAst`).
   - Kysely plans must set `plan.meta.lane = 'kysely'` for observability (plugins remain lane-agnostic).

2. **Transformation**
   - Transform Kysely `compiledQuery.query` AST into PN SQL `QueryAst`.
   - The transformation must not encode Kysely-shaped node kinds into PN. Any PN AST changes must remain lane-neutral.

3. **Robustness via forcing function**
   - If the transformer encounters an unsupported Kysely AST node / construct, it must **throw** (not silently drop AST or fallback to heuristic “raw” linting).

4. **Resolved references**
   - Kysely plans must populate `plan.meta.refs` (`tables`, `columns`) with **resolved** references validated against the contract, aligning with what SQL DSL/ORM plans provide.

5. **Query params and param descriptors**
   - Kysely plans must populate:
     - `plan.params` as positional values (from `compiledQuery.parameters`)
     - `plan.meta.paramDescriptors` with per-param metadata:
       - where possible, include `{ refs: { table, column } }`
       - derive `codecId`, `nativeType`, `nullable` from contract column metadata
   - Parameter indexing in PN AST (`ParamRef.index`) must align with `plan.params` positions.

6. **Expand PN SQL AST where necessary**
   - Evolve PN SQL AST to represent the constructs required by the demo scope (e.g. `and/or`, `like`, `in`, selection of `*`, richer join conditions, etc.).
   - These changes must remain compatible with existing lanes (DSL/ORM) and runtime lowering, without introducing Kysely-specific shapes.

7. **Example parity**
   - Add Kysely equivalents for the demo queries in `examples/prisma-next-demo/src/kysely`.
   - The Kysely versions should be executable with the demo runtime and validate that plugins can inspect AST/refs.

### Non-functional requirements

- **Deterministic**: transformation output should be stable for identical inputs.
- **Inspection-first**: runtime plugins must be able to lint based on AST + refs, not SQL string parsing.
- **No lane leakage**: PN AST remains a Prisma Next concept (family-owned), not a mirror of Kysely.

### Out of scope (for this spec)

- Moving `packages/1-framework/4-runtime-executor/src/plugins/lints.ts` into the SQL domain (noted as existing layering violation).
- Implementing a full production-grade lint ruleset (the current lint plugin is a POC).

