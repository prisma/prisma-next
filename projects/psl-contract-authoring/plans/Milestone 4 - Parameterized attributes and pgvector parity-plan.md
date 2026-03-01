# Milestone 4 — Parameterized attributes and pgvector parity plan

## Summary

Add PSL support for **parameterized attributes** (including namespaced extension-pack attributes) in a way that maps cleanly onto the **existing TS contract authoring surface**. Prove the new behavior via fixture-driven parity: pgvector `vector(1536)` expressed in PSL as `@pgvector.column(length: 1536)` (preferably via `types { ... }`) must emit the **same canonical `contract.json` and stable hashes** as the TS fixture.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 4 - Parameterized attributes and pgvector parity.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Contract authoring owner | Drives parser + interpreter + parity fixture work |
| Reviewer | Framework/tooling reviewer (TBD) | Reviews diagnostic surfaces and provider/config plumbing |
| Collaborator | SQL contract authoring surface owner (TBD) | Confirms TS surface parity mapping (codecId/nativeType/typeParams) |
| Collaborator | Extensions/packs owner (TBD) | Confirms pgvector namespace + mapping expectations |

## Milestones

### Milestone 1: Parser support for parameterized and namespaced attributes (generic parsing)

Extend `@prisma-next/psl-parser` to parse **any** attribute with:

- optional namespace (e.g. `@id`, `@pgvector.column`, `@@map`, `@@postgis.gistIndex`), and
- an optional argument list

The parser is responsible for syntax + structure; downstream interpretation/validation is responsible for semantics.

**Tasks:**

- [ ] Extend the AST types to represent generic attributes with source spans:
  - attribute target (`field` vs `model` vs `namedType`)
  - attribute name (support namespaced form like `pgvector.column`)
  - argument list (parsed) with spans
- [ ] Ensure `@map("...")` and `@@map("...")` are parsed through this generic mechanism (no special casing needed at the parser layer).
- [ ] Update `packages/1-framework/2-authoring/psl-parser/test/parser.test.ts` to cover:
  - field-level namespaced + parameterized attribute: `@pgvector.column(length: 1536)`
  - named type instance with namespaced + parameterized attribute in `types { ... }`
  - `@map` and `@@map` with string literals
- [ ] Ensure parser remains strict: unsupported/invalid attribute syntax produces stable diagnostics with spans (no silent skipping).

### Milestone 2: PSL → Contract IR interpretation for mapping + pgvector parameterization

Teach `@prisma-next/sql-contract-psl` to interpret the new attribute tokens into the existing SQL contract builder shapes, keeping the IR boundary stable and parity-aligned with TS.

**Tasks:**

- [ ] Implement `@@map("...")` (model → table name mapping) in interpretation:
  - default table naming continues to be deterministic (current `lowerFirst(model.name)`), but `@@map` overrides it
  - update model builder wiring so `model(name, tableName)` still maps fields correctly
- [ ] Implement `@map("...")` (field → column name mapping) in interpretation:
  - field name remains the model field name
  - column name becomes the mapped storage column name
  - ensure indexes/uniques/primary keys and relation FKs reference the **storage column names** after mapping
- [ ] Add interpretation support for parameterized attributes on `types { ... }` entries:
  - support `types { Embedding1536 = Bytes @pgvector.column(length: 1536) }`
  - optimize for TS consistency in the **emitted contract shape**: `codecId: "pg/vector@1"`, `nativeType: "vector(1536)"`, `typeParams: { length: 1536 }`
  - enforce compatibility invariants per ADR 104 (e.g. `@pgvector.column(...)` only allowed on compatible base types)
- [ ] Add interpretation support for parameterized attributes on fields:
  - support `embedding Bytes @pgvector.column(length: 1536)` (even if the recommended pattern is `types { ... }`)
  - map to the same column descriptor shape as TS (`vector(1536)`), not a new primitive
- [ ] Enforce the composition constraint in the interpreter (namespace requires config composition):
  - when `@<ns>.*` is present but there is no registered association for `<ns>` (because the pack was not composed via `prisma-next.config.ts`), interpretation fails with an actionable diagnostic (and span)

### Milestone 3: Parity fixtures + diagnostics coverage (pgvector + map)

Add fixture-driven evidence that PSL and TS produce identical normalized IR, canonical JSON, and stable hashes for the new surface area, plus a dedicated negative case for missing pack composition.

**Tasks:**

- [ ] Add a new parity fixture case for pgvector vector typing (prefer named type ergonomic pattern):
  - PSL: `types { Embedding1536 = Bytes @pgvector.column(length: 1536) }` and a model field referencing `Embedding1536`
  - TS: `vector(1536)` / `vectorColumn` (from `@prisma-next/extension-pgvector/column-types`) with `extensionPacks({ pgvector })`
  - assert: normalized IR equality, canonical `contract.json` equality, and stable hash equality (existing harness already checks this)
- [ ] Add a parity fixture case that exercises `@map` and `@@map` (can be standalone or combined with pgvector if it stays readable).
- [ ] Add a diagnostics fixture and integration test coverage for “namespace used without composing the pack”:
  - schema contains `@pgvector.column(...)`
  - config omits the pgvector pack from `extensionPacks`
  - assert failure includes a stable code + actionable message (and span)
- [ ] Update `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md` with follow-on parameterized native types (char/varchar/numeric/time/bit/json) and where they would map onto existing TS column type factories.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| PSL can express parameterized attributes on fields and on `types { ... }` entries | Unit + Integration | Milestone 1 + 2 | Parser unit tests + parity fixture exercising both surfaces |
| `@map` / `@@map` are supported and participate in parity tests | Integration | Milestone 2 + 3 | Parity fixture asserts canonical JSON + hashes |
| At least one pgvector parity fixture exists and passes (canonical JSON + stable hashes) | Integration | Milestone 3 | New `pgvector` parity case |
| Using `@pgvector.*` without composing the pack via config fails with actionable diagnostic | Integration | Milestone 2 + 3 | Dedicated diagnostics fixture (negative case) |

## Open Items

- Confirm the canonical argument shape conventions for the generic attribute parser (e.g. named args `length: 1536`, positional args, string literals), so interpretation can validate predictably while still supporting the generic “any attribute” parse.
- Confirm the stable diagnostic code(s) for “namespace used but pack not composed” (interpreter-level), so parity diagnostics fixtures can assert it reliably.
