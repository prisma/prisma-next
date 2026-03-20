# Summary

`prisma-next db introspect` now writes a `schema.prisma` file by default instead of printing the tree view. This PR adds the PSL printer (`SqlSchemaIR -> string`), keeps `--json` behavior intact, and moves the tree preview behind `--dry-run`.

# Scope Clarifications

- The printer emits `enum` blocks for Postgres enums discovered in introspection.
- Enum member mapping is intentionally out of scope for this PR.
- Concretely: if a database enum label is not already a PSL-safe identifier, the printer normalizes it to a valid PSL enum member name instead of preserving the original label via enum member `@map`.
- That means introspection is lossy for enum labels that need normalization. This is a deliberate scope cut for now, not an omitted follow-up inside this PR.

# Why

The core brownfield adoption goal is to get teams from an existing database to a usable `schema.prisma` file in one command. Supporting full enum member mapping would add extra surface area and validation work that is not required to land the PSL printer and CLI default-behavior change in this branch.
