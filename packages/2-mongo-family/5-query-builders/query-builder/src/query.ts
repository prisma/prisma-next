import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type { AnyMongoCommand, MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { type CollectionHandle, createCollectionHandle } from './state-classes';

/**
 * Public entry point of the query builder. `mongoQuery(...).from(rootName)`
 * yields the root state of the three-state machine
 * (`CollectionHandle` → `FilteredCollection` → `PipelineChain`).
 *
 * `rawCommand(cmd)` is the escape hatch for cases the typed surface does
 * not cover (yet) — it accepts any `AnyMongoCommand` (typed CRUD or a
 * `RawMongoCommand` of `Document`s) and packages it into a `MongoQueryPlan`
 * with `lane: 'mongo-query'`. Row type is `unknown` because the runtime
 * cannot know what the caller's command yields.
 */
export interface QueryRoot<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  from<K extends keyof TContract['roots'] & string>(
    rootName: K,
  ): CollectionHandle<TContract, TContract['roots'][K] & string & keyof TContract['models']>;
  rawCommand(command: AnyMongoCommand): MongoQueryPlan<unknown>;
}

export function mongoQuery<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: { contractJson: unknown }): QueryRoot<TContract> {
  const contract = options.contractJson as TContract;
  return {
    from<K extends keyof TContract['roots'] & string>(rootName: K) {
      return createCollectionHandle(contract, rootName);
    },
    rawCommand(command: AnyMongoCommand): MongoQueryPlan<unknown> {
      const c = contract as unknown as MongoContract;
      const storageHash = c.storage?.storageHash;
      if (!storageHash) {
        throw new Error(
          'Contract is missing storage.storageHash. Pass a validated contract to mongoQuery().',
        );
      }
      const meta: PlanMeta = {
        target: 'mongo',
        storageHash: String(storageHash),
        lane: 'mongo-query',
        paramDescriptors: [],
      };
      return { collection: command.collection, command, meta };
    },
  };
}
