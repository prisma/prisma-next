/**
 * Pure schema verification exports.
 *
 * This module exports the pure schema verification function that can be used
 * without a database connection. It's suitable for migration planning and
 * other tools that need to compare schema states.
 */

export type { VerifySqlSchemaOptions } from '../core/schema-verify/verify-sql-schema';
export { verifySqlSchema } from '../core/schema-verify/verify-sql-schema';
