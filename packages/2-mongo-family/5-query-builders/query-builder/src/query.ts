import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { type CollectionHandle, createCollectionHandle } from './state-classes';

/**
 * Public entry point of the query builder. `mongoQuery(...).from(rootName)`
 * yields the root state of the three-state machine
 * (`CollectionHandle` → `FilteredCollection` → `PipelineChain`).
 */
export interface QueryRoot<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  from<K extends keyof TContract['roots'] & string>(
    rootName: K,
  ): CollectionHandle<TContract, TContract['roots'][K] & string & keyof TContract['models']>;
}

export function mongoQuery<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: { contractJson: unknown }): QueryRoot<TContract> {
  const contract = options.contractJson as TContract;
  return {
    from<K extends keyof TContract['roots'] & string>(rootName: K) {
      return createCollectionHandle(contract, rootName);
    },
  };
}
