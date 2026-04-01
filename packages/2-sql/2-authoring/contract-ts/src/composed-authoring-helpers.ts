import type {
  AuthoringArgumentDescriptor,
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
  ExtensionPackRef,
  TargetPackRef,
} from '@prisma-next/contract/framework-components';
import {
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  validateAuthoringHelperArguments,
} from '@prisma-next/contract/framework-components';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  field,
  model,
  rel,
  ScalarFieldBuilder,
  type ScalarFieldState,
} from './staged-contract-dsl';

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type ExtractTypeNamespaceFromPack<Pack> = Pack extends {
  readonly authoring?: { readonly type?: infer Namespace extends AuthoringTypeNamespace };
}
  ? Namespace
  : Record<never, never>;

type ExtractFieldNamespaceFromPack<Pack> = Pack extends {
  readonly authoring?: { readonly field?: infer Namespace extends AuthoringFieldNamespace };
}
  ? Namespace
  : Record<never, never>;

type MergeExtensionTypeNamespaces<ExtensionPacks> =
  ExtensionPacks extends Record<string, unknown>
    ? keyof ExtensionPacks extends never
      ? Record<never, never>
      : UnionToIntersection<
          {
            [K in keyof ExtensionPacks]: ExtractTypeNamespaceFromPack<ExtensionPacks[K]>;
          }[keyof ExtensionPacks]
        >
    : Record<never, never>;

type MergeExtensionFieldNamespaces<ExtensionPacks> =
  ExtensionPacks extends Record<string, unknown>
    ? keyof ExtensionPacks extends never
      ? Record<never, never>
      : UnionToIntersection<
          {
            [K in keyof ExtensionPacks]: ExtractFieldNamespaceFromPack<ExtensionPacks[K]>;
          }[keyof ExtensionPacks]
        >
    : Record<never, never>;

type NamedConstraintSpec<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};

type OptionalObjectArgumentKeys<Properties extends Record<string, AuthoringArgumentDescriptor>> = {
  readonly [K in keyof Properties]: Properties[K] extends { readonly optional: true } ? K : never;
}[keyof Properties];

type ObjectArgumentType<Properties extends Record<string, AuthoringArgumentDescriptor>> = {
  readonly [K in Exclude<
    keyof Properties,
    OptionalObjectArgumentKeys<Properties>
  >]: ArgTypeFromDescriptor<Properties[K]>;
} & {
  readonly [K in OptionalObjectArgumentKeys<Properties>]?: ArgTypeFromDescriptor<Properties[K]>;
};

type ArgTypeFromDescriptor<Arg extends AuthoringArgumentDescriptor> = Arg extends {
  readonly kind: 'string';
}
  ? string
  : Arg extends { readonly kind: 'number' }
    ? number
    : Arg extends { readonly kind: 'stringArray' }
      ? readonly string[]
      : Arg extends {
            readonly kind: 'object';
            readonly properties: infer Properties extends Record<
              string,
              AuthoringArgumentDescriptor
            >;
          }
        ? ObjectArgumentType<Properties>
        : never;

type TupleFromArgumentDescriptors<Args extends readonly AuthoringArgumentDescriptor[]> = {
  readonly [K in keyof Args]: Args[K] extends AuthoringArgumentDescriptor
    ? ArgTypeFromDescriptor<Args[K]>
    : never;
};

type ResolveTemplateValue<Template, Args extends readonly unknown[]> = Template extends {
  readonly kind: 'arg';
  readonly index: infer Index extends number;
  readonly path?: infer Path extends readonly string[] | undefined;
  readonly default?: infer Default;
}
  ? ResolveTemplateArgValue<Args[Index], Path, Default, Args>
  : Template extends readonly unknown[]
    ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
    : Template extends Record<string, unknown>
      ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
      : Template;

type ResolveTemplatePathValue<
  Value,
  Path extends readonly string[] | undefined,
> = Path extends readonly [infer Segment extends string, ...infer Rest extends readonly string[]]
  ? Segment extends keyof NonNullable<Value>
    ? ResolveTemplatePathValue<NonNullable<Value>[Segment], Rest>
    : never
  : Value;

type ResolveTemplateDefaultValue<
  Value,
  Default,
  Args extends readonly unknown[],
> = Default extends undefined
  ? Value
  : [Value] extends [never]
    ? ResolveTemplateValue<Default, Args>
    : undefined extends Value
      ? Exclude<Value, undefined> | ResolveTemplateValue<Default, Args>
      : Value;

type ResolveTemplateArgValue<
  Value,
  Path extends readonly string[] | undefined,
  Default,
  Args extends readonly unknown[],
> = ResolveTemplateDefaultValue<ResolveTemplatePathValue<Value, Path>, Default, Args>;

type StorageTypeFromDescriptor<
  Descriptor extends AuthoringTypeConstructorDescriptor,
  Args extends readonly unknown[],
> = {
  readonly codecId: ResolveTemplateValue<Descriptor['output']['codecId'], Args>;
  readonly nativeType: ResolveTemplateValue<Descriptor['output']['nativeType'], Args>;
} & (Descriptor['output'] extends {
  readonly typeParams: infer TypeParams extends Record<string, unknown>;
}
  ? {
      readonly typeParams: ResolveTemplateValue<TypeParams, Args>;
    }
  : Record<never, never>);

type TypeHelperFunction<Descriptor extends AuthoringTypeConstructorDescriptor> =
  Descriptor extends { readonly args: infer Args extends readonly AuthoringArgumentDescriptor[] }
    ? <const Params extends TupleFromArgumentDescriptors<Args>>(
        ...args: Params
      ) => StorageTypeFromDescriptor<Descriptor, Params>
    : () => StorageTypeFromDescriptor<Descriptor, readonly []>;

type TypeHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringTypeConstructorDescriptor
    ? TypeHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? TypeHelpersFromNamespace<Namespace[K]>
      : never;
};

type NamedConstraintState<
  Enabled extends boolean,
  Name extends string | undefined = undefined,
> = Enabled extends true ? NamedConstraintSpec<Name> : undefined;

type FieldBuilderFromPresetDescriptor<
  Descriptor extends AuthoringFieldPresetDescriptor,
  Args extends readonly unknown[],
  ConstraintName extends string | undefined = undefined,
> = ScalarFieldBuilder<
  ScalarFieldState<
    ResolveTemplateValue<Descriptor['output']['codecId'], Args> extends string
      ? ResolveTemplateValue<Descriptor['output']['codecId'], Args>
      : string,
    undefined,
    ResolveTemplateValue<Descriptor['output']['nullable'], Args> extends true ? true : false,
    undefined,
    NamedConstraintState<
      ResolveTemplateValue<Descriptor['output']['id'], Args> extends true ? true : false,
      ConstraintName
    >,
    NamedConstraintState<
      ResolveTemplateValue<Descriptor['output']['unique'], Args> extends true ? true : false,
      ConstraintName
    >
  >
>;

type SupportsNamedConstraintOptions<Descriptor extends AuthoringFieldPresetDescriptor> =
  Descriptor['output'] extends { readonly id: true }
    ? true
    : Descriptor['output'] extends { readonly unique: true }
      ? true
      : false;

type FieldHelperFunctionWithoutNamedConstraint<Descriptor extends AuthoringFieldPresetDescriptor> =
  Descriptor extends { readonly args: infer Args extends readonly AuthoringArgumentDescriptor[] }
    ? <const Params extends TupleFromArgumentDescriptors<Args>>(
        ...args: Params
      ) => FieldBuilderFromPresetDescriptor<Descriptor, Params>
    : () => FieldBuilderFromPresetDescriptor<Descriptor, readonly []>;

type FieldHelperFunctionWithNamedConstraint<Descriptor extends AuthoringFieldPresetDescriptor> =
  Descriptor extends { readonly args: infer Args extends readonly AuthoringArgumentDescriptor[] }
    ? <
        const Params extends TupleFromArgumentDescriptors<Args>,
        const Name extends string | undefined = undefined,
      >(
        ...args: [...params: Params, options?: NamedConstraintSpec<Name>]
      ) => FieldBuilderFromPresetDescriptor<Descriptor, Params, Name>
    : <const Name extends string | undefined = undefined>(
        options?: NamedConstraintSpec<Name>,
      ) => FieldBuilderFromPresetDescriptor<Descriptor, readonly [], Name>;

type FieldHelperFunction<Descriptor extends AuthoringFieldPresetDescriptor> =
  SupportsNamedConstraintOptions<Descriptor> extends true
    ? FieldHelperFunctionWithNamedConstraint<Descriptor>
    : FieldHelperFunctionWithoutNamedConstraint<Descriptor>;

type FieldHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringFieldPresetDescriptor
    ? FieldHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? FieldHelpersFromNamespace<Namespace[K]>
      : never;
};

type CoreFieldHelpers = Pick<typeof field, 'column' | 'generated' | 'namedType'>;

export type ComposedAuthoringHelpers<
  Target extends TargetPackRef<'sql', string>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = {
  readonly field: CoreFieldHelpers &
    FieldHelpersFromNamespace<
      ExtractFieldNamespaceFromPack<Target> & MergeExtensionFieldNamespaces<ExtensionPacks>
    >;
  readonly model: typeof model;
  readonly rel: typeof rel;
  readonly type: TypeHelpersFromNamespace<
    ExtractTypeNamespaceFromPack<Target> & MergeExtensionTypeNamespaces<ExtensionPacks>
  >;
};

function extractTypeNamespace<Pack>(pack: Pack): ExtractTypeNamespaceFromPack<Pack> {
  return ((pack as { readonly authoring?: { readonly type?: unknown } }).authoring?.type ??
    {}) as ExtractTypeNamespaceFromPack<Pack>;
}

function extractFieldNamespace<Pack>(pack: Pack): ExtractFieldNamespaceFromPack<Pack> {
  return ((pack as { readonly authoring?: { readonly field?: unknown } }).authoring?.field ??
    {}) as ExtractFieldNamespaceFromPack<Pack>;
}

function mergeHelperNamespaces(
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

    mergeHelperNamespaces(
      existingValue as Record<string, unknown>,
      sourceValue as Record<string, unknown>,
      currentPath,
      leafGuard,
      label,
    );
  }
}

function createTypeHelpersFromNamespace(
  namespace: AuthoringTypeNamespace,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];

    if (isAuthoringTypeConstructorDescriptor(value)) {
      const helperPath = currentPath.join('.');
      helpers[key] = (...args: readonly unknown[]) => {
        validateAuthoringHelperArguments(helperPath, value.args, args);
        return instantiateAuthoringTypeConstructor(value, args) as StorageTypeInstance;
      };
      continue;
    }

    helpers[key] = createTypeHelpersFromNamespace(value as AuthoringTypeNamespace, currentPath);
  }

  return helpers;
}

function createFieldHelpersFromNamespace(
  namespace: AuthoringFieldNamespace,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];

    if (isAuthoringFieldPresetDescriptor(value)) {
      const helperPath = currentPath.join('.');
      helpers[key] = (...rawArgs: readonly unknown[]) => {
        const acceptsNamedConstraintOptions =
          value.output.id === true || value.output.unique === true;
        const declaredArguments = value.args ?? [];

        if (acceptsNamedConstraintOptions && rawArgs.length > declaredArguments.length + 1) {
          throw new Error(
            `${helperPath} expects at most ${declaredArguments.length + 1} argument(s), received ${rawArgs.length}`,
          );
        }

        let args = rawArgs;
        let namedConstraintOptions: RuntimeNamedConstraintSpec | undefined;

        if (acceptsNamedConstraintOptions && rawArgs.length === declaredArguments.length + 1) {
          const maybeNamedConstraintOptions = rawArgs.at(-1);
          if (!isNamedConstraintOptionsLike(maybeNamedConstraintOptions)) {
            throw new Error(
              `${helperPath} accepts an optional trailing { name?: string } constraint options object`,
            );
          }
          namedConstraintOptions = maybeNamedConstraintOptions;
          args = rawArgs.slice(0, -1);
        }

        validateAuthoringHelperArguments(helperPath, value.args, args);
        const preset = instantiateAuthoringFieldPreset(value, args);

        return new ScalarFieldBuilder({
          kind: 'scalar',
          descriptor: preset.descriptor,
          nullable: preset.nullable,
          ...(preset.default ? { default: preset.default as ColumnDefault } : {}),
          ...(preset.executionDefault
            ? { executionDefault: preset.executionDefault as ExecutionMutationDefaultValue }
            : {}),
          ...(preset.id
            ? {
                id: namedConstraintOptions?.name ? { name: namedConstraintOptions.name } : {},
              }
            : {}),
          ...(preset.unique
            ? {
                unique: namedConstraintOptions?.name ? { name: namedConstraintOptions.name } : {},
              }
            : {}),
        });
      };
      continue;
    }

    helpers[key] = createFieldHelpersFromNamespace(value as AuthoringFieldNamespace, currentPath);
  }

  return helpers;
}

type RuntimeNamedConstraintSpec = {
  readonly name?: string;
};

function isNamedConstraintOptionsLike(value: unknown): value is RuntimeNamedConstraintSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.some((key) => key !== 'name')) {
    return false;
  }

  const name = (value as { readonly name?: unknown }).name;
  return name === undefined || typeof name === 'string';
}

function composeTypeNamespace(
  target: TargetPackRef<'sql', string>,
  extensionPacks: Record<string, ExtensionPackRef<'sql', string>> | undefined,
): AuthoringTypeNamespace {
  const merged: Record<string, unknown> = {};

  mergeHelperNamespaces(
    merged,
    extractTypeNamespace(target),
    [],
    isAuthoringTypeConstructorDescriptor,
    'type',
  );

  for (const pack of Object.values(extensionPacks ?? {})) {
    mergeHelperNamespaces(
      merged,
      extractTypeNamespace(pack),
      [],
      isAuthoringTypeConstructorDescriptor,
      'type',
    );
  }

  return merged as AuthoringTypeNamespace;
}

function composeFieldNamespace(
  target: TargetPackRef<'sql', string>,
  extensionPacks: Record<string, ExtensionPackRef<'sql', string>> | undefined,
): AuthoringFieldNamespace {
  const merged: Record<string, unknown> = {};

  mergeHelperNamespaces(
    merged,
    extractFieldNamespace(target),
    [],
    isAuthoringFieldPresetDescriptor,
    'field',
  );

  for (const pack of Object.values(extensionPacks ?? {})) {
    mergeHelperNamespaces(
      merged,
      extractFieldNamespace(pack),
      [],
      isAuthoringFieldPresetDescriptor,
      'field',
    );
  }

  return merged as AuthoringFieldNamespace;
}

function createComposedFieldHelpers(
  target: TargetPackRef<'sql', string>,
  extensionPacks: Record<string, ExtensionPackRef<'sql', string>> | undefined,
): CoreFieldHelpers & Record<string, unknown> {
  const helperNamespace = createFieldHelpersFromNamespace(
    composeFieldNamespace(target, extensionPacks),
  );
  const coreFieldHelpers = {
    column: field.column,
    generated: field.generated,
    namedType: field.namedType,
  } satisfies CoreFieldHelpers;

  const coreHelperNames = new Set(Object.keys(coreFieldHelpers));
  for (const helperName of Object.keys(helperNamespace)) {
    if (coreHelperNames.has(helperName)) {
      throw new Error(
        `Duplicate authoring field helper "${helperName}". Core field helpers reserve that name.`,
      );
    }
  }

  return {
    ...coreFieldHelpers,
    ...helperNamespace,
  };
}

export function createComposedAuthoringHelpers<
  Target extends TargetPackRef<'sql', string>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
>(options: {
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
}): ComposedAuthoringHelpers<Target, ExtensionPacks> {
  return {
    field: createComposedFieldHelpers(options.target, options.extensionPacks),
    model,
    rel,
    type: createTypeHelpersFromNamespace(
      composeTypeNamespace(options.target, options.extensionPacks),
    ),
  } as ComposedAuthoringHelpers<Target, ExtensionPacks>;
}
