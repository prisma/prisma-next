import { MongoContractSerializerBase } from '@prisma-next/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { type MongoContract, MongoStorage } from '@prisma-next/mongo-contract';
import { blindCast } from '@prisma-next/utils/casts';
import type { JsonObject } from '@prisma-next/utils/json';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from './mongo-target-database';

export class MongoTargetContractSerializer extends MongoContractSerializerBase<MongoTargetContract> {
  protected constructTargetContract(validated: MongoContract): MongoTargetContract {
    const { storage, ...rest } = validated;
    const namespaces = Object.fromEntries(
      Object.entries(storage.namespaces).map(([nsId, nsData]) => {
        const collections = nsData.entries.collection;
        const collectionCount = Object.keys(collections).length;
        if (nsId === UNBOUND_NAMESPACE_ID && collectionCount === 0) {
          return [nsId, MongoTargetUnboundDatabase.instance];
        }
        return [
          nsId,
          new MongoTargetDatabase({
            id: nsData.id,
            entries: { collection: collections },
          }),
        ];
      }),
    );
    const targetStorage = new MongoStorage({
      storageHash: storage.storageHash,
      namespaces,
    });
    return { ...rest, storage: targetStorage };
  }

  override serializeContract(contract: MongoTargetContract): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      const collectionsOut: Record<string, JsonObject> = {};
      for (const [collName, coll] of Object.entries(ns.entries.collection)) {
        collectionsOut[collName] = JSON.parse(JSON.stringify(coll)) as JsonObject;
      }
      namespacesJson[nsId] = {
        id: ns.id,
        kind: 'mongo-database',
        entries: { collection: collectionsOut },
      };
    }
    return blindCast<
      JsonObject,
      'rest carries plain domain/capabilities JSON fields; storage has been serialized to JSON-safe form'
    >({
      ...rest,
      storage: {
        storageHash: String(storage.storageHash),
        namespaces: namespacesJson,
      },
    });
  }
}
