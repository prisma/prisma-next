import 'dotenv/config';
import { Client } from 'pg';

const databaseNames = {
  DATABASE_URL_ARKTYPE_JSON: 'demo_2025_02_18_arktype',
  DATABASE_URL_ZOD_UNION: 'demo_2025_02_18_zod',
  DATABASE_URL_IDS: 'demo_2025_02_18_ids',
} as const;

function validateDatabaseName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Invalid database name "${name}"`);
  }
  return name;
}

function deriveDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function ensureDatabase(adminClient: Client, databaseName: string): Promise<void> {
  const result = await adminClient.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
    [databaseName],
  );
  if (result.rows[0]?.exists) {
    return;
  }
  const safeName = validateDatabaseName(databaseName);
  await adminClient.query(`CREATE DATABASE "${safeName}"`);
}

async function truncateAllTables(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tables = result.rows.map((r) => `"public"."${r.tablename}"`);
    if (tables.length > 0) {
      await client.query(`TRUNCATE ${tables.join(', ')} CASCADE`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const baseUrl = process.env['BASE_DATABASE_URL'];
  if (!baseUrl) {
    throw new Error('Missing BASE_DATABASE_URL');
  }

  const adminClient = new Client({ connectionString: baseUrl });
  await adminClient.connect();
  try {
    for (const [_envName, databaseName] of Object.entries(databaseNames)) {
      await ensureDatabase(adminClient, databaseName);
      const derivedUrl = deriveDatabaseUrl(baseUrl, databaseName);
      await truncateAllTables(derivedUrl);
      // process.stdout.write(`${envName}=${derivedUrl}\n`);
    }
  } finally {
    await adminClient.end();
  }
}

await main();
