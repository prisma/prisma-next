import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newDb } from 'pg-mem';

import { readMarker, upsertMarker } from '../src/index';

describe('@prisma/marker', () => {
  let client: any;

  beforeEach(async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    const { Client } = db.adapters.createPg();
    client = new Client();
    await client.connect();
  });

  afterEach(async () => {
    if (client) {
      await client.end();
    }
  });

  it('creates marker schema and upserts marker row', async () => {
    await upsertMarker(client, {
      coreHash: 'sha256:abc',
      profileHash: 'sha256:def',
      contractJson: { foo: 'bar' },
      canonicalVersion: 1,
      appTag: 'test',
      meta: { region: 'dev' },
    });

    const marker = await readMarker(client);

    expect(marker).toMatchObject({
      coreHash: 'sha256:abc',
      profileHash: 'sha256:def',
      appTag: 'test',
      canonicalVersion: 1,
      meta: { region: 'dev' },
      contractJson: { foo: 'bar' },
    });
    expect(marker?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates marker row on subsequent upserts', async () => {
    await upsertMarker(client, {
      coreHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    await upsertMarker(client, {
      coreHash: 'sha256:new',
      profileHash: 'sha256:new-profile',
      meta: { refresh: true },
    });

    const marker = await readMarker(client);
    expect(marker).toMatchObject({
      coreHash: 'sha256:new',
      profileHash: 'sha256:new-profile',
      meta: { refresh: true },
    });
  });

  it('returns null when marker table is missing', async () => {
    const marker = await readMarker(client);
    expect(marker).toBeNull();
  });
});
