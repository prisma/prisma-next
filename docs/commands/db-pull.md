## `prisma-next db pull`

Introspect a database and print a Prisma-formatted schema using Prisma 7 `db pull --print`.

### Canonical usage and flags

See the `db pull` section in:

- `packages/1-framework/3-tooling/cli/README.md`

### Notes

- Intended for `.prisma` workflows that need schema introspection output.
- Resolves schema from `--schema` or from `config.contract.source` when it is a `.prisma` path.
- Requires database connection (`--db` or `config.db.connection`).

