import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  AnyMongoTypeMaps,
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  RootModelName,
} from '@prisma-next/mongo-contract';
import type { AnyMongoCommand, MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { createFn, type MongoFn } from './expression-helpers';
import { asMongoContract, type CollectionHandle, createCollectionHandle } from './state-classes';
import type { MongoOperationCodecTable } from './types';

/**
 * Public entry point of the query builder. `mongoQuery(...).from(rootName)`
 * yields the root state of the three-state machine
 * (`CollectionHandle` → `FilteredCollection` → `PipelineChain`).
 *
 * The root also exposes the context-bound `fn` expression helpers, minted
 * from the adapter-declared `operationCodecs` table, for standalone
 * expression construction outside stage callbacks.
 *
 * `rawCommand(cmd)` is the escape hatch for cases the typed surface does
 * not cover (yet) — it accepts any `AnyMongoCommand` (typed CRUD or a
 * `RawMongoCommand` of `Document`s) and packages it into a `MongoQueryPlan`
 * with `lane: 'mongo-query'`. Row type is `unknown` because the runtime
 * cannot know what the caller's command yields.
 */
export interface QueryRoot<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  TOps extends MongoOperationCodecTable = MongoOperationCodecTable,
> {
  from<K extends keyof TContract['roots'] & string>(
    rootName: K,
  ): CollectionHandle<TContract, RootModelName<TContract, K>, TOps>;
  rawCommand<C extends AnyMongoCommand>(command: C): MongoQueryPlan<unknown, C>;
  readonly fn: MongoFn<TOps, ExtractMongoCodecTypes<TContract>>;
}

/**
 * Construct a query root from a validated contract and the adapter's
 * operation→output-codec table. `operationCodecs` is required — a builder
 * without codec knowledge cannot mint the `fn` helpers, and the family
 * declares no fallback table of its own. The supported production surface
 * threads it from the execution context (`mongoStatic()`); tests construct
 * a local table.
 */
export function mongoQuery<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  TOps extends MongoOperationCodecTable,
>(options: { contractJson: TContract; operationCodecs: TOps }): QueryRoot<TContract, TOps> {
  const contract = options.contractJson;
  const operationCodecs = options.operationCodecs;
  return {
    from<K extends keyof TContract['roots'] & string>(rootName: K) {
      return createCollectionHandle(contract, rootName, operationCodecs);
    },
    rawCommand<C extends AnyMongoCommand>(command: C): MongoQueryPlan<unknown, C> {
      const c = asMongoContract(contract);
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
      };
      return { collection: command.collection, command, meta };
    },
    fn: createFn<TOps, ExtractMongoCodecTypes<TContract>>(operationCodecs),
  };
}
