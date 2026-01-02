import { errorRuntime } from '@prisma-next/core-control-plane/errors';
import type {
  ControlDriverDescriptor,
  ControlDriverInstance,
} from '@prisma-next/core-control-plane/types';
import { SqlQueryError } from '@prisma-next/sql-errors';
import { redactDatabaseUrl } from '@prisma-next/utils/redact-db-url';
import { Client } from 'pg';
import { postgresDriverDescriptorMeta } from '../core/descriptor-meta';
import { normalizePgError } from '../normalize-error';

/**
 * Postgres control driver instance for control-plane operations.
 * Implements ControlDriverInstance<'sql', 'postgres'> for database queries.
 */
export class PostgresControlDriver implements ControlDriverInstance<'sql', 'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;
  /**
   * @deprecated Use targetId instead
   */
  readonly target = 'postgres' as const;

  constructor(private readonly client: Client) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    try {
      const result = await this.client.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as Row[] };
    } catch (error) {
      throw normalizePgError(error);
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

/**
 * Postgres driver descriptor for CLI config.
 */
const postgresDriverDescriptor: ControlDriverDescriptor<'sql', 'postgres', PostgresControlDriver> =
  {
    ...postgresDriverDescriptorMeta,
    async create(url: string): Promise<PostgresControlDriver> {
      const client = new Client({ connectionString: url });
      try {
        await client.connect();
        return new PostgresControlDriver(client);
      } catch (error) {
        const normalized = normalizePgError(error);
        const redacted = redactDatabaseUrl(url);
        try {
          await client.end();
        } catch {
          // ignore
        }

        const codeFromSqlState = SqlQueryError.is(normalized) ? normalized.sqlState : undefined;
        const causeCode =
          'cause' in normalized && normalized.cause
            ? (normalized.cause as { code?: unknown }).code
            : undefined;
        const code = codeFromSqlState ?? causeCode;

        throw errorRuntime('Database connection failed', {
          why: normalized.message,
          fix: 'Verify the database URL, ensure the database is reachable, and confirm credentials/permissions',
          meta: {
            ...(typeof code !== 'undefined' ? { code } : {}),
            ...redacted,
          },
        });
      }
    },
  };

export default postgresDriverDescriptor;
