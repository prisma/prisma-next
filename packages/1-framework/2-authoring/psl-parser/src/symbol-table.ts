import type { ParseDiagnostic } from './parse';
import type { SourceFile } from './source-file';
import type {
  CompositeTypeDeclarationAst,
  DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
} from './syntax/ast/declarations';

/**
 * A scope-aware model of a PSL `DocumentAst`, produced by {@link buildSymbolTable}.
 * Top-level declarations are grouped by kind into keyed records; namespace
 * members and block fields are nested under their owning symbol. Every symbol is
 * discriminated by a `kind` literal and carries its originating CST AST `node`.
 */
export interface SymbolTable {
  readonly topLevel: TopLevelScope;
}

/**
 * The document's top-level scope. Each record is keyed by declared name and
 * holds the first-wins symbol for that kind.
 */
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
  readonly keyword: string;
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

export interface BuildSymbolTableOptions {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly scalarTypes: readonly string[];
}

export interface SymbolTableResult {
  readonly table: SymbolTable;
  readonly diagnostics: readonly ParseDiagnostic[];
}

/**
 * Build a scope-aware {@link SymbolTable} from a parsed CST `DocumentAst`.
 *
 * A pure, fault-tolerant pass: it never throws on recovered/malformed CST, and
 * its `diagnostics` carry only this pass's own duplicate-name findings
 * (`PSL_DUPLICATE_DECLARATION`), separate from `parse`'s diagnostics.
 */
export function buildSymbolTable(_options: BuildSymbolTableOptions): SymbolTableResult {
  throw new Error('not implemented');
}
