// Ported ledger entries for parameterized / keyed / relational data types,
// driven against the extended `datatypes-psl` fixture:
//   #71, #72, #83  numeric(20,8) round-trip + filter via `ParamRow.amount`
//   #112           char(12) shorter-than-n round-trip via `ParamRow.code`
//   #111           bytea primary-key round-trip via `BytesRow`
//   #128           bytea-keyed upsert via `BytesRow` (conflict on the bytea PK)
//   #114           int8 precision across an include join via BigParent/BigChild
//
// Codec representation notes (verified against the codec sources, not guessed):
//   - pg/numeric@1 (ParamRow.amount, typeRef Amount = numeric(20,8)):
//       decode passes the driver's textual numeric through verbatim
//       (`core/codec-helpers.ts` `pgNumericDecode`). numeric(20,8) SCALE-PADS
//       on store, so `'12.3456'` reads back as `'12.34560000'` and `'0'` as
//       `'0.00000000'` — preserved to 8 dp (faithful, not truncated). NOTE:
//       for a *parameterized* column the ORM's create/filter INPUT and the
//       read-back OUTPUT are the branded `Numeric<20, 8>` (a branded string),
//       not a plain string, so test literals are branded via `blindCast`.
//   - sql/char@1 (ParamRow.code, typeRef Code = char(12)):
//       decode is `wire.trimEnd()` (`relational-core/.../sql-codec-helpers.ts`
//       `sqlCharDecode`). Postgres char(n) space-pads on read; the codec strips
//       that trailing padding, so `'12345'` reads back as `'12345'` (padding
//       removed, input preserved / not truncated). The faithful ORM-level
//       assertion is therefore the trimmed `'12345'`, NOT the raw padded DB
//       string. Input/output are the branded `Char<12>`.
//   - pg/bytea@1 (BytesRow.id): input/output `Uint8Array` (plain, unbranded).
//   - pg/int8@1 (BigParent.id, BigChild.parentId): declared input/output
//       `number`, but reads currently return a `string` (known bug #983) — see
//       the `it.fails` on #114.

import type { Char, Numeric } from '@prisma-next/target-postgres/codec-types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  createBigChildCollection,
  createBigParentCollection,
  createBytesRowCollection,
  createParamRowCollection,
  timeouts,
  withDataRowRuntime,
} from './datatypes-helpers';

// Parameterized-codec fields expose branded literal types on the public
// surface; brand plain test literals to satisfy `create`/filter input and
// read-back `toEqual` expectations.
const amount = (value: string) =>
  blindCast<
    Numeric<20, 8>,
    'numeric(20,8) literal — branded scalar for a parameterized codec field'
  >(value);
const code = (value: string) =>
  blindCast<Char<12>, 'char(12) literal — branded scalar for a parameterized codec field'>(value);

describe('integration/ported-datatypes-params', () => {
  // ===========================================================================
  // numeric(20,8) — ParamRow.amount.
  // ===========================================================================

  it(
    '#71 positive numeric (decimal) value round-trips scale-normalized',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createParamRowCollection(runtime);

        await rows.create({ id: 1, amount: amount('12.3456') });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual({ id: 1, amount: amount('12.34560000'), code: null });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#72 negative numeric (decimal) value round-trips scale-normalized',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createParamRowCollection(runtime);

        await rows.create({ id: 2, amount: amount('-1.2345678') });
        const found = await rows.first({ id: 2 });

        expect(found).toEqual({ id: 2, amount: amount('-1.23456780'), code: null });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#83 gte on a numeric (decimal) field returns non-negative rows',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createParamRowCollection(runtime);

        await rows.createAll([
          { id: 1, amount: amount('12.3456') },
          { id: 2, amount: amount('-1.2345678') },
          { id: 3, amount: amount('0') },
        ]);

        const matched = await rows
          .where((m) => m.amount.gte(amount('0')))
          .orderBy((m) => m.id.asc())
          .all();

        expect(matched).toEqual([
          { id: 1, amount: amount('12.34560000'), code: null },
          { id: 3, amount: amount('0.00000000'), code: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // char(12) — ParamRow.code.
  // ===========================================================================

  it(
    '#112 char(n) value shorter than n round-trips without truncation',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createParamRowCollection(runtime);

        await rows.create({ id: 1, code: code('12345') });
        const found = await rows.first({ id: 1 });

        expect(found).toEqual({ id: 1, amount: null, code: code('12345') });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // bytea primary key — BytesRow.
  // ===========================================================================

  it(
    '#111 bytea (bytes) primary key round-trips through create and read-back',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createBytesRowCollection(runtime);

        await rows.create({ id: new Uint8Array(16).fill(0), label: 'x' });
        const found = await rows.where({ id: new Uint8Array(16).fill(0) }).first();

        expect(found).toEqual({ id: new Uint8Array(16).fill(0), label: 'x' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '#128 upsert keyed on a bytea (bytes) primary key resolves the conflict',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const rows = createBytesRowCollection(runtime);
        const key = new Uint8Array(16).fill(7);

        const created = await rows.upsert({
          create: { id: new Uint8Array(16).fill(7), label: 'first' },
          update: { label: 'updated' },
        });
        expect(created).toEqual({ id: new Uint8Array(16).fill(7), label: 'first' });

        const updated = await rows.upsert({
          create: { id: new Uint8Array(16).fill(7), label: 'ignored' },
          update: { label: 'updated' },
        });
        expect(updated).toEqual({ id: new Uint8Array(16).fill(7), label: 'updated' });

        const found = await rows.where({ id: key }).first();
        expect(found).toEqual({ id: new Uint8Array(16).fill(7), label: 'updated' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // int8 precision across an include join — BigParent / BigChild.
  // ===========================================================================

  // Known bug: https://github.com/prisma/prisma-next/issues/983 — int8 returns string; fix is bigint. Remove .fails when fixed.
  // The id below is capped at 2^53-1 (Number.MAX_SAFE_INTEGER) because today's
  // pg/int8@1 input is typed `number`, and a >2^53 literal trips
  // lint/correctness/noPrecisionLoss (which we must not suppress). The genuine
  // >2^53 precision case is unlocked by the #983 fix: once int8 becomes
  // `bigint`, swap this to a bigint literal such as `312590077454712834n` (a
  // real >2^53 value) and remove `.fails`.
  it.fails(
    '#114 int8 (bigint) precision is preserved across an include relation join',
    async () => {
      await withDataRowRuntime(async (runtime) => {
        const parents = createBigParentCollection(runtime);
        const children = createBigChildCollection(runtime);

        await parents.create({ id: 9007199254740991, label: 'p' });
        await children.create({ id: 1, parentId: 9007199254740991 });

        const found = await parents.where({ id: 9007199254740991 }).include('children').first();

        expect(found).toEqual({
          id: 9007199254740991,
          label: 'p',
          children: [{ id: 1, parentId: 9007199254740991 }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
