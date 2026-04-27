// Re-exports of the codec-types surface that downstream consumers (demo,
// e2e tests, generated contract `.d.ts`) already import from
// `@prisma-next/adapter-sqlite/codec-types`. Now that codec definitions
// live target-side (mirroring Postgres), this is a thin facade over
// `@prisma-next/target-sqlite/codec-types`.
export { type CodecTypes, dataTypes, type JsonValue } from '@prisma-next/target-sqlite/codecs';
