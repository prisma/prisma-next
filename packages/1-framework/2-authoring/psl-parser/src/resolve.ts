import type {
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@prisma-next/framework-components/authoring';
import { isAuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type { PslBlockParam, PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { blindCast } from '@prisma-next/utils/casts';
import type { ParseDiagnostic } from './parse';
import { type Range, SourceFile } from './source-file';
import type { FieldAttributeAst, ModelAttributeAst } from './syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  EnumDeclarationAst,
  type EnumValueDeclarationAst,
  type FieldDeclarationAst,
  GenericBlockDeclarationAst,
  type KeyValuePairAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from './syntax/ast/declarations';
import {
  ArrayLiteralAst,
  type ExpressionAst,
  StringLiteralExprAst,
} from './syntax/ast/expressions';
import { IdentifierAst } from './syntax/ast/identifier';
import type { TypeAnnotationAst } from './syntax/ast/type-annotation';
import type { SyntaxNode } from './syntax/red';

/**
 * Inputs the resolve pass needs to run the descriptor-driven extension-block
 * validators. Both are optional: with no descriptors registered, generic blocks
 * in the document are recorded structurally but no parameter-level diagnostic
 * runs (the keyword is unrecognised by the resolver). `codecLookup` defaults to
 * {@link emptyCodecLookup}, which rejects every `value`-kind parameter as an
 * unknown codec — callers with `value` parameters must supply a real lookup.
 */
export interface ResolveOptions {
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  readonly codecLookup?: CodecLookup;
}

const SCALAR_TYPES: ReadonlySet<string> = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

export type DeclKind = 'model' | 'enum' | 'compositeType' | 'namedType';

export interface DeclCoord {
  readonly kind: DeclKind;
  readonly namespaceId: string;
  readonly name: string;
}

export type TypeTarget =
  | { readonly kind: 'scalar'; readonly name: string }
  | { readonly kind: 'ref'; readonly coord: DeclCoord }
  | {
      readonly kind: 'crossSpace';
      readonly spaceId: string;
      readonly namespaceId?: string;
      readonly typeName: string;
    }
  | {
      readonly kind: 'constructor';
      readonly path: readonly string[];
      readonly args: readonly ExpressionAst[];
    }
  | { readonly kind: 'unresolved'; readonly typeName: string };

export interface ResolvedFieldType {
  readonly optional: boolean;
  readonly list: boolean;
  readonly target: TypeTarget;
}

export interface ResolvedArg {
  readonly name?: string;
  readonly value: ExpressionAst;
}

/**
 * Structured view of one attribute on a resolved entity. Argument values stay as
 * CST {@link ExpressionAst} nodes (no normalized value union); the accessors
 * subsume the old standalone `getPositionalArgument` / `parseQuotedStringLiteral`
 * helpers — `positionalArg` returns the nth positional arg's expression node, and
 * `stringArg` reads it as an unquoted string when it is a string literal.
 */
export class ResolvedAttribute {
  readonly name: string;
  readonly args: readonly ResolvedArg[];
  readonly syntax: FieldAttributeAst | ModelAttributeAst;

  constructor(
    name: string,
    args: readonly ResolvedArg[],
    syntax: FieldAttributeAst | ModelAttributeAst,
  ) {
    this.name = name;
    this.args = args;
    this.syntax = syntax;
  }

  positionalArg(index: number): ExpressionAst | undefined {
    let seen = 0;
    for (const arg of this.args) {
      if (arg.name !== undefined) continue;
      if (seen === index) return arg.value;
      seen++;
    }
    return undefined;
  }

  stringArg(index: number): string | undefined {
    const value = this.positionalArg(index);
    const literal = value === undefined ? undefined : StringLiteralExprAst.cast(value.syntax);
    return literal?.value();
  }
}

export interface ResolvedField {
  readonly name: string;
  readonly type: ResolvedFieldType;
  readonly attributes: readonly ResolvedAttribute[];
  readonly syntax: FieldDeclarationAst;
}

export interface ResolvedModel {
  readonly name: string;
  readonly namespaceId: string;
  readonly fields: ReadonlyMap<string, ResolvedField>;
  readonly attributes: readonly ResolvedAttribute[];
  readonly syntax: ModelDeclarationAst;
}

export interface ResolvedCompositeType {
  readonly name: string;
  readonly namespaceId: string;
  readonly fields: ReadonlyMap<string, ResolvedField>;
  readonly attributes: readonly ResolvedAttribute[];
  readonly syntax: CompositeTypeDeclarationAst;
}

export interface ResolvedEnumValue {
  readonly name: string;
  readonly attributes: readonly ResolvedAttribute[];
  readonly syntax: EnumValueDeclarationAst;
}

export interface ResolvedEnum {
  readonly name: string;
  readonly namespaceId: string;
  readonly values: ReadonlyMap<string, ResolvedEnumValue>;
  readonly attributes: readonly ResolvedAttribute[];
  readonly syntax: EnumDeclarationAst;
}

export interface ResolvedExtensionBlock {
  readonly name: string;
  readonly namespaceId: string;
  readonly syntax: SyntaxNode;
}

export interface ResolvedNamedType {
  readonly name: string;
  readonly type: ResolvedFieldType;
  readonly target: TypeTarget;
  readonly attributes: readonly ResolvedAttribute[];
  readonly syntax: NamedTypeDeclarationAst;
}

export interface ResolvedNamespace {
  readonly id: string;
  readonly models: ReadonlyMap<string, ResolvedModel>;
  readonly enums: ReadonlyMap<string, ResolvedEnum>;
  readonly compositeTypes: ReadonlyMap<string, ResolvedCompositeType>;
  readonly extensionBlocks: ReadonlyMap<string, ResolvedExtensionBlock>;
  readonly syntax?: NamespaceDeclarationAst;
}

export interface ResolvedDocument {
  readonly namespaces: ReadonlyMap<string, ResolvedNamespace>;
  readonly namedTypes: ReadonlyMap<string, ResolvedNamedType>;
  readonly diagnostics: readonly ParseDiagnostic[];
}

function identifierText(identifier: IdentifierAst | undefined): string | undefined {
  return identifier?.token()?.text;
}

/**
 * The set of declaration names visible while binding a written type reference to
 * a kind-ful coordinate. The chosen bare-name policy is current-namespace first,
 * then document-wide first-match; a qualified `ns.Type` reference resolves against
 * the named namespace exactly.
 *
 * The live SQL interpreter's bare-name path is instead flat document-wide
 * last-wins (`modelMappings.set(name, …)` over the coordinate-keyed map), so a
 * bare name shared across namespaces resolves differently there. That divergence
 * is to be reconciled when the interpreter migrates onto this resolver.
 */
interface NameTable {
  readonly byNamespace: ReadonlyMap<string, ReadonlyMap<string, DeclKind>>;
  readonly namedTypes: ReadonlySet<string>;
}

class Resolver {
  readonly #diagnostics: ParseDiagnostic[] = [];
  readonly #sourceFile: SourceFile;

  constructor(sourceText: string) {
    this.#sourceFile = new SourceFile(sourceText);
  }

  get diagnostics(): readonly ParseDiagnostic[] {
    return this.#diagnostics;
  }

  #rangeOf(node: SyntaxNode): Range {
    return {
      start: this.#sourceFile.positionAt(node.offset),
      end: this.#sourceFile.positionAt(node.offset + node.textLength),
    };
  }

  diagnostic(code: PslDiagnosticCode, message: string, node: SyntaxNode): void {
    this.#diagnostics.push({ code, message, range: this.#rangeOf(node) });
  }

  resolveTypeTarget(
    annotation: TypeAnnotationAst | undefined,
    currentNamespaceId: string,
    nameTable: NameTable,
  ): TypeTarget {
    if (!annotation) return { kind: 'unresolved', typeName: '' };

    const constructorCall = annotation.constructorCall();
    if (constructorCall) {
      const path = identifierText(constructorCall.name());
      return {
        kind: 'constructor',
        path: path === undefined ? [] : [path],
        args: [...constructorCall.args()].flatMap((arg) => {
          const value = arg.value();
          return value === undefined ? [] : [value];
        }),
      };
    }

    const typeName = identifierText(annotation.name());
    if (typeName === undefined) return { kind: 'unresolved', typeName: '' };

    const spaceName = identifierText(annotation.spaceName());
    if (spaceName !== undefined) {
      const namespaceName = identifierText(annotation.namespaceName());
      return namespaceName === undefined
        ? { kind: 'crossSpace', spaceId: spaceName, typeName }
        : { kind: 'crossSpace', spaceId: spaceName, namespaceId: namespaceName, typeName };
    }

    if (SCALAR_TYPES.has(typeName)) {
      return { kind: 'scalar', name: typeName };
    }

    const qualifier = identifierText(annotation.namespaceName());
    if (qualifier !== undefined) {
      const kind = nameTable.byNamespace.get(qualifier)?.get(typeName);
      if (kind !== undefined) {
        return { kind: 'ref', coord: { kind, namespaceId: qualifier, name: typeName } };
      }
      this.diagnostic(
        'PSL_UNRESOLVED_TYPE_REFERENCE',
        `Type "${qualifier}.${typeName}" does not resolve to a known declaration`,
        annotation.syntax,
      );
      return { kind: 'unresolved', typeName };
    }

    if (nameTable.namedTypes.has(typeName)) {
      return {
        kind: 'ref',
        coord: { kind: 'namedType', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: typeName },
      };
    }

    const currentKind = nameTable.byNamespace.get(currentNamespaceId)?.get(typeName);
    if (currentKind !== undefined) {
      return {
        kind: 'ref',
        coord: { kind: currentKind, namespaceId: currentNamespaceId, name: typeName },
      };
    }

    for (const [namespaceId, decls] of nameTable.byNamespace) {
      const kind = decls.get(typeName);
      if (kind !== undefined) {
        return { kind: 'ref', coord: { kind, namespaceId, name: typeName } };
      }
    }

    this.diagnostic(
      'PSL_UNRESOLVED_TYPE_REFERENCE',
      `Type "${typeName}" does not resolve to a known declaration`,
      annotation.syntax,
    );
    return { kind: 'unresolved', typeName };
  }

  resolveFieldType(
    annotation: TypeAnnotationAst | undefined,
    currentNamespaceId: string,
    nameTable: NameTable,
  ): ResolvedFieldType {
    return {
      optional: annotation?.isOptional() ?? false,
      list: annotation?.isList() ?? false,
      target: this.resolveTypeTarget(annotation, currentNamespaceId, nameTable),
    };
  }
}

function resolveFieldAttributes(attributes: Iterable<FieldAttributeAst>): ResolvedAttribute[] {
  const result: ResolvedAttribute[] = [];
  for (const attribute of attributes) {
    const baseName = identifierText(attribute.name());
    if (baseName === undefined) continue;
    const namespaceName = identifierText(attribute.namespaceName());
    const name = namespaceName === undefined ? baseName : `${namespaceName}.${baseName}`;
    result.push(new ResolvedAttribute(name, collectArgs(attribute.argList()), attribute));
  }
  return result;
}

function resolveModelAttributes(attributes: Iterable<ModelAttributeAst>): ResolvedAttribute[] {
  const result: ResolvedAttribute[] = [];
  for (const attribute of attributes) {
    const name = identifierText(attribute.name());
    if (name === undefined) continue;
    result.push(new ResolvedAttribute(name, collectArgs(attribute.argList()), attribute));
  }
  return result;
}

function collectArgs(argList: { args(): Iterable<ArgLike> } | undefined): ResolvedArg[] {
  const args: ResolvedArg[] = [];
  for (const arg of argList?.args() ?? []) {
    const value = arg.value();
    if (value === undefined) continue;
    const name = identifierText(arg.name());
    args.push(name === undefined ? { value } : { name, value });
  }
  return args;
}

interface ArgLike {
  name(): IdentifierAst | undefined;
  value(): ExpressionAst | undefined;
}

interface NamespaceBucket {
  readonly id: string;
  readonly syntax?: NamespaceDeclarationAst;
  readonly models: ModelDeclarationAst[];
  readonly enums: EnumDeclarationAst[];
  readonly compositeTypes: CompositeTypeDeclarationAst[];
  readonly genericBlocks: GenericBlockDeclarationAst[];
}

export function resolve(document: DocumentAst, options: ResolveOptions = {}): ResolvedDocument {
  const resolver = new Resolver(reconstructSource(document.syntax));
  const descriptorsByKeyword = collectBlockDescriptors(options.pslBlockDescriptors);
  const codecLookup = options.codecLookup ?? emptyCodecLookup;

  const bucketOrder: string[] = [];
  const buckets = new Map<string, NamespaceBucket>();
  const getBucket = (id: string, syntax?: NamespaceDeclarationAst): NamespaceBucket => {
    const existing = buckets.get(id);
    if (existing) return existing;
    const bucket: NamespaceBucket = {
      id,
      ...(syntax ? { syntax } : {}),
      models: [],
      enums: [],
      compositeTypes: [],
      genericBlocks: [],
    };
    buckets.set(id, bucket);
    bucketOrder.push(id);
    return bucket;
  };

  const namedTypeDecls: NamedTypeDeclarationAst[] = [];

  const bucketMember = (bucket: NamespaceBucket, member: SyntaxNode): void => {
    const model = ModelDeclarationAst.cast(member);
    if (model) {
      bucket.models.push(model);
      return;
    }
    const enumDecl = EnumDeclarationAst.cast(member);
    if (enumDecl) {
      bucket.enums.push(enumDecl);
      return;
    }
    const composite = CompositeTypeDeclarationAst.cast(member);
    if (composite) {
      bucket.compositeTypes.push(composite);
      return;
    }
    const genericBlock = GenericBlockDeclarationAst.cast(member);
    if (genericBlock) {
      bucket.genericBlocks.push(genericBlock);
    }
  };

  for (const declaration of document.declarations()) {
    const namespaceDecl = NamespaceDeclarationAst.cast(declaration.syntax);
    if (namespaceDecl) {
      const id = identifierText(namespaceDecl.name());
      if (id === undefined) continue;
      const bucket = getBucket(id, namespaceDecl);
      for (const member of namespaceDecl.declarations()) {
        bucketMember(bucket, member.syntax);
      }
      continue;
    }
    const typesBlock = TypesBlockAst.cast(declaration.syntax);
    if (typesBlock) {
      for (const named of typesBlock.declarations()) {
        namedTypeDecls.push(named);
      }
      continue;
    }
    bucketMember(getBucket(UNSPECIFIED_PSL_NAMESPACE_ID), declaration.syntax);
  }

  const byNamespace = new Map<string, ReadonlyMap<string, DeclKind>>();
  for (const id of bucketOrder) {
    const bucket = buckets.get(id);
    if (!bucket) continue;
    const decls = new Map<string, DeclKind>();
    registerNames(decls, bucket.models, 'model', resolver);
    registerNames(decls, bucket.enums, 'enum', resolver);
    registerNames(decls, bucket.compositeTypes, 'compositeType', resolver);
    byNamespace.set(id, decls);
  }

  const namedTypeStore = new Map<string, DeclKind>();
  registerNames(namedTypeStore, namedTypeDecls, 'namedType', resolver);
  const nameTable: NameTable = { byNamespace, namedTypes: new Set(namedTypeStore.keys()) };

  const extensionContext: ExtensionValidationContext = {
    descriptorsByKeyword,
    codecLookup,
    nameTable,
  };

  const namespaces = new Map<string, ResolvedNamespace>();
  for (const id of bucketOrder) {
    const bucket = buckets.get(id);
    if (!bucket) continue;
    namespaces.set(id, buildNamespace(bucket, nameTable, resolver, extensionContext));
  }

  const namedTypes = new Map<string, ResolvedNamedType>();
  for (const declaration of namedTypeDecls) {
    const name = identifierText(declaration.name());
    if (name === undefined || namedTypes.has(name)) continue;
    const annotation = declaration.typeAnnotation();
    namedTypes.set(name, {
      name,
      type: resolver.resolveFieldType(annotation, UNSPECIFIED_PSL_NAMESPACE_ID, nameTable),
      target: resolver.resolveTypeTarget(annotation, UNSPECIFIED_PSL_NAMESPACE_ID, nameTable),
      attributes: resolveFieldAttributes(declaration.attributes()),
      syntax: declaration,
    });
  }

  validateNamedTypeCollisions(namedTypeDecls, nameTable, resolver);

  return { namespaces, namedTypes, diagnostics: resolver.diagnostics };
}

function registerNames(
  store: Map<string, DeclKind>,
  declarations: ReadonlyArray<{ name(): IdentifierAst | undefined; syntax: SyntaxNode }>,
  kind: DeclKind,
  resolver: Resolver,
): void {
  for (const declaration of declarations) {
    const name = identifierText(declaration.name());
    if (name === undefined) continue;
    if (store.has(name)) {
      resolver.diagnostic(
        'PSL_DUPLICATE_DECLARATION',
        `Duplicate declaration "${name}" in this scope; the first declaration is used`,
        declaration.syntax,
      );
      continue;
    }
    store.set(name, kind);
  }
}

function buildNamespace(
  bucket: NamespaceBucket,
  nameTable: NameTable,
  resolver: Resolver,
  extensionContext: ExtensionValidationContext,
): ResolvedNamespace {
  const models = new Map<string, ResolvedModel>();
  for (const declaration of bucket.models) {
    const name = identifierText(declaration.name());
    if (name === undefined || models.has(name)) continue;
    models.set(name, {
      name,
      namespaceId: bucket.id,
      fields: buildFields(declaration.fields(), bucket.id, nameTable, resolver),
      attributes: resolveModelAttributes(declaration.attributes()),
      syntax: declaration,
    });
  }

  const enums = new Map<string, ResolvedEnum>();
  for (const declaration of bucket.enums) {
    const name = identifierText(declaration.name());
    if (name === undefined || enums.has(name)) continue;
    const values = new Map<string, ResolvedEnumValue>();
    for (const value of declaration.values()) {
      const valueName = identifierText(value.name());
      if (valueName === undefined || values.has(valueName)) continue;
      values.set(valueName, {
        name: valueName,
        attributes: resolveFieldAttributes(value.attributes()),
        syntax: value,
      });
    }
    enums.set(name, {
      name,
      namespaceId: bucket.id,
      values,
      attributes: resolveModelAttributes(declaration.attributes()),
      syntax: declaration,
    });
  }

  const compositeTypes = new Map<string, ResolvedCompositeType>();
  for (const declaration of bucket.compositeTypes) {
    const name = identifierText(declaration.name());
    if (name === undefined || compositeTypes.has(name)) continue;
    compositeTypes.set(name, {
      name,
      namespaceId: bucket.id,
      fields: buildFields(declaration.fields(), bucket.id, nameTable, resolver),
      attributes: resolveModelAttributes(declaration.attributes()),
      syntax: declaration,
    });
  }

  const extensionBlocks = new Map<string, ResolvedExtensionBlock>();
  for (const block of bucket.genericBlocks) {
    const name = identifierText(block.name());
    if (name === undefined) continue;
    const keyword = block.keyword()?.text;
    if (keyword === undefined) continue;
    const descriptor = extensionContext.descriptorsByKeyword.get(keyword);
    if (descriptor === undefined) continue;
    validateExtensionBlock(block, name, descriptor, bucket.id, resolver, extensionContext);
    if (extensionBlocks.has(name)) continue;
    extensionBlocks.set(name, { name, namespaceId: bucket.id, syntax: block.syntax });
  }

  return {
    id: bucket.id,
    models,
    enums,
    compositeTypes,
    extensionBlocks,
    ...(bucket.syntax ? { syntax: bucket.syntax } : {}),
  };
}

function buildFields(
  fields: Iterable<FieldDeclarationAst>,
  namespaceId: string,
  nameTable: NameTable,
  resolver: Resolver,
): ReadonlyMap<string, ResolvedField> {
  const result = new Map<string, ResolvedField>();
  for (const field of fields) {
    const name = identifierText(field.name());
    if (name === undefined || result.has(name)) continue;
    result.set(name, {
      name,
      type: resolver.resolveFieldType(field.typeAnnotation(), namespaceId, nameTable),
      attributes: resolveFieldAttributes(field.attributes()),
      syntax: field,
    });
  }
  return result;
}

/**
 * Cross-kind named-type collision: a named type whose name matches a scalar, a
 * model, or an enum declared anywhere in the document. Matches the old parser's
 * verbatim messages and its scalar → model → enum precedence (first match wins,
 * one diagnostic per colliding named type). Distinct from the same-kind
 * duplicate-declaration collision handled in {@link registerNames}.
 */
function validateNamedTypeCollisions(
  namedTypeDecls: readonly NamedTypeDeclarationAst[],
  nameTable: NameTable,
  resolver: Resolver,
): void {
  const seen = new Set<string>();
  for (const declaration of namedTypeDecls) {
    const name = identifierText(declaration.name());
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    if (SCALAR_TYPES.has(name)) {
      resolver.diagnostic(
        'PSL_INVALID_TYPES_MEMBER',
        `Named type "${name}" conflicts with scalar type "${name}"`,
        declaration.syntax,
      );
      continue;
    }
    if (declaredKindAcrossNamespaces(nameTable, name) === 'model') {
      resolver.diagnostic(
        'PSL_INVALID_TYPES_MEMBER',
        `Named type "${name}" conflicts with model name "${name}"`,
        declaration.syntax,
      );
      continue;
    }
    if (declaredKindAcrossNamespaces(nameTable, name) === 'enum') {
      resolver.diagnostic(
        'PSL_INVALID_TYPES_MEMBER',
        `Named type "${name}" conflicts with enum name "${name}"`,
        declaration.syntax,
      );
    }
  }
}

function declaredKindAcrossNamespaces(nameTable: NameTable, name: string): DeclKind | undefined {
  for (const decls of nameTable.byNamespace.values()) {
    const kind = decls.get(name);
    if (kind !== undefined) return kind;
  }
  return undefined;
}

interface ExtensionValidationContext {
  readonly descriptorsByKeyword: ReadonlyMap<string, AuthoringPslBlockDescriptor>;
  readonly codecLookup: CodecLookup;
  readonly nameTable: NameTable;
}

function collectBlockDescriptors(
  namespace: AuthoringPslBlockDescriptorNamespace | undefined,
): Map<string, AuthoringPslBlockDescriptor> {
  const byKeyword = new Map<string, AuthoringPslBlockDescriptor>();
  const visit = (node: AuthoringPslBlockDescriptorNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringPslBlockDescriptor(value)) {
        byKeyword.set(value.keyword, value);
      } else {
        visit(value);
      }
    }
  };
  if (namespace) visit(namespace);
  return byKeyword;
}

/**
 * Descriptor-driven validation of one generic block against the descriptor that
 * claims its keyword, computed directly over the CST {@link KeyValuePairAst}
 * entries. Reproduces the message/code corpus of the legacy
 * `validateExtensionBlock` (unknown / missing-required / option-out-of-set /
 * invalid-value / unresolved-ref) plus first-occurrence-wins duplicate detection
 * over the parsed entries.
 */
function validateExtensionBlock(
  block: GenericBlockDeclarationAst,
  blockName: string,
  descriptor: AuthoringPslBlockDescriptor,
  namespaceId: string,
  resolver: Resolver,
  context: ExtensionValidationContext,
): void {
  const entries = new Map<string, KeyValuePairAst>();
  for (const entry of block.entries()) {
    const key = identifierText(entry.key());
    if (key === undefined) continue;
    if (entries.has(key)) {
      resolver.diagnostic(
        'PSL_EXTENSION_DUPLICATE_PARAMETER',
        `Duplicate parameter "${key}" in "${descriptor.keyword}" block "${blockName}"; first occurrence wins`,
        entry.syntax,
      );
      continue;
    }
    entries.set(key, entry);
  }

  if (!descriptor.variadicParameters) {
    for (const [key, entry] of entries) {
      if (!Object.hasOwn(descriptor.parameters, key)) {
        resolver.diagnostic(
          'PSL_EXTENSION_UNKNOWN_PARAMETER',
          `Unknown parameter "${key}" in "${descriptor.keyword}" block "${blockName}". The descriptor does not declare this parameter.`,
          entry.syntax,
        );
      }
    }
  }

  for (const [key, param] of Object.entries(descriptor.parameters)) {
    if (param.required === true && !entries.has(key)) {
      resolver.diagnostic(
        'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
        `Required parameter "${key}" is missing from "${descriptor.keyword}" block "${blockName}".`,
        block.syntax,
      );
    }
  }

  for (const [key, param] of Object.entries(descriptor.parameters)) {
    const entry = entries.get(key);
    if (entry === undefined) continue;
    const value = entry.value();
    if (value === undefined) continue;
    validateExtensionParam(
      blockName,
      descriptor,
      key,
      param,
      value,
      namespaceId,
      resolver,
      context,
    );
  }
}

function validateExtensionParam(
  blockName: string,
  descriptor: AuthoringPslBlockDescriptor,
  key: string,
  param: PslBlockParam,
  value: ExpressionAst,
  namespaceId: string,
  resolver: Resolver,
  context: ExtensionValidationContext,
): void {
  switch (param.kind) {
    case 'option': {
      const token = nodeText(value.syntax);
      if (!param.values.includes(token)) {
        resolver.diagnostic(
          'PSL_EXTENSION_OPTION_OUT_OF_SET',
          `Parameter "${key}" in "${descriptor.keyword}" block "${blockName}" has value "${token}" which is not one of the allowed values: ${param.values.map((v) => `"${v}"`).join(', ')}.`,
          value.syntax,
        );
      }
      return;
    }
    case 'value': {
      const raw = nodeText(value.syntax);
      const codec = context.codecLookup.get(param.codecId);
      if (codec === undefined) {
        resolver.diagnostic(
          'PSL_EXTENSION_INVALID_VALUE',
          `Parameter "${key}" in "${descriptor.keyword}" block "${blockName}" references unknown codec "${param.codecId}".`,
          value.syntax,
        );
        return;
      }
      let jsonValue: unknown;
      try {
        jsonValue = JSON.parse(raw);
      } catch {
        resolver.diagnostic(
          'PSL_EXTENSION_INVALID_VALUE',
          `Parameter "${key}" in "${descriptor.keyword}" block "${blockName}" is not a valid JSON literal (expected a JSON string, number, boolean, or null): ${raw}`,
          value.syntax,
        );
        return;
      }
      try {
        codec.decodeJson(
          blindCast<
            Parameters<Codec['decodeJson']>[0],
            'JSON.parse returns a JsonValue-compatible value'
          >(jsonValue),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        resolver.diagnostic(
          'PSL_EXTENSION_INVALID_VALUE',
          `Parameter "${key}" in "${descriptor.keyword}" block "${blockName}" was rejected by codec "${param.codecId}": ${reason}`,
          value.syntax,
        );
      }
      return;
    }
    case 'ref': {
      const identifier = nodeText(value.syntax);
      validateExtensionRef(
        blockName,
        descriptor,
        key,
        param,
        identifier,
        value.syntax,
        namespaceId,
        resolver,
        context,
      );
      return;
    }
    case 'list': {
      const array = ArrayLiteralAst.cast(value.syntax);
      if (!array) return;
      for (const item of array.elements()) {
        validateExtensionParam(
          blockName,
          descriptor,
          key,
          param.of,
          item,
          namespaceId,
          resolver,
          context,
        );
      }
      return;
    }
  }
}

function validateExtensionRef(
  blockName: string,
  descriptor: AuthoringPslBlockDescriptor,
  key: string,
  param: Extract<PslBlockParam, { kind: 'ref' }>,
  identifier: string,
  node: SyntaxNode,
  namespaceId: string,
  resolver: Resolver,
  context: ExtensionValidationContext,
): void {
  if (param.scope === 'cross-space') return;

  const found =
    param.scope === 'same-namespace'
      ? declaredKindInNamespace(context.nameTable, namespaceId, identifier, param.refKind)
      : declaredKindAcrossNamespaces(context.nameTable, identifier) === param.refKind;

  if (!found) {
    const scopeLabel =
      param.scope === 'same-namespace' ? 'the same namespace' : 'any namespace in the schema';
    resolver.diagnostic(
      'PSL_EXTENSION_UNRESOLVED_REF',
      `Parameter "${key}" in "${descriptor.keyword}" block "${blockName}" refers to "${identifier}" (expected ${param.refKind}), but no entity with that name and kind was found in ${scopeLabel}.`,
      node,
    );
  }
}

function declaredKindInNamespace(
  nameTable: NameTable,
  namespaceId: string,
  name: string,
  refKind: string,
): boolean {
  return nameTable.byNamespace.get(namespaceId)?.get(name) === refKind;
}

function nodeText(node: SyntaxNode): string {
  if (node.kind === 'Identifier') return IdentifierAst.cast(node)?.token()?.text ?? '';
  let text = '';
  for (const token of node.tokens()) {
    text += token.text;
  }
  return text;
}

function reconstructSource(root: SyntaxNode): string {
  let text = '';
  for (const token of root.tokens()) {
    text += token.text;
  }
  return text;
}
