import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { orm } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { contract } from '../../prisma/contract';
import { PostCollection, UserCollection } from '../orm-client/collections';

// No-emit flow: hand the TypeScript-authored contract straight to the
// `postgres()` facade with deferred binding (no url at construction). The
// facade owns stack/context/sql/enums, so the demo no longer hand-wires them.
export const db = postgres<typeof contract>({ contract, extensions: [pgvector] });

export const context = db.context;
export const stack = db.stack;
export const enums = db.enums;
export const sql = db.sql.public;

export function createOrmClient(runtime: Runtime) {
  // The demo builds runtimes externally (custom pool/middleware) and passes
  // them in, so the ORM client is built against that runtime via the `orm()`
  // builder rather than the facade's own lazily-bound `db.orm`.
  const client = orm({
    runtime,
    context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  });
  const publicNs = client['public'];
  if (publicNs === undefined) {
    throw new Error("ORM client is missing the 'public' namespace");
  }
  return publicNs;
}
