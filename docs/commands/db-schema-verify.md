## `prisma-next db schema-verify`

Verify that a live database schema satisfies the emitted contract.

### Canonical usage and flags

See the `db schema-verify` section in:

- `packages/1-framework/3-tooling/cli/README.md`

### Notes

- Uses Prisma Next control-plane verification (no Prisma engines).
- Requires an emitted contract (`contract.json`) and database connection.
- Use `--strict` to fail on extra database schema elements.
