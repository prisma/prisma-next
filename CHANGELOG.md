# Changelog

## [Unreleased]

### Breaking changes

- **`contract.d.ts` `storage.tables` and `storage.types` are now nested by namespace.** Previously emitted as a flat map `{ [tableName]: ... }`, the generated type is now `{ [namespaceId]: { [tableName]: ... } }` — matching the runtime `SqlStorage` IR shape. Cold-read JSON consumers that access `contract.storage.tables.<name>` directly must update to `contract.storage.tables.<namespaceId>.<name>` (or use `findTableByName()` for name-based lookup). DSL consumers (`db.users.select(...)`) are unaffected — the `FlatTablesOf<C>` bridge in `sql-builder` flattens the nested shape transparently.
