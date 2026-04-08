import { expectTypeOf } from 'vitest';
import { fn } from '../src/expression-helpers';
import type {
  ArrayField,
  BooleanField,
  DateField,
  DocField,
  NumericField,
  StringField,
  TypedAggExpr,
} from '../src/types';

const d = {} as TypedAggExpr<DocField>;

describe('date helpers', () => {
  it('year returns NumericField', () => {
    expectTypeOf(fn.year(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('month returns NumericField', () => {
    expectTypeOf(fn.month(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('dayOfMonth returns NumericField', () => {
    expectTypeOf(fn.dayOfMonth(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('hour returns NumericField', () => {
    expectTypeOf(fn.hour(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('minute returns NumericField', () => {
    expectTypeOf(fn.minute(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('second returns NumericField', () => {
    expectTypeOf(fn.second(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('millisecond returns NumericField', () => {
    expectTypeOf(fn.millisecond(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('dateToString returns StringField', () => {
    expectTypeOf(fn.dateToString({ date: d, format: d })).toEqualTypeOf<
      TypedAggExpr<StringField>
    >();
  });
  it('dateFromString returns DateField', () => {
    expectTypeOf(fn.dateFromString({ dateString: d })).toEqualTypeOf<TypedAggExpr<DateField>>();
  });
  it('dateDiff returns NumericField', () => {
    expectTypeOf(fn.dateDiff({ startDate: d, endDate: d, unit: d })).toEqualTypeOf<
      TypedAggExpr<NumericField>
    >();
  });
  it('dateAdd returns DateField', () => {
    expectTypeOf(fn.dateAdd({ startDate: d, unit: d, amount: d })).toEqualTypeOf<
      TypedAggExpr<DateField>
    >();
  });
  it('dateSubtract returns DateField', () => {
    expectTypeOf(fn.dateSubtract({ startDate: d, unit: d, amount: d })).toEqualTypeOf<
      TypedAggExpr<DateField>
    >();
  });
  it('dateTrunc returns DateField', () => {
    expectTypeOf(fn.dateTrunc({ date: d, unit: d })).toEqualTypeOf<TypedAggExpr<DateField>>();
  });
});

describe('string helpers', () => {
  it('substr returns StringField', () => {
    expectTypeOf(fn.substr(d, d, d)).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('substrBytes returns StringField', () => {
    expectTypeOf(fn.substrBytes(d, d, d)).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('trim returns StringField', () => {
    expectTypeOf(fn.trim({ input: d })).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('ltrim returns StringField', () => {
    expectTypeOf(fn.ltrim({ input: d })).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('rtrim returns StringField', () => {
    expectTypeOf(fn.rtrim({ input: d })).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('split returns ArrayField', () => {
    expectTypeOf(fn.split(d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('strLenCP returns NumericField', () => {
    expectTypeOf(fn.strLenCP(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('strLenBytes returns NumericField', () => {
    expectTypeOf(fn.strLenBytes(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('regexMatch returns BooleanField', () => {
    expectTypeOf(fn.regexMatch({ input: d, regex: d })).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('regexFind returns DocField', () => {
    expectTypeOf(fn.regexFind({ input: d, regex: d })).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('regexFindAll returns ArrayField', () => {
    expectTypeOf(fn.regexFindAll({ input: d, regex: d })).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('replaceOne returns StringField', () => {
    expectTypeOf(fn.replaceOne({ input: d, find: d, replacement: d })).toEqualTypeOf<
      TypedAggExpr<StringField>
    >();
  });
  it('replaceAll returns StringField', () => {
    expectTypeOf(fn.replaceAll({ input: d, find: d, replacement: d })).toEqualTypeOf<
      TypedAggExpr<StringField>
    >();
  });
});

describe('comparison helpers', () => {
  it('cmp returns NumericField', () => {
    expectTypeOf(fn.cmp(d, d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('eq returns BooleanField', () => {
    expectTypeOf(fn.eq(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('ne returns BooleanField', () => {
    expectTypeOf(fn.ne(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('gt returns BooleanField', () => {
    expectTypeOf(fn.gt(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('gte returns BooleanField', () => {
    expectTypeOf(fn.gte(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('lt returns BooleanField', () => {
    expectTypeOf(fn.lt(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('lte returns BooleanField', () => {
    expectTypeOf(fn.lte(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
});

describe('array helpers', () => {
  it('arrayElemAt returns DocField', () => {
    expectTypeOf(fn.arrayElemAt(d, d)).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('concatArrays returns ArrayField', () => {
    expectTypeOf(fn.concatArrays(d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('firstElem returns DocField', () => {
    expectTypeOf(fn.firstElem(d)).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('lastElem returns DocField', () => {
    expectTypeOf(fn.lastElem(d)).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('isIn returns BooleanField', () => {
    expectTypeOf(fn.isIn(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('indexOfArray returns NumericField', () => {
    expectTypeOf(fn.indexOfArray(d, d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('isArray returns BooleanField', () => {
    expectTypeOf(fn.isArray(d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('reverseArray returns ArrayField', () => {
    expectTypeOf(fn.reverseArray(d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('slice returns ArrayField', () => {
    expectTypeOf(fn.slice(d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('zip returns ArrayField', () => {
    expectTypeOf(fn.zip({ inputs: d })).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('range returns ArrayField', () => {
    expectTypeOf(fn.range(d, d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
});

describe('set helpers', () => {
  it('setUnion returns ArrayField', () => {
    expectTypeOf(fn.setUnion(d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('setIntersection returns ArrayField', () => {
    expectTypeOf(fn.setIntersection(d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('setDifference returns ArrayField', () => {
    expectTypeOf(fn.setDifference(d, d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('setEquals returns BooleanField', () => {
    expectTypeOf(fn.setEquals(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('setIsSubset returns BooleanField', () => {
    expectTypeOf(fn.setIsSubset(d, d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('anyElementTrue returns BooleanField', () => {
    expectTypeOf(fn.anyElementTrue(d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('allElementsTrue returns BooleanField', () => {
    expectTypeOf(fn.allElementsTrue(d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
});

describe('type helpers', () => {
  it('typeOf returns StringField', () => {
    expectTypeOf(fn.typeOf(d)).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('convert returns DocField', () => {
    expectTypeOf(fn.convert({ input: d, to: d })).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('toInt returns NumericField', () => {
    expectTypeOf(fn.toInt(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('toLong returns NumericField', () => {
    expectTypeOf(fn.toLong(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('toDouble returns NumericField', () => {
    expectTypeOf(fn.toDouble(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('toDecimal returns NumericField', () => {
    expectTypeOf(fn.toDecimal(d)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('toString_ returns StringField', () => {
    expectTypeOf(fn.toString_(d)).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('toObjectId returns DocField', () => {
    expectTypeOf(fn.toObjectId(d)).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('toBool returns BooleanField', () => {
    expectTypeOf(fn.toBool(d)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('toDate returns DateField', () => {
    expectTypeOf(fn.toDate(d)).toEqualTypeOf<TypedAggExpr<DateField>>();
  });
});

describe('object helpers', () => {
  it('objectToArray returns ArrayField', () => {
    expectTypeOf(fn.objectToArray(d)).toEqualTypeOf<TypedAggExpr<ArrayField>>();
  });
  it('arrayToObject returns DocField', () => {
    expectTypeOf(fn.arrayToObject(d)).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('getField returns DocField', () => {
    expectTypeOf(fn.getField({ field: d, input: d })).toEqualTypeOf<TypedAggExpr<DocField>>();
  });
  it('setField returns DocField', () => {
    expectTypeOf(fn.setField({ field: d, input: d, value: d })).toEqualTypeOf<
      TypedAggExpr<DocField>
    >();
  });
});
