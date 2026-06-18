# Slice: migrate-sql-interpreter

_Parent project: `projects/psl-cst-symbol-table/`. Outcome this slice contributes: the SQL interpreter consumes the symbol table (slice 1's hand-off) instead of the legacy `ParsePslDocumentResult`, proving the symbol-table API as the canary before the Mongo interpreter fans out. `parsePslDocument` survives this slice (Mongo still uses it; deleted in slice 3)._

## At a glance

Rewire `@prisma-next/sql-contract-psl` to take a `SymbolTable` (built via `parse` + `buildSymbolTable`) as its interpreter input, replacing the legacy resolved `PslDocumentAst`. Per the operator decision (logged), this is a **direct helper rewrite, not an adapter shim**: the interpreter's helpers consume `ModelSymbol` / `FieldSymbol` / `CompositeTypeSymbol` / `BlockSymbol` and read the CST AST via `.node`; the legacy `Psl*` object types leave the SQL package entirely. Diagnostics reach feature parity with today (codes preserved; wording/span may shift). Qualified-type resolution (`auth.User` / `supabase:auth.User`), left to interpreters by the project spec, is implemented here against the CST `QualifiedNameAst`.

## Chosen design

The migration follows six fault lines (mapped from the current coupling). The interpreter's deep helpers today consume legacy `PslModel`/`PslField`/`PslCompositeType`/`PslNamedTypeDeclaration`/`PslAttribute` objects; the rewrite makes them consume symbol-table entries + CST nodes.

### 1. Type-annotation + attribute readers (the shared seam)

A package-local adapter converts a `FieldDeclarationAst` type annotation into the read set the helpers need, derived from the CST instead of pre-split by the legacy parser:

_Illustrative — the derivation is prescriptive; the function shape is the implementer's:_

```ts
// from field.node.typeAnnotation().name() : QualifiedNameAst
typeName            = name.identifier()?.name()      // "User"
typeNamespaceId     = name.namespace()?.name()       // "auth"  (only if dot())
typeContractSpaceId = name.space()?.name()           // "supabase" (only if colon())
optional            = typeAnnotation.isOptional()
list                = typeAnnotation.isList()
isConstructor       = typeAnnotation.isConstructor()
// name.isOverQualified() → a malformed qualified type; emit PSL_INVALID_QUALIFIED_TYPE / _NAME
```

A parallel reader converts `FieldAttributeAst` / `ModelAttributeAst` (`name()` → `QualifiedNameAst`, `argList()` → `AttributeArgListAst` / `AttributeArgAst`) into the `{ name, args: [{kind:'positional'|'named', value, span}] }` shape the existing attribute helpers (`getAttribute`, `getNamedArgument`, `getPositionalArgument`, `psl-authoring-arguments`) read. Attribute-arg `value` is a string today (pre-rendered); the reader renders `ExpressionAst` → string so the downstream argument-parsing logic is reused unchanged.

### 2. Enum-block reconstruction (highest-risk seam — isolate it)

The downstream enum factory (`packages/2-sql/9-family/src/core/authoring-entity-types.ts`) reads a `PslExtensionBlock` with `.name`, `.blockAttributes` (for `@@type("codec")`), and `.parameters` (member name → value). The symbol table surfaces an enum as a `BlockSymbol` (`kind: 'block'`, `keyword: 'enum'`) carrying a raw `GenericBlockDeclarationAst`. This slice reconstructs a `PslExtensionBlock`-shaped object from the CST node — parsing `@@type(...)` from `node.attributes()` and members from `node.entries()` (`KeyValuePairAst.key()`/`.value()`, member spans from the entry syntax) — so the factory contract stays intact. Enums in a named namespace still emit `PSL_ENUM_NAMESPACE_NOT_SUPPORTED` (now read from `namespaceSymbol.blocks` filtered on `keyword === 'enum'`).

### 3. Named-type re-union

The interpreter today walks `ast.types.declarations` uniformly. The symbol table splits these into `topLevel.scalars` (base ∈ `scalarTypes`) and `topLevel.typeAliases`. The rewrite re-unions both into the `resolveNamedTypeDeclarations` input and swaps the `baseType` vs `typeConstructor` discriminant for `node.typeAnnotation().isConstructor()`.

### 4. Interpreter walk

Replace `input.document.ast.namespaces` / `.compositeTypes` / `.types.declarations` traversal with `SymbolTable.topLevel` + per-`NamespaceSymbol` traversal. The input type becomes the symbol table (plus the still-needed `target`, `scalarTypeDescriptors`, `authoringContributions`, etc.). `sourceId` for diagnostics comes from the provider (threaded in), since the symbol table carries no `sourceId`.

### 5. Provider parse swap

`provider.ts` switches from `parsePslDocument({ schema, sourceId, pslBlockDescriptors })` to `parse(schema)` → `buildSymbolTable({ document, sourceFile, scalarTypes })`, where `scalarTypes = [...context.scalarTypeDescriptors.keys()]`. The provider surfaces both `parse`'s diagnostics and `buildSymbolTable`'s diagnostics (two lists, per the project decision). The `pslBlockDescriptors` thread is rehomed: the symbol table defers block-parameter parsing, so descriptor-driven validation that the legacy parser did at parse time now happens in the enum-reconstruction seam (§2) or is carried as a follow-up if a gap surfaces.

### 6. Test migration

A shared test helper (`parse` → `buildSymbolTable` → `interpretPslDocumentToSqlContract`) absorbs the 160 inline `parsePslDocument` call sites across 14 test files. The one structurally-coupled test (`interpreter.diagnostics.test.ts` hand-builds a fake `ParsePslDocumentResult` to hit an unreachable guard) is rewritten against the symbol-table input.

## Coherence rationale

One PR, one outcome: "the SQL interpreter consumes the symbol table; the legacy `Psl*` object shapes are gone from the SQL package." A reviewer holds it as a single migration even though it spans several helper files — every change serves that one rewire, and the test fan-out is mechanical. It runs as ~6 dispatches (the fault lines above) within the one PR; the dispatch sequence is re-decomposable without changing the slice outcome.

## Scope

**In:**
- `packages/2-sql/2-authoring/contract-psl/src/**` — interpreter entry, the six helper files, provider.
- The CST-derived type-annotation/attribute adapters (package-local).
- Enum-block reconstruction from `GenericBlockDeclarationAst`.
- Qualified-type-reference derivation against `QualifiedNameAst` (incl. over-qualified diagnostics).
- All `packages/2-sql/2-authoring/contract-psl/test/**` (160 call sites + the hand-built-AST test).

**Out:**
- The Mongo interpreter and `parsePslDocument` deletion (slice 3).
- The printer / legacy `PslDocumentAst` types (untouched all project).
- The downstream enum factory contract in `packages/2-sql/9-family/**` — kept intact by reconstructing the `PslExtensionBlock` shape (we adapt to it, we don't change it).
- `buildSymbolTable` itself (slice 1; only consumed here — any gap found loops a fix back into the parser package within this slice).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Over-qualified type (`a.b.c` / `x:y:z`) | Emit `PSL_INVALID_QUALIFIED_TYPE`/`_NAME` | Legacy parser pre-rejected malformed qualified names; the CST exposes `QualifiedNameAst.isOverQualified()` — the rewrite must reproduce the rejection (new derivation site). |
| Enum `@@type("codec")` + members | Reconstruct from `node.attributes()` + `node.entries()` | The symbol table does not pre-parse these; the enum factory needs them. Highest-risk seam — its own dispatch. |
| Attribute arg value as rendered string | Render `ExpressionAst` → string in the attribute reader | Existing arg-parsing consumes a string `value`; reuse it by rendering, rather than rewriting all arg consumers. |
| `types { Foo = Bar(1536) }` constructor binding | `typeAlias` (already classified by `buildSymbolTable`); discriminant is `isConstructor()` | Matches slice-1 behaviour; the named-type re-union must not treat a constructor as a scalar base. |

## Slice-specific done conditions

- [ ] `rg 'PslModel|PslField|PslCompositeType|PslNamedTypeDeclaration|PslExtensionBlock|parsePslDocument' packages/2-sql/2-authoring/contract-psl/src` returns nothing — the SQL package no longer consumes the legacy parser or its object shapes (the enum factory's `PslExtensionBlock` consumption in `2-sql/9-family` is out of scope and may remain).
- [ ] The full SQL `contract-psl` test suite is green against the migrated input, with diagnostic **codes** unchanged from the pre-migration suite (wording/span may differ where the spec allows).

## Open Questions

1. `pslBlockDescriptors` rehoming. The legacy parser used `pslBlockDescriptors` (from `authoringContributions`) to validate extension blocks at parse time; the symbol table defers this. Working position: reconstruct what the enum factory needs in the §2 seam; if a descriptor-driven validation has no home, carry it as a project § Open item for slice 3 rather than widening this slice. Halt-and-surface if a parity gap appears that can't be closed in-scope.
2. Whether the `scalarTypes` list is derived in the provider (`context.scalarTypeDescriptors.keys()`) or inside the interpreter (`input.scalarTypeDescriptors.keys()`). Working position: provider, since it owns the `parse`+`buildSymbolTable` call; the interpreter takes the already-built table.

## References

- Parent project: `projects/psl-cst-symbol-table/spec.md`
- Linear issue: [TML-2929](https://linear.app/prisma-company/issue/TML-2929)
- Migration map (this slice's grounding): captured in the dispatch plan's fault lines.
- Slice 1 hand-off: `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts` (the `SymbolTable` API).
- Interpreter + helpers: `packages/2-sql/2-authoring/contract-psl/src/{interpreter,provider,psl-attribute-parsing,psl-authoring-arguments,psl-relation-resolution,psl-field-resolution,psl-column-resolution}.ts`
- Enum factory (contract kept intact): `packages/2-sql/9-family/src/core/authoring-entity-types.ts`
- Correction to project plan: slice 2 has **no** `test/integration/**` reach — the SQL `contract-psl` tests are self-contained (160 inline `parsePslDocument` calls in `test/`).
