import type {
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeNamespace,
} from '@prisma-next/contract/framework-components';
import {
  instantiateAuthoringTypeConstructor,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  validateAuthoringHelperArguments,
} from '@prisma-next/contract/framework-components';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';

export type RuntimeNamedConstraintSpec = {
  readonly name?: string;
};

export function isNamedConstraintOptionsLike(value: unknown): value is RuntimeNamedConstraintSpec {
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

export function createTypeHelpersFromNamespace(
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

export function createFieldPresetHelper<Result>(options: {
  readonly helperPath: string;
  readonly descriptor: AuthoringFieldPresetDescriptor;
  readonly build: (options: {
    readonly args: readonly unknown[];
    readonly namedConstraintOptions?: RuntimeNamedConstraintSpec;
  }) => Result;
}): (...rawArgs: readonly unknown[]) => Result {
  return (...rawArgs: readonly unknown[]) => {
    const acceptsNamedConstraintOptions =
      options.descriptor.output.id === true || options.descriptor.output.unique === true;
    const declaredArguments = options.descriptor.args ?? [];

    if (acceptsNamedConstraintOptions && rawArgs.length > declaredArguments.length + 1) {
      throw new Error(
        `${options.helperPath} expects at most ${declaredArguments.length + 1} argument(s), received ${rawArgs.length}`,
      );
    }

    let args = rawArgs;
    let namedConstraintOptions: RuntimeNamedConstraintSpec | undefined;

    if (acceptsNamedConstraintOptions && rawArgs.length === declaredArguments.length + 1) {
      const maybeNamedConstraintOptions = rawArgs.at(-1);
      if (!isNamedConstraintOptionsLike(maybeNamedConstraintOptions)) {
        throw new Error(
          `${options.helperPath} accepts an optional trailing { name?: string } constraint options object`,
        );
      }
      namedConstraintOptions = maybeNamedConstraintOptions;
      args = rawArgs.slice(0, -1);
    }

    validateAuthoringHelperArguments(options.helperPath, options.descriptor.args, args);

    return options.build({
      args,
      ...(namedConstraintOptions ? { namedConstraintOptions } : {}),
    });
  };
}

export function createFieldHelpersFromNamespace(
  namespace: AuthoringFieldNamespace,
  createLeafHelper: (options: {
    readonly helperPath: string;
    readonly descriptor: AuthoringFieldPresetDescriptor;
  }) => (...rawArgs: readonly unknown[]) => unknown,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];

    if (isAuthoringFieldPresetDescriptor(value)) {
      helpers[key] = createLeafHelper({
        helperPath: currentPath.join('.'),
        descriptor: value,
      });
      continue;
    }

    helpers[key] = createFieldHelpersFromNamespace(
      value as AuthoringFieldNamespace,
      createLeafHelper,
      currentPath,
    );
  }

  return helpers;
}
