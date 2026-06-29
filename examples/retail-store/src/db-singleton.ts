import type { Db } from './db';
import { createClient } from './db';

let db: Db | undefined;

export function getDb(): Db {
  if (!db) {
    const url = process.env['DB_URL'] ?? 'mongodb://localhost:27017';
    const dbName = process.env['MONGODB_DB'] ?? 'retail-store';
    db = createClient(url, dbName);
  }
  return db;
}
