import { MongoContractSerializerBase } from '@prisma-next/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { type MongoContract, MongoStorage } from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from './mongo-target-database';

export class MongoTargetContractSerializer extends MongoContractSerializerBase<MongoTargetContract> {
  protected constructTargetContract(validated: MongoContract): MongoTargetContract {
    const { storage, ...rest } = validated;
    const namespaces = Object.fromEntries(
      Object.entries(storage.namespaces).map(([nsId, nsData]) => {
        const tables = nsData.tables;
        const tableCount = Object.keys(tables).length;
        if (nsId === UNBOUND_NAMESPACE_ID && tableCount === 0) {
          return [nsId, MongoTargetUnboundDatabase.instance];
        }
        return [
          nsId,
          new MongoTargetDatabase({
            id: nsData.id,
            tables,
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
      const tablesOut: Record<string, JsonObject> = {};
      for (const [collName, coll] of Object.entries(ns.tables)) {
        tablesOut[collName] = JSON.parse(JSON.stringify(coll)) as JsonObject;
      }
      namespacesJson[nsId] = {
        id: ns.id,
        kind: 'mongo-database',
        tables: tablesOut,
      };
    }
    return {
      ...rest,
      storage: {
        storageHash: String(storage.storageHash),
        namespaces: namespacesJson,
      },
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
