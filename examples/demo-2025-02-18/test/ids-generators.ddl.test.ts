import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPlannedDdlSql } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, '../prisma/ids-generators/contract.json');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

describe('ids ddl', () => {
  it('matches contract planned sql', async () => {
    const sql = await getPlannedDdlSql({
      connectionString: requiredEnv('DATABASE_URL_IDS'),
      contractJsonPath,
    });
    expect(sql).toMatchInlineSnapshot(`
      "CREATE TABLE "public"."id_nanoid_record" (
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "id" character(21) NOT NULL,
        "name" text NOT NULL,
        PRIMARY KEY ("id")
      );

      CREATE TABLE "public"."id_ulid_record" (
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "id" character(26) NOT NULL,
        "note" text NOT NULL,
        PRIMARY KEY ("id")
      )"
    `);
  });
});
