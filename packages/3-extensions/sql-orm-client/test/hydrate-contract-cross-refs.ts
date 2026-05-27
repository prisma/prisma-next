import { type CrossReference, crossRef } from '@prisma-next/contract/types';
import type { Contract as EmittedOrmContract } from './fixtures/generated/contract';

type CrossRefFor<M extends string> = CrossReference & { readonly model: M };

type HydrateRelationTo<R> = R extends {
  readonly to: infer M extends string;
  readonly cardinality: infer C;
  readonly on: infer O;
}
  ? { readonly to: CrossRefFor<M>; readonly cardinality: C; readonly on: O }
  : R extends { readonly to: infer M extends string; readonly cardinality: infer C }
    ? { readonly to: CrossRefFor<M>; readonly cardinality: C }
    : R;

type HydrateModelRelations<M> = M extends {
  readonly relations: infer R extends Record<string, unknown>;
}
  ? Omit<M, 'relations'> & {
      readonly relations: { [K in keyof R]: HydrateRelationTo<R[K]> };
    }
  : M;

type HydrateModelBase<M> = M extends { readonly base: infer B extends string }
  ? Omit<M, 'base'> & { readonly base: CrossRefFor<B> }
  : M;

type HydrateModels<M extends Record<string, unknown>> = {
  [K in keyof M]: HydrateModelBase<HydrateModelRelations<M[K]>>;
};

type HydrateRootValue<V> = V extends string ? CrossRefFor<V> : V;

export type OrmTestContract = Omit<EmittedOrmContract, 'roots' | 'models'> & {
  readonly roots: {
    [K in keyof EmittedOrmContract['roots']]: HydrateRootValue<EmittedOrmContract['roots'][K]>;
  };
  readonly models: HydrateModels<EmittedOrmContract['models']>;
};

function hydrateCrossRef(value: unknown): CrossReference {
  if (typeof value === 'string') {
    return crossRef(value);
  }
  return value as CrossReference;
}

function hydrateModels(models: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(models).map(([modelName, model]) => {
      if (typeof model !== 'object' || model === null) {
        return [modelName, model];
      }
      const modelRecord = model as Record<string, unknown>;
      const relations =
        typeof modelRecord['relations'] === 'object' && modelRecord['relations'] !== null
          ? Object.fromEntries(
              Object.entries(modelRecord['relations'] as Record<string, unknown>).map(
                ([relName, rel]) => {
                  if (typeof rel !== 'object' || rel === null) {
                    return [relName, rel];
                  }
                  const relRecord = rel as Record<string, unknown>;
                  return [
                    relName,
                    'to' in relRecord
                      ? { ...relRecord, to: hydrateCrossRef(relRecord['to']) }
                      : rel,
                  ];
                },
              ),
            )
          : modelRecord['relations'];
      const base =
        typeof modelRecord['base'] === 'string'
          ? hydrateCrossRef(modelRecord['base'])
          : modelRecord['base'];
      return [
        modelName,
        {
          ...modelRecord,
          ...(relations !== undefined ? { relations } : {}),
          ...(base !== undefined ? { base } : {}),
        },
      ];
    }),
  );
}

export function hydrateOrmContractJson<
  T extends { readonly roots: Record<string, unknown>; readonly models?: Record<string, unknown> },
>(contractJson: T): T & OrmTestContract {
  const roots = Object.fromEntries(
    Object.entries(contractJson.roots).map(([rootName, rootValue]) => [
      rootName,
      hydrateCrossRef(rootValue),
    ]),
  );
  const models = contractJson.models ? hydrateModels(contractJson.models) : contractJson.models;
  return { ...contractJson, roots, models } as T & OrmTestContract;
}
