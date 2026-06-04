import type {
  ColumnDefault,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';
import {
  isColumnDefaultLiteralInputValue,
  isExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Type } from 'arktype';
import type {
  PslPackBlock,
  PslPackBlockParserContext,
  PslPackBlockPrinterContext,
} from './psl-substrate';

export type AuthoringArgRef = {
  readonly kind: 'arg';
  readonly index: number;
  readonly path?: readonly string[];
  readonly default?: AuthoringTemplateValue;
};

export type AuthoringTemplateValue =
  | string
  | number
  | boolean
  | null
  | AuthoringArgRef
  | readonly AuthoringTemplateValue[]
  | { readonly [key: string]: AuthoringTemplateValue };

interface AuthoringArgumentDescriptorCommon {
  readonly name?: string;
  readonly optional?: boolean;
}

export type AuthoringArgumentDescriptor = AuthoringArgumentDescriptorCommon &
  (
    | { readonly kind: 'string' }
    | { readonly kind: 'boolean' }
    | {
        readonly kind: 'number';
        readonly integer?: boolean;
        readonly minimum?: number;
        readonly maximum?: number;
      }
    | { readonly kind: 'stringArray' }
    | {
        readonly kind: 'object';
        readonly properties: Record<string, AuthoringArgumentDescriptor>;
      }
  );

export interface AuthoringStorageTypeTemplate {
  readonly codecId: string;
  readonly nativeType: AuthoringTemplateValue;
  readonly typeParams?: Record<string, AuthoringTemplateValue>;
}

export interface AuthoringTypeConstructorDescriptor {
  readonly kind: 'typeConstructor';
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output: AuthoringStorageTypeTemplate;
}

export interface AuthoringColumnDefaultTemplateLiteral {
  readonly kind: 'literal';
  readonly value: AuthoringTemplateValue;
}

export interface AuthoringColumnDefaultTemplateFunction {
  readonly kind: 'function';
  readonly expression: AuthoringTemplateValue;
}

export type AuthoringColumnDefaultTemplate =
  | AuthoringColumnDefaultTemplateLiteral
  | AuthoringColumnDefaultTemplateFunction;

export interface AuthoringExecutionDefaultsTemplate {
  readonly onCreate?: AuthoringTemplateValue;
  readonly onUpdate?: AuthoringTemplateValue;
}

export interface AuthoringFieldPresetOutput extends AuthoringStorageTypeTemplate {
  readonly nullable?: boolean;
  readonly default?: AuthoringColumnDefaultTemplate;
  readonly executionDefaults?: AuthoringExecutionDefaultsTemplate;
  readonly id?: boolean;
  readonly unique?: boolean;
}

export interface AuthoringFieldPresetDescriptor {
  readonly kind: 'fieldPreset';
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output: AuthoringFieldPresetOutput;
}

export type AuthoringTypeNamespace = {
  readonly [name: string]: AuthoringTypeConstructorDescriptor | AuthoringTypeNamespace;
};

export type AuthoringFieldNamespace = {
  readonly [name: string]: AuthoringFieldPresetDescriptor | AuthoringFieldNamespace;
};

/**
 * Context surfaced to entity-type factories at call time. Currently a
 * placeholder — sharpened as concrete consumers (enum, namespace, …)
 * discover what the factory actually needs to read (codec lookup,
 * namespace registry, …).
 */
export interface AuthoringEntityContext {
  readonly family: string;
  readonly target: string;
}

export interface AuthoringEntityTypeTemplateOutput {
  readonly template: AuthoringTemplateValue;
}

/**
 * Default `Input = never` is load-bearing for pack-bag-driven type
 * narrowing. Factory parameter positions are contravariant, so a pack
 * literal declaring `factory: (input: DemoEntityInput) => DemoEntity`
 * is only assignable to the base descriptor's factory shape if the
 * base's input is `never` (the bottom of the contravariant position).
 * The concrete input/output types are recovered at the helper-derivation
 * site via `EntityHelperFunction<Descriptor>`'s conditional inference,
 * which reads them from the pack's `as const` literal factory signature
 * — the base widening does not erase the literal because `satisfies`
 * does not widen the declared type.
 */
export interface AuthoringEntityTypeFactoryOutput<Input = never, Output = unknown> {
  readonly factory: (input: Input, ctx: AuthoringEntityContext) => Output;
}

export interface AuthoringEntityTypeDescriptor<Input = never, Output = unknown> {
  readonly kind: 'entity';
  readonly discriminator: string;
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output:
    | AuthoringEntityTypeTemplateOutput
    | AuthoringEntityTypeFactoryOutput<Input, Output>;
  /**
   * arktype schema fragment for one entry whose envelope `kind` matches
   * this descriptor's {@link discriminator}. The family validator composes
   * contributed fragments into the per-namespace entry schema at
   * validator construction time so the structural check covers
   * pack-introduced kinds without the family core hard-coding the schema.
   *
   * Hydration uses {@link AuthoringEntityTypeFactoryOutput.factory}
   * directly — the wire shape conforms structurally to the factory's
   * `Input` after `validatorSchema` validates it.
   */
  readonly validatorSchema?: Type<unknown>;
}

export type AuthoringEntityTypeNamespace = {
  readonly [name: string]: AuthoringEntityTypeDescriptor | AuthoringEntityTypeNamespace;
};

/**
 * Pack-contributed parser for a top-level PSL block keyword. The
 * framework parser dispatches an unrecognised opener line of the
 * shape `<keyword> <name> { … }` to the `pslBlocks.<keyword>`
 * contribution, building a {@link PslPackBlockParserContext} handle
 * from the framework's parser state and passing it as the sole
 * argument. The contribution returns the AST node the lowering
 * factory and matching `pslPrinters` descriptor consume — the
 * `Output` generic narrows that shape end to end across the triple
 * bundle (parser → printer → factory) keyed by `discriminator`.
 *
 * The context handle is intentionally minimal — only the helpers
 * needed to write a parser for a `keyword Name { key = value }`
 * block. See `PslPackBlockParserContext`'s JSDoc for the calibration.
 */
export interface AuthoringPslBlockDescriptor<Output extends PslPackBlock = PslPackBlock> {
  readonly kind: 'pslBlock';
  readonly discriminator: string;
  readonly parser: (context: PslPackBlockParserContext) => Output;
  readonly validatorSchema?: Type<unknown>;
}

/**
 * Pack-contributed printer for a top-level PSL block keyword. The
 * framework serializer dispatches a pack-contributed AST node to
 * the `pslPrinters` contribution whose `discriminator` matches the
 * node's `kind`, building a {@link PslPackBlockPrinterContext}
 * handle and passing the node + handle as arguments. The
 * contribution returns the rendered block text — typically a
 * multi-line string starting with the keyword opener and ending
 * with the closing brace; the serializer indents the result if the
 * block lives inside a `namespace { … }`.
 *
 * `Input` is constrained to `extend PslPackBlock` so the framework
 * AST slot can hold the value the matching `pslBlocks` descriptor
 * produces. The default `never` is load-bearing for assignability:
 * function parameters are contravariant, so a pack literal declaring
 * `printer: (input: SomeAst, ctx) => string` only assigns to this
 * base shape if `Input = never` (the bottom type that anything can
 * be substituted for in contravariant position). The same idiom is
 * used by {@link AuthoringEntityTypeFactoryOutput}'s `Input` default.
 */
export interface AuthoringPslPrinterDescriptor<Input extends PslPackBlock = never> {
  readonly kind: 'pslPrinter';
  readonly discriminator: string;
  readonly printer: (input: Input, context: PslPackBlockPrinterContext) => string;
}

export type AuthoringPslBlockNamespace = {
  readonly [name: string]: AuthoringPslBlockDescriptor | AuthoringPslBlockNamespace;
};

export type AuthoringPslPrinterNamespace = {
  readonly [name: string]: AuthoringPslPrinterDescriptor | AuthoringPslPrinterNamespace;
};

export interface AuthoringContributions {
  readonly type?: AuthoringTypeNamespace;
  readonly field?: AuthoringFieldNamespace;
  readonly entityTypes?: AuthoringEntityTypeNamespace;
  readonly pslBlocks?: AuthoringPslBlockNamespace;
  readonly pslPrinters?: AuthoringPslPrinterNamespace;
}

export function isAuthoringArgRef(value: unknown): value is AuthoringArgRef {
  if (typeof value !== 'object' || value === null || (value as { kind?: unknown }).kind !== 'arg') {
    return false;
  }
  const { index, path } = value as { index?: unknown; path?: unknown };
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return false;
  }
  if (path !== undefined && (!Array.isArray(path) || path.some((s) => typeof s !== 'string'))) {
    return false;
  }
  return true;
}

function isAuthoringTemplateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAuthoringTypeConstructorDescriptor(
  value: unknown,
): value is AuthoringTypeConstructorDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'typeConstructor' &&
    typeof (value as { output?: unknown }).output === 'object' &&
    (value as { output?: unknown }).output !== null
  );
}

export function isAuthoringFieldPresetDescriptor(
  value: unknown,
): value is AuthoringFieldPresetDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'fieldPreset' &&
    typeof (value as { output?: unknown }).output === 'object' &&
    (value as { output?: unknown }).output !== null
  );
}

export function isAuthoringEntityTypeDescriptor(
  value: unknown,
): value is AuthoringEntityTypeDescriptor {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { kind?: unknown }).kind !== 'entity'
  ) {
    return false;
  }
  const discriminator = (value as { discriminator?: unknown }).discriminator;
  if (typeof discriminator !== 'string' || discriminator.length === 0) {
    return false;
  }
  const output = (value as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) {
    return false;
  }
  const factory = (output as { factory?: unknown }).factory;
  const template = (output as { template?: unknown }).template;
  return typeof factory === 'function' || template !== undefined;
}

export function isAuthoringPslBlockDescriptor(
  value: unknown,
): value is AuthoringPslBlockDescriptor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = blindCast<
    Record<string, unknown>,
    'type-guard probing an unknown candidate-descriptor object for known property names'
  >(value);
  if (record['kind'] !== 'pslBlock') {
    return false;
  }
  const discriminator = record['discriminator'];
  if (typeof discriminator !== 'string' || discriminator.length === 0) {
    return false;
  }
  return typeof record['parser'] === 'function';
}

export function isAuthoringPslPrinterDescriptor(
  value: unknown,
): value is AuthoringPslPrinterDescriptor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = blindCast<
    Record<string, unknown>,
    'type-guard probing an unknown candidate-descriptor object for known property names'
  >(value);
  if (record['kind'] !== 'pslPrinter') {
    return false;
  }
  const discriminator = record['discriminator'];
  if (typeof discriminator !== 'string' || discriminator.length === 0) {
    return false;
  }
  return typeof record['printer'] === 'function';
}

/**
 * Returns true when `namespace` is a non-leaf key in `contributions.field`.
 *
 * `AuthoringFieldNamespace` permits a leaf descriptor at any depth — including
 * the root — so a top-level `field: { Foo: { kind: 'fieldPreset', ... } }`
 * registration must NOT be treated as a "namespace" with sub-paths. Callers
 * use this predicate to gate dot-namespaced lookups (e.g. PSL `@Foo.bar`).
 */
export function hasRegisteredFieldNamespace(
  contributions: AuthoringContributions | undefined,
  namespace: string,
): boolean {
  if (contributions?.field === undefined || !Object.hasOwn(contributions.field, namespace)) {
    return false;
  }
  return !isAuthoringFieldPresetDescriptor(contributions.field[namespace]);
}

function isPlainNamespaceObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges `source` into `target` recursively at the descriptor-namespace
 * level. `leafGuard` decides which values are descriptors (terminal
 * merge points; same-path registrations across components are reported
 * as duplicates) versus sub-namespaces (recursion targets).
 *
 * Path segments are validated against prototype-pollution names
 * (`__proto__`, `constructor`, `prototype`). A value that is neither a
 * recognized leaf nor a plain object — e.g. a malformed descriptor
 * where the canonical leaf guard rejected it for missing `output` —
 * is reported as an invalid contribution rather than recursed into,
 * which would either silently mangle state or infinite-loop on
 * primitive properties.
 *
 * Within-registry duplicate detection is this walker's job;
 * cross-registry detection runs separately via
 * `assertNoCrossRegistryCollisions` after merging completes.
 */
export function mergeAuthoringNamespaces(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: readonly string[],
  leafGuard: (value: unknown) => boolean,
  label: string,
): void {
  const assertSafePath = (currentPath: readonly string[]) => {
    const blockedSegment = currentPath.find(
      (segment) => segment === '__proto__' || segment === 'constructor' || segment === 'prototype',
    );
    if (blockedSegment) {
      throw new Error(
        `Invalid authoring ${label} helper "${currentPath.join('.')}". Helper path segments must not use "${blockedSegment}".`,
      );
    }
  };

  for (const [key, sourceValue] of Object.entries(source)) {
    const currentPath = [...path, key];
    assertSafePath(currentPath);
    const hasExistingValue = Object.hasOwn(target, key);
    const existingValue = hasExistingValue ? target[key] : undefined;

    if (!hasExistingValue) {
      target[key] = sourceValue;
      continue;
    }

    const existingIsLeaf = leafGuard(existingValue);
    const sourceIsLeaf = leafGuard(sourceValue);

    if (existingIsLeaf || sourceIsLeaf) {
      throw new Error(
        `Duplicate authoring ${label} helper "${currentPath.join('.')}". Helper names must be unique across composed packs.`,
      );
    }

    if (!isPlainNamespaceObject(existingValue) || !isPlainNamespaceObject(sourceValue)) {
      throw new Error(
        `Invalid authoring ${label} helper "${currentPath.join('.')}". Expected a sub-namespace object or a recognized descriptor; received a malformed value.`,
      );
    }

    mergeAuthoringNamespaces(existingValue, sourceValue, currentPath, leafGuard, label);
  }
}

function collectAuthoringLeafPaths(
  namespace: Readonly<Record<string, unknown>>,
  isLeaf: (value: unknown) => boolean,
  path: readonly string[] = [],
): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeaf(value)) {
      paths.push(currentPath.join('.'));
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      paths.push(
        ...collectAuthoringLeafPaths(
          blindCast<
            Readonly<Record<string, unknown>>,
            'walker descends into a sub-namespace whose keys are unknown until inspected'
          >(value),
          isLeaf,
          currentPath,
        ),
      );
    }
  }
  return paths;
}

interface AuthoringLeafEntry {
  readonly path: string;
  readonly discriminator: string;
}

function collectAuthoringLeafDiscriminators(
  namespace: Readonly<Record<string, unknown>>,
  isLeaf: (value: unknown) => boolean,
  path: readonly string[] = [],
): AuthoringLeafEntry[] {
  const entries: AuthoringLeafEntry[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeaf(value)) {
      const record = blindCast<
        Record<string, unknown>,
        'discriminator extraction from a leaf already validated by isLeaf'
      >(value);
      const discriminator = record['discriminator'];
      if (typeof discriminator === 'string' && discriminator.length > 0) {
        entries.push({ path: currentPath.join('.'), discriminator });
      }
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      entries.push(
        ...collectAuthoringLeafDiscriminators(
          blindCast<
            Readonly<Record<string, unknown>>,
            'walker descends into a sub-namespace whose keys are unknown until inspected'
          >(value),
          isLeaf,
          currentPath,
        ),
      );
    }
  }
  return entries;
}

export function assertNoCrossRegistryCollisions(
  typeNamespace: AuthoringTypeNamespace,
  fieldNamespace: AuthoringFieldNamespace,
  entityTypeNamespace: AuthoringEntityTypeNamespace = {},
  pslBlockNamespace: AuthoringPslBlockNamespace = {},
  pslPrinterNamespace: AuthoringPslPrinterNamespace = {},
): void {
  const typePaths = new Set(
    collectAuthoringLeafPaths(typeNamespace, isAuthoringTypeConstructorDescriptor),
  );
  const fieldPaths = new Set(
    collectAuthoringLeafPaths(fieldNamespace, isAuthoringFieldPresetDescriptor),
  );
  const entityPaths = new Set(
    collectAuthoringLeafPaths(entityTypeNamespace, isAuthoringEntityTypeDescriptor),
  );
  // Within-registry duplicate detection is handled upstream by the merge
  // walker (`mergeAuthoringNamespaces` in control-stack.ts and
  // `mergeHelperNamespaces` in composed-authoring-helpers.ts), which throws
  // on same-path registrations within any single registry before this check
  // runs. This function only handles the cross-registry case.
  //
  // Cross-registry collisions are checked among `type` / `field` /
  // `entityTypes` only — these three are user-facing helper paths
  // (`helpers.<path>(...)`) that PSL must resolve unambiguously.
  // `pslBlocks` and `pslPrinters` are internal framework indices
  // consumed by parser and printer dispatch, not user-facing helper
  // paths; the natural authoring pattern is the same path key across
  // all three of `entityTypes` / `pslBlocks` / `pslPrinters` for a
  // single triple-bundle contribution. Same-path consistency across
  // those bundle members is enforced by `assertTripleBundleConsistency`
  // via the discriminator string, not by path.
  const ambiguityHint =
    'Register each path in only one of authoringContributions.field / authoringContributions.type / authoringContributions.entityTypes.';
  for (const fieldPath of fieldPaths) {
    if (typePaths.has(fieldPath)) {
      throw new Error(
        `Ambiguous authoring registry path "${fieldPath}". The same path is registered as both a type constructor and a field preset; PSL resolution would be ambiguous. ${ambiguityHint}`,
      );
    }
  }
  for (const entityPath of entityPaths) {
    if (typePaths.has(entityPath) || fieldPaths.has(entityPath)) {
      throw new Error(
        `Ambiguous authoring registry path "${entityPath}". The same path is registered as an entity contribution AND as a type constructor or field preset; PSL resolution would be ambiguous. ${ambiguityHint}`,
      );
    }
  }

  assertTripleBundleConsistency(entityTypeNamespace, pslBlockNamespace, pslPrinterNamespace);
}

/**
 * `pslBlocks`, `pslPrinters`, and `entityTypes` form a triple bundle:
 * a pack-contributed PSL keyword needs all three (parser + printer +
 * factory) to round-trip through `parse → lower → IR → print → re-parse`.
 * `entityTypes` on its own is fine — that's the TS-builder-only path
 * (`helpers.enum({...})` reaches the factory directly without ever
 * touching PSL). Only `pslBlocks` and `pslPrinters` require all three;
 * the check is asymmetric for that reason.
 */
function assertTripleBundleConsistency(
  entityTypeNamespace: AuthoringEntityTypeNamespace,
  pslBlockNamespace: AuthoringPslBlockNamespace,
  pslPrinterNamespace: AuthoringPslPrinterNamespace,
): void {
  const blockEntries = collectAuthoringLeafDiscriminators(
    pslBlockNamespace,
    isAuthoringPslBlockDescriptor,
  );
  const printerEntries = collectAuthoringLeafDiscriminators(
    pslPrinterNamespace,
    isAuthoringPslPrinterDescriptor,
  );
  const entityEntries = collectAuthoringLeafDiscriminators(
    entityTypeNamespace,
    isAuthoringEntityTypeDescriptor,
  );

  const printerDiscriminators = new Set(printerEntries.map((entry) => entry.discriminator));
  const entityDiscriminators = new Set(entityEntries.map((entry) => entry.discriminator));
  const blockDiscriminators = new Set(blockEntries.map((entry) => entry.discriminator));

  for (const block of blockEntries) {
    if (!printerDiscriminators.has(block.discriminator)) {
      throw new Error(
        `Incomplete pack contribution bundle: pslBlock helper "${block.path}" registers discriminator "${block.discriminator}" but no pslPrinter contribution shares that discriminator. A pack-contributed PSL block requires a matching pslPrinter (and entityType) so the round-trip parse → IR → print can complete; add a pslPrinter helper with discriminator "${block.discriminator}".`,
      );
    }
    if (!entityDiscriminators.has(block.discriminator)) {
      throw new Error(
        `Incomplete pack contribution bundle: pslBlock helper "${block.path}" registers discriminator "${block.discriminator}" but no entityType contribution shares that discriminator. A pack-contributed PSL block requires a matching entityType factory so the parsed AST node can lower to an IR class instance; add an entityType helper with discriminator "${block.discriminator}".`,
      );
    }
  }

  for (const printer of printerEntries) {
    if (!blockDiscriminators.has(printer.discriminator)) {
      throw new Error(
        `Incomplete pack contribution bundle: pslPrinter helper "${printer.path}" registers discriminator "${printer.discriminator}" but no pslBlock contribution shares that discriminator. A pack-contributed PSL printer requires a matching pslBlock parser so contract inference round-trips through the same keyword; add a pslBlock helper with discriminator "${printer.discriminator}".`,
      );
    }
    if (!entityDiscriminators.has(printer.discriminator)) {
      throw new Error(
        `Incomplete pack contribution bundle: pslPrinter helper "${printer.path}" registers discriminator "${printer.discriminator}" but no entityType contribution shares that discriminator. A pack-contributed PSL printer requires a matching entityType factory; add an entityType helper with discriminator "${printer.discriminator}".`,
      );
    }
  }
}

export function resolveAuthoringTemplateValue(
  template: AuthoringTemplateValue,
  args: readonly unknown[],
): unknown {
  if (isAuthoringArgRef(template)) {
    let value = args[template.index];

    for (const segment of template.path ?? []) {
      if (!isAuthoringTemplateRecord(value) || !Object.hasOwn(value, segment)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[segment];
    }

    if (value === undefined && template.default !== undefined) {
      return resolveAuthoringTemplateValue(template.default, args);
    }

    return value;
  }
  if (Array.isArray(template)) {
    return template.map((value) => resolveAuthoringTemplateValue(value, args));
  }
  if (typeof template === 'object' && template !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      const resolvedValue = resolveAuthoringTemplateValue(value, args);
      if (resolvedValue !== undefined) {
        resolved[key] = resolvedValue;
      }
    }
    return resolved;
  }
  return template;
}

function validateAuthoringArgument(
  descriptor: AuthoringArgumentDescriptor,
  value: unknown,
  path: string,
): void {
  if (value === undefined) {
    if (descriptor.optional) {
      return;
    }
    throw new Error(`Missing required authoring helper argument at ${path}`);
  }

  if (descriptor.kind === 'string') {
    if (typeof value !== 'string') {
      throw new Error(`Authoring helper argument at ${path} must be a string`);
    }
    return;
  }

  if (descriptor.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Authoring helper argument at ${path} must be a boolean`);
    }
    return;
  }

  if (descriptor.kind === 'stringArray') {
    if (!Array.isArray(value)) {
      throw new Error(`Authoring helper argument at ${path} must be an array of strings`);
    }
    for (const entry of value) {
      if (typeof entry !== 'string') {
        throw new Error(`Authoring helper argument at ${path} must be an array of strings`);
      }
    }
    return;
  }

  if (descriptor.kind === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Authoring helper argument at ${path} must be an object`);
    }

    const input = value as Record<string, unknown>;
    const expectedKeys = new Set(Object.keys(descriptor.properties));

    for (const key of Object.keys(input)) {
      if (!expectedKeys.has(key)) {
        throw new Error(`Authoring helper argument at ${path} contains unknown property "${key}"`);
      }
    }

    for (const [key, propertyDescriptor] of Object.entries(descriptor.properties)) {
      validateAuthoringArgument(propertyDescriptor, input[key], `${path}.${key}`);
    }

    return;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Authoring helper argument at ${path} must be a number`);
  }

  if (descriptor.integer && !Number.isInteger(value)) {
    throw new Error(`Authoring helper argument at ${path} must be an integer`);
  }
  if (descriptor.minimum !== undefined && value < descriptor.minimum) {
    throw new Error(
      `Authoring helper argument at ${path} must be >= ${descriptor.minimum}, received ${value}`,
    );
  }
  if (descriptor.maximum !== undefined && value > descriptor.maximum) {
    throw new Error(
      `Authoring helper argument at ${path} must be <= ${descriptor.maximum}, received ${value}`,
    );
  }
}

export function validateAuthoringHelperArguments(
  helperPath: string,
  descriptors: readonly AuthoringArgumentDescriptor[] | undefined,
  args: readonly unknown[],
): void {
  const expected = descriptors ?? [];
  const minimumArgs = expected.reduce(
    (count, descriptor, index) => (descriptor.optional ? count : index + 1),
    0,
  );
  if (args.length < minimumArgs || args.length > expected.length) {
    throw new Error(
      `${helperPath} expects ${minimumArgs === expected.length ? expected.length : `${minimumArgs}-${expected.length}`} argument(s), received ${args.length}`,
    );
  }

  expected.forEach((descriptor, index) => {
    validateAuthoringArgument(descriptor, args[index], `${helperPath}[${index}]`);
  });
}

function resolveAuthoringStorageTypeTemplate(
  template: AuthoringStorageTypeTemplate,
  args: readonly unknown[],
): {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
} {
  const nativeType = resolveAuthoringTemplateValue(template.nativeType, args);
  if (typeof nativeType !== 'string') {
    throw new Error(
      `Resolved authoring nativeType must be a string for codec "${template.codecId}", received ${String(nativeType)}`,
    );
  }
  const typeParams =
    template.typeParams === undefined
      ? undefined
      : resolveAuthoringTemplateValue(template.typeParams, args);
  if (typeParams !== undefined && !isAuthoringTemplateRecord(typeParams)) {
    throw new Error(
      `Resolved authoring typeParams must be an object for codec "${template.codecId}", received ${String(typeParams)}`,
    );
  }

  return {
    codecId: template.codecId,
    nativeType,
    ...(typeParams === undefined ? {} : { typeParams }),
  };
}

function resolveAuthoringColumnDefaultTemplate(
  template: AuthoringColumnDefaultTemplate,
  args: readonly unknown[],
): ColumnDefault {
  if (template.kind === 'literal') {
    const value = resolveAuthoringTemplateValue(template.value, args);
    if (value === undefined) {
      throw new Error('Resolved authoring literal default must not be undefined');
    }
    if (!isColumnDefaultLiteralInputValue(value)) {
      throw new Error(
        `Resolved authoring literal default must be a JSON-serializable value or Date, received ${String(value)}`,
      );
    }
    return {
      kind: 'literal',
      value,
    };
  }

  const expression = resolveAuthoringTemplateValue(template.expression, args);
  if (expression === undefined || (typeof expression === 'object' && expression !== null)) {
    throw new Error(
      `Resolved authoring function default expression must resolve to a primitive, received ${String(expression)}`,
    );
  }
  return {
    kind: 'function',
    expression: String(expression),
  };
}

function resolveExecutionMutationDefaultPhase(
  phase: 'onCreate' | 'onUpdate',
  template: AuthoringTemplateValue,
  args: readonly unknown[],
): ExecutionMutationDefaultValue {
  const value = resolveAuthoringTemplateValue(template, args);
  if (!isExecutionMutationDefaultValue(value)) {
    throw new Error(
      `Authoring preset executionDefaults.${phase} did not resolve to a valid generator descriptor (kind: 'generator', id: string).`,
    );
  }
  return value;
}

function resolveAuthoringExecutionDefaultsTemplate(
  template: AuthoringExecutionDefaultsTemplate,
  args: readonly unknown[],
): ExecutionMutationDefaultPhases {
  return {
    ...ifDefined(
      'onCreate',
      template.onCreate !== undefined
        ? resolveExecutionMutationDefaultPhase('onCreate', template.onCreate, args)
        : undefined,
    ),
    ...ifDefined(
      'onUpdate',
      template.onUpdate !== undefined
        ? resolveExecutionMutationDefaultPhase('onUpdate', template.onUpdate, args)
        : undefined,
    ),
  };
}

export function instantiateAuthoringTypeConstructor(
  descriptor: AuthoringTypeConstructorDescriptor,
  args: readonly unknown[],
): {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
} {
  return resolveAuthoringStorageTypeTemplate(descriptor.output, args);
}

export function instantiateAuthoringEntityType(
  helperPath: string,
  descriptor: AuthoringEntityTypeDescriptor,
  args: readonly unknown[],
  ctx: AuthoringEntityContext,
): unknown {
  // Factory-output entities carry their input contract on the factory
  // signature itself — TypeScript narrows callers via
  // `EntityHelperFunction`'s extracted `input` parameter, and the factory
  // is free to do its own runtime validation (e.g. arktype Type). The
  // descriptor-level `args` validator is reserved for template-output
  // entities (which mirror field/type's declarative argument shape).
  if ('factory' in descriptor.output) {
    const input = args[0];
    // The base `AuthoringEntityTypeDescriptor`'s factory is typed
    // `(input: never, ctx) => unknown` so concrete pack-literal factories
    // with narrower input types remain assignable through the
    // contravariant position (see the type's docstring). The runtime
    // delegates input validation to the pack's factory itself, so we
    // forward the supplied input here without a static input contract.
    const factory = descriptor.output.factory as (
      input: unknown,
      ctx: AuthoringEntityContext,
    ) => unknown;
    return factory(input, ctx);
  }
  validateAuthoringHelperArguments(helperPath, descriptor.args, args);
  return resolveAuthoringTemplateValue(descriptor.output.template, args);
}

export function instantiateAuthoringFieldPreset(
  descriptor: AuthoringFieldPresetDescriptor,
  args: readonly unknown[],
): {
  readonly descriptor: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
  };
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly id: boolean;
  readonly unique: boolean;
} {
  return {
    descriptor: resolveAuthoringStorageTypeTemplate(descriptor.output, args),
    nullable: descriptor.output.nullable ?? false,
    ...ifDefined(
      'default',
      descriptor.output.default !== undefined
        ? resolveAuthoringColumnDefaultTemplate(descriptor.output.default, args)
        : undefined,
    ),
    ...ifDefined(
      'executionDefaults',
      descriptor.output.executionDefaults !== undefined
        ? resolveAuthoringExecutionDefaultsTemplate(descriptor.output.executionDefaults, args)
        : undefined,
    ),
    id: descriptor.output.id ?? false,
    unique: descriptor.output.unique ?? false,
  };
}
