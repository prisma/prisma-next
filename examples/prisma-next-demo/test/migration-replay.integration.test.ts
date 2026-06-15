/**
 * Replay proof: executing the shipped app migration chain from scratch lands
 * a database whose live schema matches the current contract.
 *
 * The chain creates `user.kind` as a `text` column with a `user_kind_check`
 * CHECK constraint from the initial migration — no native Postgres enum type
 * is ever created. This test replays every execute step in chain order against
 * a fresh dev database, then introspects and verifies against the contract.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import pgvectorPack from '@prisma-next/extension-pgvector/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const DEMO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_MIGRATIONS_DIR = join(DEMO_ROOT, 'migrations', 'app');

const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

interface OpsJsonStep {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

interface OpsJsonOperation {
  readonly id: string;
  readonly execute: readonly OpsJsonStep[];
}

function loadChainInOrder(): ReadonlyArray<{
  dirName: string;
  ops: readonly OpsJsonOperation[];
}> {
  return readdirSync(APP_MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('.'))
    .sort()
    .map((dirName) => ({
      dirName,
      ops: JSON.parse(
        readFileSync(join(APP_MIGRATIONS_DIR, dirName, 'ops.json'), 'utf-8'),
      ) as readonly OpsJsonOperation[],
    }));
}

describe('demo migration replay (dev database)', () => {
  it(
    'replaying the full chain produces a schema that verifies against the contract',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const driver = await postgresDriverDescriptor.create(connectionString);
        try {
          for (const { dirName, ops } of loadChainInOrder()) {
            for (const op of ops) {
              for (const step of op.execute) {
                try {
                  await driver.query(step.sql, [...(step.params ?? [])]);
                } catch (error) {
                  throw new Error(
                    `replay failed at ${dirName} / ${op.id}: ${(error as Error).message}\n${step.sql}`,
                  );
                }
              }
            }
          }

          // The native enum must be gone, replaced by text + check.
          const kindType = await driver.query<{ udt_name: string }>(
            `SELECT udt_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'kind'`,
          );
          expect(kindType.rows).toEqual([{ udt_name: 'text' }]);

          const nativeEnums = await driver.query<{ typname: string }>(
            `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typtype = 'e' AND n.nspname = 'public'`,
          );
          expect(nativeEnums.rows).toEqual([]);

          const check = await driver.query<{ def: string }>(
            `SELECT pg_get_constraintdef(c.oid) AS def
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'public' AND t.relname = 'user'
               AND c.conname = 'user_kind_check' AND c.contype = 'c'`,
          );
          expect(check.rows).toHaveLength(1);
          expect(check.rows[0]?.def).toContain('admin');
          expect(check.rows[0]?.def).toContain('user');

          // Full schema verification against the current contract.
          const controlStack = createControlStack({
            family: sqlFamilyDescriptor,
            target: postgresTargetDescriptor,
            adapter: postgresAdapterDescriptor,
            driver: postgresDriverDescriptor,
            extensionPacks: [pgvectorPack],
          });
          const familyInstance = sqlFamilyDescriptor.create(controlStack);
          const schema = await familyInstance.introspect({ driver, contract });
          const verifyResult = familyInstance.verifySchema({
            contract,
            schema,
            strict: false,
            frameworkComponents: [
              postgresTargetDescriptor,
              postgresAdapterDescriptor,
              postgresDriverDescriptor,
              pgvectorPack,
            ],
          });
          expect(verifyResult.schema.issues).toEqual([]);
          expect(verifyResult.ok).toBe(true);
        } finally {
          await driver.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
