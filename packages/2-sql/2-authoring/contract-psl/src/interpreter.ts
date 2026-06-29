import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@prisma-next/config/config-types';
import type {
  Contract,
  ContractField,
  ContractModel,
  ContractValueObject,
  ControlPolicy,
} from '@prisma-next/contract/types';
import { crossRef } from '@prisma-next/contract/types';
import type {
  AuthoringContributions,
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringPslBlockDescriptorNamespace,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import {
  instantiateAuthoringEntityType,
  isAuthoringEntityTypeDescriptor,
  isAuthoringPslBlockDescriptor,
} from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ControlMutationDefaultRegistry,
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from '@prisma-next/framework-components/control';
import {
  type BlockSymbol,
  type CompositeTypeSymbol,
  type FieldSymbol,
  keywordPslSpan,
  type ModelSymbol,
  type NamespaceSymbol,
  nodePslSpan,
  type ResolvedAttribute,
  type ScalarSymbol,
  type SymbolTable,
  type TypeAliasSymbol,
} from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import type {
  SqlModelStorage,
  SqlNamespaceBase,
  SqlNamespaceInput,
} from '@prisma-next/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type EnumTypeHandle,
  type FieldNode,
  type ForeignKeyNode,
  type IndexNode,
  type ModelNode,
  type PrimaryKeyNode,
  type RelationNode,
  type UniqueConstraintNode,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { invariant } from '@prisma-next/utils/assertions';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';

import {
  findDuplicateFieldName,
  getAttribute,
  getNamedArgument,
  getPositionalArgument,
  mapFieldNamesToColumns,
  parseAttributeFieldList,
  parseConstraintMapArgument,
  parseControlPolicyAttribute,
  parseObjectLiteralStringMap,
  parseQuotedStringLiteral,
} from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import {
  checkUncomposedNamespace,
  getAuthoringEntity,
  reportUncomposedNamespace,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';
import {
  buildModelMappings,
  collectResolvedFields,
  type ModelNameMapping,
  type ModelNamespaceEntry,
  modelCoordinateKey,
  type ResolvedField,
} from './psl-field-resolution';
import { resolveNamedTypeDeclarations } from './psl-named-type-resolution';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  interpretRelationAttribute,
  type ModelBackrelationCandidate,
  normalizeReferentialAction,
  validateNavigationListFieldAttributes,
} from './psl-relation-resolution';

type NamedTypeSymbol = ScalarSymbol | TypeAliasSymbol;

export interface InterpretPslDocumentToSqlContractInput {
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensionPacks?: readonly string[];
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', string>[];
  readonly controlMutationDefaults?: ControlMutationDefaults;
  readonly authoringContributions?: AuthoringContributions;
  /**
   * Extension contracts keyed by space ID. Required for cross-space FK
   * resolution. A composed space must have an entry here; if the space ID
   * appears in `composedExtensionPacks` but is absent from this map, the
   * interpreter emits `PSL_UNKNOWN_CONTRACT_SPACE` and fails fast — there
   * is no silent fallback. If a space's contract is present but the
   * referenced model or namespace is not found in it, the interpreter
   * emits `PSL_UNKNOWN_CROSS_SPACE_TARGET`.
   */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  /** Target-supplied factory that materialises a `SqlNamespaceBase` concretion for each namespace coordinate. */
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly codecLookup?: CodecLookup;
  readonly seedDiagnostics?: readonly ContractSourceDiagnostic[];
}

function buildComposedExtensionPackRefs(
  target: TargetPackRef<'sql', string>,
  extensionIds: readonly string[],
  extensionPackRefs: readonly ExtensionPackRef<'sql', string>[] = [],
): Record<string, ExtensionPackRef<'sql', string>> | undefined {
  if (extensionIds.length === 0) {
    return undefined;
  }

  const extensionPackRefById = new Map(extensionPackRefs.map((packRef) => [packRef.id, packRef]));

  return Object.fromEntries(
    extensionIds.map((extensionId) => [
      extensionId,
      extensionPackRefById.get(extensionId) ??
        ({
          kind: 'extension',
          id: extensionId,
          familyId: target.familyId,
          targetId: target.targetId,
          version: '0.0.1',
        } satisfies ExtensionPackRef<'sql', string>),
    ]),
  );
}

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Name of the framework-parser synthesised bucket for top-level
 * declarations. Re-declared here so the per-target dispatch does not
 * have to import from `@prisma-next/framework-components/psl-ast`
 * (which would cross a layer that the interpreter does not otherwise
 * import from). The value is part of the framework parser's contract;
 * if it changes there, the matching test in this package's
 * `interpreter.diagnostics.test.ts` flips first.
 */
const UNSPECIFIED_PSL_NAMESPACE_NAME = '__unspecified__';

/**
 * Per-target namespace-block validation: walk the AST's namespace buckets and
 * emit diagnostics for syntactic constructs the target does not accept.
 *
 * - **SQLite** has no schema concept and rejects every explicit
 *   `namespace { … }` block. The implicit `__unspecified__` bucket
 *   (produced by the parser for top-level declarations outside any
 *   block) is the only namespace SQLite accepts.
 * - **Postgres** accepts every explicit block — `namespace unbound { … }`
 *   is the late-binding opt-in (lowers to the IR `__unbound__` slot in
 *   a follow-on commit), `namespace public { … }` reopen-merges with
 *   the implicit bucket, and any other name lowers to a named schema.
 *
 * Storage-side lowering of these buckets to IR namespace slots is not
 * yet wired; this helper closes only the diagnostic surface.
 */
/**
 * Per-target namespace lowering: map a PSL AST namespace bucket name to the
 * resolved IR namespace id (the key downstream consumers use against
 * `SqlStorage.namespaces`).
 *
 * - **Postgres**: an explicit `namespace unbound { … }` block lowers
 *   to the framework sentinel `__unbound__` — the slot whose binding
 *   the connection's `search_path` resolves at runtime. Every other
 *   explicit bucket name (e.g. `auth`, `public`) passes through as a
 *   named schema id. The implicit `__unspecified__` bucket — top-level
 *   declarations outside any `namespace { … }` block — leaves the
 *   coordinate unset; downstream consumers treat unset as the
 *   late-bound default, and TS / PSL authoring stay byte-identical
 *   on single-namespace contracts. (A future round will add a
 *   target-default-namespace surface so `__unspecified__` lowers to
 *   `public` consistently on both authoring paths.)
 * - **SQLite**: SQLite has no schema concept; every namespace
 *   collapses to the late-bound default. The namespace-block
 *   validation step (above) has already rejected any explicit
 *   `namespace { … }` block on SQLite, so the only bucket the
 *   lowering ever sees there is `__unspecified__`.
 *
 * Returns `undefined` for targets / bucket names with no explicit
 * namespaceId to assign — callers leave the model's `namespaceId`
 * slot empty (which means the late-bound default at the `StorageTable`
 * layer; emitted JSON omits the field).
 */
function resolveNamespaceIdForSqlTarget(input: {
  readonly bucketName: string;
  readonly targetId: string;
}): string | undefined {
  if (input.targetId !== 'postgres') {
    return undefined;
  }
  if (input.bucketName === UNSPECIFIED_PSL_NAMESPACE_NAME) {
    return 'public';
  }
  if (input.bucketName === 'unbound') {
    return '__unbound__';
  }
  return input.bucketName;
}

function validateNamespaceBlocksForSqlTarget(input: {
  readonly namespaces: readonly NamespaceSymbol[];
  readonly targetId: string;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  if (input.targetId === 'sqlite') {
    for (const namespace of input.namespaces) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        message: `SQLite does not support \`namespace ${namespace.name} { … }\` blocks (SQLite has no schema concept; declare models at the document top level instead).`,
        sourceId: input.sourceId,
        span: nodePslSpan(namespace.node.syntax, input.sourceFile),
      });
    }
    return;
  }

  if (input.targetId === 'postgres') {
    const hasUnbound = input.namespaces.some((ns) => ns.name === 'unbound');
    const hasSibling = input.namespaces.some((ns) => ns.name !== 'unbound');
    if (hasUnbound && hasSibling) {
      const unboundBlock = input.namespaces.find((ns) => ns.name === 'unbound');
      input.diagnostics.push({
        code: 'PSL_RESERVED_NAMESPACE_NAME',
        message:
          'Namespace "unbound" is reserved for the late-binding sentinel mapping and cannot appear alongside other named namespace blocks. ' +
          'Use `namespace unbound { … }` alone (no sibling named namespaces) for late-binding multi-tenant contracts.',
        sourceId: input.sourceId,
        ...(unboundBlock !== undefined
          ? { span: nodePslSpan(unboundBlock.node.syntax, input.sourceFile) }
          : {}),
      });
    }
  }
}

/**
 * Walks the flat `entityTypes` namespace tree in `authoringContributions` and
 * returns a map from discriminator string to the matching descriptor. The
 * interpreter uses this to dispatch parsed extension blocks to their factory
 * without naming any specific discriminator value (generic, by-discriminator).
 */
function buildEntityTypesByDiscriminator(
  contributions: AuthoringContributions | undefined,
): ReadonlyMap<string, AuthoringEntityTypeDescriptor> {
  const result = new Map<string, AuthoringEntityTypeDescriptor>();
  const namespace = contributions?.entityTypes;
  if (namespace === undefined) return result;

  const walk = (node: object): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        result.set(value.discriminator, value);
      } else if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return result;
}

/**
 * For a single PSL namespace, lowers all extension blocks (parsed by
 * `namespacePslExtensionBlocks`) into IR entities via the registered
 * factory for each block's discriminator. Groups results by discriminator
 * (the entries key — one-string rule: discriminator === entries key).
 *
 * This pass is intentionally generic: no discriminator value is named here.
 * The factory (registered by the target pack) owns all block-specific logic.
 *
 * The `namespaceId` is attached to the block before the factory call so the
 * factory can record the namespace coordinate without the interpreter
 * containing any target-specific knowledge about how namespace ids are used.
 */
function lowerExtensionBlocksForNamespace(
  ns: NamespaceSymbol,
  nsId: string,
  entityTypesByDiscriminator: ReadonlyMap<string, AuthoringEntityTypeDescriptor>,
  entityContext: AuthoringEntityContext,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const blockSymbols = Object.values(ns.blocks);
  if (blockSymbols.length === 0) return {};

  const result: Record<string, Record<string, unknown>> = {};

  for (const blockSymbol of blockSymbols) {
    const block = blockSymbol.block;
    const descriptor = entityTypesByDiscriminator.get(block.kind);
    if (descriptor === undefined) continue;

    const annotatedBlock = { ...block, namespaceId: nsId };
    const entity = instantiateAuthoringEntityType(
      descriptor.discriminator,
      descriptor,
      [annotatedBlock],
      entityContext,
    );
    if (entity === undefined) continue;

    const entriesKey = descriptor.discriminator;
    const slot = result[entriesKey] ?? {};
    result[entriesKey] = slot;
    slot[block.name] = entity;
  }

  return result;
}

interface ProcessEnumDeclarationsInput {
  readonly enumBlocks: readonly PslExtensionBlock[];
  readonly sourceId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly entityContext: AuthoringEntityContext;
  readonly diagnostics: ContractSourceDiagnostic[];
}

function processEnumDeclarations(input: ProcessEnumDeclarationsInput): {
  readonly enumHandles: Record<string, EnumTypeHandle>;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
} {
  const enumHandles: Record<string, EnumTypeHandle> = {};
  const enumTypeDescriptors = new Map<string, ColumnDescriptor>();

  if (input.enumBlocks.length === 0) {
    return { enumHandles, enumTypeDescriptors };
  }

  const enumDescriptor = getAuthoringEntity(input.authoringContributions, ['enum']);
  if (!enumDescriptor) {
    for (const decl of input.enumBlocks) {
      input.diagnostics.push({
        code: 'PSL_ENUM_MISSING_FACTORY',
        message: `enum "${decl.name}" requires an "enum" entityType factory in the active authoring contributions`,
        sourceId: input.sourceId,
        span: decl.span,
      });
    }
    return { enumHandles, enumTypeDescriptors };
  }

  for (const decl of input.enumBlocks) {
    const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
      'enum',
      enumDescriptor,
      [decl],
      input.entityContext,
    );

    if (handle === undefined || handle === null) continue;

    enumHandles[decl.name] = handle;
    enumTypeDescriptors.set(decl.name, {
      codecId: handle.codecId,
      nativeType: handle.nativeType,
    });
  }

  return { enumHandles, enumTypeDescriptors };
}

/** Generic top-level blocks are supported only when a composed descriptor claims their keyword. */
function composedBlockKeywords(
  authoringContributions: AuthoringContributions | undefined,
): ReadonlySet<string> {
  const keywords = new Set<string>();
  const descriptors: AuthoringPslBlockDescriptorNamespace =
    authoringContributions?.pslBlockDescriptors ?? {};
  for (const [keyword, value] of Object.entries(descriptors)) {
    if (isAuthoringPslBlockDescriptor(value)) {
      keywords.add(keyword);
    }
  }
  return keywords;
}

interface BuildModelNodeInput {
  readonly model: ModelSymbol;
  readonly mapping: ModelNameMapping;
  readonly modelMappings: ReadonlyMap<string, ModelNameMapping>;
  /**
   * Model mappings keyed by `(namespaceId, modelName)` coordinate. Used to
   * resolve a namespace-qualified relation target (`auth.User`) to the exact
   * model even when the bare name is shared across namespaces.
   */
  readonly modelMappingsByCoordinate: ReadonlyMap<string, ModelNameMapping>;
  readonly modelNames: Set<string>;
  readonly compositeTypeNames: ReadonlySet<string>;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly composedExtensions: Set<string>;
  /** Extension contracts keyed by space ID for cross-space FK table-name resolution. */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly diagnostics: ContractSourceDiagnostic[];
  /** Resolved namespace id keyed by model name — used to stamp the target namespace on FKs. */
  readonly modelNamespaceIds: ReadonlyMap<string, string>;
  readonly enumHandles?: ReadonlyMap<string, EnumTypeHandle>;
}

interface BuildModelNodeResult {
  readonly modelNode: ModelNode;
  readonly fkRelationMetadata: FkRelationMetadata[];
  readonly backrelationCandidates: ModelBackrelationCandidate[];
  readonly resolvedFields: readonly ResolvedField[];
  /** Cross-contract-space relation nodes that bypass the local back-relation matching. */
  readonly crossSpaceRelations: RelationNode[];
}

function buildModelNodeFromPsl(input: BuildModelNodeInput): BuildModelNodeResult {
  const { model, mapping, sourceId, diagnostics } = input;
  const tableName = mapping.tableName;

  const resolvedFields = collectResolvedFields({
    model,
    mapping,
    enumTypeDescriptors: input.enumTypeDescriptors,
    namedTypeDescriptors: input.namedTypeDescriptors,
    modelNames: input.modelNames,
    compositeTypeNames: input.compositeTypeNames,
    composedExtensions: input.composedExtensions,
    authoringContributions: input.authoringContributions,
    familyId: input.familyId,
    targetId: input.targetId,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorDescriptorById: input.generatorDescriptorById,
    diagnostics,
    sourceId,
    scalarTypeDescriptors: input.scalarTypeDescriptors,
    ...ifDefined('enumHandles', input.enumHandles),
  });

  const inlineIdFields = resolvedFields.filter((field) => field.isId);
  if (inlineIdFields.length > 1) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `Model "${model.name}" cannot declare inline @id on multiple fields; use model-level @@id([...]) for composite identity`,
      sourceId,
      span: model.span,
    });
  }
  const singleInlineIdField = inlineIdFields.length === 1 ? inlineIdFields[0] : undefined;
  let primaryKey: PrimaryKeyNode | undefined = singleInlineIdField
    ? {
        columns: [singleInlineIdField.columnName],
        ...ifDefined('name', singleInlineIdField.idName),
      }
    : undefined;
  const hasInlinePrimaryKey = primaryKey !== undefined;
  let blockPrimaryKeyDeclared = false;
  let controlPolicyDeclared = false;
  let controlPolicy: ControlPolicy | undefined;

  const resultBackrelationCandidates: ModelBackrelationCandidate[] = [];
  for (const field of Object.values(model.fields)) {
    if (!field.list || !input.modelNames.has(field.typeName)) {
      continue;
    }
    const attributesValid = validateNavigationListFieldAttributes({
      modelName: model.name,
      field,
      sourceId,
      composedExtensions: input.composedExtensions,
      authoringContributions: input.authoringContributions,
      diagnostics,
      familyId: input.familyId,
      targetId: input.targetId,
    });
    const relationAttribute = getAttribute(field.attributes, 'relation');
    let relationName: string | undefined;
    if (relationAttribute) {
      const parsedRelation = interpretRelationAttribute({
        selfModel: model,
        field,
        symbols: input.symbolTable,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (parsedRelation.fields || parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Backrelation list field "${model.name}.${field.name}" cannot declare fields/references; define them on the FK-side relation field`,
          sourceId,
          span: relationAttribute.span,
        });
        continue;
      }
      if (parsedRelation.onDelete || parsedRelation.onUpdate) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Backrelation list field "${model.name}.${field.name}" cannot declare onDelete/onUpdate; define referential actions on the FK-side relation field`,
          sourceId,
          span: relationAttribute.span,
        });
        continue;
      }
      relationName = parsedRelation.relationName;
    }
    if (!attributesValid) {
      continue;
    }

    resultBackrelationCandidates.push({
      modelName: model.name,
      tableName,
      field,
      targetModelName: field.typeName,
      ...ifDefined('relationName', relationName),
    });
  }

  const relationAttributes = Object.values(model.fields)
    .map((field) => ({
      field,
      relation: getAttribute(field.attributes, 'relation'),
    }))
    .filter((entry): entry is { field: FieldSymbol; relation: ResolvedAttribute } =>
      Boolean(entry.relation),
    );
  const uniqueConstraints: UniqueConstraintNode[] = resolvedFields
    .filter((field) => field.isUnique)
    .map((field) => ({
      columns: [field.columnName],
      ...ifDefined('name', field.uniqueName),
    }));
  const indexNodes: IndexNode[] = [];
  const foreignKeyNodes: ForeignKeyNode[] = [];

  for (const modelAttribute of model.attributes) {
    if (modelAttribute.name === 'map') {
      continue;
    }
    if (modelAttribute.name === 'discriminator' || modelAttribute.name === 'base') {
      continue;
    }
    if (modelAttribute.name === 'control') {
      if (controlPolicyDeclared) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_ATTRIBUTE',
          message: `\`@@control\` declared more than once on model "${model.name}".`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      controlPolicyDeclared = true;
      const parsed = parseControlPolicyAttribute({
        attribute: modelAttribute,
        sourceId,
        diagnostics,
      });
      if (parsed !== undefined) {
        controlPolicy = parsed;
      }
      continue;
    }
    const attributeLabel = `Model "${model.name}" @@${modelAttribute.name}`;
    if (modelAttribute.name === 'id') {
      if (blockPrimaryKeyDeclared) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Model "${model.name}" declares @@id more than once`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      if (hasInlinePrimaryKey) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Model "${model.name}" cannot declare both field-level @id and model-level @@id`,
          sourceId,
          span: modelAttribute.span,
        });
        blockPrimaryKeyDeclared = true;
        continue;
      }
      const fieldNames = parseAttributeFieldList({
        attribute: modelAttribute,
        sourceId,
        diagnostics,
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        entityLabel: attributeLabel,
      });
      if (!fieldNames) {
        continue;
      }
      const duplicateFieldName = findDuplicateFieldName(fieldNames);
      if (duplicateFieldName !== undefined) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `${attributeLabel} list contains duplicate field "${duplicateFieldName}"`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      const nullableFieldName = fieldNames.find((name) => model.fields[name]?.optional === true);
      if (nullableFieldName !== undefined) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `${attributeLabel} cannot include optional field "${nullableFieldName}"; primary key columns must be NOT NULL`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      const columnNames = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames,
        mapping,
        sourceId,
        diagnostics,
        span: modelAttribute.span,
        entityLabel: attributeLabel,
      });
      if (!columnNames) {
        continue;
      }
      const constraintName = parseConstraintMapArgument({
        attribute: modelAttribute,
        sourceId,
        diagnostics,
        entityLabel: attributeLabel,
        span: modelAttribute.span,
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      });
      primaryKey = {
        columns: columnNames,
        ...ifDefined('name', constraintName),
      };
      blockPrimaryKeyDeclared = true;
      continue;
    }
    if (modelAttribute.name === 'unique' || modelAttribute.name === 'index') {
      const fieldNames = parseAttributeFieldList({
        attribute: modelAttribute,
        sourceId,
        diagnostics,
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        entityLabel: attributeLabel,
      });
      if (!fieldNames) {
        continue;
      }
      const duplicateFieldName = findDuplicateFieldName(fieldNames);
      if (duplicateFieldName !== undefined) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `${attributeLabel} list contains duplicate field "${duplicateFieldName}"`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      const columnNames = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames,
        mapping,
        sourceId,
        diagnostics,
        span: modelAttribute.span,
        entityLabel: attributeLabel,
      });
      if (!columnNames) {
        continue;
      }
      const constraintName = parseConstraintMapArgument({
        attribute: modelAttribute,
        sourceId,
        diagnostics,
        entityLabel: attributeLabel,
        span: modelAttribute.span,
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      });
      if (modelAttribute.name === 'unique') {
        uniqueConstraints.push({
          columns: columnNames,
          ...ifDefined('name', constraintName),
        });
      } else {
        const indexEntityLabel = `Model "${model.name}" @@index`;
        const rawTypeArg = getNamedArgument(modelAttribute, 'type');
        let indexType: string | undefined;
        if (rawTypeArg !== undefined) {
          const parsed = parseQuotedStringLiteral(rawTypeArg);
          if (parsed === undefined) {
            diagnostics.push({
              code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
              message: `${indexEntityLabel} type argument must be a quoted string literal`,
              sourceId,
              span: modelAttribute.span,
            });
            continue;
          }
          indexType = parsed;
        }
        const rawOptionsArg = getNamedArgument(modelAttribute, 'options');
        let indexOptions: Record<string, string> | undefined;
        if (rawOptionsArg !== undefined) {
          if (indexType === undefined) {
            diagnostics.push({
              code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
              message: `${indexEntityLabel} options argument requires a type argument`,
              sourceId,
              span: modelAttribute.span,
            });
            continue;
          }
          const parsed = parseObjectLiteralStringMap({
            raw: rawOptionsArg,
            diagnostics,
            sourceId,
            span: modelAttribute.span,
            entityLabel: indexEntityLabel,
          });
          if (parsed === undefined) {
            continue;
          }
          indexOptions = parsed;
        }
        indexNodes.push({
          columns: columnNames,
          ...ifDefined('name', constraintName),
          ...ifDefined('type', indexType),
          ...ifDefined('options', indexOptions),
        });
      }
      continue;
    }
    const uncomposedNamespace = checkUncomposedNamespace(
      modelAttribute.name,
      input.composedExtensions,
      {
        familyId: input.familyId,
        targetId: input.targetId,
        authoringContributions: input.authoringContributions,
      },
    );
    if (uncomposedNamespace) {
      reportUncomposedNamespace({
        subjectLabel: `Attribute "@@${modelAttribute.name}"`,
        namespace: uncomposedNamespace,
        sourceId,
        span: modelAttribute.span,
        diagnostics,
      });
      continue;
    }
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      message: `Model "${model.name}" uses unsupported attribute "@@${modelAttribute.name}"`,
      sourceId,
      span: modelAttribute.span,
    });
  }

  const resultFkRelationMetadata: FkRelationMetadata[] = [];
  const resultCrossSpaceRelations: RelationNode[] = [];
  for (const relationAttribute of relationAttributes) {
    const {
      typeName: fieldTypeName,
      typeNamespaceId: fieldTypeNamespaceId,
      typeContractSpaceId: fieldTypeContractSpaceId,
    } = relationAttribute.field;

    if (relationAttribute.field.list) {
      // F-list: cross-space list relations are explicitly unsupported (Option B does not
      // navigate, so a list target makes no sense to carry). Emit a diagnostic instead of
      // silently dropping the field — the author needs to know the field was ignored.
      if (fieldTypeContractSpaceId !== undefined) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_CROSS_SPACE_LIST',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" is a cross-space list relation (type "${fieldTypeContractSpaceId}:${fieldTypeNamespaceId !== undefined ? `${fieldTypeNamespaceId}.` : ''}${fieldTypeName}[]"). Cross-space relations must be singular in v0.1 — list cross-space relations are not supported.`,
          sourceId,
          span: relationAttribute.field.span,
        });
      }
      continue;
    }

    // Cross-contract-space relation: the target model lives in a different contract space
    // identified by `typeContractSpaceId` (e.g. `supabase:auth.User`).
    if (fieldTypeContractSpaceId !== undefined) {
      // Fail fast if the space has no entry in composedExtensionContracts (AC5 PSL half).
      const extContractForSpace = input.composedExtensionContracts.get(fieldTypeContractSpaceId);
      if (extContractForSpace === undefined) {
        diagnostics.push({
          code: 'PSL_UNKNOWN_CONTRACT_SPACE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" references contract space "${fieldTypeContractSpaceId}" which is not declared in extensionPacks. Add "${fieldTypeContractSpaceId}" to extensionPacks in prisma-next.config.ts.`,
          sourceId,
          span: relationAttribute.field.span,
          data: { space: fieldTypeContractSpaceId, suggestedPack: fieldTypeContractSpaceId },
        });
        continue;
      }

      const parsedRelation = interpretRelationAttribute({
        selfModel: model,
        field: relationAttribute.field,
        symbols: input.symbolTable,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (!parsedRelation.fields || !parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
          sourceId,
          span: relationAttribute.relation.span,
        });
        continue;
      }

      const localColumns = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames: parsedRelation.fields,
        mapping,
        sourceId,
        diagnostics,
        span: relationAttribute.relation.span,
        entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
      });
      if (!localColumns) {
        continue;
      }

      // For cross-space references the `references` list provides field names from the remote
      // model. Since the interpreter has no access to the extension contract, these field names
      // are treated as column names directly (matching the TS builder's cross-space path).
      const referencedColumns = parsedRelation.references;

      if (localColumns.length !== referencedColumns.length) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" must provide the same number of fields and references`,
          sourceId,
          span: relationAttribute.relation.span,
        });
        continue;
      }

      const onDelete = parsedRelation.onDelete
        ? normalizeReferentialAction({
            modelName: model.name,
            fieldName: relationAttribute.field.name,
            actionName: 'onDelete',
            actionToken: parsedRelation.onDelete,
            sourceId,
            span: relationAttribute.field.span,
            diagnostics,
          })
        : undefined;
      const onUpdate = parsedRelation.onUpdate
        ? normalizeReferentialAction({
            modelName: model.name,
            fieldName: relationAttribute.field.name,
            actionName: 'onUpdate',
            actionToken: parsedRelation.onUpdate,
            sourceId,
            span: relationAttribute.field.span,
            diagnostics,
          })
        : undefined;

      // Target namespace: use the colon-prefix namespace qualifier, or `__unbound__` when the
      // no-namespace form is used (e.g. `supabase:User` → AC3).
      const crossTargetNamespaceId = fieldTypeNamespaceId ?? '__unbound__';

      // Target table name: resolved from the extension contract. The get() check above
      // guarantees extContractForSpace is defined here; if the model or namespace is not
      // found in it, emit PSL_UNKNOWN_CROSS_SPACE_TARGET (user typo).
      const extContract = extContractForSpace;
      const resolvedTable =
        extContract.domain.namespaces[crossTargetNamespaceId]?.models[fieldTypeName]?.storage[
          'table'
        ];
      if (typeof resolvedTable !== 'string') {
        const availableModels =
          Object.keys(extContract.domain.namespaces[crossTargetNamespaceId]?.models ?? {}).join(
            ', ',
          ) || '(none)';
        diagnostics.push({
          code: 'PSL_UNKNOWN_CROSS_SPACE_TARGET',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" references model "${fieldTypeName}" in namespace "${crossTargetNamespaceId}" of space "${fieldTypeContractSpaceId}", but that model was not found in the extension contract. Available models: ${availableModels}`,
          sourceId,
          span: relationAttribute.field.span,
          data: {
            space: fieldTypeContractSpaceId,
            namespace: crossTargetNamespaceId,
            model: fieldTypeName,
          },
        });
        continue;
      }
      const crossTargetTableName = resolvedTable;

      foreignKeyNodes.push({
        columns: localColumns,
        references: {
          model: fieldTypeName,
          table: crossTargetTableName,
          columns: referencedColumns,
          namespaceId: crossTargetNamespaceId,
          spaceId: fieldTypeContractSpaceId,
        },
        ...ifDefined('name', parsedRelation.constraintName),
        ...ifDefined('onDelete', onDelete),
        ...ifDefined('onUpdate', onUpdate),
      });

      // Build the cross-space RelationNode directly (no local back-relation candidate).
      // `buildSqlContractFromDefinition` recognises `spaceId` on a RelationNode and routes it
      // through the cross-space domain-relation path (produces a non-navigable CrossReference).
      resultCrossSpaceRelations.push({
        fieldName: relationAttribute.field.name,
        toModel: fieldTypeName,
        toTable: crossTargetTableName,
        cardinality: 'N:1',
        spaceId: fieldTypeContractSpaceId,
        namespaceId: crossTargetNamespaceId,
        on: {
          parentTable: tableName,
          parentColumns: localColumns,
          childTable: crossTargetTableName,
          childColumns: referencedColumns,
        },
      });

      continue;
    }

    const qualifiedTypeName = fieldTypeNamespaceId
      ? `${fieldTypeNamespaceId}.${fieldTypeName}`
      : fieldTypeName;

    if (!input.modelNames.has(fieldTypeName)) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`,
        sourceId,
        span: relationAttribute.field.span,
      });
      continue;
    }

    const normalizedQualifier =
      fieldTypeNamespaceId === undefined
        ? undefined
        : fieldTypeNamespaceId === 'unbound'
          ? '__unbound__'
          : fieldTypeNamespaceId;
    if (
      normalizedQualifier !== undefined &&
      !input.modelMappingsByCoordinate.has(modelCoordinateKey(normalizedQualifier, fieldTypeName))
    ) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`,
        sourceId,
        span: relationAttribute.field.span,
      });
      continue;
    }

    const parsedRelation = interpretRelationAttribute({
      selfModel: model,
      field: relationAttribute.field,
      symbols: input.symbolTable,
      sourceFile: input.sourceFile,
      sourceId,
      diagnostics,
    });
    if (!parsedRelation) {
      continue;
    }
    if (!parsedRelation.fields || !parsedRelation.references) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
        sourceId,
        span: relationAttribute.relation.span,
      });
      continue;
    }

    const targetMapping =
      normalizedQualifier !== undefined
        ? input.modelMappingsByCoordinate.get(
            modelCoordinateKey(normalizedQualifier, fieldTypeName),
          )
        : input.modelMappings.get(fieldTypeName);
    if (!targetMapping) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`,
        sourceId,
        span: relationAttribute.field.span,
      });
      continue;
    }

    const localColumns = mapFieldNamesToColumns({
      modelName: model.name,
      fieldNames: parsedRelation.fields,
      mapping,
      sourceId,
      diagnostics,
      span: relationAttribute.relation.span,
      entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
    });
    if (!localColumns) {
      continue;
    }
    const referencedColumns = mapFieldNamesToColumns({
      modelName: targetMapping.model.name,
      fieldNames: parsedRelation.references,
      mapping: targetMapping,
      sourceId,
      diagnostics,
      span: relationAttribute.relation.span,
      entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
    });
    if (!referencedColumns) {
      continue;
    }
    if (localColumns.length !== referencedColumns.length) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" must provide the same number of fields and references`,
        sourceId,
        span: relationAttribute.relation.span,
      });
      continue;
    }

    const onDelete = parsedRelation.onDelete
      ? normalizeReferentialAction({
          modelName: model.name,
          fieldName: relationAttribute.field.name,
          actionName: 'onDelete',
          actionToken: parsedRelation.onDelete,
          sourceId,
          span: relationAttribute.field.span,
          diagnostics,
        })
      : undefined;
    const onUpdate = parsedRelation.onUpdate
      ? normalizeReferentialAction({
          modelName: model.name,
          fieldName: relationAttribute.field.name,
          actionName: 'onUpdate',
          actionToken: parsedRelation.onUpdate,
          sourceId,
          span: relationAttribute.field.span,
          diagnostics,
        })
      : undefined;

    const targetNamespaceId =
      normalizedQualifier !== undefined
        ? normalizedQualifier
        : input.modelNamespaceIds.get(targetMapping.model.name);
    foreignKeyNodes.push({
      columns: localColumns,
      references: {
        model: targetMapping.model.name,
        table: targetMapping.tableName,
        columns: referencedColumns,
        ...ifDefined('namespaceId', targetNamespaceId),
      },
      ...ifDefined('name', parsedRelation.constraintName),
      ...ifDefined('onDelete', onDelete),
      ...ifDefined('onUpdate', onUpdate),
    });

    resultFkRelationMetadata.push({
      declaringModelName: model.name,
      declaringFieldName: relationAttribute.field.name,
      declaringTableName: tableName,
      ...ifDefined('declaringNamespaceId', input.modelNamespaceIds.get(model.name)),
      targetModelName: targetMapping.model.name,
      targetTableName: targetMapping.tableName,
      ...ifDefined('targetNamespaceId', targetNamespaceId),
      ...ifDefined('relationName', parsedRelation.relationName),
      localColumns,
      referencedColumns,
    });
  }

  return {
    modelNode: {
      modelName: model.name,
      tableName,
      fields: resolvedFields.map((resolvedField) => {
        const enumHandle = input.enumHandles?.get(resolvedField.field.typeName);
        return {
          fieldName: resolvedField.field.name,
          columnName: resolvedField.columnName,
          descriptor: resolvedField.descriptor,
          nullable: resolvedField.nullable,
          ...ifDefined('default', resolvedField.defaultValue),
          ...ifDefined('executionDefaults', resolvedField.executionDefaults),
          ...ifDefined('enumTypeHandle', enumHandle),
        };
      }),
      ...ifDefined('id', primaryKey),
      ...(uniqueConstraints.length > 0 ? { uniques: uniqueConstraints } : {}),
      ...(indexNodes.length > 0 ? { indexes: indexNodes } : {}),
      ...(foreignKeyNodes.length > 0 ? { foreignKeys: foreignKeyNodes } : {}),
      ...ifDefined('control', controlPolicy),
    },
    fkRelationMetadata: resultFkRelationMetadata,
    crossSpaceRelations: resultCrossSpaceRelations,
    backrelationCandidates: resultBackrelationCandidates,
    resolvedFields,
  };
}

interface BuildValueObjectsInput {
  readonly compositeTypes: readonly CompositeTypeSymbol[];
  readonly enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}

function buildValueObjects(input: BuildValueObjectsInput): Record<string, ContractValueObject> {
  const {
    compositeTypes,
    enumTypeDescriptors,
    namedTypeDescriptors,
    scalarTypeDescriptors,
    composedExtensions,
    familyId,
    targetId,
    authoringContributions,
    diagnostics,
    sourceId,
  } = input;
  const valueObjects: Record<string, ContractValueObject> = {};
  const compositeTypeNames = new Set(compositeTypes.map((ct) => ct.name));

  for (const compositeType of compositeTypes) {
    const fields: Record<string, ContractField> = {};
    for (const field of Object.values(compositeType.fields)) {
      if (compositeTypeNames.has(field.typeName)) {
        const result: ContractField = {
          type: { kind: 'valueObject', name: field.typeName },
          nullable: field.optional,
        };
        fields[field.name] = field.list ? { ...result, many: true } : result;
        continue;
      }
      const resolved = resolveFieldTypeDescriptor({
        field,
        enumTypeDescriptors,
        namedTypeDescriptors,
        scalarTypeDescriptors,
        authoringContributions,
        composedExtensions,
        familyId,
        targetId,
        diagnostics,
        sourceId,
        entityLabel: `Field "${compositeType.name}.${field.name}"`,
      });
      if (!resolved.ok) {
        if (!resolved.alreadyReported) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${compositeType.name}.${field.name}" type "${field.typeName}" is not supported`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      const scalarField: ContractField = {
        nullable: field.optional,
        type: { kind: 'scalar', codecId: resolved.descriptor.codecId },
      };
      fields[field.name] = field.list ? { ...scalarField, many: true } : scalarField;
    }
    valueObjects[compositeType.name] = { fields };
  }

  return valueObjects;
}

function patchModelDomainFields(
  models: Record<string, ContractModel>,
  modelResolvedFields: ReadonlyMap<string, readonly ResolvedField[]>,
): Record<string, ContractModel> {
  let patched = models;

  for (const [modelName, resolvedFields] of modelResolvedFields) {
    const model = patched[modelName];
    if (!model) continue;

    let needsPatch = false;
    const patchedFields: Record<string, ContractField> = { ...model.fields };

    for (const rf of resolvedFields) {
      if (rf.valueObjectTypeName) {
        needsPatch = true;
        patchedFields[rf.field.name] = {
          nullable: rf.field.optional,
          type: { kind: 'valueObject', name: rf.valueObjectTypeName },
          ...(rf.many ? { many: true as const } : {}),
        };
      } else if (rf.many && rf.scalarCodecId) {
        needsPatch = true;
        patchedFields[rf.field.name] = {
          nullable: rf.field.optional,
          type: { kind: 'scalar', codecId: rf.scalarCodecId },
          many: true as const,
        };
      }
    }

    if (needsPatch) {
      patched = { ...patched, [modelName]: { ...model, fields: patchedFields } };
    }
  }

  return patched;
}

type DiscriminatorDeclaration = {
  readonly fieldName: string;
  readonly span: ContractSourceDiagnosticSpan;
};

type BaseDeclaration = {
  readonly baseName: string;
  readonly value: string;
  readonly span: ContractSourceDiagnosticSpan;
};

function collectPolymorphismDeclarations(
  models: readonly ModelSymbol[],
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): {
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
} {
  const discriminatorDeclarations = new Map<string, DiscriminatorDeclaration>();
  const baseDeclarations = new Map<string, BaseDeclaration>();

  for (const model of models) {
    for (const attr of model.attributes) {
      if (attr.name === 'discriminator') {
        const fieldName = getPositionalArgument(attr);
        if (!fieldName) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${model.name}" @@discriminator requires a field name argument`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const discField = model.fields[fieldName];
        if (discField && discField.typeName !== 'String') {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Discriminator field "${fieldName}" on model "${model.name}" must be of type String, but is "${discField.typeName}"`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        discriminatorDeclarations.set(model.name, { fieldName, span: attr.span });
      }

      if (attr.name === 'base') {
        const baseName = getPositionalArgument(attr, 0);
        const rawValue = getPositionalArgument(attr, 1);
        if (!baseName || !rawValue) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${model.name}" @@base requires two arguments: base model name and discriminator value`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        const value = parseQuotedStringLiteral(rawValue);
        if (value === undefined) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Model "${model.name}" @@base discriminator value must be a quoted string literal`,
            sourceId,
            span: attr.span,
          });
          continue;
        }
        baseDeclarations.set(model.name, { baseName, value, span: attr.span });
      }
    }
  }

  return { discriminatorDeclarations, baseDeclarations };
}

function resolvePolymorphism(
  models: Record<string, ContractModel>,
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>,
  baseDeclarations: Map<string, BaseDeclaration>,
  modelNames: Set<string>,
  modelMappings: ReadonlyMap<string, ModelNameMapping>,
  modelNamespaceIds: ReadonlyMap<string, string>,
  defaultNamespaceId: string,
  syntheticPkFieldsByVariant: ReadonlyMap<string, readonly string[]>,
  stiBaseFieldsByBase: ReadonlyMap<string, readonly string[]>,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): Record<string, ContractModel> {
  let patched = models;

  const coordinateFor = (modelName: string): string =>
    modelCoordinateKey(modelNamespaceIds.get(modelName) ?? defaultNamespaceId, modelName);

  // STI variant columns were materialised onto the base storage table so the
  // variants' `storage.fields` resolve. They are storage-only on the base — the
  // domain field belongs to the variant — so strip them from the base model's
  // domain + storage field maps (the table column, built upstream, stays).
  for (const [baseName, fieldNames] of stiBaseFieldsByBase) {
    const baseKey = coordinateFor(baseName);
    const baseModel = patched[baseKey];
    if (!baseModel || fieldNames.length === 0) continue;
    patched = {
      ...patched,
      [baseKey]: stripStorageOnlyDomainFields(baseModel, fieldNames),
    };
  }

  for (const [modelName, decl] of discriminatorDeclarations) {
    if (baseDeclarations.has(modelName)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_AND_BASE',
        message: `Model "${modelName}" cannot have both @@discriminator and @@base`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    const model = patched[coordinateFor(modelName)];
    if (!model) continue;

    if (!Object.hasOwn(model.fields, decl.fieldName)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_FIELD_NOT_FOUND',
        message: `Discriminator field "${decl.fieldName}" is not a field on model "${modelName}"`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    const variants: Record<string, { readonly value: string }> = {};
    const seenValues = new Map<string, string>();

    for (const [variantName, baseDecl] of baseDeclarations) {
      if (baseDecl.baseName !== modelName) continue;

      const existingVariant = seenValues.get(baseDecl.value);
      if (existingVariant) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          message: `Discriminator value "${baseDecl.value}" is used by both "${existingVariant}" and "${variantName}" on base model "${modelName}"`,
          sourceId,
          span: baseDecl.span,
        });
        continue;
      }
      seenValues.set(baseDecl.value, variantName);
      variants[variantName] = { value: baseDecl.value };
    }

    if (Object.keys(variants).length === 0) {
      diagnostics.push({
        code: 'PSL_ORPHANED_DISCRIMINATOR',
        message: `Model "${modelName}" has @@discriminator but no variant models declare @@base(${modelName}, ...)`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    patched = {
      ...patched,
      [coordinateFor(modelName)]: { ...model, discriminator: { field: decl.fieldName }, variants },
    };
  }

  for (const [variantName, baseDecl] of baseDeclarations) {
    if (!modelNames.has(baseDecl.baseName)) {
      diagnostics.push({
        code: 'PSL_BASE_TARGET_NOT_FOUND',
        message: `Model "${variantName}" @@base references non-existent model "${baseDecl.baseName}"`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    if (!discriminatorDeclarations.has(baseDecl.baseName)) {
      diagnostics.push({
        code: 'PSL_ORPHANED_BASE',
        message: `Model "${variantName}" declares @@base(${baseDecl.baseName}, ...) but "${baseDecl.baseName}" has no @@discriminator`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    if (discriminatorDeclarations.has(variantName)) {
      continue;
    }

    const variantModel = patched[coordinateFor(variantName)];
    if (!variantModel) continue;

    const baseMapping = modelMappings.get(baseDecl.baseName);
    const variantMapping = modelMappings.get(variantName);
    const hasExplicitMap =
      variantMapping?.model.attributes.some((attr) => attr.name === 'map') ?? false;
    const resolvedTable = hasExplicitMap ? variantMapping?.tableName : baseMapping?.tableName;

    const patchedVariant: ContractModel = {
      ...variantModel,
      base: crossRef(
        baseDecl.baseName,
        modelNamespaceIds.get(baseDecl.baseName) ?? defaultNamespaceId,
      ),
      ...(resolvedTable ? { storage: { ...variantModel.storage, table: resolvedTable } } : {}),
    };

    patched = {
      ...patched,
      [coordinateFor(variantName)]: stripStorageOnlyDomainFields(
        patchedVariant,
        syntheticPkFieldsByVariant.get(variantName) ?? [],
      ),
    };
  }

  return patched;
}

/**
 * Multi-table-inheritance variants (`@@base` + their own `@@map`) live in a
 * separate table from their base. The ORM joins that table to the base on the
 * shared primary key (`base.id = variant.id`), so the variant storage table
 * must carry the base PK column even though the variant domain model declares
 * only its own fields. This enriches each MTI variant's `ModelNode` with that
 * link column, a primary key on it, and a FK back to the base table.
 *
 * The link column is reported back per variant in `syntheticPkFieldsByVariant`
 * so the domain-model patch can drop it again — keeping the variant's domain
 * surface thin (its create/read inputs don't gain a redundant `id`) while the
 * storage table stays joinable. Single-table-inheritance variants (no own
 * table) are left untouched.
 */
function materializeMtiVariantStorageLinks(
  modelNodes: readonly ModelNode[],
  baseDeclarations: ReadonlyMap<string, BaseDeclaration>,
  stiVariantNames: ReadonlySet<string>,
): { modelNodes: ModelNode[]; syntheticPkFieldsByVariant: Map<string, readonly string[]> } {
  const nodeByModel = new Map(modelNodes.map((node) => [node.modelName, node]));
  const syntheticPkFieldsByVariant = new Map<string, readonly string[]>();

  const enriched = modelNodes.map((node): ModelNode => {
    const baseDecl = baseDeclarations.get(node.modelName);
    if (!baseDecl) return node;
    const baseNode = nodeByModel.get(baseDecl.baseName);
    if (!baseNode) return node;
    // Single-table inheritance (no own `@@map`) shares the base table; it gets
    // its columns materialised onto the base instead (see
    // {@link materializeStiVariantStorageColumns}), never a link column.
    if (stiVariantNames.has(node.modelName)) return node;
    const basePrimaryKey = baseNode.id;
    if (!basePrimaryKey || basePrimaryKey.columns.length === 0) return node;

    const existingColumns = new Set(node.fields.map((field) => field.columnName));
    const linkFields: FieldNode[] = [];
    for (const pkColumn of basePrimaryKey.columns) {
      if (existingColumns.has(pkColumn)) continue;
      const baseField = baseNode.fields.find(
        (field): field is FieldNode => 'descriptor' in field && field.columnName === pkColumn,
      );
      if (!baseField) continue;
      linkFields.push({
        fieldName: baseField.fieldName,
        columnName: pkColumn,
        descriptor: baseField.descriptor,
        nullable: false,
      });
    }
    if (linkFields.length === 0) return node;

    syntheticPkFieldsByVariant.set(
      node.modelName,
      linkFields.map((field) => field.fieldName),
    );

    const foreignKey: ForeignKeyNode = {
      columns: basePrimaryKey.columns,
      references: {
        model: baseNode.modelName,
        table: baseNode.tableName,
        columns: basePrimaryKey.columns,
        ...ifDefined('namespaceId', baseNode.namespaceId),
      },
      constraint: true,
      // The link columns are the variant's own primary key, which already
      // carries a unique index — a separate FK backing index would be redundant.
      index: false,
      // Deleting a base row must delete its variant extension row — classic
      // multi-table-inheritance semantics.
      onDelete: 'cascade',
    };

    return {
      ...node,
      fields: [...linkFields, ...node.fields],
      id: { columns: basePrimaryKey.columns },
      foreignKeys: [...(node.foreignKeys ?? []), foreignKey],
    };
  });

  return { modelNodes: enriched, syntheticPkFieldsByVariant };
}

/**
 * Single-table-inheritance variants (`@@base` with no own `@@map`) share the
 * base table: `resolvePolymorphism` points the variant's `storage.table` at the
 * base, and the ORM reads variant-declared fields straight off the base table.
 * For that to validate and round-trip, the base storage table must physically
 * carry every STI variant's declared columns. This enriches the base
 * `ModelNode` with those columns.
 *
 * The materialised columns are always nullable in storage: the base table hosts
 * every variant's rows, so a column a variant declares as required is still
 * NULL on sibling-variant rows. The variant's domain field keeps its declared
 * nullability — required-in-domain / nullable-in-storage is the intended STI
 * shape.
 *
 * Collisions (two variants declaring the same column, or a variant column name
 * clashing with a base column) are resolved skip-if-exists here, mirroring the
 * MTI link guard; surfacing them as diagnostics is tracked separately
 * (TML-2827).
 */
function materializeStiVariantStorageColumns(
  modelNodes: readonly ModelNode[],
  baseDeclarations: ReadonlyMap<string, BaseDeclaration>,
  stiVariantNames: ReadonlySet<string>,
): { modelNodes: ModelNode[]; stiBaseFieldsByBase: Map<string, readonly string[]> } {
  if (stiVariantNames.size === 0) {
    return { modelNodes: [...modelNodes], stiBaseFieldsByBase: new Map() };
  }

  const nodeByModel = new Map(modelNodes.map((node) => [node.modelName, node]));
  type StiColumn = ModelNode['fields'][number];
  const stiColumnsByBase = new Map<string, StiColumn[]>();

  for (const variantName of stiVariantNames) {
    const variantNode = nodeByModel.get(variantName);
    const baseDecl = baseDeclarations.get(variantName);
    if (!variantNode || !baseDecl) continue;
    const baseNode = nodeByModel.get(baseDecl.baseName);
    if (!baseNode) continue;

    const baseColumns = new Set(baseNode.fields.map((field) => field.columnName));
    const claimed = stiColumnsByBase.get(baseDecl.baseName) ?? [];
    const claimedColumns = new Set(claimed.map((field) => field.columnName));

    for (const field of variantNode.fields) {
      if (baseColumns.has(field.columnName) || claimedColumns.has(field.columnName)) {
        continue;
      }
      claimedColumns.add(field.columnName);
      claimed.push({ ...field, nullable: true });
    }
    stiColumnsByBase.set(baseDecl.baseName, claimed);
  }

  // The materialised columns exist on the base STORAGE table so the variants'
  // `storage.fields` resolve, but they are NOT base DOMAIN fields — `severity`
  // belongs to `Bug`, not to `Task`. Report the materialised field names per
  // base so the domain patch can strip them from the base model (the table
  // column stays); this is the STI analogue of `syntheticPkFieldsByVariant`.
  const stiBaseFieldsByBase = new Map<string, readonly string[]>();
  for (const [baseName, columns] of stiColumnsByBase) {
    stiBaseFieldsByBase.set(
      baseName,
      columns.map((field) => field.fieldName),
    );
  }

  const enriched = modelNodes.map((node): ModelNode => {
    // STI variant: contributes a domain model but no storage table of its own.
    if (stiVariantNames.has(node.modelName)) {
      return { ...node, sharesBaseTable: true };
    }
    const stiColumns = stiColumnsByBase.get(node.modelName);
    if (!stiColumns || stiColumns.length === 0) return node;
    return { ...node, fields: [...node.fields, ...stiColumns] };
  });

  return { modelNodes: enriched, stiBaseFieldsByBase };
}

/**
 * Drop the storage-only link fields (added by
 * {@link materializeMtiVariantStorageLinks}) from a variant's domain model, so
 * the domain surface stays thin while the storage table keeps the link column.
 */
function stripStorageOnlyDomainFields(
  model: ContractModel,
  fieldNames: readonly string[],
): ContractModel {
  if (fieldNames.length === 0) return model;
  const fields = { ...model.fields };
  for (const name of fieldNames) delete fields[name];
  const storage = blindCast<
    SqlModelStorage,
    'SQL interpreter domain models always carry SqlModelStorage'
  >(model.storage);
  const storageFields = { ...storage.fields };
  for (const name of fieldNames) delete storageFields[name];
  return { ...model, fields, storage: { ...storage, fields: storageFields } };
}

export function interpretPslDocumentToSqlContract(
  input: InterpretPslDocumentToSqlContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const sourceId = input.sourceId;
  if (!input.target) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: [
        {
          code: 'PSL_TARGET_CONTEXT_REQUIRED',
          message: 'PSL interpretation requires an explicit target context from composition.',
          sourceId,
        },
      ],
    });
  }
  if (!input.scalarTypeDescriptors) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: [
        {
          code: 'PSL_SCALAR_TYPE_CONTEXT_REQUIRED',
          message: 'PSL interpretation requires composed scalar type descriptors.',
          sourceId,
        },
      ],
    });
  }

  const { topLevel } = input.symbolTable;
  const sourceFile = input.sourceFile;
  const namespaceSymbols = Object.values(topLevel.namespaces);
  const diagnostics: ContractSourceDiagnostic[] = [...(input.seedDiagnostics ?? [])];
  validateNamespaceBlocksForSqlTarget({
    namespaces: namespaceSymbols,
    targetId: input.target.targetId,
    sourceId,
    sourceFile,
    diagnostics,
  });
  const models: ModelSymbol[] = [];
  const modelEntries: ModelNamespaceEntry[] = [];
  const modelNamespaceIds = new Map<string, string>();
  const compositeTypes: CompositeTypeSymbol[] = [];

  const collectScope = (
    bucketName: string,
    scopeModels: Iterable<ModelSymbol>,
    scopeCompositeTypes: Iterable<CompositeTypeSymbol>,
  ): void => {
    const resolvedNamespaceId = resolveNamespaceIdForSqlTarget({
      bucketName,
      targetId: input.target.targetId,
    });
    for (const model of scopeModels) {
      models.push(model);
      modelEntries.push({ model, namespaceId: resolvedNamespaceId });
      if (resolvedNamespaceId !== undefined) {
        modelNamespaceIds.set(model.name, resolvedNamespaceId);
      }
    }
    for (const compositeType of scopeCompositeTypes) {
      compositeTypes.push(compositeType);
    }
  };

  collectScope(
    UNSPECIFIED_PSL_NAMESPACE_NAME,
    Object.values(topLevel.models),
    Object.values(topLevel.compositeTypes),
  );
  for (const namespace of namespaceSymbols) {
    collectScope(
      namespace.name,
      Object.values(namespace.models),
      Object.values(namespace.compositeTypes),
    );
  }
  const defaultNamespaceId = input.target.defaultNamespaceId;

  const modelNames = new Set(models.map((model) => model.name));
  const compositeTypeNames = new Set(compositeTypes.map((ct) => ct.name));
  const composedExtensions = new Set(input.composedExtensionPacks ?? []);
  const composedExtensionContracts: ReadonlyMap<string, Contract> =
    input.composedExtensionContracts;
  const defaultFunctionRegistry: ControlMutationDefaultRegistry =
    input.controlMutationDefaults?.defaultFunctionRegistry ?? new Map();
  const generatorDescriptors = input.controlMutationDefaults?.generatorDescriptors ?? [];
  const generatorDescriptorById = new Map<string, MutationDefaultGeneratorDescriptor>();
  for (const descriptor of generatorDescriptors) {
    generatorDescriptorById.set(descriptor.id, descriptor);
  }

  const isEnumBlock = (block: BlockSymbol): boolean => block.keyword === 'enum';
  const legitimateBlockKeywords = composedBlockKeywords(input.authoringContributions);
  const reportUnsupportedTopLevelBlock = (block: BlockSymbol): void => {
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
      message: `Unsupported top-level block "${block.keyword}"`,
      sourceId,
      span: keywordPslSpan(block.node.syntax, block.keyword, sourceFile),
    });
  };

  const topLevelEnums = Object.values(topLevel.blocks)
    .filter((block) => {
      if (!legitimateBlockKeywords.has(block.keyword)) {
        reportUnsupportedTopLevelBlock(block);
        return false;
      }
      return isEnumBlock(block);
    })
    .map((block) => block.block);
  for (const namespace of namespaceSymbols) {
    for (const block of Object.values(namespace.blocks)) {
      if (isEnumBlock(block)) {
        diagnostics.push({
          code: 'PSL_ENUM_NAMESPACE_NOT_SUPPORTED',
          message: `enum "${block.name}" inside namespace "${namespace.name}" is not supported; declare enum at the top level`,
          sourceId,
          span: nodePslSpan(block.node.syntax, sourceFile),
        });
        continue;
      }
      if (!legitimateBlockKeywords.has(block.keyword)) {
        reportUnsupportedTopLevelBlock(block);
      }
    }
  }

  const enumResult = processEnumDeclarations({
    enumBlocks: topLevelEnums,
    sourceId,
    authoringContributions: input.authoringContributions,
    entityContext: {
      family: input.target.familyId,
      target: input.target.targetId,
      ...ifDefined('codecLookup', input.codecLookup),
      sourceId,
      diagnostics: {
        push: (d) => {
          diagnostics.push(
            blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
          );
        },
      },
    },
    diagnostics,
  });

  const allEnumTypeDescriptors = new Map(enumResult.enumTypeDescriptors);

  const validEnumHandles: Record<string, EnumTypeHandle> = { ...enumResult.enumHandles };

  const enumHandlesByName = new Map(Object.entries(validEnumHandles));

  const namedTypeSymbols: readonly NamedTypeSymbol[] = [
    ...Object.values(topLevel.scalars),
    ...Object.values(topLevel.typeAliases),
  ];

  const namedTypeResult = resolveNamedTypeDeclarations({
    declarations: namedTypeSymbols,
    sourceId,
    enumTypeDescriptors: allEnumTypeDescriptors,
    scalarTypeDescriptors: input.scalarTypeDescriptors,
    composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    authoringContributions: input.authoringContributions,
    diagnostics,
  });

  const storageTypes = { ...namedTypeResult.storageTypes };

  const modelMappingsByCoordinate = buildModelMappings(
    modelEntries,
    defaultNamespaceId,
    diagnostics,
    sourceId,
  );
  // Bare-name view for unqualified relation targets and polymorphism, where
  // resolution is by bare model name. When a bare name is shared across
  // namespaces this collapses to the last entry; qualified relation targets
  // and per-model lowering use the coordinate-keyed map above instead.
  const modelMappings = new Map<string, ModelNameMapping>();
  for (const mapping of modelMappingsByCoordinate.values()) {
    modelMappings.set(mapping.model.name, mapping);
  }
  const modelNodes: ModelNode[] = [];
  const fkRelationMetadata: FkRelationMetadata[] = [];
  const backrelationCandidates: ModelBackrelationCandidate[] = [];
  const modelResolvedFields = new Map<string, readonly ResolvedField[]>();
  // Cross-space relation nodes keyed by declaring model name — merged into
  // modelRelations after local back-relation matching so they bypass that step.
  const crossSpaceRelationsByModel = new Map<string, RelationNode[]>();

  for (const { model, namespaceId } of modelEntries) {
    const coordinate = modelCoordinateKey(namespaceId ?? defaultNamespaceId, model.name);
    const mapping = modelMappingsByCoordinate.get(coordinate);
    if (!mapping) {
      continue;
    }
    const result = buildModelNodeFromPsl({
      model,
      mapping,
      modelMappings,
      modelMappingsByCoordinate,
      modelNames,
      compositeTypeNames,
      enumTypeDescriptors: allEnumTypeDescriptors,
      namedTypeDescriptors: namedTypeResult.namedTypeDescriptors,
      composedExtensions,
      composedExtensionContracts,
      familyId: input.target.familyId,
      targetId: input.target.targetId,
      authoringContributions: input.authoringContributions,
      defaultFunctionRegistry,
      generatorDescriptorById,
      scalarTypeDescriptors: input.scalarTypeDescriptors,
      sourceId,
      sourceFile,
      symbolTable: input.symbolTable,
      diagnostics,
      modelNamespaceIds,
      ...(enumHandlesByName.size > 0 ? { enumHandles: enumHandlesByName } : {}),
    });
    modelNodes.push(
      namespaceId !== undefined ? { ...result.modelNode, namespaceId } : result.modelNode,
    );
    fkRelationMetadata.push(...result.fkRelationMetadata);
    backrelationCandidates.push(...result.backrelationCandidates);
    modelResolvedFields.set(coordinate, result.resolvedFields);
    if (result.crossSpaceRelations.length > 0) {
      const existing = crossSpaceRelationsByModel.get(model.name) ?? [];
      crossSpaceRelationsByModel.set(model.name, [...existing, ...result.crossSpaceRelations]);
    }
  }

  const { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel } = indexFkRelations({
    fkRelationMetadata,
  });
  const modelIdColumns = new Map<string, readonly string[]>();
  for (const modelNode of modelNodes) {
    if (modelNode.id) {
      modelIdColumns.set(modelNode.modelName, modelNode.id.columns);
    }
  }
  applyBackrelationCandidates({
    backrelationCandidates,
    fkRelationsByPair,
    fkRelationsByDeclaringModel,
    modelIdColumns,
    modelRelations,
    diagnostics,
    sourceId,
  });

  // Merge cross-space relations into modelRelations after local back-relation matching.
  // Cross-space targets have no local back-relation candidates, so they bypass that step.
  for (const [modelName, relations] of crossSpaceRelationsByModel) {
    const existing = modelRelations.get(modelName);
    if (existing) {
      existing.push(...relations);
    } else {
      modelRelations.set(modelName, [...relations]);
    }
  }

  const { discriminatorDeclarations, baseDeclarations } = collectPolymorphismDeclarations(
    models,
    sourceId,
    diagnostics,
  );

  // A variant with `@@base` but no own `@@map` is single-table inheritance:
  // it shares the base table. (`@@map` ⇒ multi-table inheritance.) This is the
  // authoritative STI/MTI signal — the variant's resolved table name is not,
  // because a no-`@@map` STI variant still gets a `lowerFirst(name)` default
  // table name that differs from the base before `resolvePolymorphism` rewrites
  // it onto the base table.
  const stiVariantNames = new Set<string>();
  for (const variantName of baseDeclarations.keys()) {
    const variantMapping = modelMappings.get(variantName);
    const hasExplicitMap =
      variantMapping?.model.attributes.some((attr) => attr.name === 'map') ?? false;
    if (!hasExplicitMap) {
      stiVariantNames.add(variantName);
    }
  }

  const { modelNodes: mtiLinkedModelNodes, syntheticPkFieldsByVariant } =
    materializeMtiVariantStorageLinks(modelNodes, baseDeclarations, stiVariantNames);
  const { modelNodes: stiColumnModelNodes, stiBaseFieldsByBase } =
    materializeStiVariantStorageColumns(mtiLinkedModelNodes, baseDeclarations, stiVariantNames);

  const valueObjects = buildValueObjects({
    compositeTypes,
    enumTypeDescriptors: allEnumTypeDescriptors,
    namedTypeDescriptors: namedTypeResult.namedTypeDescriptors,
    scalarTypeDescriptors: input.scalarTypeDescriptors,
    composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    authoringContributions: input.authoringContributions,
    diagnostics,
    sourceId,
  });

  if (diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics,
    });
  }

  // Generic extension-block lowering pass: per named namespace, lower all
  // parsed extension blocks into IR entities via the registered factory for
  // each block's discriminator, then collect by entrySlotName. This pass
  // names no specific discriminator value — all target-specific logic lives
  // in the factory contributed by the target pack.
  const entityTypesByDiscriminator = buildEntityTypesByDiscriminator(input.authoringContributions);
  const extensionEntityContext: AuthoringEntityContext = {
    family: input.target.familyId,
    target: input.target.targetId,
  };
  const namespaceExtensionEntities = new Map<
    string,
    Readonly<Record<string, Readonly<Record<string, unknown>>>>
  >();
  for (const ns of namespaceSymbols) {
    if (ns.name === UNSPECIFIED_PSL_NAMESPACE_NAME) continue;
    const nsId = resolveNamespaceIdForSqlTarget({
      bucketName: ns.name,
      targetId: input.target.targetId,
    });
    if (nsId === undefined) continue;
    const entities = lowerExtensionBlocksForNamespace(
      ns,
      nsId,
      entityTypesByDiscriminator,
      extensionEntityContext,
    );
    if (Object.keys(entities).length > 0) {
      namespaceExtensionEntities.set(nsId, entities);
    }
  }

  // Wrap createNamespace to merge lowered extension-block entities into each
  // namespace's entries before handing off to the factory. The entities map
  // keys are discriminator strings — equal to the entries key by the one-string
  // rule — so they merge directly into entries without translation.
  const { createNamespace } = input;
  const createNamespaceWithExtensions = (nsInput: SqlNamespaceInput) => {
    const entities = namespaceExtensionEntities.get(nsInput.id);
    if (entities === undefined) {
      return createNamespace(nsInput);
    }
    const extended: SqlNamespaceInput = {
      ...nsInput,
      entries: { ...nsInput.entries, ...entities },
    };
    return createNamespace(extended);
  };

  const contract = buildSqlContractFromDefinition({
    target: input.target,
    ...ifDefined(
      'extensionPacks',
      buildComposedExtensionPackRefs(
        input.target,
        [...composedExtensions].sort(compareStrings),
        input.composedExtensionPackRefs,
      ),
    ),
    ...(Object.keys(storageTypes).length > 0 ? { storageTypes } : {}),
    ...(Object.keys(validEnumHandles).length > 0 ? { enums: validEnumHandles } : {}),
    createNamespace: createNamespaceWithExtensions,
    models: stiColumnModelNodes.map((model) => ({
      ...model,
      ...(modelRelations.has(model.modelName)
        ? {
            relations: [...(modelRelations.get(model.modelName) ?? [])].sort((left, right) =>
              compareStrings(left.fieldName, right.fieldName),
            ),
          }
        : {}),
    })),
  });

  // Include namespace in patch keys so same bare model names across namespaces
  // stay distinct; same-coordinate duplicates were already collapsed first-wins.
  const modelsForPatch: Record<string, ContractModel> = {};
  for (const [namespaceId, namespaceSlice] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespaceSlice.models)) {
      const coordinate = modelCoordinateKey(namespaceId, modelName);
      invariant(
        !Object.hasOwn(modelsForPatch, coordinate),
        `symbol table guarantees coordinate uniqueness; duplicate model "${namespaceId}.${modelName}" reached interpretation`,
      );
      modelsForPatch[coordinate] = model;
    }
  }
  let patchedModels = patchModelDomainFields(modelsForPatch, modelResolvedFields);

  const polyDiagnostics: ContractSourceDiagnostic[] = [];
  patchedModels = resolvePolymorphism(
    patchedModels,
    discriminatorDeclarations,
    baseDeclarations,
    modelNames,
    modelMappings,
    modelNamespaceIds,
    input.target.defaultNamespaceId,
    syntheticPkFieldsByVariant,
    stiBaseFieldsByBase,
    sourceId,
    polyDiagnostics,
  );

  if (polyDiagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: polyDiagnostics,
    });
  }

  const variantModelNames = new Set(baseDeclarations.keys());
  const filteredRoots = Object.fromEntries(
    Object.entries(contract.roots).filter(
      ([, crossReference]) => !variantModelNames.has(crossReference.model),
    ),
  );

  const patchedContract: Contract = {
    ...contract,
    roots: filteredRoots,
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(contract.domain.namespaces).map(([namespaceId, namespaceSlice]) => [
          namespaceId,
          {
            models: Object.fromEntries(
              Object.entries(namespaceSlice.models).map(([modelName, model]) => [
                modelName,
                patchedModels[modelCoordinateKey(namespaceId, modelName)] ?? model,
              ]),
            ),
            ...ifDefined('enum', namespaceSlice.enum),
            ...ifDefined('valueObjects', namespaceSlice.valueObjects),
            ...(namespaceId === input.target.defaultNamespaceId &&
            Object.keys(valueObjects).length > 0
              ? { valueObjects }
              : {}),
          },
        ]),
      ),
    },
  };

  return ok(patchedContract);
}
