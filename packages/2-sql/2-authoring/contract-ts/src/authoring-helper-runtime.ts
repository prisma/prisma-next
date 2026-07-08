import type {
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeNamespace,
} from '@prisma-next/framework-components/authoring';
import {
  instantiateAuthoringTypeConstructor,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  validateAuthoringHelperArguments,
} from '@prisma-next/framework-components/authoring';
import { type StorageTypeInstance, toStorageTypeInstance } from '@prisma-next/sql-contract/types';

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

const blockedSegments = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeHelperKey(key: string, path: readonly string[]): void {
  if (blockedSegments.has(key)) {
    throw new Error(
      `Invalid authoring helper "${[...path, key].join('.')}". Helper path segments must not use "${key}".`,
    );
  }
}

export function createTypeHelpersFromNamespace(
  namespace: AuthoringTypeNamespace,
  path: readonly string[] = [],
): Record<string, unknown> {
  const helpers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(namespace)) {
    assertSafeHelperKey(key, path);
    const currentPath = [...path, key];

    if (isAuthoringTypeConstructorDescriptor(value)) {
      const helperPath = currentPath.join('.');
      helpers[key] = (...args: readonly unknown[]): StorageTypeInstance => {
        validateAuthoringHelperArguments(helperPath, value.args, args);
        const triple = instantiateAuthoringTypeConstructor(value, args);
        return toStorageTypeInstance({
          codecId: triple.codecId,
          nativeType: triple.nativeType,
          typeParams: triple.typeParams ?? {},
        });
      };
      continue;
    }

    helpers[key] = createTypeHelpersFromNamespace(value, currentPath);
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
    assertSafeHelperKey(key, path);
    const currentPath = [...path, key];

    if (isAuthoringFieldPresetDescriptor(value)) {
      helpers[key] = createLeafHelper({
        helperPath: currentPath.join('.'),
        descriptor: value,
      });
      continue;
    }

    helpers[key] = createFieldHelpersFromNamespace(value, createLeafHelper, currentPath);
  }

  return helpers;
}
