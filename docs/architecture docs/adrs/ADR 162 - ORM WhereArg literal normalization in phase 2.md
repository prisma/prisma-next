# ADR 162 — ORM `WhereArg` literal normalization in Phase 2

## Context

Phase 2 introduces lane-agnostic ORM filter interop with `WhereArg = WhereExpr | ToWhereExpr`.
`ToWhereExpr.toWhereExpr()` returns a bound payload `{ expr, params, paramDescriptors }` that can be produced by non-ORM authoring surfaces (for example, lane-built filters).

At this stage, `@prisma-next/sql-orm-client` stores ORM filters as param-free internal AST fragments used for composition and terminal collection operations.

## Problem

We need a stable Phase 2 behavior for consuming `ToWhereExpr` inside ORM:

- preserve interoperability with bound payload producers
- keep ORM internals predictable and low-risk for this release
- enforce payload correctness strongly enough to avoid silent misbinding

The alternative is carrying bound params/descriptors through ORM composition and reindexing at plan assembly time. That approach is viable but changes internal semantics more broadly.

## Constraints

- Phase 2 scope prioritizes architectural extraction and compatibility stability.
- Existing ORM internals are designed around param-free `WhereExpr` state.
- Payloads from lanes must still be validated rigorously.
- A richer bound-param-preserving model remains desirable for future work, but not at the expense of Phase 2 merge risk.

## Decision

For Phase 2, ORM consumes `ToWhereExpr` via **literal normalization**:

1. Validate bound payload integrity:
   - `params.length === paramDescriptors.length`
   - `ParamRef` indices start at `1`
   - `ParamRef` indices are contiguous (no gaps)
   - max `ParamRef` index equals `params.length`
2. Normalize by substituting `ParamRef(index)` with `LiteralExpr(params[index - 1])`.
3. Keep ORM internal filter state param-free after normalization.
4. Do not propagate `paramDescriptors` through ORM plan metadata in this phase.

## Consequences

### Positive

- Low-risk alignment with current ORM internal model.
- Immediate lane-agnostic interop for `ToWhereExpr` producers.
- Strong payload validation catches malformed bound payloads early.

### Trade-offs

- Descriptor-rich, bound-param-preserving semantics are deferred.
- Future prepared/descriptor-aware composition work will require a deliberate Phase 3 design pass.

## Example

```ts
const whereArg = {
  toWhereExpr: () => ({
    expr: {
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'users', column: 'kind' },
      right: { kind: 'param', index: 1 },
    },
    params: ['admin'],
    paramDescriptors: [{ source: 'lane' }],
  }),
};

// Phase 2 ORM behavior:
// right: { kind: 'param', index: 1 } -> { kind: 'literal', value: 'admin' }
```

## Follow-up

Phase 3 evaluates a bound-param-preserving ORM composition model (carry/reindex params and descriptors instead of literal normalization) and shared PLAN.UNSUPPORTED envelope helpers.
