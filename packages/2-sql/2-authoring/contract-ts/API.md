# @prisma-next/sql-contract-ts API Notes

This page collects user-facing helper semantics that are too detailed for the package README.

## Generated Field Specs

`field.generated(...)` accepts a generated-field spec with:

- `type`
- optional `typeParams`
- `generated`

Built-in ID helpers from `@prisma-next/ids` already return that shape, so calls such as `field.generated(uuidv4()).id()` and `field.generated(nanoid({ size: 12 })).id()` are valid.

If you are composing the spec yourself instead of using an ID helper, pass the same `{ type, typeParams?, generated }` structure.

## Helper Quick Reference

- Structural helpers: `field.column(...)`, `field.generated(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- Callback helper presets: `field.id.uuidv4()`, `field.id.uuidv7()`, `field.id.nanoid({ size })`, `field.uuid()`, `field.text()`, `field.timestamp()`, `field.createdAt()`, and `type.*`
- Field-local and FK-local storage overrides stay next to the authoring site with `field.sql(...)` and `rel.belongsTo(...).sql({ fk })`
- Prefer typed local refs such as `field.namedType(types.Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available

## Validation and Warnings

- Duplicate named storage objects are rejected during build. This includes named primary keys, uniques, indexes, and foreign keys in the authored contract.
- String fallbacks such as `field.namedType('Role')` or `constraints.ref('User', 'id')` still work, but they emit typed-fallback warnings when a local typed token is available in the same contract.
- Prefer local typed references such as `field.namedType(types.Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available.

Contributor-facing lowering notes and implementation details live in [DEVELOPING.md](./DEVELOPING.md).
