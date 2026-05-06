import mongo from '@prisma-next/mongo/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export function createClient(options: { url: string; dbName?: string }) {
  return mongo<Contract>({
    contractJson,
    url: options.url,
    ...(options.dbName !== undefined ? { dbName: options.dbName } : {}),
  });
}

export type Db = ReturnType<typeof createClient>;
