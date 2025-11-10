## Brief — AST Factories Own Normalization (Domain: SQL, Layer: lanes, Plane: runtime)

### Context
- Conditional object assembly (only include fields if present) is repeated across lanes (e.g., orm-lane). Example:
  - `packages/sql/lanes/orm-lane/src/orm-builder.ts` builds a Select AST with spread/ternary checks for `includes`, `where`, `orderBy`, `limit`.
- We already have a Select factory in relational-core (`packages/sql/lanes/relational-core/src/ast/select.ts`). The factory should be the single place that normalizes optional fields.

### Goal
- Make relational-core AST factories the single point of normalization for optional fields.
- Remove caller-side conditional spreads. Callers pass raw optional values; factories compact them.
- No public API changes; this is an internal refactor consistent with 04a.

### Scope
- Domain: SQL
- Layer: lanes
- Plane: runtime
- Affects relational-core AST factories (select/insert/update/delete, and any helpers as needed) and all lane call sites (orm-lane, sql-lane).

### Design
- Introduce a tiny `compact` helper in relational-core used by all AST factories to drop:
  - `undefined` and `null`
  - empty arrays (`[]`)
- Update existing factories (select) and add others (insert, update, delete) so they accept optional fields and return `compact(base)`.
- Callers always pass raw optional values; factories own normalization.

### Implementation

1) Add `compact` helper
- File: `packages/sql/lanes/relational-core/src/ast/util.ts`
- Responsibility: remove `undefined`/`null` keys and keys with empty array values.

```ts
export function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}
```

2) Update `createSelectAst` to use `compact`
- File: `packages/sql/lanes/relational-core/src/ast/select.ts`
- Keep one factory (do not add another). Accept optional `joins`, `includes`, `where`, `orderBy`, `limit`, `offset`. Build a base object and return `compact(base)`.

3) Add/normalize other statement factories
- Files:
  - `packages/sql/lanes/relational-core/src/ast/insert.ts`
  - `packages/sql/lanes/relational-core/src/ast/update.ts`
  - `packages/sql/lanes/relational-core/src/ast/delete.ts`
- Pattern: accept optional fields (`returning`, `where`, etc.), return `compact(base)`.

4) Optional: other helpers
- `join.ts`: `createJoin({ type, table, on? })` with `compact` on `on`.
- `order.ts`: may not need `compact` if returning single nodes; apply consistently if building arrays.
- `predicate.ts`: typically returns single nodes; keep structural.

5) Barrel export(s)
- File: `packages/sql/lanes/relational-core/src/exports/ast.ts`
- Re-export factories (`createSelectAst`, `createInsertAst`, `createUpdateAst`, `createDeleteAst`, join/predicate/order helpers) and re-export from `index.ts` if that’s your pattern.

### Refactor call sites

Replace caller-side normalization everywhere:
- Remove patterns like:
  - `...(arr.length > 0 ? { field: arr } : {})`
  - `...(value ? { field: value } : {})`
  - `...(typeof n === 'number' ? { limit: n } : {})`
- Replace with direct fields passed to factories:
  - `field: arr`
  - `field: value`
  - `limit: n`

Concrete example (orm-lane)

Before:
```ts
const ast = createSelectAst({
  from: createTableRef(this.table.name),
  project: projectEntries,
  ...(includesAst.length > 0 ? { includes: includesAst } : {}),
  ...(whereExpr ? { where: whereExpr } : {}),
  ...(orderByClause ? { orderBy: orderByClause } : {}),
  ...(typeof this.limitValue === 'number' ? { limit: this.limitValue } : {}),
});
```

After:
```ts
const ast = createSelectAst({
  from: createTableRef(this.table.name),
  project: projectEntries,
  includes: includesAst,
  where: whereExpr,
  orderBy: orderByClause,
  limit: this.limitValue,
  offset: this.offsetValue,
});
```

Apply the same to `sql-lane` internals.

### Anti-patterns to remove
- Inline object spread/ternary checks for optional fields.
- Building AST nodes directly in lanes instead of factories.
- Capability checks inside factories (keep factories structural; capability gating belongs in lane builders and adapters).

### Scanning tips
- Find conditional spread patterns:
  - `rg -n "\\.\\.\\." packages/sql/lanes/orm-lane/src`
  - `rg -n "length > 0 \\? \\{ [^}]+ \\} : \\{\\}" packages/sql/lanes/**`
  - `rg -n "typeof [a-zA-Z0-9_]+ === 'number' \\? \\{ limit" packages/sql/lanes/**`

### Acceptance criteria
- Factories own normalization using `compact()`.
- All lane call sites pass raw optional fields without caller-side normalization.
- No behavior changes; existing plan/AST outputs remain the same.
- Tests remain green:
  - `pnpm --filter @prisma-next/sql-relational-core test`
  - `pnpm --filter @prisma-next/sql-lane test`
  - `pnpm --filter @prisma-next/sql-orm-lane test`
  - `pnpm lint`, `pnpm typecheck`
- Dependency guard stays green (orm-lane does not import sql-lane).

### Out of scope
- Public API changes for sql-lane or orm-lane.
- Moving capability checks into factories.
- Cross-package moves beyond relational-core AST factories and lane usage cleanup.

### Notes
- Prefer small, pure functions and one normalization policy for all factories.
- If future nodes need to preserve empty arrays, adjust `compact()` once and all factories follow suit.
