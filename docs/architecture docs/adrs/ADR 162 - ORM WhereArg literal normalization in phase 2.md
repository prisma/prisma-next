# ADR 162 — ORM `WhereArg` literal normalization

## Context

Lane-agnostic ORM filter interop uses `WhereArg = WhereExpr | ToWhereExpr`.
`ToWhereExpr.toWhereExpr()` returns a bound payload `{ expr, params, paramDescriptors }` that can be produced by non-ORM authoring surfaces (for example, lane-built filters).

At this stage, `@prisma-next/sql-orm-client` stores ORM filters as param-free internal AST fragments used for composition and terminal collection operations.

## Problem

We need stable behavior for consuming `ToWhereExpr` inside ORM:

- preserve interoperability with bound payload producers
- keep ORM internals predictable and low-risk for this release
- enforce payload correctness strongly enough to avoid silent misbinding

The alternative is carrying bound params/descriptors through ORM composition and reindexing at plan assembly time. That approach is viable but changes internal semantics more broadly.

## Constraints

- Current scope prioritizes architectural extraction and compatibility stability.
- Existing ORM internals are designed around param-free `WhereExpr` state.
- Payloads from lanes must still be validated rigorously.
- A richer bound-param-preserving model remains desirable for future work, but not at the expense of merge risk.

## Decision

ORM consumes `ToWhereExpr` via **literal normalization**:

1. Validate bound payload integrity:
   - `params.length === paramDescriptors.length`
   - `ParamRef` indices start at `1`
   - `ParamRef` indices are contiguous (no gaps)
   - max `ParamRef` index equals `params.length`
2. Normalize by substituting `ParamRef(index)` with `LiteralExpr(params[index - 1])`.
3. Keep ORM internal filter state param-free after normalization.
4. Do not propagate `paramDescriptors` through ORM plan metadata in the current release.

## Consequences

### Positive

- Low-risk alignment with current ORM internal model.
- Immediate lane-agnostic interop for `ToWhereExpr` producers.
- Strong payload validation catches malformed bound payloads early.

### Trade-offs

- Descriptor-rich, bound-param-preserving semantics are deferred.
- Future prepared/descriptor-aware composition work will require a deliberate design pass.

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

// ORM behavior:
// right: { kind: 'param', index: 1 } -> { kind: 'literal', value: 'admin' }
```

## Follow-up

Future work may evaluate a bound-param-preserving ORM composition model (carry/reindex params and descriptors instead of literal normalization) and shared PLAN.UNSUPPORTED envelope helpers.
