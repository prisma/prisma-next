import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import arktypeJson from '@prisma-next/extension-arktype-json/runtime';
import type { Vector } from '@prisma-next/extension-pgvector/codec-types';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { runDbInit } from './utils';

// Round-trip coverage for the `Embedding.profile` arktype-json column.
// The fixture has carried this column since the original arktype-json
// landing, but no test wrote or read it — so the runtime correctness
// gaps (missing cast-lookup registration, hardcoded `JSON.parse(wire)`
// in decode) surfaced only in production. This file exercises the full
// pipeline:
//
//   create → encode (schema validate + JSON.stringify) → SQL renderer
//   ($N::jsonb cast lookup) → driver write → driver read (pre-parsed
//   JSON for jsonb on `pg`) → decode (schema validate) → ORM result.

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

async function loadContractJson(): Promise<unknown> {
  const content = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(content);
}

async function withPostgresClient(
  callback: (db: ReturnType<typeof postgres<Contract>>) => Promise<void>,
): Promise<void> {
  const contractJson = await loadContractJson();
  await withDevDatabase(async ({ connectionString }) => {
    await runDbInit({ connectionString, contractJsonPath });
    const db = postgres<Contract>({
      contractJson,
      url: connectionString,
      extensions: [pgvector, arktypeJson],
    });
    let runtime: Runtime | undefined;
    try {
      runtime = await db.connect();
      await db.orm.User.first();
      await callback(db);
    } finally {
      await runtime?.close();
    }
  });
}

function buildEmbedding(seed: number): Vector<1536> {
  return Array.from({ length: 1536 }, (_, i) => (i + seed) / 1536) as Vector<1536>;
}

describe('arktype-json column round-trip', { timeout: timeouts.spinUpPpgDev }, () => {
  it('writes and reads back a typed JSON value through the ORM', async () => {
    await withPostgresClient(async (db) => {
      const created = await db.orm.Embedding.create({
        embedding: buildEmbedding(0),
        profile: { name: 'alice', age: 30 },
      });

      const found = await db.orm.Embedding.where((e) => e.id.eq(created.id)).first();
      expect(found).not.toBeNull();
      expect(found!.profile).toEqual({ name: 'alice', age: 30 });
    });
  });

  it('rejects writes that violate the arktype schema with the stable error code', async () => {
    // Encode validates the payload before serialization. The codec throws
    // `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`; the runtime must surface
    // that stable code unchanged on the write side (symmetric to the
    // decode-side rethrow guard, see ADR 208 § Case J).
    // Cast through `unknown` to deliberately bypass the static type
    // (which would block the missing `age` field at compile time) and
    // surface the runtime schema check as the only enforcement point.
    const incompleteProfile = { name: 'bob' } as unknown as { name: string; age: number };
    await withPostgresClient(async (db) => {
      await expect(
        db.orm.Embedding.create({
          embedding: buildEmbedding(1),
          profile: incompleteProfile,
        }),
      ).rejects.toMatchObject({
        code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      });
    });
  });
});
