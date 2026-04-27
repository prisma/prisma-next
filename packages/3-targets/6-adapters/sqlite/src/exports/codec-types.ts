// Facade over `@prisma-next/target-sqlite/codec-types` so downstream consumers
// (demo, e2e tests, generated contract `.d.ts`) can keep importing from
// `@prisma-next/adapter-sqlite/codec-types` after codecs moved target-side.
export {
  type CodecTypes,
  dataTypes,
  type JsonValue,
} from '@prisma-next/target-sqlite/codec-types';
