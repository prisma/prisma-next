import { expectTypeOf } from 'vitest';
import { createFn } from '../src/expression-helpers';
import type { DocField, TypedAggExpr, UnresolvedField } from '../src/types';
import type { TestCodecTypes, TestOperationCodecs } from './fixtures/test-contract';
import { testOperationCodecs } from './fixtures/test-contract';

const fn = createFn<TestOperationCodecs, TestCodecTypes>(testOperationCodecs);

type StringLeaf = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
type NumericLeaf = { readonly codecId: 'mongo/double@1'; readonly nullable: false };
type BooleanLeaf = { readonly codecId: 'mongo/bool@1'; readonly nullable: false };
type DateLeaf = { readonly codecId: 'mongo/date@1'; readonly nullable: false };
type ObjectIdLeaf = { readonly codecId: 'mongo/objectId@1'; readonly nullable: false };

const d = {} as TypedAggExpr<DocField>;
const s = {} as TypedAggExpr<StringLeaf>;
const n = {} as TypedAggExpr<NumericLeaf>;
const dt = {} as TypedAggExpr<DateLeaf>;
const b = {} as TypedAggExpr<BooleanLeaf>;
const arr = {} as TypedAggExpr<UnresolvedField>;

describe('table-sourced output types', () => {
  it('concat output codec comes from the table', () => {
    expectTypeOf(fn.concat(d)).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('toDate output codec comes from the table', () => {
    expectTypeOf(fn.toDate(d)).toEqualTypeOf<TypedAggExpr<DateLeaf>>();
  });
  it('eq output codec comes from the table', () => {
    expectTypeOf(fn.eq(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });
  it('year output codec comes from the table', () => {
    expectTypeOf(fn.year(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('toObjectId output codec comes from the table', () => {
    expectTypeOf(fn.toObjectId(s)).toEqualTypeOf<TypedAggExpr<ObjectIdLeaf>>();
  });

  it('a different table yields different output codec types — no hardcode', () => {
    const altOps = { $concat: 'alt/text@9', $toDate: 'alt/when@2' } as const;
    const altFn = createFn<typeof altOps, TestCodecTypes>(altOps);
    expectTypeOf(altFn.concat(d)).toEqualTypeOf<
      TypedAggExpr<{ readonly codecId: 'alt/text@9'; readonly nullable: false }>
    >();
    expectTypeOf(altFn.toDate(d)).toEqualTypeOf<
      TypedAggExpr<{ readonly codecId: 'alt/when@2'; readonly nullable: false }>
    >();
  });
});

describe('date helpers', () => {
  it('date parts return the numeric output', () => {
    expectTypeOf(fn.month(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.dayOfMonth(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.hour(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.minute(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.second(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.millisecond(dt)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('dateToString accepts a contract-shaped date leaf uncast', () => {
    expectTypeOf(fn.dateToString({ date: dt, format: s })).toEqualTypeOf<
      TypedAggExpr<StringLeaf>
    >();
    expectTypeOf(fn.dateToString({ date: dt })).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('dateToString accepts a computed date uncast', () => {
    expectTypeOf(fn.dateToString({ date: fn.toDate(s) })).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('dateFromString returns the date output', () => {
    expectTypeOf(fn.dateFromString({ dateString: s })).toEqualTypeOf<TypedAggExpr<DateLeaf>>();
  });
  it('dateDiff accepts contract and computed dates and returns the numeric output', () => {
    expectTypeOf(fn.dateDiff({ startDate: dt, endDate: fn.toDate(s), unit: s })).toEqualTypeOf<
      TypedAggExpr<NumericLeaf>
    >();
  });
  it('dateAdd returns the date output', () => {
    expectTypeOf(fn.dateAdd({ startDate: dt, unit: s, amount: n })).toEqualTypeOf<
      TypedAggExpr<DateLeaf>
    >();
  });
  it('dateSubtract returns the date output', () => {
    expectTypeOf(fn.dateSubtract({ startDate: dt, unit: s, amount: n })).toEqualTypeOf<
      TypedAggExpr<DateLeaf>
    >();
  });
  it('dateTrunc returns the date output', () => {
    expectTypeOf(fn.dateTrunc({ date: dt, unit: s })).toEqualTypeOf<TypedAggExpr<DateLeaf>>();
  });

  it('rejects wrong type for dateToString date key', () => {
    // @ts-expect-error — date requires an expression whose codec decodes to Date
    fn.dateToString({ date: s });
  });
  it('rejects wrong type for dateAdd amount key', () => {
    // @ts-expect-error — amount requires an expression whose codec decodes to number
    fn.dateAdd({ startDate: dt, unit: s, amount: s });
  });
});

describe('string helpers', () => {
  it('substr returns the string output', () => {
    expectTypeOf(fn.substr(d, d, d)).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('substrBytes returns the string output', () => {
    expectTypeOf(fn.substrBytes(d, d, d)).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('trim family returns the string output', () => {
    expectTypeOf(fn.trim({ input: s })).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
    expectTypeOf(fn.ltrim({ input: s })).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
    expectTypeOf(fn.rtrim({ input: s })).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('trim accepts a computed string uncast', () => {
    expectTypeOf(fn.trim({ input: fn.concat(s, s) })).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('split returns an unresolved structural field', () => {
    expectTypeOf(fn.split(s, s)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('strLen helpers return the numeric output', () => {
    expectTypeOf(fn.strLenCP(s)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.strLenBytes(s)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('regexMatch returns the boolean output', () => {
    expectTypeOf(fn.regexMatch({ input: s, regex: s })).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });
  it('regexFind returns an unresolved structural field', () => {
    expectTypeOf(fn.regexFind({ input: s, regex: s })).toEqualTypeOf<
      TypedAggExpr<UnresolvedField>
    >();
  });
  it('regexFindAll returns an unresolved structural field', () => {
    expectTypeOf(fn.regexFindAll({ input: s, regex: s })).toEqualTypeOf<
      TypedAggExpr<UnresolvedField>
    >();
  });
  it('replaceOne/replaceAll return the string output', () => {
    expectTypeOf(fn.replaceOne({ input: s, find: s, replacement: s })).toEqualTypeOf<
      TypedAggExpr<StringLeaf>
    >();
    expectTypeOf(fn.replaceAll({ input: s, find: s, replacement: s })).toEqualTypeOf<
      TypedAggExpr<StringLeaf>
    >();
  });

  it('rejects wrong type for trim input key', () => {
    // @ts-expect-error — input requires an expression whose codec decodes to string
    fn.trim({ input: n });
  });
  it('rejects wrong type for regexMatch input key', () => {
    // @ts-expect-error — input requires an expression whose codec decodes to string
    fn.regexMatch({ input: dt, regex: s });
  });
});

describe('comparison helpers', () => {
  it('cmp returns the numeric output', () => {
    expectTypeOf(fn.cmp(d, d)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('binary comparisons return the boolean output', () => {
    expectTypeOf(fn.ne(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.gt(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.gte(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.lt(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.lte(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });
});

describe('arithmetic helpers', () => {
  it('add/subtract/multiply/divide return the numeric output', () => {
    expectTypeOf(fn.add(n, n)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.subtract(n, n)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.multiply(n, n)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.divide(n, n)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('size returns the numeric output', () => {
    expectTypeOf(fn.size(arr)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
});

describe('array helpers', () => {
  it('arrayElemAt returns an unresolved structural field', () => {
    expectTypeOf(fn.arrayElemAt(d, d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('concatArrays returns an unresolved structural field', () => {
    expectTypeOf(fn.concatArrays(d, d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('firstElem/lastElem return unresolved structural fields', () => {
    expectTypeOf(fn.firstElem(d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.lastElem(d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('isIn returns the boolean output', () => {
    expectTypeOf(fn.isIn(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });
  it('indexOfArray returns the numeric output', () => {
    expectTypeOf(fn.indexOfArray(d, d)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('isArray returns the boolean output', () => {
    expectTypeOf(fn.isArray(d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });
  it('reverseArray/slice/range return unresolved structural fields', () => {
    expectTypeOf(fn.reverseArray(d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.slice(d, d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.range(n, n, n)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('zip returns an unresolved structural field', () => {
    expectTypeOf(fn.zip({ inputs: [arr, arr] })).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });

  it('rejects wrong type for zip inputs key', () => {
    // @ts-expect-error — inputs requires unresolved-array expressions, not a bare string leaf
    fn.zip({ inputs: s });
  });
});

describe('set helpers', () => {
  it('set-producing helpers return unresolved structural fields', () => {
    expectTypeOf(fn.setUnion(d, d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.setIntersection(d, d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.setDifference(d, d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('set predicates return the boolean output', () => {
    expectTypeOf(fn.setEquals(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.setIsSubset(d, d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.anyElementTrue(d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
    expectTypeOf(fn.allElementsTrue(d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });
});

describe('type helpers', () => {
  it('typeOf returns the string output', () => {
    expectTypeOf(fn.typeOf(d)).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('convert returns an unresolved structural field', () => {
    expectTypeOf(fn.convert({ input: d, to: s })).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.convert({ input: d, to: n })).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('numeric conversions return the numeric output', () => {
    expectTypeOf(fn.toInt(d)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.toLong(d)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.toDouble(d)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
    expectTypeOf(fn.toDecimal(d)).toEqualTypeOf<TypedAggExpr<NumericLeaf>>();
  });
  it('toString_ returns the string output', () => {
    expectTypeOf(fn.toString_(d)).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
  });
  it('toBool returns the boolean output', () => {
    expectTypeOf(fn.toBool(d)).toEqualTypeOf<TypedAggExpr<BooleanLeaf>>();
  });

  it('rejects wrong type for convert to key', () => {
    // @ts-expect-error — to requires an expression decoding to string or number
    fn.convert({ input: d, to: dt });
  });
});

describe('object helpers', () => {
  it('objectToArray/arrayToObject return unresolved structural fields', () => {
    expectTypeOf(fn.objectToArray(d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.arrayToObject(d)).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
  });
  it('getField/setField return unresolved structural fields', () => {
    expectTypeOf(fn.getField({ field: s, input: d })).toEqualTypeOf<
      TypedAggExpr<UnresolvedField>
    >();
    expectTypeOf(fn.getField({ field: s })).toEqualTypeOf<TypedAggExpr<UnresolvedField>>();
    expectTypeOf(fn.setField({ field: s, input: d, value: d })).toEqualTypeOf<
      TypedAggExpr<UnresolvedField>
    >();
  });

  it('rejects wrong type for getField field key', () => {
    // @ts-expect-error — field requires an expression whose codec decodes to string
    fn.getField({ field: n });
  });
  it('rejects wrong type for setField field key', () => {
    // @ts-expect-error — field requires an expression whose codec decodes to string
    fn.setField({ field: b, input: d, value: d });
  });
});

describe('control flow', () => {
  it('cond propagates the then-branch field', () => {
    expectTypeOf(fn.cond(fn.eq(d, d).node, s, d)).toEqualTypeOf<TypedAggExpr<StringLeaf>>();
    expectTypeOf(fn.cond(fn.eq(d, d).node, dt, d)).toEqualTypeOf<TypedAggExpr<DateLeaf>>();
  });
});

describe('literal inference', () => {
  it('string literal usable in string-input positions', () => {
    expectTypeOf(fn.dateToString({ date: dt, format: fn.literal('%Y-%m-%d') })).toEqualTypeOf<
      TypedAggExpr<StringLeaf>
    >();
  });
  it('number literal usable in numeric-input positions', () => {
    expectTypeOf(fn.dateAdd({ startDate: dt, unit: s, amount: fn.literal(3) })).toEqualTypeOf<
      TypedAggExpr<DateLeaf>
    >();
  });
  it('rejects wrong literal type in contextual position', () => {
    // @ts-expect-error — format expects a string-decoding expression, 42 infers numeric
    fn.dateToString({ date: dt, format: fn.literal(42) });
  });
  it('allows explicit generic for custom field types', () => {
    type CustomField = { readonly codecId: 'custom/bigint@1'; readonly nullable: false };
    const custom = fn.literal<CustomField>(42n);
    expectTypeOf(custom).toEqualTypeOf<TypedAggExpr<CustomField>>();
  });
});
