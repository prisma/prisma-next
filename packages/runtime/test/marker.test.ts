import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureSchemaStatement,
  ensureTableStatement,
  parseContractMarkerRow,
  readContractMarker,
  writeContractMarker,
} from '../src/marker';
import { createDevDatabase, executeStatement } from './utils';

describe('marker helpers', { timeout: 30000 }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  /** Raw Postgres client for direct interaction with the database */
  let client: Client;

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54216,
      databasePort: 54217,
      shadowDatabasePort: 54218,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
  }, 30000);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore errors closing the client or database since it probably means it's already closed
    }
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
    const record = parseContractMarkerRow(seeded.rows[0]);
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
    const updatedRecord = parseContractMarkerRow(updated.rows[0]);
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

  it('parses row with string updated_at', async () => {
    await executeStatement(client, ensureSchemaStatement);
    await executeStatement(client, ensureTableStatement);

    const writeInitial = writeContractMarker({
      coreHash: 'sha256:alpha',
      profileHash: 'sha256:profile',
    });
    await executeStatement(client, writeInitial.insert);

    const read = readContractMarker();
    const seeded = await client.query(read.sql, [...read.params]);
    expect(seeded.rowCount).toBe(1);

    // Simulate string date from driver
    const firstRow = seeded.rows[0] as {
      core_hash: string;
      profile_hash: string;
      updated_at: Date;
      [key: string]: unknown;
    };
    const rowWithStringDate = {
      ...firstRow,
      updated_at: firstRow.updated_at.toISOString(),
    };

    const record = parseContractMarkerRow(rowWithStringDate);
    expect(record.updatedAt).toBeInstanceOf(Date);
    expect(record.coreHash).toBe('sha256:alpha');
  });

  it('throws error when row structure is invalid', () => {
    expect(() => parseContractMarkerRow({})).toThrow('Invalid contract marker row');
    expect(() => parseContractMarkerRow({ core_hash: 'test' })).toThrow(
      'Invalid contract marker row',
    );
    expect(() => parseContractMarkerRow({ profile_hash: 'test' })).toThrow(
      'Invalid contract marker row',
    );
    expect(() => parseContractMarkerRow(null)).toThrow('Invalid contract marker row');
    expect(() => parseContractMarkerRow('invalid')).toThrow('Invalid contract marker row');
  });

  it('handles meta field validation failures', () => {
    // Test with invalid meta types that should fail validation
    const rowWithArrayMeta = {
      core_hash: 'sha256:test',
      profile_hash: 'sha256:profile',
      updated_at: new Date(),
      meta: ['array', 'not', 'object'],
    };

    // Arrays are objects in JS, so they might pass validation
    // But we should test with something that definitely fails
    const rowWithNumberMeta = {
      core_hash: 'sha256:test',
      profile_hash: 'sha256:profile',
      updated_at: new Date(),
      meta: 123,
    };

    const record1 = parseContractMarkerRow(rowWithArrayMeta);
    // Arrays might pass as objects, so check if it's handled
    expect(typeof record1.meta).toBe('object');
    expect(record1.meta).not.toBeNull();

    const record2 = parseContractMarkerRow(rowWithNumberMeta);
    // Numbers should fail validation and return empty object
    expect(record2.meta).toEqual({});
  });

  it('handles meta field as JSON string', () => {
    // Test meta as JSON string directly (simulating driver returning string)
    const rowWithStringMeta = {
      core_hash: 'sha256:test',
      profile_hash: 'sha256:profile',
      updated_at: new Date(),
      meta: JSON.stringify({ key: 'value' }),
    };

    const record = parseContractMarkerRow(rowWithStringMeta);
    expect(record.meta).toEqual({ key: 'value' });
  });

  it('handles invalid JSON string in meta field', () => {
    // Test meta as invalid JSON string (should return empty object)
    const rowWithInvalidJson = {
      core_hash: 'sha256:test',
      profile_hash: 'sha256:profile',
      updated_at: new Date(),
      meta: '{ invalid json }',
    };

    const record = parseContractMarkerRow(rowWithInvalidJson);
    expect(record.meta).toEqual({});
  });

  it('handles meta field as null', () => {
    // Test null meta directly (database has NOT NULL constraint, but parser should handle null)
    const rowWithNullMeta = {
      core_hash: 'sha256:test',
      profile_hash: 'sha256:profile',
      updated_at: new Date(),
      meta: null,
    };

    const record = parseContractMarkerRow(rowWithNullMeta);
    expect(record.meta).toEqual({});
  });

  it('handles missing updated_at field', () => {
    const rowWithoutUpdatedAt = {
      core_hash: 'sha256:test',
      profile_hash: 'sha256:profile',
    };

    const record = parseContractMarkerRow(rowWithoutUpdatedAt);
    expect(record.updatedAt).toBeInstanceOf(Date);
    expect(record.coreHash).toBe('sha256:test');
  });
});
