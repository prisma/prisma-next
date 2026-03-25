# Summary

This branch replaces the old public `db introspect` workflow with two commands:

- `prisma-next db schema` for read-only live schema inspection
- `prisma-next contract infer` for writing `contract.prisma`

It also lands the PSL printer refactor needed for brownfield round-trips, including shared schema validation, injected Postgres default mapping, and updated integration journeys.

# Scope Clarifications

- `db schema` is inspection-only and never writes files
- `contract infer` performs the PSL write step and stops before `contract emit`
- enum member `@map` preservation remains out of scope
- the brownfield flow is explicit:
  `contract infer` -> `contract emit` -> `db sign`

# Why

The old plan mixed two different actions into one public command: previewing a live schema and materializing a PSL contract. Splitting those actions makes the CLI clearer, keeps inspection side-effect free, and still gives brownfield users a direct path from an existing database to a usable `contract.prisma`.
