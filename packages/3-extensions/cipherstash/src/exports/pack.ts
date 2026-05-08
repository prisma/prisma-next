/**
 * Pack entry point for the cipherstash extension.
 *
 * Re-exports the SDK-free pack metadata so TS contract authoring
 * (`defineContract({ extensionPacks: { cipherstash: cipherstashPack } })`)
 * can enable the `cipherstash.*` PSL/TS namespace and the storage type
 * registration without pulling in any runtime code (envelope, SDK,
 * codec runtime, middleware).
 *
 * Mirrors `packages/3-extensions/pgvector/src/exports/pack.ts`.
 */

export { cipherstashPackMeta as default } from '../core/descriptor-meta';
