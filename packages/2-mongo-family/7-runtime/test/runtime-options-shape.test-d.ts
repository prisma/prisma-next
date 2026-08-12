import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoExecutionContext, MongoRuntimeOptions } from '../src/exports/index';
import { createMongoRuntime } from '../src/mongo-runtime';

declare const ctx: MongoExecutionContext;

// MongoRuntimeOptions is { context, driver, middleware?, mode? }. No `codecs`
// field at the top level. The runtime reads codecs from `context.codecs`.

createMongoRuntime({
  context: ctx,
  driver: {} as never,
});

createMongoRuntime({
  context: ctx,
  driver: {} as never,
  // @ts-expect-error `codecs` is not a property of MongoRuntimeOptions —
  // codecs are aggregated via `createMongoExecutionContext` and reached
  // through `context.codecs`.
  codecs: {} as MongoCodecRegistry,
});

createMongoRuntime({
  context: ctx,
  driver: {} as never,
  // @ts-expect-error `adapter` is not a property of MongoRuntimeOptions —
  // the adapter is reached via `context.stack.adapter`.
  adapter: {} as never,
});

createMongoRuntime({
  context: ctx,
  driver: {} as never,
  // @ts-expect-error `targetId` is not a property of MongoRuntimeOptions —
  // the target is reached via `context.stack.target.targetId`.
  targetId: 'mongo',
});

createMongoRuntime({
  context: ctx,
  driver: {} as never,
  // @ts-expect-error `contract` is not a property of MongoRuntimeOptions —
  // the contract is reached via `context.contract`.
  contract: {},
});

declare const _options: MongoRuntimeOptions;
