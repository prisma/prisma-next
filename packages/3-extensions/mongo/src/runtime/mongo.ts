import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import type { MongoRuntime } from '@prisma-next/mongo-runtime';
import { createMongoRuntime } from '@prisma-next/mongo-runtime';

export interface MongoOptions {
  readonly contractJson: unknown;
}

export interface MongoClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
  connect(uri: string, dbName: string): Promise<ConnectedMongoClient<TContract>>;
}

export interface ConnectedMongoClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> {
  readonly orm: ReturnType<typeof mongoOrm<TContract>>;
  readonly runtime: MongoRuntime;
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
  readonly contract: TContract;
  close(): Promise<void>;
}

export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
>(options: MongoOptions): MongoClient<TContract> {
  const { contract } = validateMongoContract<TContract>(options.contractJson);
  const query = mongoQuery<TContract>({ contractJson: options.contractJson });

  return {
    query,
    async connect(uri: string, dbName: string): Promise<ConnectedMongoClient<TContract>> {
      const adapter = createMongoAdapter();
      const driver = await createMongoDriver(uri, dbName);
      const runtime = createMongoRuntime({ adapter, driver, contract, targetId: 'mongo' });
      const orm = mongoOrm<TContract>({ contract, executor: runtime });

      return {
        orm,
        runtime,
        query,
        contract,
        async close() {
          await runtime.close();
        },
      };
    },
  };
}
