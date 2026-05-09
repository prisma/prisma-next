/**
 * Public migration-time entry point for the cipherstash extension.
 *
 * Re-exports the user-callable factory functions used in hand-written
 * migrations (or auto-imported by the planner-generated `migration.ts`)
 * to wire EQL search-config rows alongside structural DDL:
 *
 * ```ts
 * import { Migration, MigrationCLI, createTable } from '@prisma-next/target-postgres/migration';
 * import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';
 *
 * export default class M extends Migration {
 *   override get operations() {
 *     return [
 *       createTable('public', 'user', [
 *         { name: 'email', typeSql: 'eql_v2_encrypted', defaultSql: '', nullable: false },
 *         { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
 *       ]),
 *       cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'unique' }),
 *     ];
 *   }
 * }
 *
 * MigrationCLI.run(import.meta.url, M);
 * ```
 *
 * Identical ergonomics to `createTable` / `setNotNull` etc. from
 * `@prisma-next/target-postgres/migration`. The codec lifecycle hook
 * for `Encrypted<string>` columns calls these factories automatically
 * when planning a contract diff.
 *
 * @see ADR 195 — Planner IR with two renderers.
 * @see ADR 212 — Codec lifecycle hooks.
 */

export type {
  CipherstashSearchConfigArgs,
  CipherstashSearchIndex,
} from '../migration/call-classes';
export {
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from '../migration/call-classes';
