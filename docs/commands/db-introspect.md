## `prisma-next db introspect`

Inspect a database schema using Prisma Next-native introspection.

### Canonical usage and flags

See the `db introspect` section in:

- `packages/1-framework/3-tooling/cli/README.md`

### Notes

- Uses Prisma Next control-plane introspection (no Prisma engines).
- Requires database connection (`--db` or `config.db.connection`).
- Outputs schema tree (human mode) or structured schema IR (`--json`).
