import type {
  ColumnDefault,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';
import {
  isColumnDefaultLiteralInputValue,
  isExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';
import { ifDefined } from '@prisma-next/utils/defined';

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

export interface AuthoringContributions {
  readonly type?: AuthoringTypeNamespace;
  readonly field?: AuthoringFieldNamespace;
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
          value as Readonly<Record<string, unknown>>,
          isLeaf,
          currentPath,
        ),
      );
    }
  }
  return paths;
}

export function assertNoCrossRegistryCollisions(
  typeNamespace: AuthoringTypeNamespace,
  fieldNamespace: AuthoringFieldNamespace,
): void {
  const typePaths = new Set(
    collectAuthoringLeafPaths(typeNamespace, isAuthoringTypeConstructorDescriptor),
  );
  // Within-registry duplicate detection is handled upstream by the merge
  // walker (`mergeAuthoringNamespaces` in control-stack.ts and
  // `mergeHelperNamespaces` in composed-authoring-helpers.ts), which throws
  // on same-path registrations within either registry before this check
  // runs. This function only handles the cross-registry case — and an
  // empty type namespace makes a cross-registry collision structurally
  // impossible, so the early-out is sound.
  if (typePaths.size === 0) {
    return;
  }
  for (const fieldPath of collectAuthoringLeafPaths(
    fieldNamespace,
    isAuthoringFieldPresetDescriptor,
  )) {
    if (typePaths.has(fieldPath)) {
      throw new Error(
        `Ambiguous authoring registry path "${fieldPath}". The same path is registered as both a type constructor and a field preset; PSL resolution would be ambiguous. Register each path in only one of authoringContributions.field / authoringContributions.type.`,
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
