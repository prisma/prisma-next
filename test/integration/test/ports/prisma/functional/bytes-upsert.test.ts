import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/bytes-upsert/generated/contract';
import contractJson from '../../_fixtures/bytes-upsert/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/bytes-upsert
// (postgres matrix entry; sqlserver opted out — does not support bytes IDs).
//
// Regression test for v7 bug: "No record was found for an upsert" when calling
// upsert twice with the same Bytes @unique value.
//
// In prisma-next, the Bytes field is typed as Uint8Array and `conflictOn` is
// used instead of Prisma's `where: { bytes: byteId }`.
//
// FAIL: second upsert with `update: {}` on a Bytes @unique field throws
//   ORM.MUTATION_ROW_MISSING — the ON CONFLICT DO NOTHING RETURNING * emits
//   zero rows, and the follow-up reload via `#buildUpsertConflictCriterion`
//   fails to match the existing row (Uint8Array equality in the WHERE clause
//   does not round-trip correctly through the reload path).

describe('ports/prisma/functional/bytes-upsert', () => {
  it.fails(
    'bytes upsert should work correctly',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const byteId = new Uint8Array(randomBytes(16));

        const upsertByteRow = () =>
          db.public.TestByteId.upsert({
            create: { bytes: byteId },
            update: {},
            conflictOn: { bytes: byteId },
          });

        await upsertByteRow();
        // This second call fails: upsert() did not return a row
        await upsertByteRow();

        const result = await db.public.TestByteId.first({ bytes: byteId });
        expect(result).toBeTruthy();
        expect(result?.bytes).toEqual(byteId);
      }),
    timeouts.spinUpPpgDev,
  );
});
