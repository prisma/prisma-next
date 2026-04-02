import type {
  AuthoringArgumentDescriptor,
  AuthoringFieldNamespace,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
  ExtensionPackRef,
  TargetPackRef,
} from '@prisma-next/contract/framework-components';
import {
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
} from '@prisma-next/contract/framework-components';
import {
  createFieldHelpersFromNamespace,
  createFieldPresetHelper,
  createTypeHelpersFromNamespace,
} from './authoring-helper-runtime';
import type {
  FieldHelpersFromNamespace,
  ResolveTemplateValue,
  TupleFromArgumentDescriptors,
  UnionToIntersection,
} from './authoring-type-utils';
import { buildFieldPreset, field, model, rel } from './staged-contract-dsl';

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
    ({ helperPath, descriptor }) =>
      createFieldPresetHelper({
        helperPath,
        descriptor,
        build: ({ args, namedConstraintOptions }) =>
          buildFieldPreset(descriptor, args, namedConstraintOptions),
      }),
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
