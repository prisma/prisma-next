import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';
import type { PslExtensionBlock, PslSpan } from '@prisma-next/framework-components/psl-ast';
import { reconstructExtensionBlock } from './block-reconstruction';
import { findBlockDescriptor } from './extension-block';
import type { ParseDiagnostic } from './parse';
import {
  nodePslSpan,
  type ResolvedAttribute,
  type ResolvedTypeConstructorCall,
  readResolvedAttributes,
  readResolvedConstructorCall,
  resolveFieldTypeAnnotation,
} from './resolve';
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

export type {
  ResolvedAttribute,
  ResolvedAttributeArg,
  ResolvedTypeConstructorCall,
} from './resolve';

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
  readonly span: PslSpan;
  readonly models: Record<string, ModelSymbol>;
  readonly compositeTypes: Record<string, CompositeTypeSymbol>;
  readonly blocks: Record<string, BlockSymbol>;
}

export interface ModelSymbol {
  readonly kind: 'model';
  readonly name: string;
  readonly node: ModelDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly attributes: readonly ResolvedAttribute[];
}

export interface CompositeTypeSymbol {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly node: CompositeTypeDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly attributes: readonly ResolvedAttribute[];
}

export interface BlockSymbol {
  readonly kind: 'block';
  readonly name: string;
  readonly keyword: string;
  readonly node: GenericBlockDeclarationAst;
  readonly span: PslSpan;
  /**
   * The resolved extension block, reconstructed at symbol-table construction
   * from the block's descriptor (looked up by `keyword`) or descriptor-free when
   * no descriptor is registered. Consumers (enum factory, descriptor-driven
   * validation) read this directly instead of reconstructing it themselves.
   */
  readonly block: PslExtensionBlock;
}

/**
 * The resolved binding shape shared by `types {}` entries: exactly one of
 * `baseType` / `typeConstructor` is meaningful, discriminated by `isConstructor`
 * (the CST `typeAnnotation().isConstructor()` discriminant), plus the binding's
 * attributes.
 */
export interface ResolvedNamedTypeBinding {
  readonly baseType?: string;
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly isConstructor: boolean;
  readonly attributes: readonly ResolvedAttribute[];
}

export interface ScalarSymbol extends ResolvedNamedTypeBinding {
  readonly kind: 'scalar';
  readonly name: string;
  readonly node: NamedTypeDeclarationAst;
  readonly span: PslSpan;
}

export interface TypeAliasSymbol extends ResolvedNamedTypeBinding {
  readonly kind: 'typeAlias';
  readonly name: string;
  readonly node: NamedTypeDeclarationAst;
  readonly span: PslSpan;
}

export interface FieldSymbol {
  readonly kind: 'field';
  readonly name: string;
  readonly node: FieldDeclarationAst;
  readonly span: PslSpan;
  readonly typeName: string;
  readonly typeNamespaceId?: string;
  readonly typeContractSpaceId?: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly attributes: readonly ResolvedAttribute[];
  /**
   * Set when the field's qualified type was over-qualified and
   * `PSL_INVALID_QUALIFIED_TYPE` was already emitted into the symbol-table
   * diagnostics. Interpreters treat it as already-reported and do NOT cascade a
   * `PSL_UNSUPPORTED_FIELD_TYPE` (the legacy parser rejected such types before
   * the interpreter ran, so that cascade would be a spurious extra diagnostic).
   */
  readonly malformedType?: boolean;
}

export interface BuildSymbolTableOptions {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly scalarTypes: readonly string[];
  /**
   * Composed extension-block descriptors, used to resolve each generic block
   * into its {@link PslExtensionBlock} at construction (descriptor-driven
   * parameter classification). Required: block resolution cannot classify
   * parameters without it. Pass `{}` when the document has no extension blocks.
   */
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
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
 *
 * This pass is the **sole owner** of duplicate-declaration detection: it is the
 * only production emitter of `PSL_DUPLICATE_DECLARATION`, resolving same-scope
 * duplicate names first-wins (one symbol per name, colliding regardless of
 * kind). Downstream consumers (the SQL/Mongo interpreters) rely on this — they
 * never re-detect or re-emit duplicate declarations; an interpreter-side guard
 * against a same-coordinate duplicate is an invariant documenting this
 * guarantee, not a live error path.
 */
export function buildSymbolTable(options: BuildSymbolTableOptions): SymbolTableResult {
  const { document, sourceFile, scalarTypes, pslBlockDescriptors } = options;
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
      if (name !== undefined) models[name] = buildModel(name, declaration, sourceFile, diagnostics);
    } else if (declaration instanceof CompositeTypeDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) {
        compositeTypes[name] = buildCompositeType(name, declaration, sourceFile, diagnostics);
      }
    } else if (declaration instanceof GenericBlockDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) {
        blocks[name] = buildBlock(name, declaration, sourceFile, pslBlockDescriptors, diagnostics);
      }
    } else if (declaration instanceof NamespaceDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) {
        namespaces[name] = buildNamespace(
          name,
          declaration,
          diagnostics,
          sourceFile,
          pslBlockDescriptors,
        );
      }
    } else if (declaration instanceof TypesBlockAst) {
      for (const binding of declaration.declarations()) {
        const name = claim(topLevelNames, binding.name());
        if (name === undefined) continue;
        const resolved = resolveNamedTypeBinding(binding, sourceFile);
        const span = nodePslSpan(binding.syntax, sourceFile);
        if (isScalarBinding(binding, scalarSet)) {
          scalars[name] = { kind: 'scalar', name, node: binding, span, ...resolved };
        } else {
          typeAliases[name] = { kind: 'typeAlias', name, node: binding, span, ...resolved };
        }
      }
    }
  }

  const table: SymbolTable = {
    topLevel: { namespaces, scalars, typeAliases, blocks, models, compositeTypes },
  };
  return { table, diagnostics };
}

function buildModel(
  name: string,
  node: ModelDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): ModelSymbol {
  return {
    kind: 'model',
    name,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    fields: buildFields(name, node.fields(), sourceFile, diagnostics),
    attributes: readResolvedAttributes(node.attributes(), sourceFile),
  };
}

function buildCompositeType(
  name: string,
  node: CompositeTypeDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): CompositeTypeSymbol {
  return {
    kind: 'compositeType',
    name,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    fields: buildFields(name, node.fields(), sourceFile, diagnostics),
    attributes: readResolvedAttributes(node.attributes(), sourceFile),
  };
}

function buildBlock(
  name: string,
  node: GenericBlockDeclarationAst,
  sourceFile: SourceFile,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
  diagnostics: ParseDiagnostic[],
): BlockSymbol {
  const keyword = node.keyword()?.text ?? '';
  const descriptor = findBlockDescriptor(pslBlockDescriptors, keyword);
  return {
    kind: 'block',
    name,
    keyword,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    block: reconstructExtensionBlock(node, descriptor, sourceFile, diagnostics),
  };
}

function buildNamespace(
  name: string,
  node: NamespaceDeclarationAst,
  diagnostics: ParseDiagnostic[],
  sourceFile: SourceFile,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
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
      models[memberName] = buildModel(memberName, member, sourceFile, diagnostics);
    } else if (member instanceof CompositeTypeDeclarationAst) {
      compositeTypes[memberName] = buildCompositeType(memberName, member, sourceFile, diagnostics);
    } else if (member instanceof GenericBlockDeclarationAst) {
      blocks[memberName] = buildBlock(
        memberName,
        member,
        sourceFile,
        pslBlockDescriptors,
        diagnostics,
      );
    }
  }

  return {
    kind: 'namespace',
    name,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    models,
    compositeTypes,
    blocks,
  };
}

function buildFields(
  ownerName: string,
  fields: Iterable<FieldDeclarationAst>,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): Record<string, FieldSymbol> {
  const result: Record<string, FieldSymbol> = {};
  for (const field of fields) {
    const name = field.name()?.name();
    if (name === undefined || name in result) continue;
    result[name] = buildField(ownerName, name, field, sourceFile, diagnostics);
  }
  return result;
}

function buildField(
  ownerName: string,
  name: string,
  node: FieldDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): FieldSymbol {
  const attributes = readResolvedAttributes(node.attributes(), sourceFile);
  const span = nodePslSpan(node.syntax, sourceFile);
  const annotation = resolveFieldTypeAnnotation(node, sourceFile);

  if (!annotation.ok) {
    diagnostics.push({
      code: 'PSL_INVALID_QUALIFIED_TYPE',
      message: `Field "${ownerName}.${name}" has an invalid qualified type "${annotation.path.join('.')}"; use at most one namespace qualifier (e.g. "ns.TypeName")`,
      range: annotation.range,
    });
    return {
      kind: 'field',
      name,
      node,
      span,
      typeName: annotation.path[annotation.path.length - 1] ?? '',
      optional: false,
      list: false,
      malformedType: true,
      attributes,
    };
  }

  const typeConstructor = annotation.annotation.isConstructor
    ? readResolvedConstructorCall(node.typeAnnotation(), sourceFile)
    : undefined;

  return {
    kind: 'field',
    name,
    node,
    span,
    typeName: annotation.annotation.typeName ?? '',
    ...(annotation.annotation.typeNamespaceId !== undefined
      ? { typeNamespaceId: annotation.annotation.typeNamespaceId }
      : {}),
    ...(annotation.annotation.typeContractSpaceId !== undefined
      ? { typeContractSpaceId: annotation.annotation.typeContractSpaceId }
      : {}),
    optional: annotation.annotation.optional,
    list: annotation.annotation.list,
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes,
  };
}

function resolveNamedTypeBinding(
  node: NamedTypeDeclarationAst,
  sourceFile: SourceFile,
): {
  baseType?: string;
  typeConstructor?: ResolvedTypeConstructorCall;
  isConstructor: boolean;
  attributes: readonly ResolvedAttribute[];
} {
  const annotation = node.typeAnnotation();
  const isConstructor = annotation?.isConstructor() ?? false;
  const baseType = annotation?.name()?.identifier()?.name();
  const typeConstructor = readResolvedConstructorCall(annotation, sourceFile);
  return {
    isConstructor,
    ...(!isConstructor && baseType !== undefined ? { baseType } : {}),
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes: readResolvedAttributes(node.attributes(), sourceFile),
  };
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
