/**
 * Codec-types subpath entry for the cipherstash extension. Re-exports
 * the hand-written `CodecTypes` table from `../types/codec-types` so
 * the contract emitter can pull it via
 * `import type { CodecTypes as CipherstashTypes } from '@prisma-next/extension-cipherstash/codec-types'`.
 *
 * Mirrors `packages/3-extensions/pgvector/src/exports/codec-types.ts`.
 */

export type { CodecTypes } from '../types/codec-types';
