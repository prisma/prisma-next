# Transform Kysely AST → Prisma Next AST (query lane)

## Problem

We recently added a Kysely query lane. It currently produces query plans that embed the Kysely AST. Runtime plugins (and other plan-inspection surfaces) cannot reliably inspect or lint those plans because they lack a Prisma Next (PN) AST.

This spec tracks the scope/design for transforming Kysely AST nodes into a PN AST representation during plan construction.

## Goals

- Produce a PN AST for queries authored via the Kysely lane.
- Enable runtime plugins to inspect plans via PN AST (without depending on Kysely internals).
- Use this work to validate whether the existing PN AST is robust enough; evolve PN AST where needed while keeping it target- and authoring-library-agnostic.

## Non-goals

- Encoding Kysely-specific semantics or node shapes into the PN AST.
- Implementing runtime plugins themselves (only enabling them via PN AST presence).
- Solving every SQL feature in one go; focus on the subset used by the current Kysely lane / MVP.

## Constraints / guardrails

- PN AST must remain “Prisma Next native” and stable across authoring surfaces (DSL, TypedSQL, Kysely, future lanes).
- Plans remain immutable, deterministic artifacts; the PN AST should be a data structure (no executable behavior).
- Dialect specifics belong in targets/adapters, not in PN AST.

## Open questions (to be answered during shaping)

## Shaping decisions (captured)

- **Initial scope**: Recreate all demo queries from `examples/prisma-next-demo/src/queries` under `examples/prisma-next-demo/src/kysely`.
- **Unsupported constructs**: Throw `NotImplementedError`/equivalent when a Kysely AST node cannot be transformed (forcing function).
- **Where PN AST lives**: Attach PN SQL AST as `plan.ast` (the existing SQL family `QueryAst`), not as lane-specific metadata.
- **Lane id**: Set `plan.meta.lane = 'kysely'` for observability/debug, but keep plugins lane-agnostic (plugins should key off `plan.ast` + `meta.refs`).
- **PN AST evolution**: Expand the PN SQL AST to cover missing constructs required by the demo/Kysely surface (no Kysely-shaped nodes in PN).
- **Refs expectation**: Produce **resolved** `meta.refs` (validated against contract), matching what SQL DSL/ORM plans provide today.
- **Normalization**: Prefer canonical identifiers (contract table/column names) over preserving authoring syntax/quoting.

See `supporting-reference.md` for the current plan/AST structures and a Kysely↔PN node compatibility table.

## Requested assets

Please provide:

- 2–3 representative Kysely queries (or a fixture file) that the lane must support.
- Any screenshots/logs of the current plan shape showing where the Kysely AST is stored.

