import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type AnyMongoContract = MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>;

// Hoisted mocks so they are observable from inside vi.mock() factories.
const mocks = vi.hoisted(() => ({
  createMongoAdapter: vi.fn(),
  createMongoRuntime: vi.fn(),
  driverFromConnection: vi.fn(),
  driverFromDb: vi.fn(),
  validateMongoContract: vi.fn(),
  mongoOrm: vi.fn(),
  mongoQuery: vi.fn(),
}));

vi.mock('@prisma-next/adapter-mongo', () => ({
  createMongoAdapter: mocks.createMongoAdapter,
}));

vi.mock('@prisma-next/mongo-runtime', () => ({
  createMongoRuntime: mocks.createMongoRuntime,
}));

vi.mock('@prisma-next/driver-mongo', () => ({
  MongoDriverImpl: {
    fromConnection: mocks.driverFromConnection,
    fromDb: mocks.driverFromDb,
  },
}));

vi.mock('@prisma-next/mongo-contract', () => ({
  validateMongoContract: mocks.validateMongoContract,
}));

vi.mock('@prisma-next/mongo-orm', () => ({
  mongoOrm: mocks.mongoOrm,
}));

vi.mock('@prisma-next/mongo-query-builder', () => ({
  mongoQuery: mocks.mongoQuery,
}));

import mongo from '../src/runtime/mongo';

const fakeContract = { roots: {}, models: {} } as unknown as AnyMongoContract;
const fakeRuntime = { id: 'runtime-instance', close: vi.fn().mockResolvedValue(undefined) };
const fakeOrm = { id: 'orm-instance' };
const fakeQuery = { id: 'query-instance' };

describe('mongo() facade', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();

    mocks.validateMongoContract.mockReturnValue({ contract: fakeContract });
    mocks.createMongoAdapter.mockReturnValue({ id: 'adapter' });
    mocks.driverFromConnection.mockResolvedValue({ id: 'driver-from-url' });
    mocks.driverFromDb.mockReturnValue({ id: 'driver-from-db' });
    mocks.createMongoRuntime.mockReturnValue(fakeRuntime);
    mocks.mongoOrm.mockReturnValue(fakeOrm);
    mocks.mongoQuery.mockReturnValue(fakeQuery);
    fakeRuntime.close.mockClear();
  });

  it('exposes orm and query eagerly without connecting the driver', () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    expect(db.orm).toBe(fakeOrm);
    expect(db.query).toBe(fakeQuery);
    expect(mocks.mongoOrm).toHaveBeenCalledTimes(1);
    expect(mocks.mongoQuery).toHaveBeenCalledTimes(1);

    expect(mocks.driverFromConnection).not.toHaveBeenCalled();
    expect(mocks.driverFromDb).not.toHaveBeenCalled();
    expect(mocks.createMongoRuntime).not.toHaveBeenCalled();
  });

  it('builds the runtime exactly once on the first runtime() call from a url', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const first = await db.runtime();
    const second = await db.runtime();

    expect(first).toBe(fakeRuntime);
    expect(second).toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017/mydb',
      'mydb',
    );
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
  });

  it('builds the runtime exactly once across concurrent first calls (lazy memoisation)', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const [a, b, c] = await Promise.all([db.runtime(), db.runtime(), db.runtime()]);

    expect(a).toBe(fakeRuntime);
    expect(b).toBe(fakeRuntime);
    expect(c).toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
  });

  it('accepts uri+dbName and uses fromConnection with the supplied dbName', async () => {
    const db = mongo({
      contract: fakeContract,
      uri: 'mongodb://localhost:27017',
      dbName: 'override_db',
    });

    await db.runtime();

    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017',
      'override_db',
    );
  });

  it('accepts a pre-built mongoClient and uses fromDb', async () => {
    const fakeClient = { db: vi.fn().mockReturnValue({ id: 'db-handle' }) };
    const db = mongo({
      contract: fakeContract,
      mongoClient: fakeClient as unknown as import('mongodb').MongoClient,
      dbName: 'my_db',
    });

    await db.runtime();

    expect(fakeClient.db).toHaveBeenCalledWith('my_db');
    expect(mocks.driverFromDb).toHaveBeenCalledWith({ id: 'db-handle' });
    expect(mocks.driverFromConnection).not.toHaveBeenCalled();
  });

  it('accepts an explicit binding object', async () => {
    const db = mongo({
      contract: fakeContract,
      binding: { kind: 'url', url: 'mongodb://localhost:27017/mydb', dbName: 'mydb' },
    });

    await db.runtime();

    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017/mydb',
      'mydb',
    );
  });

  it('allows deferred binding via connect() after construction', async () => {
    const db = mongo({ contract: fakeContract });

    expect(mocks.driverFromConnection).not.toHaveBeenCalled();

    await db.connect({ url: 'mongodb://localhost:27017/lazy_db' });

    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017/lazy_db',
      'lazy_db',
    );
  });

  it('rejects when runtime() is requested without a configured binding', async () => {
    const db = mongo({ contract: fakeContract });

    await expect(db.runtime()).rejects.toThrow('Mongo binding not configured');
  });

  it('throws when connect() is called twice', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.connect();
    await expect(db.connect()).rejects.toThrow('Mongo client already connected');
  });

  it('throws when connect() is called twice with explicit bindings', async () => {
    const db = mongo({ contract: fakeContract });

    await db.connect({ url: 'mongodb://localhost:27017/first' });
    await expect(db.connect({ url: 'mongodb://localhost:27017/second' })).rejects.toThrow(
      'Mongo client already connected',
    );
  });

  it('throws when constructed with multiple binding inputs', () => {
    expect(() =>
      mongo({
        contract: fakeContract,
        url: 'mongodb://localhost:27017/a',
        uri: 'mongodb://localhost:27017',
        dbName: 'b',
      } as unknown as Parameters<typeof mongo>[0]),
    ).toThrow('Provide one binding input');
  });

  it('throws for a url without a dbName in the path', () => {
    expect(() => mongo({ contract: fakeContract, url: 'mongodb://localhost:27017' })).toThrow(
      'Mongo URL must include a database name',
    );
  });

  it('throws for a url with the wrong scheme', () => {
    expect(() => mongo({ contract: fakeContract, url: 'http://localhost/x' })).toThrow(
      'Mongo URL must use mongodb:// or mongodb+srv://',
    );
  });

  it('throws for an empty url', () => {
    expect(() => mongo({ contract: fakeContract, url: '   ' })).toThrow(
      'Mongo URL must be a non-empty string',
    );
  });

  it('throws for { uri } without a dbName', () => {
    expect(() =>
      mongo({
        contract: fakeContract,
        uri: 'mongodb://localhost:27017',
      } as unknown as Parameters<typeof mongo>[0]),
    ).toThrow(/dbName/);
  });

  it('close() propagates to the underlying runtime when one was built', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();
    await db.close();

    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
  });

  it('close() is a no-op when no runtime has been built', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.close();

    expect(fakeRuntime.close).not.toHaveBeenCalled();
  });

  it('validates the contract via validateMongoContract for both authoring modes', () => {
    const json = { models: {} };
    mongo({ contractJson: json, url: 'mongodb://localhost:27017/mydb' });
    expect(mocks.validateMongoContract).toHaveBeenLastCalledWith(json);

    mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
    expect(mocks.validateMongoContract).toHaveBeenLastCalledWith(fakeContract);
  });
});
