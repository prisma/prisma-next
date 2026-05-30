import { MongoContractSerializerBase } from '@prisma-next/family-mongo/ir';
import {
  storageNamespaceEntries,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  buildMongoStorageInput,
  type MongoContract,
  type MongoNamespaceShape,
  MongoStorage,
} from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from './mongo-target-database';

export class MongoTargetContractSerializer extends MongoContractSerializerBase<MongoTargetContract> {
  protected constructTargetContract(validated: MongoContract): MongoTargetContract {
    const { storage, ...rest } = validated;
    const namespaces = Object.fromEntries(
      [...storageNamespaceEntries(storage)].map(([nsId, nsData]) => {
        const ns = nsData as MongoNamespaceShape;
        const collections = ns.collections;
        const collectionCount = Object.keys(collections).length;
        if (nsId === UNBOUND_NAMESPACE_ID && collectionCount === 0) {
          return [nsId, MongoTargetUnboundDatabase.instance];
        }
        return [
          nsId,
          new MongoTargetDatabase({
            id: ns.id,
            collections,
          }),
        ];
      }),
    );
    const targetStorage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: storage.storageHash,
        namespaces,
      }),
    );
    return { ...rest, storage: targetStorage };
  }

  override serializeContract(contract: MongoTargetContract): JsonObject {
    const { storage, ...rest } = contract;
    const storageOut: Record<string, JsonObject | string> = {
      storageHash: String(storage.storageHash),
    };
    for (const [nsId, ns] of [...storageNamespaceEntries(storage)]) {
      const mongoNs = ns as MongoNamespaceShape;
      const collectionsOut: Record<string, JsonObject> = {};
      for (const [collName, coll] of Object.entries(mongoNs.collections)) {
        collectionsOut[collName] = JSON.parse(JSON.stringify(coll)) as JsonObject;
      }
      storageOut[nsId] = {
        id: mongoNs.id,
        kind: 'mongo-database',
        collections: collectionsOut,
      };
    }
    return {
      ...rest,
      storage: storageOut,
      // `rest` carries Contract fields typed against framework interfaces
      // (e.g. `ContractExecutionSection`) that TypeScript can't structurally
      // prove are JSON-compatible without a per-field re-validation pass.
      // The runtime invariant is that an emitted MongoTargetContract has
      // already been through validation and contains only JSON-safe values,
      // so the two-step cast is intentional. Mirrors the pattern in
      // PostgresContractSerializer.serializeContract.
    } as unknown as JsonObject;
  }
}
