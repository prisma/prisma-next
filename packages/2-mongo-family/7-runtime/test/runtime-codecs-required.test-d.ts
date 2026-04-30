import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import { createMongoRuntime } from '../src/mongo-runtime';

// @ts-expect-error codecs is required on MongoRuntimeOptions
createMongoRuntime({
  adapter: {} as never,
  driver: {} as never,
  contract: {},
  targetId: 'mongo',
});

export type _CodecRegistry = MongoCodecRegistry;
