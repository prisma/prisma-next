# Contract .d.ts Fixtures & Generic DSL Typing — Brief

Objective: Hand-author `.d.ts` per fixture to restore precise types and genericize the DSL so contract types flow from the root argument, enabling multiple contracts in one repo without collisions.

## Scope
- Add a `.d.ts` per hand-written `contract.json` fixture.
- Introduce a stable import per fixture to avoid ambient/global declarations.
- Genericize `@prisma-next/sql` public API to accept a `TContract` and thread it through builder types.
- Keep runtime behavior unchanged; this is a typing and surface refactor.

Out of scope: implementing an emitter; changing planning/execution semantics.

## References
- [MVP Spec](../MVP-Spec.md)
- ADRs:
  - [ADR 007 — Types-only emission](../architecture%20docs/adrs/ADR%20007%20-%20Types%20Only%20Emission.md)
  - [ADR 096 — TS-authored parity & purity](../architecture%20docs/adrs/ADR%20096%20-%20TS-authored%20contract%20parity%20%26%20purity%20rules.md)
  - [ADR 097 — Tooling runs on canonical JSON only](../architecture%20docs/adrs/ADR%20097%20-%20Tooling%20runs%20on%20canonical%20JSON%20only.md)

## Design

### Namespacing: isolate multiple fixtures (no collisions)
Two viable patterns; pick one (B by default):

- A) Path-alias per fixture
  - tsconfig `paths`: `prisma-contract:demoA` → `examples/prisma-next-demo/src/prisma/contract.json`
  - Declaration:
    ```ts
    declare module 'prisma-contract:demoA' {
      import type { SqlContract } from '@prisma-next/sql-target';
      const contract: Readonly<SqlContract>;
      export default contract;
    }
    ```
  - Pros: clear, explicit module IDs. Cons: requires paths setup.

- B) Local re-export next to JSON (recommended)
  - `contract.ts` stabilizes the specifier; declaration targets `'./contract'`.
    ```ts
    // contract.ts
    import c from './contract.json';
    export default c;
    ```
    ```ts
    // contract.d.ts
    declare module './contract' {
      import type { SqlContract } from '@prisma-next/sql-target';
      const contract: Readonly<SqlContract>;
      export default contract;
    }
    ```
  - Pros: no tsconfig changes; declarations are local and non-ambient.

Avoid wildcard declarations like `declare module '*.json'`.

### Public API: generic contract root
Update the `@prisma-next/sql` surface to accept a typed contract and propagate it:

```ts
// packages/sql/src/exports/schema.ts
import type { SqlContract } from '@prisma-next/sql-target';

export type AnySqlContract = SqlContract;

export function sql<TContract extends AnySqlContract>(
  contract: TContract
): SqlRootBuilder<TContract>;

export function schema<TContract extends AnySqlContract>(
  contract: TContract
): SchemaIntrospection<TContract>;

export function makeT<TContract extends AnySqlContract>(
  contract: TContract
): TablesGraph<TContract>;
```

Centralize helper types:

```ts
// packages/sql/src/types.ts
export type TablesOf<T> = T extends { storage: { tables: infer U } } ? U : never;
export type TableKey<T> = Extract<keyof TablesOf<T>, string>;
export type ColumnsOf<T, K extends TableKey<T>> =
  K extends keyof TablesOf<T> ? TablesOf<T>[K]['columns'] : never;
```

Builder classes carry generics end-to-end, deriving table/column keys and mapped scalar types from `TContract`. Operator nodes retain literal tags internally (e.g., `op: 'eq' as const`) to preserve discriminants.

### Usage example (two contracts side-by-side)
```ts
import contractA from './prismaA/contract';
import contractB from './prismaB/contract';
import { sql, makeT, schema } from '@prisma-next/sql';

const rootA = sql(contractA);
const tA = makeT(contractA);
const sA = schema(contractA);

const rootB = sql(contractB);
const tB = makeT(contractB);

// Types remain disjoint and precise for A vs B
```

## Tests
- Type-level: `packages/sql/test/plan-types.test-d.ts`
  - `TableKey<T>` narrows to contract table names for A and B independently.
  - Column operator `.eq` accepts the mapped TS scalar type (e.g., `string`, `number`, `null` when `nullable: true`).
- Integration (compile-only) in examples:
  - `examples/prisma-next-demo/src/prisma/dsl.ts` compiles when using `contract`.
  - A second fixture compiles in parallel without collisions.

## Milestones & Timeline
- M1 (0.5–1d): Namespacing pattern implemented for existing fixtures; add `.d.ts` and optional `contract.ts`.
- M2 (0.5–1d): Genericize API and thread `TContract` through builders; add helper types; adjust implementations.
- M3 (0.5d): Add compile-time tests and dual-fixture example usage.

## Risks & Mitigations
- Generic ripple: keep helpers centralized; refactor incrementally.
- Literal widening during implementation: preserve operator tags with `as const` where applicable.
- Module drift: use `contract.ts` re-export to stabilize specifiers.

## Acceptance Criteria
- Multiple fixtures load in one repo without ambient type collisions.
- `sql(contract)`/`schema(contract)`/`makeT(contract)` are generic and propagate `TContract` to table/column/operator types.
- Operators accept precise mapped scalars and respect `nullable`.
- No wildcard module declarations introduced.



