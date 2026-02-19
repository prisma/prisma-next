## `prisma-next db push`

Apply a Prisma schema (`.prisma`) to a database using Prisma 7 `db push` semantics.

### Canonical usage and flags

See the `db push` section in:

- `packages/1-framework/3-tooling/cli/README.md`

### Notes

- Intended for `.prisma` authoring workflows.
- Resolves schema from `--schema` or from `config.contract.source` when it is a `.prisma` path.
- Requires database connection (`--db` or `config.db.connection`).

