## Requirements

### Initial description

Introduce strictly-typed literal defaults for SQL columns so defaults are represented as typed values instead of string SQL snippets.

The implementation must:

- Replace `ColumnDefault` literal payloads from string `expression` to typed `value`.
- Support literal default inputs for:
  - JSON-safe values (`string | number | boolean | null | object | array`)
  - `bigint`
  - `Date`
- Preserve function defaults (`{ kind: 'function', expression }`) unchanged.
- Keep runtime and migration behavior deterministic across authoring, emitted contract JSON, validation, schema verification, and migration SQL rendering.

### Acceptance criteria

- Core contract types expose typed defaults:
  - `ColumnDefaultLiteralValue`, `ColumnDefaultLiteralInputValue`, and `ColumnDefaultInput`.
  - `ColumnDefault` literal variant is `{ kind: 'literal', value: ... }`.
- Authoring builders accept typed literals:
  - Non-nullable columns can define typed defaults.
  - Nullable columns can also define typed defaults.
  - SQL builder default typing is codec-aware so literal defaults align with codec output types.
- Contract emission serializes non-JSON primitives safely:
  - `bigint` is encoded as `{ "$type": "bigint", "value": "<decimal-string>" }`.
  - `Date` is encoded as ISO string.
- Contract validation decodes typed defaults for runtime use:
  - Tagged bigint defaults decode to runtime `BigInt` only for bigint-like columns.
  - Temporal/date-like defaults stay serialized as strings.
- Postgres schema/default comparison works with typed defaults:
  - Normalization parses DB defaults into typed literal values.
  - String defaults with casts and escaped quotes compare correctly.
  - Boolean and numeric defaults compare as typed values.
- Postgres migration planner renders typed literal defaults correctly:
  - Strings quoted/escaped.
  - Numbers and booleans rendered as literals.
  - `null` rendered as `NULL`.
  - JSON/JSONB literals rendered via JSON stringification (with `::json`/`::jsonb` where relevant).
  - Tagged bigint rendered as numeric literal.
  - Date values rendered as quoted ISO strings.
- End-to-end behavior demonstrates typed defaults:
  - E2E fixtures include literal defaults for text, numeric, float, boolean, bigint, json object, json array, and timestamptz.
  - Insert/select assertions verify decoded runtime types and values.

### Related work / dependencies

- Type and builder updates:
  - `packages/1-framework/1-core/shared/contract/src/types.ts`
  - `packages/1-framework/2-authoring/contract/src/table-builder.ts`
  - `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts`
- Validation / decoding:
  - `packages/2-sql/1-core/contract/src/validate.ts`
- Postgres normalization and rendering:
  - `packages/3-targets/6-adapters/postgres/src/core/default-normalizer.ts`
  - `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
  - `packages/3-targets/3-targets/postgres/src/core/migrations/statement-builders.ts`
  - `packages/1-framework/1-core/migration/control-plane/src/emission/canonicalization.ts`
- Tests and fixtures:
  - `packages/1-framework/2-authoring/contract/test/table-builder.test.ts`
  - `packages/2-sql/3-tooling/family/test/schema-verify.defaults.test.ts`
  - `test/e2e/framework/test/fixtures/contract.ts`
  - `test/e2e/framework/test/dml.test.ts`

### Requirements discussion

#### Decisions captured from branch changes

1) Literal defaults are value-first, not SQL-string-first.
2) Bigint JSON representation is tagged to avoid JSON precision loss.
3) Temporal defaults round-trip through ISO strings in emitted JSON and stay strings in validation/runtime flows.
4) Schema verification compares normalized typed defaults rather than raw expression strings where normalizers are available.
5) No backward-compatibility shim is introduced for `{ kind: 'literal', expression }`.

#### Follow-up questions

- None required.

### Scope boundaries

**In scope:**

- Contract type updates for typed literal defaults.
- Authoring and SQL contract-builder support for typed literals and codec-aware typing.
- Serialization/normalization logic required for deterministic JSON contracts and migration outputs.
- Validation-time decode for tagged bigint defaults while preserving temporal string defaults.
- Postgres default normalization and planner SQL rendering updates.
- Test and fixture updates that verify typed default behavior end-to-end.

**Out of scope:**

- New default kinds beyond `literal` and `function`.
- Cross-target custom literal parsing behavior beyond what is already covered by existing target adapters.
- Broader refactors unrelated to default literal typing.

### Visual assets

- `planning/visuals/README.md` (flow diagram for encode/decode/normalize/render lifecycle).
