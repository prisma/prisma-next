/**
 * End-to-end smoke: facade → real driver → fake `@prisma/ppg` Client.
 *
 * Unlike the sibling `prisma-postgres-serverless.test.ts` which mocks the
 * sql-runtime / driver internals to assert wiring shapes, this file
 * exercises the actual composed stack — every layer is the real module
 * except the PPG `Client`, which is a hand-built fake passed via the
 * `{ ppgClient }` binding. The test asserts that:
 *
 * - the facade constructs against the real `@prisma-next/driver-ppg-serverless`
 *   without contract / target / adapter wiring issues;
 * - `db.connect()` resolves the binding through the driver (which would
 *   throw if the binding shape were wrong);
 * - `db.close()` resolves cleanly through the real driver instance.
 *
 * The row-roundtrip path itself (driver → fake session → row mapping back)
 * is exhaustively covered by the driver package's own tests; reproducing it
 * here would duplicate that coverage without exercising the seam this
 * file's job is to defend.
 */
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import prismaPostgresServerless from '../src/runtime/prisma-postgres-serverless';
import { col, makeFakeClient, row } from './_fakes';

describe('prisma-postgres-serverless end-to-end (real driver, fake PPG client)', () => {
  it('composes the real driver stack and round-trips connect/close through it', async () => {
    let queryCount = 0;
    const fakeClient = makeFakeClient((_sql, _params) => {
      queryCount++;
      return { columns: [col('id'), col('name')], rows: [row(42, 'alice')] };
    });

    const db = prismaPostgresServerless({
      contract: createContract<SqlStorage>(),
      ppgClient: fakeClient,
    });

    // Static surfaces materialise eagerly.
    expect(db.sql).toBeDefined();
    expect(db.context).toBeDefined();
    expect(db.stack).toBeDefined();

    // connect() resolves through the real driver; if the binding shape were
    // wrong (e.g. the facade passed `{ ppgClient: ... }` instead of the
    // discriminated `{ kind: 'ppgClient', client: ... }`) the driver would
    // reject here.
    const runtime = await db.connect();
    expect(runtime).toBeDefined();

    // We did not issue any SQL — the fake's query handler should not have
    // fired. This catches regressions where the facade accidentally probes
    // the driver during connect (e.g. a future smoke-check that runs
    // SELECT 1 on bind).
    expect(queryCount).toBe(0);

    // Close runs through the real driver instance; no facade-owned resource
    // to dispose, so this is a state flip and a no-op on the driver.
    await db.close();

    // Post-close the facade refuses further work.
    expect(() => db.runtime()).toThrow('Prisma Postgres serverless client is closed');
  });
});
