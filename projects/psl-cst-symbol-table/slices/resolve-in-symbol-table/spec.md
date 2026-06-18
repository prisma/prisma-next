# Slice: resolve-in-symbol-table

_Parent project: `projects/psl-cst-symbol-table/`. Outcome: reverse decision #4 — `buildSymbolTable` resolves field/named-type shapes once (as the legacy `parsePslDocument` did on `PslField`), and the per-package interpreter view layer + its duplication are deleted._

## At a glance

Today both interpreters re-derive the resolved field read-set into `CstFieldView`/`CstNamedTypeView` — near-exact `PslField` clones — duplicated across the SQL and Mongo `contract-psl` packages (`cst-read.ts` + `cst-read-views.ts` + `symbol-views.ts` in each), plus a view-build pass. This slice moves that resolution **into `buildSymbolTable`** so each `FieldSymbol` carries the resolved shape directly, and deletes the per-package view layer.

```ts
// FieldSymbol gains the resolved read-set (was: only name + node):
export interface FieldSymbol {
  readonly kind: 'field';
  readonly name: string;
  readonly node: FieldDeclarationAst;
  readonly typeName: string;
  readonly typeNamespaceId?: string;     // from dot-qualifier
  readonly typeContractSpaceId?: string; // from colon-prefix
  readonly optional: boolean;
  readonly list: boolean;
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly attributes: readonly ResolvedAttribute[]; // {name, args:[{kind,name?,value,span}]}
  readonly malformedType?: boolean;      // over-qualified; PSL_INVALID_QUALIFIED_TYPE already emitted
}
```

Interpreter helpers read `field.typeName` etc. directly off the symbol — no view struct, no per-package re-derivation.

## Chosen design

1. **`buildSymbolTable` resolves once.** Move the resolution currently in the SQL/Mongo `cst-read.ts`/`symbol-views.ts` into `@prisma-next/psl-parser`: split the qualified type from `QualifiedNameAst` (`typeName`/`typeNamespaceId`/`typeContractSpaceId`), derive `optional`/`list`/`isConstructor`, render attributes (`ResolvedAttribute` with rendered string arg values), and resolve `types {}` bindings' shape onto `ScalarSymbol`/`TypeAliasSymbol` (the `baseType` / `typeConstructor` + `isConstructor` discriminant). The over-qualified malformed signal becomes a symbol-table diagnostic (`PSL_INVALID_QUALIFIED_TYPE`) with the field marked `malformedType` (replacing the per-package `typeAlreadyReported` flag).
2. **Symbol-table types carry the resolved shape.** `FieldSymbol`, `ScalarSymbol`, `TypeAliasSymbol`, and a shared `ResolvedAttribute`/`ResolvedTypeConstructorCall` are exported from `@prisma-next/psl-parser`. `.node` stays on every symbol (interpreters still reach raw CST when needed).
3. **Delete the per-package view layer.** Remove `cst-read-views.ts` and `symbol-views.ts` from BOTH `packages/2-sql/2-authoring/contract-psl/` and `packages/2-mongo-family/2-authoring/contract-psl/`. Trim `cst-read.ts` in each to only what's still package-specific (likely nothing for field/attribute reading — it moves to the symbol table; the `Range→PslSpan` map may stay or move too).
4. **Rewire both interpreters' helpers** to consume the resolved `FieldSymbol`/`ScalarSymbol`/`TypeAliasSymbol` fields directly instead of building/consuming views. The helpers' read-set is unchanged (same fields, now sourced from the symbol). Attribute spans: the symbol's `ResolvedAttribute` carries `PslSpan` (resolution moves into the symbol table, so the `Range→PslSpan` map moves with it or is shared from psl-parser).
5. **Enum/extension-block reconstruction** (`extension-block.ts` in psl-parser, and SQL's `enum-block.ts`) is unaffected by the field-resolution move — leave it, unless the attribute-rendering helper it reuses moves (then re-point the import).

Diagnostic parity is absolute: every code preserved, including `PSL_INVALID_QUALIFIED_TYPE` (now from the symbol table) and the suppressed-spurious-cascade behaviour (now keyed off `FieldSymbol.malformedType`).

## Coherence rationale

One PR, one outcome: "resolution lives in the symbol table; the duplicated view layer is gone." A reviewer holds it as a single consolidation — the symbol-table change + the two interpreters' deletion-and-rewire all serve that one end. It builds directly on the merged project work.

## Scope

**In:**
- `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts` — resolved `FieldSymbol`/`ScalarSymbol`/`TypeAliasSymbol` + `ResolvedAttribute`/`ResolvedTypeConstructorCall` + the resolution logic + the over-qualified diagnostic. Its tests.
- `packages/2-sql/2-authoring/contract-psl/` — delete `cst-read-views.ts`, `symbol-views.ts`; trim `cst-read.ts`; rewire helpers + interpreter walk + tests.
- `packages/2-mongo-family/2-authoring/contract-psl/` — same deletions + rewire.

**Out:**
- The `parse`/CST grammar (unchanged).
- The printer + legacy `PslDocumentAst` types (untouched).
- The doubled-qualified-name-codes question (separate open item; this slice keeps current behaviour).
- Extracting a shared package (moot — resolution centralizes in psl-parser, which both already depend on).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Over-qualified type now flagged in the symbol table | `PSL_INVALID_QUALIFIED_TYPE` from `buildSymbolTable`; `FieldSymbol.malformedType=true`; interpreters suppress the `PSL_UNSUPPORTED_FIELD_TYPE` cascade off that flag | Replaces the per-package `typeAlreadyReported` view flag; the doubled-code behaviour (parser's `PSL_INVALID_QUALIFIED_NAME` + this) is unchanged. |
| Mongo never had constructors/named-types | `FieldSymbol` carries `typeConstructor?` (optional); Mongo simply never sees it set | The resolved `FieldSymbol` is one shape both consume; Mongo ignores the constructor field, as it ignored it via the view. |
| Attribute value rendering | Moves into the symbol table's `ResolvedAttribute` (the verbatim-source render the views did) | Cross-target identical; one implementation now, not two. |

## Slice-specific done conditions

- [ ] `cst-read-views.ts` and `symbol-views.ts` no longer exist in either `contract-psl` package; `rg 'CstFieldView|CstModelView|CstCompositeTypeView|CstNamedTypeView|buildFieldView' packages/2-sql packages/2-mongo-family` is empty.
- [ ] `buildSymbolTable`'s `FieldSymbol`/`ScalarSymbol`/`TypeAliasSymbol` carry the resolved shape; psl-parser symbol-table tests cover the resolution (qualified split, optional/list, constructor, over-qualified diagnostic, scalar-vs-alias).
- [ ] Workspace-wide gate green (`pnpm build` + `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps`), with all diagnostic codes preserved across the SQL + Mongo suites (no assertion changed except where a span legitimately shifts).

## Open Questions

1. Whether the `Range→PslSpan` map + attribute-render helper live in `@prisma-next/psl-parser` (shared, since resolution moves there) or stay package-local. Working position: move them into psl-parser alongside the resolution (single home); the interpreters import the resolved `PslSpan`-carrying symbols and need no local span code.

## References

- Parent project + the retro finding driving this slice: `projects/psl-cst-symbol-table/plan.md` § Open items (decision-#4 reversal).
- Symbol table: `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts`
- Current view layer (to delete): `packages/2-sql/2-authoring/contract-psl/src/{cst-read,cst-read-views,symbol-views}.ts` + the Mongo equivalents.
- Legacy resolved shape this re-centralizes: `PslField` in `46d58b1fd:packages/1-framework/1-core/framework-components/src/control/psl-ast.ts`.
