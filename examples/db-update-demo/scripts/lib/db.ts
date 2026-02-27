import pg from 'pg';

function getAdminConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

export async function withClient<T>(
  connectionString: string,
  fn: (client: pg.Client) => Promise<T>,
) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName) {
    throw new Error('Database name is required in DATABASE_URL.');
  }

  const adminConnection = getAdminConnectionString(connectionString);
  try {
    await withClient(adminConnection, async (client) => {
      const result = await client.query<{ exists: boolean }>(
        'select exists(select 1 from pg_database where datname = $1) as exists',
        [dbName],
      );
      if (!result.rows[0]?.exists) {
        await client.query(`create database "${dbName}"`);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to create database "${dbName}". ${message} ` +
        'Ensure the credentials can create databases or pre-provision it.',
    );
  }
}

export async function resetDatabase(connectionString: string): Promise<void> {
  await ensureDatabaseExists(connectionString);
  await withClient(connectionString, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
  });
}

export async function executeSql(
  connectionString: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(sql, params);
  });
}
