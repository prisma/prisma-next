# `contract.ts` Before and After

These are compare-first examples for Cursor, derived from the original `main` and current-branch versions of [`examples/prisma-next-demo/prisma/contract.ts`](../../examples/prisma-next-demo/prisma/contract.ts) and then enriched to show more Prisma Next features with working imports and clean TypeScript checking.

- `before`: legacy fluent builder, based on `main` at `c746f162`
- `after`: refined object-literal builder, based on current branch `feat/contract-ts-revamp` at `ec1ef79d`

Files:

- [`contract.before.ts`](./contract.before.ts)
- [`contract.after.ts`](./contract.after.ts)

Highlights:

- `before` uses the fluent `defineContract().table().model().build()` surface with explicit snake_case tables, columns, relations, indexes, and foreign keys.
- `after` uses the callback overload `defineContract(config, ({ type, field, model, rel }) => ...)`, so the helper vocabulary comes from the composed target and extension packs.
- `after` shows naming defaults, `foreignKeyDefaults`, local field `.sql({ id | unique | column })` overlays, local belongsTo `.sql({ fk })` overlays, compound `.attributes(...)`, `hasOne` / `hasMany` / `belongsTo` / `manyToMany`, named storage types, and pack-owned helper presets such as `field.id.uuidv7()`, `field.id.nanoid({ size: 16 })`, `field.uuid()`, `field.nanoid({ size: 16 })`, `field.text()`, and `field.createdAt()`.
