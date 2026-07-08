# Slice: sql-attributes

_(In-project slice. Parent: `projects/typed-attribute-parsers/`. Outcome it contributes: the SQL family's attribute argument-parsing is fully spec-driven — finishing what slice 1 started with `@relation`.)_

## At a glance

Migrate the remaining SQL attributes off hand-written argument parsing onto declarative `AttributeSpec`s, growing the kit with the pieces they need. Slice 1 shipped the engine + `@relation`; this slice does `@id`/`@@id`, `@unique`/`@@unique`, `@@index`, `@default`, `@map`/`@@map`, `@@control`, `@@discriminator`, `@@base` — and deletes the SQL family's now-dead syntax helpers.

## Chosen design

Each attribute becomes a spec, mirroring `sqlRelation`. **Only argument *syntax* parsing moves to specs; the interpreter's *semantic* checks stay put** — existence resolution, type checks, cross-attribute conflicts, applicability, duplicate-attribute guards, and field-name→column-name mapping (`mapFieldNamesToColumns`) remain in `interpreter.ts` / `psl-field-resolution.ts`.

Specs (from the grounded map):

```ts
modelAttribute('map',   { positional: [{ key: 'name', type: str() }] })
fieldAttribute('map',   { positional: [{ key: 'name', type: str() }] })
fieldAttribute('id',    { named: { map: optional(str()) } })
fieldAttribute('unique',{ named: { map: optional(str()) } })
modelAttribute('id',    { positional: [{ key: 'fields', type: list(fieldRef('self'), { nonEmpty: true, unique: true }) }], named: { map: optional(str()) } })
modelAttribute('unique',{ /* same shape as @@id */ })
modelAttribute('index', { positional: [{ key: 'fields', type: list(fieldRef('self'), …) }], named: { map: optional(str()), type: optional(str()), options: optional(record(str())) }, refine: optionsRequiresType })
modelAttribute('control',      { positional: [{ key: 'policy', type: oneOf(identifier('managed'), identifier('tolerated'), identifier('external'), identifier('observed')) }] })
modelAttribute('discriminator',{ positional: [{ key: 'field', type: fieldRef('self') }] })
modelAttribute('base',         { positional: [{ key: 'base', type: entityRef() }, { key: 'value', type: str() }] })
fieldAttribute('default',      { positional: [{ key: 'value', type: oneOf(matchingScalarLiteral(), funcCallFrom(defaultFnRegistry), /* enum-member, list */) }] })
```

**Kit growth** (built as consumers need it): `modelAttribute` constructor + model-level plumbing (`findModelAttributeNode` + `buildModelInterpretCtx`, mirroring `@relation`'s helpers); `int`, `bool`; `record`/`map` (object-literal → `Record<string,string>`); `entityRef` (bare-identifier model reference — lighter than `fieldRef`, resolution stays in `resolvePolymorphism`); and `funcCall`/`funcCallFrom` + a matching-scalar-literal + array-literal leaf for `@default`. The engine already accepts `ModelAttributeAst` and `AttributeLevel` already includes `'model'`; `fieldRef('self')` already resolves against `ctx.selfModel`, so it works unchanged at model level.

**`@default` is the long pole** and migrates last: it dispatches function-call defaults through the existing `ControlMutationDefaultRegistry` (`funcCall` builds the `ParsedDefaultFunctionCall` and defers name/arg validation to `lowerDefaultFunctionWithRegistry`), and covers literal, function, bare-enum-member, and list defaults.

## Coherence rationale

One outcome — "the SQL family validates every attribute's arguments through the kit; the hand-written syntax helpers are gone." The kit-growth pieces exist only to serve these attributes and are reviewed alongside their first consumer. Large but singular; a reviewer holds "SQL attributes are now spec-driven" in one sitting. (`@default`'s size is the risk — see Open Questions.)

## Scope

**In:** the 8 attributes above (field + model levels); the kit growth listed; deletion of the SQL family's syntax helpers once their last caller migrates — `parseMapName`, `parseAttributeFieldList`/`parseFieldList`/`findDuplicateFieldName`, `parseObjectLiteralStringMap` (+ `splitObjectLiteralEntries`/`findTopLevelColon`), `parseControlPolicyAttribute` (+ `CONTROL_POLICY_LITERALS`/`isControlPolicyLiteral`), `parseConstraintMapArgument`.

**Out:**
- **Mongo** — slice 3.
- **`@db.*` native types** — out of the whole project; **do NOT delete `parseOptionalSingleIntegerArgument` / `parseOptionalNumericArguments` / `getPositionalArguments`** (they serve the `@db.*` path).
- **The interpreter's semantic checks** — existence, type, conflict (`options`-requires-`type` is the one cross-*argument* rule that moves to `refine`; multi-attribute/model-level checks stay), applicability, duplicate-attribute (`PSL_DUPLICATE_ATTRIBUTE`), and `mapFieldNamesToColumns` — all stay in the interpreter.
- Pinned `str(value)`/`num(value)` literal matchers (Mongo index `type`, slice 3).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `@db.*` helpers share `getPositionalArguments` + own `parseOptional*Argument` | Must NOT delete | They serve the out-of-scope native-type path; deleting breaks `@db.VarChar(n)` / `@db.Decimal(p,s)`. |
| `parseConstraintMapArgument` shared by 5 attrs (`@id`,`@unique`,`@@id`,`@@unique`,`@@index`) | Delete only after the last (`@@index`) migrates | Not per-attribute. |
| `fieldRef('self')` at model level | Works unchanged | Keys off `ctx.selfModel`; no separate "model field list" combinator needed. |
| `@default` function registry | Preserve; `funcCall` defers to it | Entries are pack-contributed via `ControlMutationDefaultRegistry`; `funcCall` must be registry-parameterised, not hardcode names. Preserve `PSL_UNKNOWN_DEFAULT_FUNCTION` etc. |
| Diagnostic codes | Syntax→`PSL_INVALID_ATTRIBUTE_SYNTAX`; semantic checks keep their codes | Expect fixture/test churn where an old `PSL_INVALID_ATTRIBUTE_ARGUMENT` *shape* error becomes `PSL_INVALID_ATTRIBUTE_SYNTAX` — intentional (consistent with slice 1). |
| Field-list spelling for `@@id`/`@@unique`/`@@index` | Positional-only (`@@index([a, b])`); named `fields:` spelling intentionally dropped | The legacy `parseAttributeFieldList` accepted `fields: [...]` as a named arg too; the specs model `fields` as a positional param only. Positional is Prisma's canonical form, and no in-repo schema/fixture/test/example uses the named spelling, so this narrowing is invisible in practice. Accepted deliberately (operator decision) to keep the specs clean rather than declaring `fields` in both positional and named. |
| `@@control` policy spelling | Bare identifier only (`@@control(external)`); quoted form dropped | The legacy parser unquoted the arg, so the quoted spelling also worked; the `oneOf(identifier(...))` spec accepts bare identifiers only. Bare is canonical and no in-repo schema uses the quoted form; same invisible narrowing as the field-list row, accepted deliberately. |

## Slice-specific done conditions

- [ ] Every listed SQL attribute is validated + lowered via a spec through `interpretAttribute`.
- [ ] The SQL syntax helpers listed in Scope-In are deleted (`rg` for each returns zero); the `@db.*` helpers are retained.
- [ ] `pnpm fixtures:check` clean; SQL interpreter suites green; `pnpm lint:framework-vocabulary` green (kit growth may add framework lines — update threshold if the count moves).
- [ ] Diagnostic **codes** preserved for semantic checks; syntax-error codes may become `PSL_INVALID_ATTRIBUTE_SYNTAX` (intentional, test assertions updated).

## Open Questions

1. **Is `@default` in this slice or its own?** `@default` (funcCall + registry + literal/enum/list) is a large, self-contained sub-problem. Working position: keep it in this slice as the **last dispatch**; if its review burden or dispatch count balloons the slice past a single coherent review, split it into a follow-up slice (`sql-default`) mid-flight via `drive-triage-work`. Non-blocking to start.

## References

- Parent project: `projects/typed-attribute-parsers/spec.md`; project plan slice-2 entry.
- Slice-1 exemplar: `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts` (`sqlRelation`, `findRelationAttributeNode`, `buildRelationInterpretCtx`).
- Kit: `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/**`.
- Legacy helpers: `packages/2-sql/2-authoring/contract-psl/src/psl-attribute-parsing.ts`; `@default`: `default-function-registry.ts`, `psl-column-resolution.ts`, `framework-components/.../mutation-default-types.ts`.
