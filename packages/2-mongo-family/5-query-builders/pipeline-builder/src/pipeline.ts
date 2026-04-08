import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { PipelineBuilder } from './builder';
import type { ModelToDocShape } from './types';

export interface PipelineRoot<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  from<K extends keyof TContract['roots'] & string>(
    rootName: K,
  ): PipelineBuilder<
    TContract,
    ModelToDocShape<TContract, TContract['roots'][K] & string & keyof TContract['models']>
  >;
}

export function mongoPipeline<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: { contractJson: unknown }): PipelineRoot<TContract> {
  const contract = options.contractJson as TContract;
  return {
    from<K extends keyof TContract['roots'] & string>(rootName: K) {
      const modelName = (contract as MongoContract).roots[rootName];
      if (!modelName) {
        throw new Error(`Unknown root: ${rootName}`);
      }
      const model = (contract as MongoContract).models[modelName];
      if (!model) {
        throw new Error(`Unknown model: ${modelName}`);
      }
      const collectionName = model.storage?.collection ?? rootName;
      const storage = (contract as MongoContract).storage;
      if (!storage?.storageHash) {
        throw new Error(
          'Contract is missing storage.storageHash. Pass a validated contract to mongoPipeline().',
        );
      }
      const storageHash = storage.storageHash;

      type ResultShape = ModelToDocShape<
        TContract,
        TContract['roots'][K] & string & keyof TContract['models']
      >;

      return new PipelineBuilder<TContract, ResultShape>(contract, {
        collection: collectionName,
        stages: [],
        storageHash: String(storageHash),
      });
    },
  };
}
