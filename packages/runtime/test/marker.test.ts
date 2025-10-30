import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import {
  ensureSchemaStatement,
  ensureTableStatement,
  mapContractMarkerRow,
  readContractMarker,
  writeContractMarker,
} from '../src/marker';
import { createDevDatabase, executeStatement } from './utils';

describe('marker helpers', { timeout: 100 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  /** Raw Postgres client for direct interaction with the database */
  let client: Client;

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54213,
      databasePort: 54214,
      shadowDatabasePort: 54215,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
  }, 3000);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch (error) {}
  });

  beforeEach(async () => {
    await client.query('drop schema if exists prisma_contract cascade');
  });

  it('creates schema and marker table', async () => {
    await executeStatement(client, ensureSchemaStatement);
    await executeStatement(client, ensureTableStatement);

    const schemaResult = await client.query(
      "select schema_name from information_schema.schemata where schema_name = 'prisma_contract'",
    );
    expect(schemaResult.rowCount).toBe(1);

    const tableResult = await client.query(
      "select table_name from information_schema.tables where table_schema = 'prisma_contract' and table_name = 'marker'",
    );
    expect(tableResult.rowCount).toBe(1);
  });

  it('writes and reads marker rows', async () => {
    await executeStatement(client, ensureSchemaStatement);
    await executeStatement(client, ensureTableStatement);

    const writeInitial = writeContractMarker({
      coreHash: 'sha256:alpha',
      profileHash: 'sha256:profile',
      contractJson: { foo: 'bar' },
      canonicalVersion: 1,
      appTag: 'test',
      meta: { region: 'dev' },
    });
    await executeStatement(client, writeInitial.insert);

    const read = readContractMarker();
    const seeded = await client.query(read.sql, [...read.params]);
    expect(seeded.rowCount).toBe(1);
    const record = mapContractMarkerRow(seeded.rows[0] as any);
    expect(record).toMatchObject({
      coreHash: 'sha256:alpha',
      profileHash: 'sha256:profile',
      contractJson: { foo: 'bar' },
      canonicalVersion: 1,
      appTag: 'test',
      meta: { region: 'dev' },
    });
    expect(record.updatedAt).toBeInstanceOf(Date);

    const writeUpdate = writeContractMarker({
      coreHash: 'sha256:beta',
      profileHash: 'sha256:profile',
      meta: { refresh: true },
    });
    await executeStatement(client, writeUpdate.update);

    const updated = await client.query(read.sql, [...read.params]);
    const updatedRecord = mapContractMarkerRow(updated.rows[0] as any);
    expect(updatedRecord).toMatchObject({
      coreHash: 'sha256:beta',
      profileHash: 'sha256:profile',
      canonicalVersion: null,
      appTag: null,
      meta: { refresh: true },
    });
  });

  it('returns no rows when marker is missing', async () => {
    await executeStatement(client, ensureSchemaStatement);
    await executeStatement(client, ensureTableStatement);

    const read = readContractMarker();
    const result = await client.query(read.sql, [...read.params]);
    expect(result.rowCount).toBe(0);
  });
});
