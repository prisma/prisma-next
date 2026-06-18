import type { ParseDiagnostic } from './parse';
import type { Range, SourceFile } from './source-file';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  type FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from './syntax/ast/declarations';
import type { IdentifierAst } from './syntax/ast/identifier';

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
export function buildSymbolTable(options: BuildSymbolTableOptions): SymbolTableResult {
  const { document, sourceFile, scalarTypes } = options;
  const diagnostics: ParseDiagnostic[] = [];
  const scalarSet = new Set(scalarTypes);

  const namespaces: Record<string, NamespaceSymbol> = {};
  const scalars: Record<string, ScalarSymbol> = {};
  const typeAliases: Record<string, TypeAliasSymbol> = {};
  const blocks: Record<string, BlockSymbol> = {};
  const models: Record<string, ModelSymbol> = {};
  const compositeTypes: Record<string, CompositeTypeSymbol> = {};
  const topLevelNames = new Set<string>();

  const claim = (taken: Set<string>, name: IdentifierAst | undefined): string | undefined => {
    const text = name?.name();
    if (text === undefined) return undefined;
    if (taken.has(text)) {
      const range = nameRange(name, sourceFile);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${text}"`,
          range,
        });
      }
      return undefined;
    }
    taken.add(text);
    return text;
  };

  for (const declaration of document.declarations()) {
    if (declaration instanceof ModelDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) models[name] = buildModel(name, declaration);
    } else if (declaration instanceof CompositeTypeDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) compositeTypes[name] = buildCompositeType(name, declaration);
    } else if (declaration instanceof GenericBlockDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) blocks[name] = buildBlock(name, declaration);
    } else if (declaration instanceof NamespaceDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) {
        namespaces[name] = buildNamespace(name, declaration, diagnostics, sourceFile);
      }
    } else if (declaration instanceof TypesBlockAst) {
      for (const binding of declaration.declarations()) {
        const name = claim(topLevelNames, binding.name());
        if (name === undefined) continue;
        if (isScalarBinding(binding, scalarSet)) {
          scalars[name] = { kind: 'scalar', name, node: binding };
        } else {
          typeAliases[name] = { kind: 'typeAlias', name, node: binding };
        }
      }
    }
  }

  const table: SymbolTable = {
    topLevel: { namespaces, scalars, typeAliases, blocks, models, compositeTypes },
  };
  return { table, diagnostics };
}

function buildModel(name: string, node: ModelDeclarationAst): ModelSymbol {
  return { kind: 'model', name, node, fields: buildFields(node.fields()) };
}

function buildCompositeType(name: string, node: CompositeTypeDeclarationAst): CompositeTypeSymbol {
  return { kind: 'compositeType', name, node, fields: buildFields(node.fields()) };
}

function buildBlock(name: string, node: GenericBlockDeclarationAst): BlockSymbol {
  return { kind: 'block', name, keyword: node.keyword()?.text ?? '', node };
}

function buildNamespace(
  name: string,
  node: NamespaceDeclarationAst,
  diagnostics: ParseDiagnostic[],
  sourceFile: SourceFile,
): NamespaceSymbol {
  const models: Record<string, ModelSymbol> = {};
  const compositeTypes: Record<string, CompositeTypeSymbol> = {};
  const blocks: Record<string, BlockSymbol> = {};
  const taken = new Set<string>();

  for (const member of node.declarations()) {
    const memberName = member.name()?.name();
    if (memberName === undefined) continue;
    if (taken.has(memberName)) {
      const range = nameRange(member.name(), sourceFile);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${memberName}"`,
          range,
        });
      }
      continue;
    }
    taken.add(memberName);
    if (member instanceof ModelDeclarationAst) {
      models[memberName] = buildModel(memberName, member);
    } else if (member instanceof CompositeTypeDeclarationAst) {
      compositeTypes[memberName] = buildCompositeType(memberName, member);
    } else if (member instanceof GenericBlockDeclarationAst) {
      blocks[memberName] = buildBlock(memberName, member);
    }
  }

  return { kind: 'namespace', name, node, models, compositeTypes, blocks };
}

function buildFields(fields: Iterable<FieldDeclarationAst>): Record<string, FieldSymbol> {
  const result: Record<string, FieldSymbol> = {};
  for (const field of fields) {
    const name = field.name()?.name();
    if (name === undefined || name in result) continue;
    result[name] = { kind: 'field', name, node: field };
  }
  return result;
}

function isScalarBinding(node: NamedTypeDeclarationAst, scalarTypes: Set<string>): boolean {
  const annotation = node.typeAnnotation();
  if (annotation === undefined || annotation.isConstructor()) return false;
  const base = annotation.name()?.identifier()?.name();
  return base !== undefined && scalarTypes.has(base);
}

function nameRange(name: IdentifierAst | undefined, sourceFile: SourceFile): Range | undefined {
  if (name === undefined) return undefined;
  for (const token of name.syntax.tokens()) {
    if (token.kind === 'Ident') {
      return {
        start: sourceFile.positionAt(token.offset),
        end: sourceFile.positionAt(token.offset + token.text.length),
      };
    }
  }
  return undefined;
}
