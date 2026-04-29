import type { MongoStorageIndex } from './contract-types';

export type PolymorphicIndexScope = {
  readonly discriminatorField: string;
  readonly discriminatorValue: string | number | boolean;
};

export type ApplyScopeResult =
  | { readonly kind: 'ok'; readonly index: MongoStorageIndex }
  | { readonly kind: 'conflict'; readonly reason: string };

function isScalarDiscriminatorValue(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function applyPolymorphicScopeToMongoIndex(
  index: MongoStorageIndex,
  scope: PolymorphicIndexScope,
): ApplyScopeResult {
  if (!isScalarDiscriminatorValue(scope.discriminatorValue)) {
    return {
      kind: 'conflict',
      reason: `Variant-scoped indexes require a scalar (string, number, or boolean) discriminator value for field "${scope.discriminatorField}", but received ${formatValue(scope.discriminatorValue)}.`,
    };
  }

  const existing = index.partialFilterExpression;
  if (existing && Object.hasOwn(existing, scope.discriminatorField)) {
    const existingValue = existing[scope.discriminatorField];
    if (existingValue === scope.discriminatorValue) {
      return { kind: 'ok', index };
    }
    return {
      kind: 'conflict',
      reason: `Index partialFilterExpression sets "${scope.discriminatorField}" to ${formatValue(existingValue)}, which conflicts with the variant's discriminator value ${formatValue(scope.discriminatorValue)}.`,
    };
  }

  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    [scope.discriminatorField]: scope.discriminatorValue,
  };

  return {
    kind: 'ok',
    index: { ...index, partialFilterExpression: merged },
  };
}
