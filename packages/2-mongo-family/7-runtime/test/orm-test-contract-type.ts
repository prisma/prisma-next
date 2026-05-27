import type { CrossReference } from '@prisma-next/contract/types';
import type { Contract as EmittedOrmContract } from '../../1-foundation/mongo-contract/test/fixtures/orm-contract';

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

export type OrmTestContract = Omit<EmittedOrmContract, 'roots' | 'models'> & {
  readonly roots: {
    readonly tasks: CrossRefFor<'Task'>;
    readonly users: CrossRefFor<'User'>;
  };
  readonly models: HydrateModels<EmittedOrmContract['models']>;
};
