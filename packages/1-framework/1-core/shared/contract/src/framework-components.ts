import { ifDefined } from '@prisma-next/utils/defined';
import type { RenderTypeContext, TypesImportSpec } from './types';

/**
 * A template-based type renderer (structured form).
 * Uses mustache-style placeholders (e.g., `Vector<{{length}}>`) that are
 * replaced with typeParams values during rendering.
 *
 * @example
 * ```ts
 * { kind: 'template', template: 'Vector<{{length}}>' }
 * // With typeParams { length: 1536 }, renders: 'Vector<1536>'
 * ```
 */
export interface TypeRendererTemplate {
  readonly kind: 'template';
  /** Template string with `{{key}}` placeholders for typeParams values */
  readonly template: string;
}

/**
 * A function-based type renderer for full control over type expression generation.
 *
 * @example
 * ```ts
 * {
 *   kind: 'function',
 *   render: (params, ctx) => `Vector<${params.length}>`
 * }
 * ```
 */
export interface TypeRendererFunction {
  readonly kind: 'function';
  /** Render function that produces a TypeScript type expression */
  readonly render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
}

/**
 * A raw template string type renderer (convenience form).
 * Shorthand for TypeRendererTemplate - just the template string without wrapper.
 *
 * @example
 * ```ts
 * 'Vector<{{length}}>'
 * // Equivalent to: { kind: 'template', template: 'Vector<{{length}}>' }
 * ```
 */
export type TypeRendererString = string;

/**
 * A raw function type renderer (convenience form).
 * Shorthand for TypeRendererFunction - just the function without wrapper.
 *
 * @example
 * ```ts
 * (params, ctx) => `Vector<${params.length}>`
 * // Equivalent to: { kind: 'function', render: ... }
 * ```
 */
export type TypeRendererRawFunction = (
  params: Record<string, unknown>,
  ctx: RenderTypeContext,
) => string;

/**
 * Union of type renderer formats.
 *
 * Supports both structured forms (with `kind` discriminator) and convenience forms:
 * - `string` - Template string with `{{key}}` placeholders (manifest-safe, JSON-serializable)
 * - `function` - Render function for full control (requires runtime execution)
 * - `{ kind: 'template', template: string }` - Structured template form
 * - `{ kind: 'function', render: fn }` - Structured function form
 *
 * Templates are normalized to functions during pack assembly.
 * **Prefer template strings** for most cases - they are JSON-serializable.
 */
export type TypeRenderer =
  | TypeRendererString
  | TypeRendererRawFunction
  | TypeRendererTemplate
  | TypeRendererFunction;

/**
 * Normalized type renderer - always a function after assembly.
 * This is the form received by the emitter.
 */
export interface NormalizedTypeRenderer {
  readonly codecId: string;
  readonly render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
}

/**
 * Interpolates a template string with params values.
 * Used internally by normalizeRenderer to compile templates to functions.
 *
 * @throws Error if a placeholder key is not found in params (except 'CodecTypes')
 */
export function interpolateTypeTemplate(
  template: string,
  params: Record<string, unknown>,
  ctx: RenderTypeContext,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key === 'CodecTypes') return ctx.codecTypesName;
    const value = params[key];
    if (value === undefined) {
      throw new Error(
        `Missing template parameter "${key}" in template "${template}". ` +
          `Available params: ${Object.keys(params).join(', ') || '(none)'}`,
      );
    }
    return String(value);
  });
}

/**
 * Normalizes a TypeRenderer to function form.
 * Called during pack assembly, not at emission time.
 *
 * Handles all TypeRenderer forms:
 * - Raw string template: `'Vector<{{length}}>'`
 * - Raw function: `(params, ctx) => ...`
 * - Structured template: `{ kind: 'template', template: '...' }`
 * - Structured function: `{ kind: 'function', render: fn }`
 */
export function normalizeRenderer(codecId: string, renderer: TypeRenderer): NormalizedTypeRenderer {
  // Handle raw string (template shorthand)
  if (typeof renderer === 'string') {
    return {
      codecId,
      render: (params, ctx) => interpolateTypeTemplate(renderer, params, ctx),
    };
  }

  // Handle raw function (function shorthand)
  if (typeof renderer === 'function') {
    return { codecId, render: renderer };
  }

  // Handle structured function form
  if (renderer.kind === 'function') {
    return { codecId, render: renderer.render };
  }

  // Handle structured template form
  const { template } = renderer;
  return {
    codecId,
    render: (params, ctx) => interpolateTypeTemplate(template, params, ctx),
  };
}

/**
 * Declarative fields that describe component metadata.
 */
export interface ComponentMetadata {
  /** Component version (semver) */
  readonly version: string;

  /**
   * Capabilities this component provides.
   *
   * For adapters, capabilities must be declared on the adapter descriptor (so they are emitted into
   * the contract) and also exposed in runtime adapter code (e.g. `adapter.profile.capabilities`);
   * keep these declarations in sync. Targets are identifiers/descriptors and typically do not
   * declare capabilities.
   */
  readonly capabilities?: Record<string, unknown>;

  /** Type imports for contract.d.ts generation */
  readonly types?: {
    readonly codecTypes?: {
      /**
       * Base codec types import spec.
       * Optional: adapters typically provide this, extensions usually don't.
       */
      readonly import?: TypesImportSpec;
      /**
       * Optional renderers for parameterized codecs owned by this component.
       * Key is codecId (e.g., 'pg/vector@1'), value is the type renderer.
       *
       * Templates are normalized to functions during pack assembly.
       * Duplicate codecId across descriptors is a hard error.
       */
      readonly parameterized?: Record<string, TypeRenderer>;
      /**
       * Optional additional type-only imports required by parameterized renderers.
       *
       * These imports are included in generated `contract.d.ts` but are NOT treated as
       * codec type maps (i.e., they should not be intersected into `export type CodecTypes = ...`).
       *
       * Example: `Vector<N>` for pgvector renderers that emit `Vector<{{length}}>`
       */
      readonly typeImports?: ReadonlyArray<TypesImportSpec>;
      /**
       * Optional control-plane hooks keyed by codecId.
       * Used by family-specific planners/verifiers to handle storage types.
       */
      readonly controlPlaneHooks?: Record<string, unknown>;
    };
    readonly operationTypes?: { readonly import: TypesImportSpec };
    readonly storage?: ReadonlyArray<{
      readonly typeId: string;
      readonly familyId: string;
      readonly targetId: string;
      readonly nativeType?: string;
    }>;
  };

  /**
   * Optional pure-data authoring contributions exposed by this component.
   *
   * These contributions are safe to include on pack refs and descriptors because
   * they contain only declarative metadata. Higher-level authoring packages may
   * project them into concrete helper functions for TS-first workflows.
   */
  readonly authoring?: AuthoringContributions;
}

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

export type AuthoringArgumentDescriptor =
  | {
      readonly kind: 'string';
      readonly optional?: boolean;
    }
  | {
      readonly kind: 'number';
      readonly optional?: boolean;
      readonly integer?: boolean;
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly kind: 'stringArray';
      readonly optional?: boolean;
    }
  | {
      readonly kind: 'object';
      readonly optional?: boolean;
      readonly properties: Record<string, AuthoringArgumentDescriptor>;
    };

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

export interface AuthoringFieldPresetOutput extends AuthoringStorageTypeTemplate {
  readonly nullable?: boolean;
  readonly default?: AuthoringColumnDefaultTemplate;
  readonly executionDefault?: AuthoringTemplateValue;
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

export interface AuthoringContributions {
  readonly type?: AuthoringTypeNamespace;
  readonly field?: AuthoringFieldNamespace;
}

export function isAuthoringArgRef(value: unknown): value is AuthoringArgRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'arg' &&
    typeof (value as { index?: unknown }).index === 'number'
  );
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
    (value as { kind?: unknown }).kind === 'typeConstructor'
  );
}

export function isAuthoringFieldPresetDescriptor(
  value: unknown,
): value is AuthoringFieldPresetDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'fieldPreset'
  );
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

  if (descriptor.kind === 'stringArray') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Authoring helper argument at ${path} must be an array of strings`);
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
  const requiredCount = expected.filter((descriptor) => !descriptor.optional).length;
  if (args.length < requiredCount || args.length > expected.length) {
    throw new Error(
      `${helperPath} expects ${requiredCount === expected.length ? expected.length : `${requiredCount}-${expected.length}`} argument(s), received ${args.length}`,
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
):
  | {
      readonly kind: 'literal';
      readonly value: unknown;
    }
  | {
      readonly kind: 'function';
      readonly expression: string;
    } {
  if (template.kind === 'literal') {
    return {
      kind: 'literal',
      value: resolveAuthoringTemplateValue(template.value, args),
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
  readonly default?:
    | {
        readonly kind: 'literal';
        readonly value: unknown;
      }
    | {
        readonly kind: 'function';
        readonly expression: string;
      };
  readonly executionDefault?: unknown;
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
      'executionDefault',
      descriptor.output.executionDefault !== undefined
        ? resolveAuthoringTemplateValue(descriptor.output.executionDefault, args)
        : undefined,
    ),
    id: descriptor.output.id ?? false,
    unique: descriptor.output.unique ?? false,
  };
}

/**
 * Base descriptor for any framework component.
 * @template Kind — discriminant identifying the component type (e.g. `'family'`, `'target'`).
 */
export interface ComponentDescriptor<Kind extends string> extends ComponentMetadata {
  /** Discriminant identifying the component type. */
  readonly kind: Kind;
  /** Unique identifier for this component instance. */
  readonly id: string;
}

export interface ContractComponentRequirementsCheckInput {
  readonly contract: {
    readonly target: string;
    readonly targetFamily?: string | undefined;
    readonly extensionPacks?: Record<string, unknown> | undefined;
  };
  readonly expectedTargetFamily?: string | undefined;
  readonly expectedTargetId?: string | undefined;
  readonly providedComponentIds: Iterable<string>;
}

export interface ContractComponentRequirementsCheckResult {
  readonly familyMismatch?: { readonly expected: string; readonly actual: string } | undefined;
  readonly targetMismatch?: { readonly expected: string; readonly actual: string } | undefined;
  readonly missingExtensionPackIds: readonly string[];
}

export function checkContractComponentRequirements(
  input: ContractComponentRequirementsCheckInput,
): ContractComponentRequirementsCheckResult {
  const providedIds = new Set<string>();
  for (const id of input.providedComponentIds) {
    providedIds.add(id);
  }

  const requiredExtensionPackIds = input.contract.extensionPacks
    ? Object.keys(input.contract.extensionPacks)
    : [];
  const missingExtensionPackIds = requiredExtensionPackIds.filter((id) => !providedIds.has(id));

  const expectedTargetFamily = input.expectedTargetFamily;
  const contractTargetFamily = input.contract.targetFamily;
  const familyMismatch =
    expectedTargetFamily !== undefined &&
    contractTargetFamily !== undefined &&
    contractTargetFamily !== expectedTargetFamily
      ? { expected: expectedTargetFamily, actual: contractTargetFamily }
      : undefined;

  const expectedTargetId = input.expectedTargetId;
  const contractTargetId = input.contract.target;
  const targetMismatch =
    expectedTargetId !== undefined && contractTargetId !== expectedTargetId
      ? { expected: expectedTargetId, actual: contractTargetId }
      : undefined;

  return {
    ...(familyMismatch ? { familyMismatch } : {}),
    ...(targetMismatch ? { targetMismatch } : {}),
    missingExtensionPackIds,
  };
}

/**
 * A family groups data sources with shared semantics (e.g., SQL, document).
 * @template TFamilyId — literal string identifying this family (e.g. `'sql'`).
 */
export interface FamilyDescriptor<TFamilyId extends string> extends ComponentDescriptor<'family'> {
  /** The family this component belongs to. */
  readonly familyId: TFamilyId;
}

/**
 * A specific database within a family (e.g., Postgres, MySQL).
 * @template TFamilyId — literal string identifying the family (e.g. `'sql'`).
 * @template TTargetId — literal string identifying this target (e.g. `'postgres'`).
 */
export interface TargetDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'target'> {
  /** The family this target belongs to. */
  readonly familyId: TFamilyId;
  /** Unique identifier for this target within its family. */
  readonly targetId: TTargetId;
}

/**
 * Base shape for any pack reference.
 * Pack refs are pure JSON-friendly objects safe to import in authoring flows.
 */
export interface PackRefBase<Kind extends string, TFamilyId extends string>
  extends ComponentMetadata {
  readonly kind: Kind;
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId?: string;
}

export type TargetPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'target', TFamilyId> & {
  readonly targetId: TTargetId;
};

export type AdapterPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'adapter', TFamilyId> & {
  readonly targetId: TTargetId;
};

export type ExtensionPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'extension', TFamilyId> & {
  readonly targetId: TTargetId;
};

export type DriverPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'driver', TFamilyId> & {
  readonly targetId: TTargetId;
};

/**
 * Protocol and dialect implementation for a target.
 * @template TFamilyId — literal string identifying the family.
 * @template TTargetId — literal string identifying the target.
 */
export interface AdapterDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'adapter'> {
  /** The family this adapter belongs to. */
  readonly familyId: TFamilyId;
  /** The target this adapter implements. */
  readonly targetId: TTargetId;
}

/**
 * Connection and execution layer for a target.
 * @template TFamilyId — literal string identifying the family.
 * @template TTargetId — literal string identifying the target.
 */
export interface DriverDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'driver'> {
  /** The family this driver belongs to. */
  readonly familyId: TFamilyId;
  /** The target this driver connects to. */
  readonly targetId: TTargetId;
}

/**
 * Optional capability addition to a target (e.g., pgvector).
 * @template TFamilyId — literal string identifying the family.
 * @template TTargetId — literal string identifying the target.
 */
export interface ExtensionDescriptor<TFamilyId extends string, TTargetId extends string>
  extends ComponentDescriptor<'extension'> {
  /** The family this extension belongs to. */
  readonly familyId: TFamilyId;
  /** The target this extension augments. */
  readonly targetId: TTargetId;
}

/** Components bound to a specific family+target combination. */
export type TargetBoundComponentDescriptor<TFamilyId extends string, TTargetId extends string> =
  | TargetDescriptor<TFamilyId, TTargetId>
  | AdapterDescriptor<TFamilyId, TTargetId>
  | DriverDescriptor<TFamilyId, TTargetId>
  | ExtensionDescriptor<TFamilyId, TTargetId>;

export interface FamilyInstance<TFamilyId extends string> {
  readonly familyId: TFamilyId;
}

export interface TargetInstance<TFamilyId extends string, TTargetId extends string> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

export interface AdapterInstance<TFamilyId extends string, TTargetId extends string> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

export interface DriverInstance<TFamilyId extends string, TTargetId extends string> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

export interface ExtensionInstance<TFamilyId extends string, TTargetId extends string> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}
