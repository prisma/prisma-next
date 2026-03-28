import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | undefined;
let client: MongoClient | undefined;
let connectionUri = '';
const dbName = 'test';

export function getConnectionUri(): string {
  if (!connectionUri) throw new Error('MongoMemoryReplSet not started');
  return connectionUri;
}

export function getDbName(): string {
  return dbName;
}

export function getClient(): MongoClient {
  if (!client) throw new Error('MongoClient not connected');
  return client;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  connectionUri = replSet.getUri();
  client = new MongoClient(connectionUri);
  await client.connect();
});

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
  client = undefined;
  replSet = undefined;
  connectionUri = '';
});
