/**
 * Runtime-plane entry point for the CipherStash extension.
 *
 * Consumed at query time by application runtimes that need to encode /
 * decode `cipherstash/string@1` columns (envelope class) and talk to the
 * CipherStash SDK shape the codec runtime + bulk-encrypt middleware
 * depend on.
 *
 * The runtime entry point is deliberately separate from `./control`
 * (descriptor, codec lifecycle hook, contract-space artefacts) so apps
 * that only emit migrations against cipherstash never load the runtime,
 * and apps that only run queries never load the migration-time
 * descriptor (project AC-UMB9 — tree-shakable control vs runtime
 * planes).
 */

export type { EncryptedStringFromInternalArgs } from '../core/envelope';
export { EncryptedString } from '../core/envelope';
export type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashRoutingKey,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '../core/sdk';
