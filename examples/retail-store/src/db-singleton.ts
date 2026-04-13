import type { Db } from './db';
import { createClient } from './db';

let dbPromise: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    const url = process.env['DB_URL'] ?? 'mongodb://localhost:27017';
    const dbName = process.env['MONGODB_DB'] ?? 'retail-store';
    dbPromise = createClient(url, dbName).catch((error) => {
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
}
