/**
 * Operation type definitions for the cipherstash extension.
 *
 * Re-export from the types module for the public
 * `@prisma-next/extension-cipherstash/operation-types` subpath. The
 * contract emitter pulls these via the `types.operationTypes` /
 * `types.queryOperationTypes` import declarations on
 * `cipherstashPackMeta` (see `../extension-metadata/descriptor-meta.ts`); user code
 * may also import them directly when authoring TS-side type
 * compositions.
 *
 * @see ADR 211 — Extension operator surface (namespaced replacement
 *   operators must project type-visibility through `QueryOperationTypes`).
 */

export type { OperationTypes, QueryOperationTypes } from '../types/operation-types';
