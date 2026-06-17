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
import { ifDefined } from '@prisma-next/utils/defined';
import type { ParseDiagnostic } from './parse';
import type { MutableScope, NameTable } from './scope-table';
import { buildNameTable, symbolTarget, unresolvedBareNameMessage } from './scope-table';
import type { Range, SourceFile } from './source-file';
import type { FieldAttributeAst, ModelAttributeAst } from './syntax/ast/attributes';
import type {
  CompositeTypeDeclarationAst,
  DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
} from './syntax/ast/declarations';
import {
  ArrayLiteralAst,
  type ExpressionAst,
  StringLiteralExprAst,
} from './syntax/ast/expressions';
import { IdentifierAst } from './syntax/ast/identifier';
import type { QualifiedNameAst } from './syntax/ast/qualified-name';
import type { TypeAnnotationAst } from './syntax/ast/type-annotation';
import type { SyntaxNode } from './syntax/red';

/**
 * Inputs the resolve pass needs. `pslBlockDescriptors` and `codecLookup` are
 * optional: with no descriptors registered, generic blocks in the document are
 * recorded structurally but no parameter-level diagnostic runs (the keyword is
 * unrecognised by the resolver); `codecLookup` defaults to
 * {@link emptyCodecLookup}, which rejects every `value`-kind parameter as an
 * unknown codec — callers with `value` parameters must supply a real lookup.
 *
 * `scalarTypes` is required: it is the set of bare type names the target treats
 * as built-in scalars (its `scalarTypeDescriptors` keys). A name in this set
 * resolves to a `scalar` target rather than an `unresolved` reference. The
 * resolver has no built-in fallback — every caller has a target, and the target's
 * concrete scalar list is the single source of truth, so a scalar the target does
 * not declare is (correctly) unresolved.
 */
export interface ResolveOptions {
  readonly scalarTypes: ReadonlySet<string>;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  readonly codecLookup?: CodecLookup;
}

export type DeclKind = 'model' | 'compositeType' | 'namedType';

export interface DeclCoord {
  readonly kind: DeclKind;
  readonly namespaceId: string;
  readonly name: string;
}

export type TypeTarget =
  | { readonly kind: 'scalar'; readonly name: string }
  | { readonly kind: 'ref'; readonly coord: DeclCoord }
  | { readonly kind: 'block'; readonly namespaceId: string; readonly name: string }
  | {
      readonly kind: 'crossSpace';
      readonly spaceId: string;
      readonly namespaceId?: string;
      readonly typeName: string;
    }
  | {
      readonly kind: 'constructor';
      readonly path: readonly string[];
      readonly args: readonly (ExpressionAst | undefined)[];
    }
  | { readonly kind: 'unresolved'; readonly typeName: string };

export interface ResolvedFieldType {
  readonly optional: boolean;
  readonly list: boolean;
  readonly target: TypeTarget;
}

export interface ResolvedArg {
  readonly name?: string;
  readonly value?: ExpressionAst;
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

export interface ResolvedExtensionBlock {
  readonly name: string;
  readonly namespaceId: string;
  readonly syntax: SyntaxNode;
}

/**
 * A named generic block recorded as a type-defining declaration: a field or
 * named-type reference whose name binds here resolves to a `block` {@link TypeTarget}
 * carrying the block's `namespaceId`/`name`, and the consumer reads {@link ResolvedBlockType.keyword}
 * to learn which keyword (`enum`, …) defined the type.
 *
 * The resolver records *every* named generic block here regardless of keyword —
 * it does not gatekeep whether the keyword is valid in field position. That
 * judgement (e.g. `enum` is a field type, but a non-type block is not) belongs to
 * the interpreter, which reads `keyword` off the resolved block-type target.
 */
export interface ResolvedBlockType {
  readonly name: string;
  readonly keyword: string;
  readonly namespaceId: string;
  readonly syntax: GenericBlockDeclarationAst;
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
  readonly compositeTypes: ReadonlyMap<string, ResolvedCompositeType>;
  readonly extensionBlocks: ReadonlyMap<string, ResolvedExtensionBlock>;
  readonly blockTypes: ReadonlyMap<string, ResolvedBlockType>;
  readonly syntax?: NamespaceDeclarationAst;
}

export interface ResolvedDocument {
  readonly namespaces: ReadonlyMap<string, ResolvedNamespace>;
  readonly namedTypes: ReadonlyMap<string, ResolvedNamedType>;
  readonly diagnostics: readonly ParseDiagnostic[];
}

export class Resolver {
  readonly #diagnostics: ParseDiagnostic[] = [];
  readonly #sourceFile: SourceFile;
  readonly #scalarTypes: ReadonlySet<string>;

  constructor(sourceFile: SourceFile, scalarTypes: ReadonlySet<string>) {
    this.#sourceFile = sourceFile;
    this.#scalarTypes = scalarTypes;
  }

  get scalarTypes(): ReadonlySet<string> {
    return this.#scalarTypes;
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

    const qn = annotation.name();

    const argList = annotation.argList();
    if (argList) {
      return {
        kind: 'constructor',
        path: qn?.path() ?? [],
        args: [...argList.args()].map((arg) => arg.value()),
      };
    }

    const typeName = qn?.identifier()?.name();
    if (typeName === undefined) return { kind: 'unresolved', typeName: '' };

    const spaceName = qn?.space()?.name();
    if (spaceName !== undefined) {
      const namespaceName = qn?.namespace()?.name();
      return namespaceName === undefined
        ? { kind: 'crossSpace', spaceId: spaceName, typeName }
        : { kind: 'crossSpace', spaceId: spaceName, namespaceId: namespaceName, typeName };
    }

    // A qualified `ns.Type` must resolve against the named namespace `ns` — even
    // when `Type` matches a built-in scalar name. The bare-name scalar shortcut
    // below runs only after the qualifier branch, so `ns.String` does not bind to
    // the scalar `String` and skip the namespace lookup.
    const qualifier = qn?.namespace()?.name();
    if (qualifier !== undefined) {
      const symbol = nameTable.scopes.get(qualifier)?.get(typeName);
      if (symbol !== undefined) {
        return symbolTarget(symbol, qualifier, typeName);
      }
      // An over-qualified annotation (e.g. `a.b.Bar`) was already flagged by
      // `parse` with `PSL_INVALID_QUALIFIED_NAME`; re-reporting it here as an
      // unresolved reference would double-diagnose a single malformed type.
      if (!(qn?.isOverQualified() ?? false)) {
        this.diagnostic(
          'PSL_UNRESOLVED_TYPE_REFERENCE',
          `Type "${qualifier}.${typeName}" does not resolve to a known declaration`,
          annotation.syntax,
        );
      }
      return { kind: 'unresolved', typeName };
    }

    if (this.#scalarTypes.has(typeName)) {
      return { kind: 'scalar', name: typeName };
    }

    if (nameTable.namedTypes.has(typeName)) {
      return {
        kind: 'ref',
        coord: { kind: 'namedType', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: typeName },
      };
    }

    return this.#resolveBareName(typeName, currentNamespaceId, nameTable, annotation);
  }

  // Bare name: the current namespace, then the ambient (top-level) one. A
  // kind-ful declaration outranks a same-named block across both scopes (a model
  // in the ambient scope binds before a block in the current one), preserving the
  // legacy decl-before-block precedence. A name found in no allowed scope is an
  // unresolved reference.
  #resolveBareName(
    typeName: string,
    currentNamespaceId: string,
    nameTable: NameTable,
    annotation: TypeAnnotationAst,
  ): TypeTarget {
    const currentSymbol = nameTable.scopes.get(currentNamespaceId)?.get(typeName);
    const ambientSymbol =
      currentNamespaceId === UNSPECIFIED_PSL_NAMESPACE_ID
        ? undefined
        : nameTable.scopes.get(UNSPECIFIED_PSL_NAMESPACE_ID)?.get(typeName);

    if (currentSymbol !== undefined && currentSymbol.kind !== 'block') {
      return symbolTarget(currentSymbol, currentNamespaceId, typeName);
    }
    if (ambientSymbol !== undefined && ambientSymbol.kind !== 'block') {
      return symbolTarget(ambientSymbol, UNSPECIFIED_PSL_NAMESPACE_ID, typeName);
    }
    if (currentSymbol?.kind === 'block') {
      return { kind: 'block', namespaceId: currentNamespaceId, name: typeName };
    }
    if (ambientSymbol?.kind === 'block') {
      return { kind: 'block', namespaceId: UNSPECIFIED_PSL_NAMESPACE_ID, name: typeName };
    }

    this.diagnostic(
      'PSL_UNRESOLVED_TYPE_REFERENCE',
      unresolvedBareNameMessage(typeName, currentNamespaceId, nameTable),
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

function attributeName(qualified: QualifiedNameAst | undefined): string | undefined {
  const baseName = qualified?.identifier()?.name();
  if (baseName === undefined) return undefined;
  const namespaceName = qualified?.namespace()?.name();
  return namespaceName === undefined ? baseName : `${namespaceName}.${baseName}`;
}

function resolveFieldAttributes(attributes: Iterable<FieldAttributeAst>): ResolvedAttribute[] {
  const result: ResolvedAttribute[] = [];
  for (const attribute of attributes) {
    const name = attributeName(attribute.name());
    if (name === undefined) continue;
    result.push(new ResolvedAttribute(name, collectArgs(attribute.argList()), attribute));
  }
  return result;
}

function resolveModelAttributes(attributes: Iterable<ModelAttributeAst>): ResolvedAttribute[] {
  const result: ResolvedAttribute[] = [];
  for (const attribute of attributes) {
    const name = attributeName(attribute.name());
    if (name === undefined) continue;
    result.push(new ResolvedAttribute(name, collectArgs(attribute.argList()), attribute));
  }
  return result;
}

function collectArgs(argList: { args(): Iterable<ArgLike> } | undefined): ResolvedArg[] {
  const args: ResolvedArg[] = [];
  for (const arg of argList?.args() ?? []) {
    const value = arg.value();
    const name = arg.name()?.name();
    args.push({ ...ifDefined('name', name), ...ifDefined('value', value) });
  }
  return args;
}

interface ArgLike {
  name(): IdentifierAst | undefined;
  value(): ExpressionAst | undefined;
}

/**
 * Resolves a parsed {@link DocumentAst} into the kind-ful {@link ResolvedDocument}.
 * The `sourceFile` is the one {@link parse} already built ({@link ParseResult.sourceFile});
 * passing it in lets every diagnostic {@link Range} be derived from the real
 * source positions rather than reconstructing the text from the green tree.
 */
export function resolve(
  document: DocumentAst,
  sourceFile: SourceFile,
  options: ResolveOptions,
): ResolvedDocument {
  const resolver = new Resolver(sourceFile, options.scalarTypes);
  const descriptorsByKeyword = collectBlockDescriptors(options.pslBlockDescriptors);
  const codecLookup = options.codecLookup ?? emptyCodecLookup;

  const { nameTable, scopes, scopeOrder, namedTypeDecls } = buildNameTable(document, resolver);

  const extensionContext: ExtensionValidationContext = {
    descriptorsByKeyword,
    codecLookup,
    nameTable,
  };

  const namespaces = new Map<string, ResolvedNamespace>();
  for (const id of scopeOrder) {
    const scope = scopes.get(id);
    if (!scope) continue;
    namespaces.set(id, buildNamespace(scope, nameTable, resolver, extensionContext));
  }

  const namedTypes = new Map<string, ResolvedNamedType>();
  for (const declaration of namedTypeDecls) {
    const name = declaration.name()?.name();
    if (name === undefined || namedTypes.has(name)) continue;
    const annotation = declaration.typeAnnotation();
    // Resolve the annotation once and reuse its `target`; resolving via both
    // `resolveFieldType` and `resolveTypeTarget` would re-bind the same
    // reference and emit a duplicate `PSL_UNRESOLVED_TYPE_REFERENCE`.
    const type = resolver.resolveFieldType(annotation, UNSPECIFIED_PSL_NAMESPACE_ID, nameTable);
    namedTypes.set(name, {
      name,
      type,
      target: type.target,
      attributes: resolveFieldAttributes(declaration.attributes()),
      syntax: declaration,
    });
  }

  validateNamedTypeCollisions(namedTypeDecls, nameTable, resolver);

  return { namespaces, namedTypes, diagnostics: resolver.diagnostics };
}

function buildNamespace(
  scope: MutableScope,
  nameTable: NameTable,
  resolver: Resolver,
  extensionContext: ExtensionValidationContext,
): ResolvedNamespace {
  // Models, composites, and block types all come straight from the scope's
  // symbols — already deduped and source-ordered — so the resolved namespace
  // agrees with the name table by construction; no second pass re-derives them.
  const models = new Map<string, ResolvedModel>();
  const compositeTypes = new Map<string, ResolvedCompositeType>();
  const blockTypes = new Map<string, ResolvedBlockType>();
  for (const [name, symbol] of scope.symbols) {
    if (symbol.kind === 'model') {
      models.set(name, {
        name,
        namespaceId: scope.id,
        fields: buildFields(symbol.node.fields(), scope.id, nameTable, resolver),
        attributes: resolveModelAttributes(symbol.node.attributes()),
        syntax: symbol.node,
      });
    } else if (symbol.kind === 'compositeType') {
      compositeTypes.set(name, {
        name,
        namespaceId: scope.id,
        fields: buildFields(symbol.node.fields(), scope.id, nameTable, resolver),
        attributes: resolveModelAttributes(symbol.node.attributes()),
        syntax: symbol.node,
      });
    } else {
      blockTypes.set(name, {
        name,
        keyword: symbol.keyword,
        namespaceId: scope.id,
        syntax: symbol.node,
      });
    }
  }

  // Extension-block validation runs over every generic block, independent of the
  // declaration name-space: a block that lost a name collision is still validated.
  const extensionBlocks = new Map<string, ResolvedExtensionBlock>();
  for (const block of scope.genericBlocks) {
    const keyword = block.keyword()?.text;
    if (keyword === undefined) continue;
    const descriptor = extensionContext.descriptorsByKeyword.get(keyword);
    if (descriptor === undefined) {
      // A generic block whose keyword no registered descriptor claims is an
      // unsupported top-level block — the resolve-pass counterpart of the legacy
      // parser's verbatim diagnostic, kept identical so callers see one message.
      resolver.diagnostic(
        'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        `Unsupported top-level block "${keyword}"`,
        block.syntax,
      );
      continue;
    }
    const name = block.name()?.name();
    if (name === undefined) continue;
    validateExtensionBlockParams(block, name, descriptor, scope.id, resolver, extensionContext);
    if (extensionBlocks.has(name)) continue;
    extensionBlocks.set(name, { name, namespaceId: scope.id, syntax: block.syntax });
  }

  return {
    id: scope.id,
    models,
    compositeTypes,
    extensionBlocks,
    blockTypes,
    ...(scope.syntax ? { syntax: scope.syntax } : {}),
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
    const name = field.name()?.name();
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
 * Cross-kind named-type collision: a named type whose name matches a scalar or a
 * model declared anywhere in the document. Matches the old parser's verbatim
 * messages and its scalar → model precedence (first match wins, one diagnostic
 * per colliding named type). Distinct from the same-name duplicate-declaration
 * collision detected while collecting the named-type declarations.
 */
function validateNamedTypeCollisions(
  namedTypeDecls: readonly NamedTypeDeclarationAst[],
  nameTable: NameTable,
  resolver: Resolver,
): void {
  const seen = new Set<string>();
  for (const declaration of namedTypeDecls) {
    const name = declaration.name()?.name();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    if (resolver.scalarTypes.has(name)) {
      resolver.diagnostic(
        'PSL_INVALID_TYPES_MEMBER',
        `Named type "${name}" conflicts with scalar type "${name}"`,
        declaration.syntax,
      );
      continue;
    }
    if (hasDeclaredKindAcrossNamespaces(nameTable, name, 'model')) {
      resolver.diagnostic(
        'PSL_INVALID_TYPES_MEMBER',
        `Named type "${name}" conflicts with model name "${name}"`,
        declaration.syntax,
      );
    }
  }
}

/**
 * Whether any namespace declares `name` with the given kind. Checks every
 * namespace rather than returning the first name hit, so a model in one namespace
 * is still found when an earlier namespace declares a different-kind symbol of the
 * same name (and vice versa). Block symbols never match (their kind is `block`,
 * never a {@link DeclKind} a ref param expects).
 */
function hasDeclaredKindAcrossNamespaces(
  nameTable: NameTable,
  name: string,
  expectedKind: string,
): boolean {
  for (const scope of nameTable.scopes.values()) {
    if (scope.get(name)?.kind === expectedKind) return true;
  }
  return false;
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
 * Validates extension block parameters (unknown / missing-required / option-out-of-set /
 * invalid-value / unresolved-ref) plus first-occurrence-wins duplicate detection
 * over the parsed entries.
 */
function validateExtensionBlockParams(
  block: GenericBlockDeclarationAst,
  blockName: string,
  descriptor: AuthoringPslBlockDescriptor,
  namespaceId: string,
  resolver: Resolver,
  context: ExtensionValidationContext,
): void {
  const entries = new Map<string, KeyValuePairAst>();
  for (const entry of block.entries()) {
    const key = entry.key()?.name();
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
      if (!array) {
        resolver.diagnostic(
          'PSL_EXTENSION_INVALID_VALUE',
          `Parameter "${key}" in "${descriptor.keyword}" block "${blockName}" must be a list.`,
          value.syntax,
        );
        return;
      }
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
      : hasDeclaredKindAcrossNamespaces(context.nameTable, identifier, param.refKind);

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
  return nameTable.scopes.get(namespaceId)?.get(name)?.kind === refKind;
}

function nodeText(node: SyntaxNode): string {
  if (node.kind === 'Identifier') return IdentifierAst.cast(node)?.token()?.text ?? '';
  let text = '';
  for (const token of node.tokens()) {
    text += token.text;
  }
  return text;
}
