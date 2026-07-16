// Ported ledger entries 85–93, 108, 111–116, 128–129: the remaining typed
// scalar filters (bytea/datetime/bool/enum), a datetime cursor, data-type
// regressions, and data-type writes — all driven against the `DataRow`
// fixture (`fixtures/datatypes-psl`), one column per postgres scalar codec.
//
// Shared fixture wiring (`dataTypesContext`, `createDataRowCollection`,
// `withDataRowRuntime`) lives in `datatypes-helpers.ts` and is reused as-is;
// the `dr(id, overrides)` whole-row builder mirrors `ported-datatypes.test.ts`.
//
// Codec traits (verified against `target-postgres/core/codecs.ts`):
//   - pg/bool@1        ['equality', 'boolean']       → eq
//   - pg/bytea@1       ['equality']                  → eq / in
//   - pg/timestamptz@1 ['equality', 'order']         → eq / in / gt / lt
//   - pg/text@1 (enum) ['equality', 'order', 'textual'] → eq / in
//   - pg/float8@1      ['equality', 'order', 'numeric']
//
// Cursor semantics: prisma-next cursors are INTENTIONALLY EXCLUSIVE (the
// cursor row is dropped) and `cursor()` requires a value for every `orderBy`
// column. Entry 108 asserts the exclusive result, which diverges from the
// upstream (inclusive) fixture it is ported from — see the test comment.
//
// Not ported here:
//   - #111 (bytea primary-key round-trip): the fixture's `id` is int4; there is
//     no bytea-typed PK column, so this cannot be expressed. (cannot express)
//   - #112 (char(n) shorter than n): the fixture has no `char(n)` column
//     (`stringValue` is text). (cannot express)
//   - #114 (int8 precision across an include join): the `DataRow` fixture is a
//     single relation-less model, so there is no relation join to traverse and
//     no int8 id/fk pair to carry. (cannot express; the value read would also
//     hit https://github.com/prisma/prisma-next/issues/983)
//   - #128 (bytea-keyed upsert): `upsert({ conflictOn })` needs a unique
//     constraint on the conflict column, and `bytesValue` is a plain nullable
//     column with no unique constraint in the fixture. (cannot express)

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

describe('integration/ported-datatypes-regressions', () => {
  // ===========================================================================
  // Typed scalar filters — bool / bytea / datetime.
  // ===========================================================================

  it(
    '#85 eq on a bool field matching false',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, boolValue: true },
          { id: 2, boolValue: false },
          { id: 3, boolValue: null },
        ]);

        const matched = await rows.where((m) => m.boolValue.eq(false)).all();

        expect(matched).toEqual([dr(2, { boolValue: false })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#86 eq on a bytea (bytes) field matches the row',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);
        const target = new TextEncoder().encode('test');

        await rows.createAll([
          { id: 1, bytesValue: target },
          { id: 2, bytesValue: new TextEncoder().encode('other') },
          { id: 3, bytesValue: null },
        ]);

        const matched = await rows.where((m) => m.bytesValue.eq(target)).all();

        expect(matched).toEqual([dr(1, { bytesValue: new Uint8Array([116, 101, 115, 116]) })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#87 gt on a timestamp (datetime) field returns later rows',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, dateTimeValue: new Date('1900-10-10T01:10:10.001Z') },
          { id: 2, dateTimeValue: new Date('1969-01-01T10:33:59.000Z') },
          { id: 3, dateTimeValue: new Date('2000-06-15T12:00:00.000Z') },
        ]);

        const matched = await rows
          .where((m) => m.dateTimeValue.gt(new Date('1950-01-01T00:00:00.000Z')))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([
          dr(2, { dateTimeValue: new Date('1969-01-01T10:33:59.000Z') }),
          dr(3, { dateTimeValue: new Date('2000-06-15T12:00:00.000Z') }),
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#88 lt on a timestamp (datetime) field returns earlier rows',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, dateTimeValue: new Date('1900-10-10T01:10:10.001Z') },
          { id: 2, dateTimeValue: new Date('1969-01-01T10:33:59.000Z') },
          { id: 3, dateTimeValue: new Date('2000-06-15T12:00:00.000Z') },
        ]);

        const matched = await rows
          .where((m) => m.dateTimeValue.lt(new Date('1950-01-01T00:00:00.000Z')))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([dr(1, { dateTimeValue: new Date('1900-10-10T01:10:10.001Z') })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#89 eq on a timestamp (datetime) field matches the exact instant',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, dateTimeValue: new Date('1900-10-10T01:10:10.001Z') },
          { id: 2, dateTimeValue: new Date('1969-01-01T10:33:59.000Z') },
          { id: 3, dateTimeValue: new Date('2000-06-15T12:00:00.000Z') },
        ]);

        const matched = await rows
          .where((m) => m.dateTimeValue.eq(new Date('1900-10-10T01:10:10.001Z')))
          .all();

        expect(matched).toEqual([dr(1, { dateTimeValue: new Date('1900-10-10T01:10:10.001Z') })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#90 in on a timestamp (datetime) field matches the listed instants',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, dateTimeValue: new Date('1900-10-10T01:10:10.001Z') },
          { id: 2, dateTimeValue: new Date('1969-01-01T10:33:59.000Z') },
          { id: 3, dateTimeValue: new Date('2000-06-15T12:00:00.000Z') },
        ]);

        const matched = await rows
          .where((m) =>
            m.dateTimeValue.in([
              new Date('1900-10-10T01:10:10.001Z'),
              new Date('1969-01-01T10:33:59.000Z'),
            ]),
          )
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([
          dr(1, { dateTimeValue: new Date('1900-10-10T01:10:10.001Z') }),
          dr(2, { dateTimeValue: new Date('1969-01-01T10:33:59.000Z') }),
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Enums.
  // ===========================================================================

  it(
    '#91 eq on an enum field selects the matching value',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, grade: 'low' },
          { id: 2, grade: 'medium' },
          { id: 3, grade: 'high' },
        ]);

        const matched = await rows.where((m) => m.grade.eq('low')).all();

        expect(matched).toEqual([dr(1, { grade: 'low' })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#92 in on an enum field selects rows matching any listed value',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, grade: 'low' },
          { id: 2, grade: 'medium' },
          { id: 3, grade: 'high' },
        ]);

        const matched = await rows
          .where((m) => m.grade.in(['low', 'high']))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([dr(1, { grade: 'low' }), dr(3, { grade: 'high' })]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#93 enum value round-trips through create and read',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 1, grade: 'low' });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual(dr(1, { grade: 'low' }));
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Cursor pagination against a datetime column.
  // ===========================================================================

  it(
    '#108 cursor pagination against a timestamp (datetime) column',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        // Ten rows with strictly ascending timestamps (2025-01-01 .. 2025-01-10).
        await rows.createAll(
          Array.from({ length: 10 }, (_unused, index) => ({
            id: index + 1,
            dateTimeValue: new Date(`2025-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
          })),
        );

        // Cursor on the datetime column at 2025-01-03. prisma-next cursors are
        // EXCLUSIVE, so the 2025-01-03 row is dropped and the window opens at
        // 2025-01-04; skip(1) then drops 2025-01-04, and take(3) yields
        // 2025-01-05..07. (Upstream's inclusive cursor would yield 01-04..06.)
        const page = await rows
          .orderBy((m) => m.dateTimeValue.asc())
          .cursor({ dateTimeValue: new Date('2025-01-03T00:00:00.000Z') })
          .skip(1)
          .take(3)
          .all();

        expect(page).toEqual([
          dr(5, { dateTimeValue: new Date('2025-01-05T00:00:00.000Z') }),
          dr(6, { dateTimeValue: new Date('2025-01-06T00:00:00.000Z') }),
          dr(7, { dateTimeValue: new Date('2025-01-07T00:00:00.000Z') }),
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Data-type regressions.
  // ===========================================================================

  it(
    '#113 the maximum 32-bit signed integer round-trips through create',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 2147483647 });
        const found = await rows.first({ id: 2147483647 });

        expect(found).toEqual(dr(2147483647));
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#115 groupBy on an enum field with a count aggregate',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.create({ id: 1, grade: 'low' });

        const grouped = await rows
          .groupBy('grade')
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        expect(grouped).toEqual([{ grade: 'low', count: 1 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#116 create with a configured select returns only the selected enum field',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        const created = await rows.select('grade').create({ id: 1, grade: 'low' });

        expect(created).toEqual({ grade: 'low' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Data-type writes.
  // ===========================================================================

  it(
    '#129 large-magnitude float8 values round-trip through create',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createDataRowCollection(runtime);

        await rows.createAll([
          { id: 1, floatValue: 1e20 },
          { id: 2, floatValue: -1e20 },
          { id: 3, floatValue: Number.MAX_SAFE_INTEGER },
        ]);

        const found = await rows.orderBy((m) => m.id.asc()).all();

        expect(found).toEqual([
          dr(1, { floatValue: 1e20 }),
          dr(2, { floatValue: -1e20 }),
          dr(3, { floatValue: 9007199254740991 }),
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
