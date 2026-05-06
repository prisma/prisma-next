/**
 * Public middleware surface for the cipherstash extension.
 *
 * Consumers register the bulk-encrypt middleware in their runtime so
 * `EncryptedString` envelopes embedded in `INSERT` / `UPDATE` plans get
 * encrypted in batches before encode runs. See package README for the
 * recommended runtime composition (extension pack registers it
 * automatically; manual middleware lists may add it explicitly).
 */
export { bulkEncryptMiddleware } from '../middleware/bulk-encrypt';
