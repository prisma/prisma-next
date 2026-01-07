/**
 * Codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */

export type { CodecTypes } from '../core/codecs.ts';
export { dataTypes } from '../core/codecs.ts';
