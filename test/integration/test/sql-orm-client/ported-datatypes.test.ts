// Ported ledger entries 67–84: data-type round-trip reads and typed scalar
// filters, driven against the `DataRow` fixture (`fixtures/datatypes-psl`).
// Each column exercises one postgres scalar codec.
//
// Entries #71, #72, #83 (numeric/decimal) and #112 (char) are ported in
// ported-datatypes-params.test.ts via PSL named types
// (`types { Amount = Decimal @db.Numeric(20, 8) }`, `Code = String @db.Char(12)`),
// which carry the required typeParams. This file's DataRow has no numeric/char field.
//
// Codec representation notes (verified against
// `@prisma-next/target-postgres/codec-types` + `core/codecs.ts`):
//   - pg/int8@1     input/output are `number` (NOT bigint). The ledger's
//                   `10000000000n` is expressed as the number `10000000000`,
//                   which is < Number.MAX_SAFE_INTEGER so it is exact.
//   - pg/bytea@1    input/output `Uint8Array` (driver Buffers are normalized
//                   to a plain Uint8Array on decode).
//   - pg/timestamptz@1 input/output `Date`.
//
// Entry 67 (negative int4) is expressed via `DataRow.id` (an int4 PK) rather
// than `posts.views`: the runtime is built against the data-types contract, so
// a plan over the base `posts` table would fail storageHash validation.

import { describe, expect, it } from 'vitest';
import { createDataRowCollection, timeouts, withDataRowRuntime } from './datatypes-helpers';

type DataRowShape = {
  id: number;
  bigValue: number | null;
  floatValue: number | null;
  boolValue: boolean | null;
  bytesValue: Uint8Array | null;
  dateTimeValue: Date | null;
  stringValue: string | null;
  grade: 'low' | 'medium' | 'high' | null;
};

function dr(id: number, overrides: Partial<DataRowShape> = {}): DataRowShape {
  return {
    id,
    bigValue: null,
    floatValue: null,
    boolValue: null,
    bytesValue: null,
    dateTimeValue: null,
    stringValue: null,
    grade: null,
    ...overrides,
  };
}

describe('integration/ported-datatypes', () => {
  // ===========================================================================
  // Round-trip reads (create + read-back).
  // ===========================================================================

  it(
    '#67 negative int4 value round-trips through create and read',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: -42 });
        const found = await rows.first({ id: -42 });

        expect(found).toEqual(dr(-42));
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Known bug: https://github.com/prisma/prisma-next/issues/983 — int8 reads return a string; decided fix is bigint for both type and runtime. When fixed, assert bigint values and remove .fails.
  it.fails(
    '#68 positive int8 (bigint) value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 1, bigValue: 10000000000 });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { bigValue: 10000000000 }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Known bug: https://github.com/prisma/prisma-next/issues/983 — int8 reads return a string; decided fix is bigint for both type and runtime. When fixed, assert bigint values and remove .fails.
  it.fails(
    '#69 negative int8 (bigint) value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 2, bigValue: -10000000000 });
        const found = await rows.first({ id: 2 });

        expect(found).toEqual(dr(2, { bigValue: -10000000000 }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#70 float8 value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 1, floatValue: 13.37 });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { floatValue: 13.37 }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#73 bool true value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 1, boolValue: true });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { boolValue: true }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#74 bool false value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 2, boolValue: false });
        const found = await rows.first({ id: 2 });

        expect(found).toEqual(dr(2, { boolValue: false }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#75 bytea (bytes) value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);
        const bytes = new TextEncoder().encode('test');

        await rows.create({ id: 1, bytesValue: bytes });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { bytesValue: new Uint8Array([116, 101, 115, 116]) }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#76 timestamptz (datetime) value round-trips a specific instant',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);
        const instant = new Date('1900-10-10T01:10:10.001Z');

        await rows.create({ id: 1, dateTimeValue: instant });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { dateTimeValue: new Date('1900-10-10T01:10:10.001Z') }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#77 empty-string text value round-trips',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 1, stringValue: '' });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { stringValue: '' }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Typed scalar filters.
  // ===========================================================================

  // Known bug: https://github.com/prisma/prisma-next/issues/983 — int8 reads return a string; decided fix is bigint for both type and runtime. When fixed, assert bigint values and remove .fails.
  it.fails(
    '#78 eq on an int8 (bigint) field matches the row',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, bigValue: 10000000000 },
          { id: 2, bigValue: -10000000000 },
          { id: 3, bigValue: null },
        ]);

        const matched = await rows.where((m) => m.bigValue.eq(10000000000)).all();

        expect(matched).toEqual([dr(1, { bigValue: 10000000000 })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Known bug: https://github.com/prisma/prisma-next/issues/983 — int8 reads return a string; decided fix is bigint for both type and runtime. When fixed, assert bigint values and remove .fails.
  it.fails(
    '#79 gt on an int8 (bigint) field returns positive rows',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, bigValue: 10000000000 },
          { id: 2, bigValue: -10000000000 },
          { id: 3, bigValue: null },
        ]);

        const matched = await rows
          .where((m) => m.bigValue.gt(0))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([dr(1, { bigValue: 10000000000 })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Known bug: https://github.com/prisma/prisma-next/issues/983 — int8 reads return a string; decided fix is bigint for both type and runtime. When fixed, assert bigint values and remove .fails.
  it.fails(
    '#80 in on an int8 (bigint) field matches the listed rows',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, bigValue: 10000000000 },
          { id: 2, bigValue: -10000000000 },
          { id: 3, bigValue: 42 },
        ]);

        const matched = await rows
          .where((m) => m.bigValue.in([10000000000, -10000000000]))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([
          dr(1, { bigValue: 10000000000 }),
          dr(2, { bigValue: -10000000000 }),
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#81 gt on a float8 field returns rows above the threshold',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, floatValue: 13.37 },
          { id: 2, floatValue: 1.2 },
          { id: 3, floatValue: 0.5 },
        ]);

        const matched = await rows
          .where((m) => m.floatValue.gt(1.2))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([dr(1, { floatValue: 13.37 })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#82 eq on a float8 field matches the row',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, floatValue: 13.37 },
          { id: 2, floatValue: 1.2 },
        ]);

        const matched = await rows.where((m) => m.floatValue.eq(13.37)).all();

        expect(matched).toEqual([dr(1, { floatValue: 13.37 })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#84 eq on a bool field matching true',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, boolValue: true },
          { id: 2, boolValue: false },
          { id: 3, boolValue: null },
        ]);

        const matched = await rows.where((m) => m.boolValue.eq(true)).all();

        expect(matched).toEqual([dr(1, { boolValue: true })]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
