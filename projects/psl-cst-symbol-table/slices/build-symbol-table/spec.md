# Slice: build-symbol-table

_Parent project: `projects/psl-cst-symbol-table/`. Outcome this slice contributes: the `buildSymbolTable` resolution layer exists and is tested, giving both interpreters a single scope-aware model to consume in place of the legacy AST._

## At a glance

Add `buildSymbolTable` to `@prisma-next/psl-parser`, co-located with `parse`. It is a pure, fault-tolerant pass over the CST `DocumentAst` that returns a scope-aware symbol table — top-level namespaces / scalars / type-aliases / blocks / models / composite-types as keyed records discriminated by `kind`; namespace-nested members keyed by name; fields keyed under their owning block; every symbol carrying its CST AST node — plus its own duplicate-name diagnostics. No interpreter changes, no deletions; `parsePslDocument` is untouched.

## Chosen design

### Entry point

```ts
export interface BuildSymbolTableOptions {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly scalarTypes: readonly string[];
}

export interface SymbolTableResult {
  readonly table: SymbolTable;
  readonly diagnostics: readonly ParseDiagnostic[]; // duplicate-name findings only
}

export function buildSymbolTable(options: BuildSymbolTableOptions): SymbolTableResult;
```

`diagnostics` carries **only** `buildSymbolTable`'s own duplicate-name findings (decided: two separate lists; the caller surfaces these alongside `parse`'s `diagnostics`). Reuse the existing `ParseDiagnostic` shape (`{ code, message, range }`) from `parse.ts` — diagnostics already carry a `Range` resolved via `SourceFile`, which is why `sourceFile` is a required input.

### Table shape — keyed records, distinct per-kind interfaces

Decided: **keyed records** (`Record<string, …Symbol>`) for lookup scopes, and **distinct per-kind interfaces** under a discriminated `kind`. Every symbol carries `.node` — the CST AST class it was built from.

_Illustrative — field names are the implementer's to finalise; the keyed-record + discriminated-`kind` + `.node`-on-every-symbol shape is prescriptive:_

```ts
export interface SymbolTable {
  readonly topLevel: TopLevelScope;
}

export interface TopLevelScope {
  readonly namespaces: Record<string, NamespaceSymbol>;
  readonly scalars: Record<string, ScalarSymbol>;
  readonly typeAliases: Record<string, TypeAliasSymbol>;
  readonly blocks: Record<string, BlockSymbol>;
  readonly models: Record<string, ModelSymbol>;
  readonly compositeTypes: Record<string, CompositeTypeSymbol>;
}

export interface NamespaceSymbol {
  readonly kind: 'namespace';
  readonly name: string;
  readonly node: NamespaceDeclarationAst;
  readonly models: Record<string, ModelSymbol>;
  readonly compositeTypes: Record<string, CompositeTypeSymbol>;
  readonly blocks: Record<string, BlockSymbol>;
}

export interface ModelSymbol {
  readonly kind: 'model';
  readonly name: string;
  readonly node: ModelDeclarationAst;
  readonly fields: Record<string, FieldSymbol>;
}

export interface CompositeTypeSymbol {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly node: CompositeTypeDeclarationAst;
  readonly fields: Record<string, FieldSymbol>;
}

export interface BlockSymbol {
  readonly kind: 'block';
  readonly name: string;
  readonly keyword: string;            // the generic block's keyword, e.g. "enum", "policy"
  readonly node: GenericBlockDeclarationAst;
}

export interface ScalarSymbol {
  readonly kind: 'scalar';
  readonly name: string;
  readonly node: NamedTypeDeclarationAst;
}

export interface TypeAliasSymbol {
  readonly kind: 'typeAlias';
  readonly name: string;
  readonly node: NamedTypeDeclarationAst;
}

export interface FieldSymbol {
  readonly kind: 'field';
  readonly name: string;
  readonly node: FieldDeclarationAst;
}
```

### Resolution rules

- **Iterate `DocumentAst.declarations()`** for the top-level scope, and `NamespaceDeclarationAst.declarations()` for namespace members. Read names via `IdentifierAst.name()` on each declaration's `.name()`.
- **Scalar vs type alias (decided #4-adjacent):** a `NamedTypeDeclarationAst` from a `types { … }` block is a `ScalarSymbol` when its base-type name is in `scalarTypes`, else a `TypeAliasSymbol`. The base-type name is the `typeAnnotation().name()` identifier (`QualifiedNameAst.identifier()` / `.path()`); a constructor annotation (`isConstructor()`) is never a scalar — it's a type alias.
- **Qualified type references are NOT resolved here (decided):** `FieldSymbol` carries only its `FieldDeclarationAst`. Splitting `auth.User` / `supabase:auth.User` into space/namespace/name stays in the interpreters, which read `field.node.typeAnnotation().name()` (the CST `QualifiedNameAst` already exposes `space()` / `namespace()` / `identifier()`).
- **Namespace members** are models, composite types, and generic blocks only (`types {}` and nested `namespace` blocks are not namespace members, per the CST grammar). A nested `namespace` or `types` inside a namespace is already a parser diagnostic; the symbol table does not re-flag it.

### Duplicate detection

- **`PSL_DUPLICATE_DECLARATION`** (decided) — a new code added to the `PslDiagnosticCode` union in `framework-components`.
- **First-wins (decided):** the first declaration of a name in a scope is kept in the keyed record; each later same-name declaration is dropped from the record and emits one `PSL_DUPLICATE_DECLARATION` anchored on the later declaration's name span.
- **Collide regardless of `kind` (decided):** within one scope (top level, or one namespace body, or one block's fields), a name collides across kinds — a top-level `model User` and composite `type User` collide; a `model A` and a generic block `policy A` collide. Implementation: dedupe on a single per-scope name set, not per-kind sub-maps. (Scalars and type-aliases share the top-level name set with models/blocks/etc.; two `types {}` bindings of the same name collide too.)
- **Fault-tolerant:** an unnamed declaration (recovered CST where `.name()` is absent) is skipped for keying, never throws, never invents a name.

## Coherence rationale

One reviewer holds this in one sitting: it is a single new module (`buildSymbolTable` + its symbol-table types) plus its unit tests, plus one new diagnostic-code literal. No call sites change; nothing is deleted. The whole diff is additive and reviewable against the chosen-design shape above.

## Scope

**In:**
- New symbol-table module in `packages/1-framework/2-authoring/psl-parser/src/` (e.g. `symbol-table.ts`) + its public types.
- Export of `buildSymbolTable` and the symbol-table types from the package's `src/exports/` surface.
- `PSL_DUPLICATE_DECLARATION` added to the `PslDiagnosticCode` union in `packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts`.
- Unit tests for `buildSymbolTable` co-located in the package's `test/`.
- README note for the new public API (`packages/1-framework/2-authoring/psl-parser/README.md`).

**Out:**
- Any interpreter change (slices 2–3).
- Any deletion of `parsePslDocument` or legacy parser machinery (slice 3).
- Qualified-type-reference resolution onto field symbols (stays in interpreters, per decision).
- The printer and the legacy `PslDocumentAst` types (untouched all project).
- Descriptor-driven extension-block parameter validation (a `BlockSymbol` records the generic block + its `node`; richer parameter resolution is not in this slice).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `types { Foo = Bar(1536) }` constructor binding | Classify as `typeAlias`, never `scalar` | A constructor annotation is not a bare scalar name; `scalarTypes` membership only applies to a plain base-type identifier. |
| Recovered CST with a nameless declaration (parse error upstream) | Skip for keying; emit no symbol-table diagnostic | The parser already diagnosed the malformed header; `buildSymbolTable` must not throw or double-report. |
| Same name across kinds in one scope (`model User` + `type User`) | `PSL_DUPLICATE_DECLARATION` on the later one | Per the collide-regardless-of-kind decision; stricter than legacy per-kind keying. |

## Slice-specific done conditions

- [ ] `buildSymbolTable` and the symbol-table types are exported from `@prisma-next/psl-parser`; `PSL_DUPLICATE_DECLARATION` is in the `PslDiagnosticCode` union, and `framework-components` is rebuilt so the new code is visible to the parser package's typecheck.

## Contract-impact section

Touches the core diagnostic vocabulary (`packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts`): adds one new member, `PSL_DUPLICATE_DECLARATION`, to the `PslDiagnosticCode` union. Additive only — no existing code is changed or removed. Downstream consumers that exhaustively switch on `PslDiagnosticCode` (e.g. CLI/editor diagnostic renderers) gain a new arm; verify none rely on exhaustiveness without a default. No contract-entity, IR, or `contract.json` shape change. After editing the union, rebuild `framework-components` (`pnpm build` for that package) before the parser package's typecheck will see the new literal.

## Open Questions

1. Module filename (`symbol-table.ts`) and exact exported type names. Working position: `symbol-table.ts`, type names per the illustrative sketch; implementer may refine names provided the keyed-record + discriminated-`kind` + `.node`-on-every-symbol shape holds.

## References

- Parent project: `projects/psl-cst-symbol-table/spec.md`
- Linear issue: [TML-2929](https://linear.app/prisma-company/issue/TML-2929)
- CST parser + `ParseDiagnostic`/`SourceFile`: `packages/1-framework/2-authoring/psl-parser/src/parse.ts`, `src/source-file.ts`
- CST AST node classes: `packages/1-framework/2-authoring/psl-parser/src/syntax/ast/declarations.ts`, `qualified-name.ts`, `type-annotation.ts`, `identifier.ts`
- Diagnostic-code union: `packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts`
