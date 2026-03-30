import type { MongoContract } from '@prisma-next/mongo-core';
import type { MongoOrmClient, MongoOrmOptions } from './types';

export function mongoOrm<TContract extends MongoContract>(
  _options: MongoOrmOptions<TContract>,
): MongoOrmClient<TContract> {
  throw new Error('Not yet implemented');
}
