import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../../src/prisma/db';

let runtimePromise: Promise<Runtime> | undefined;

export function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
    }
    runtimePromise = db.connect({ url }).catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}
