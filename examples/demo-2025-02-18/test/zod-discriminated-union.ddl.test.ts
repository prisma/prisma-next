import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPlannedDdlSql } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, '../prisma/zod-discriminated-union/contract.json');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

describe('zod union ddl', () => {
  it('matches contract planned sql', async () => {
    const sql = await getPlannedDdlSql({
      connectionString: requiredEnv('DATABASE_URL_ZOD_UNION'),
      contractJsonPath,
    });
    expect(sql).toMatchInlineSnapshot(`
      "CREATE TABLE "public"."zod_event" (
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "event" jsonb NOT NULL,
        "id" character(26) NOT NULL,
        "source" text NOT NULL,
        PRIMARY KEY ("id")
      )"
    `);
  });
});
