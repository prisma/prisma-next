import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { SignDatabaseResult } from '@prisma-next/core-control-plane/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { readMarker } from '@prisma-next/family-sql/verify';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import postgres from '@prisma-next/target-postgres/control';
import type { DevDatabase } from '@prisma-next/test-utils';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Creates a test contract for testing.
 */
function createTestContract(): SqlContract<SqlStorage> {
  const contractObj = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  return {
    ...contractObj,
    extensions: {
      postgres: {
        version: '15.0.0',
      },
      pg: {},
    },
  };
}

describe('family instance sign', () => {
  let database: DevDatabase | undefined;
  let connectionString: string | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    connectionString = database.connectionString;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, timeouts.spinUpPpgDev);

  describe('new marker creation', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      await withClient(connectionString, async (client) => {
        // Clean up any existing marker
        await client.query('drop table if exists prisma_contract.marker');
        await client.query('drop schema if exists prisma_contract');
        // Create schema and table
        await executeStatement(client, ensureSchemaStatement);
        await executeStatement(client, ensureTableStatement);
        // Create table matching contract
        await client.query(`
          create table if not exists "user" (
            "id" int4 not null,
            "email" text not null,
            primary key ("id")
          )
        `);
      });
    });

    it(
      'creates new marker when none exists',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = createTestContract();
        const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensions: [],
          });

          const result = (await familyInstance.sign({
            driver,
            contractIR: validatedContract,
            contractPath: './contract.json',
          })) as SignDatabaseResult;

          expect(result).toMatchObject({
            ok: true,
            summary: 'Database signed (marker created)',
            marker: {
              created: true,
              updated: false,
            },
            contract: {
              coreHash: validatedContract.coreHash,
            },
          });
          expect(result.timings.total).toBeGreaterThanOrEqual(0);

          // Verify marker was written to database
          const marker = await readMarker(driver);
          expect(marker).not.toBeNull();
          expect(marker?.coreHash).toBe(validatedContract.coreHash);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('marker update', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      await withClient(connectionString, async (client) => {
        // Clean up any existing marker
        await client.query('drop table if exists prisma_contract.marker');
        await client.query('drop schema if exists prisma_contract');
        // Create schema and table
        await executeStatement(client, ensureSchemaStatement);
        await executeStatement(client, ensureTableStatement);
        // Create table matching contract
        await client.query(`
          create table if not exists "user" (
            "id" int4 not null,
            "email" text not null,
            primary key ("id")
          )
        `);
        // Write initial marker with different hash
        const write = writeContractMarker({
          coreHash: 'sha256:old-hash',
          profileHash: 'sha256:old-profile-hash',
          contractJson: { target: 'postgres' },
          canonicalVersion: 1,
        });
        await executeStatement(client, write.insert);
      });
    });

    it(
      'updates marker when hashes differ',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = createTestContract();
        const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensions: [],
          });

          const result = (await familyInstance.sign({
            driver,
            contractIR: validatedContract,
            contractPath: './contract.json',
          })) as SignDatabaseResult;

          expect(result).toMatchObject({
            ok: true,
            marker: {
              created: false,
              updated: true,
              previous: {
                coreHash: 'sha256:old-hash',
                profileHash: 'sha256:old-profile-hash',
              },
            },
            contract: {
              coreHash: validatedContract.coreHash,
            },
          });
          expect(result.summary).toContain('Database signed (marker updated from');
          expect(result.timings.total).toBeGreaterThanOrEqual(0);

          // Verify marker was updated in database
          const marker = await readMarker(driver);
          expect(marker).not.toBeNull();
          expect(marker?.coreHash).toBe(validatedContract.coreHash);
          expect(marker?.coreHash).not.toBe('sha256:old-hash');
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('idempotent behavior', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }

      await withClient(connectionString, async (client) => {
        // Clean up any existing marker
        await client.query('drop table if exists prisma_contract.marker');
        await client.query('drop schema if exists prisma_contract');
        // Create schema and table
        await executeStatement(client, ensureSchemaStatement);
        await executeStatement(client, ensureTableStatement);
        // Create table matching contract
        await client.query(`
          create table if not exists "user" (
            "id" int4 not null,
            "email" text not null,
            primary key ("id")
          )
        `);
      });
    });

    it(
      'no-op when marker already matches',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = createTestContract();
        const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensions: [],
          });

          // First sign - creates marker
          const firstResult = (await familyInstance.sign({
            driver,
            contractIR: validatedContract,
            contractPath: './contract.json',
          })) as SignDatabaseResult;

          expect(firstResult.ok).toBe(true);
          expect(firstResult.marker.created).toBe(true);

          // Get the marker's updated_at timestamp
          const markerAfterFirst = await readMarker(driver);
          const firstUpdatedAt = markerAfterFirst?.updatedAt;

          // Second sign - should be idempotent
          const secondResult = (await familyInstance.sign({
            driver,
            contractIR: validatedContract,
            contractPath: './contract.json',
          })) as SignDatabaseResult;

          expect(secondResult).toMatchObject({
            ok: true,
            summary: 'Database already signed with this contract',
            marker: {
              created: false,
              updated: false,
            },
            contract: {
              coreHash: validatedContract.coreHash,
            },
          });
          expect(secondResult.marker.previous).toBeUndefined();

          // Verify marker was not updated (updated_at should be the same)
          const markerAfterSecond = await readMarker(driver);
          expect(markerAfterSecond?.updatedAt).toEqual(firstUpdatedAt);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
