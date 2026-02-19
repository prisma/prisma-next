import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPlannedDdlSql } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, '../prisma/arktype-json/contract.json');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

describe('arktype json ddl', () => {
  it('matches contract planned sql', async () => {
    const sql = await getPlannedDdlSql({
      connectionString: requiredEnv('DATABASE_URL_ARKTYPE_JSON'),
      contractJsonPath,
    });
    expect(sql).toMatchInlineSnapshot(`
      "CREATE TABLE "public"."arktype_profile" (
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "id" character(26) NOT NULL,
        "label" text NOT NULL,
        "profile" jsonb NOT NULL,
        PRIMARY KEY ("id")
      )"
    `);
  });
});
