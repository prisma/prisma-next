import type { MongoAggExpr } from '@prisma-next/mongo-query-ast/execution';
import {
  MongoAggCond,
  MongoAggLiteral,
  MongoAggOperator,
} from '@prisma-next/mongo-query-ast/execution';
import { blindCast } from '@prisma-next/utils/casts';
import type {
  CodecIdsWithOutput,
  CodecTypesBase,
  ComputedField,
  DocField,
  MongoOperationCodecTable,
  TypedAggExpr,
  UnresolvedField,
} from './types';

type AnyExpr = TypedAggExpr<DocField>;

// Operators grouped by declared output role. The family names operators
// only; which codec each op returns is the adapter table's decision.
type StringOutputOps =
  | '$concat'
  | '$toLower'
  | '$toUpper'
  | '$toString'
  | '$substr'
  | '$substrBytes'
  | '$trim'
  | '$ltrim'
  | '$rtrim'
  | '$replaceOne'
  | '$replaceAll'
  | '$dateToString'
  | '$type';

type NumericOutputOps =
  | '$add'
  | '$subtract'
  | '$multiply'
  | '$divide'
  | '$size'
  | '$year'
  | '$month'
  | '$dayOfMonth'
  | '$hour'
  | '$minute'
  | '$second'
  | '$millisecond'
  | '$dateDiff'
  | '$strLenCP'
  | '$strLenBytes'
  | '$cmp'
  | '$indexOfArray'
  | '$toInt'
  | '$toLong'
  | '$toDouble'
  | '$toDecimal'
  | '$count';

type BooleanOutputOps =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$regexMatch'
  | '$isArray'
  | '$toBool'
  | '$setEquals'
  | '$setIsSubset'
  | '$anyElementTrue'
  | '$allElementsTrue';

type DateOutputOps = '$toDate' | '$dateAdd' | '$dateSubtract' | '$dateTrunc' | '$dateFromString';

/**
 * Codec ids acceptable where a value decoding to `TOut` is required: any
 * contract codec whose decoded output extends `TOut`, plus the declared
 * outputs of the operators in `Ops` (so computed values qualify even when
 * the contract itself declares no such codec).
 */
type AcceptedCodecIds<
  CT extends CodecTypesBase,
  TOps extends MongoOperationCodecTable,
  TOut,
  Ops extends string,
> = CodecIdsWithOutput<CT, TOut> | TOps[Ops & keyof TOps];

type InputField<
  CT extends CodecTypesBase,
  TOps extends MongoOperationCodecTable,
  TOut,
  Ops extends string,
> = {
  readonly codecId: AcceptedCodecIds<CT, TOps, TOut, Ops>;
  readonly nullable: boolean;
};

type LiteralField<
  CT extends CodecTypesBase,
  TOps extends MongoOperationCodecTable,
  TOut,
  Ops extends string,
> = {
  readonly codecId: AcceptedCodecIds<CT, TOps, TOut, Ops>;
  readonly nullable: false;
};

type StringExpr<CT extends CodecTypesBase, TOps extends MongoOperationCodecTable> = TypedAggExpr<
  InputField<CT, TOps, string, StringOutputOps>
>;
type NumericExpr<CT extends CodecTypesBase, TOps extends MongoOperationCodecTable> = TypedAggExpr<
  InputField<CT, TOps, number, NumericOutputOps>
>;
type BooleanExpr<CT extends CodecTypesBase, TOps extends MongoOperationCodecTable> = TypedAggExpr<
  InputField<CT, TOps, boolean, BooleanOutputOps>
>;
type DateExpr<CT extends CodecTypesBase, TOps extends MongoOperationCodecTable> = TypedAggExpr<
  InputField<CT, TOps, Date, DateOutputOps>
>;
type StringOrNumericExpr<
  CT extends CodecTypesBase,
  TOps extends MongoOperationCodecTable,
> = TypedAggExpr<InputField<CT, TOps, string | number, StringOutputOps | NumericOutputOps>>;

type Computed<TOps extends MongoOperationCodecTable, Op extends string> = TypedAggExpr<
  ComputedField<TOps, Op>
>;

type Unresolved = TypedAggExpr<UnresolvedField>;

/**
 * Context-bound aggregation expression helpers. Minted from the query root
 * via {@link createFn}; every role-fixed output codec — value and type —
 * comes from the adapter-declared operation table, never from the family.
 */
export interface MongoFn<TOps extends MongoOperationCodecTable, CT extends CodecTypesBase> {
  // -- Arithmetic -----------------------------------------------------------
  add(...args: AnyExpr[]): Computed<TOps, '$add'>;
  subtract(a: AnyExpr, b: AnyExpr): Computed<TOps, '$subtract'>;
  multiply(...args: AnyExpr[]): Computed<TOps, '$multiply'>;
  divide(a: AnyExpr, b: AnyExpr): Computed<TOps, '$divide'>;

  // -- String ---------------------------------------------------------------
  concat(...args: AnyExpr[]): Computed<TOps, '$concat'>;
  toLower(a: AnyExpr): Computed<TOps, '$toLower'>;
  toUpper(a: AnyExpr): Computed<TOps, '$toUpper'>;

  // -- Size -----------------------------------------------------------------
  size(a: AnyExpr): Computed<TOps, '$size'>;

  // -- Control flow ---------------------------------------------------------
  cond<F extends DocField>(
    condition: MongoAggExpr,
    thenExpr: TypedAggExpr<F>,
    elseExpr: AnyExpr,
  ): TypedAggExpr<F>;

  literal(value: string): TypedAggExpr<LiteralField<CT, TOps, string, StringOutputOps>>;
  literal(value: number): TypedAggExpr<LiteralField<CT, TOps, number, NumericOutputOps>>;
  literal(value: boolean): TypedAggExpr<LiteralField<CT, TOps, boolean, BooleanOutputOps>>;
  literal(value: Date): TypedAggExpr<LiteralField<CT, TOps, Date, DateOutputOps>>;
  literal<F extends DocField>(value: unknown): TypedAggExpr<F>;

  // -- Date helpers ----------------------------------------------------------
  year(a: AnyExpr): Computed<TOps, '$year'>;
  month(a: AnyExpr): Computed<TOps, '$month'>;
  dayOfMonth(a: AnyExpr): Computed<TOps, '$dayOfMonth'>;
  hour(a: AnyExpr): Computed<TOps, '$hour'>;
  minute(a: AnyExpr): Computed<TOps, '$minute'>;
  second(a: AnyExpr): Computed<TOps, '$second'>;
  millisecond(a: AnyExpr): Computed<TOps, '$millisecond'>;
  dateToString(args: {
    date: DateExpr<CT, TOps>;
    format?: StringExpr<CT, TOps>;
    timezone?: StringExpr<CT, TOps>;
    onNull?: AnyExpr;
  }): Computed<TOps, '$dateToString'>;
  dateFromString(args: {
    dateString: StringExpr<CT, TOps>;
    format?: StringExpr<CT, TOps>;
    timezone?: StringExpr<CT, TOps>;
    onError?: AnyExpr;
    onNull?: AnyExpr;
  }): Computed<TOps, '$dateFromString'>;
  dateDiff(args: {
    startDate: DateExpr<CT, TOps>;
    endDate: DateExpr<CT, TOps>;
    unit: StringExpr<CT, TOps>;
    timezone?: StringExpr<CT, TOps>;
    startOfWeek?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$dateDiff'>;
  dateAdd(args: {
    startDate: DateExpr<CT, TOps>;
    unit: StringExpr<CT, TOps>;
    amount: NumericExpr<CT, TOps>;
    timezone?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$dateAdd'>;
  dateSubtract(args: {
    startDate: DateExpr<CT, TOps>;
    unit: StringExpr<CT, TOps>;
    amount: NumericExpr<CT, TOps>;
    timezone?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$dateSubtract'>;
  dateTrunc(args: {
    date: DateExpr<CT, TOps>;
    unit: StringExpr<CT, TOps>;
    binSize?: NumericExpr<CT, TOps>;
    timezone?: StringExpr<CT, TOps>;
    startOfWeek?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$dateTrunc'>;

  // -- String helpers ---------------------------------------------------------
  substr(str: AnyExpr, start: AnyExpr, length: AnyExpr): Computed<TOps, '$substr'>;
  substrBytes(str: AnyExpr, start: AnyExpr, count: AnyExpr): Computed<TOps, '$substrBytes'>;
  trim(args: {
    input: StringExpr<CT, TOps>;
    chars?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$trim'>;
  ltrim(args: {
    input: StringExpr<CT, TOps>;
    chars?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$ltrim'>;
  rtrim(args: {
    input: StringExpr<CT, TOps>;
    chars?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$rtrim'>;
  split(str: AnyExpr, delimiter: AnyExpr): Unresolved;
  strLenCP(a: AnyExpr): Computed<TOps, '$strLenCP'>;
  strLenBytes(a: AnyExpr): Computed<TOps, '$strLenBytes'>;
  regexMatch(args: {
    input: StringExpr<CT, TOps>;
    regex: StringExpr<CT, TOps>;
    options?: StringExpr<CT, TOps>;
  }): Computed<TOps, '$regexMatch'>;
  regexFind(args: {
    input: StringExpr<CT, TOps>;
    regex: StringExpr<CT, TOps>;
    options?: StringExpr<CT, TOps>;
  }): Unresolved;
  regexFindAll(args: {
    input: StringExpr<CT, TOps>;
    regex: StringExpr<CT, TOps>;
    options?: StringExpr<CT, TOps>;
  }): Unresolved;
  replaceOne(args: {
    input: StringExpr<CT, TOps>;
    find: StringExpr<CT, TOps>;
    replacement: StringExpr<CT, TOps>;
  }): Computed<TOps, '$replaceOne'>;
  replaceAll(args: {
    input: StringExpr<CT, TOps>;
    find: StringExpr<CT, TOps>;
    replacement: StringExpr<CT, TOps>;
  }): Computed<TOps, '$replaceAll'>;

  // -- Comparison helpers ------------------------------------------------------
  cmp(a: AnyExpr, b: AnyExpr): Computed<TOps, '$cmp'>;
  eq(a: AnyExpr, b: AnyExpr): Computed<TOps, '$eq'>;
  ne(a: AnyExpr, b: AnyExpr): Computed<TOps, '$ne'>;
  gt(a: AnyExpr, b: AnyExpr): Computed<TOps, '$gt'>;
  gte(a: AnyExpr, b: AnyExpr): Computed<TOps, '$gte'>;
  lt(a: AnyExpr, b: AnyExpr): Computed<TOps, '$lt'>;
  lte(a: AnyExpr, b: AnyExpr): Computed<TOps, '$lte'>;

  // -- Array helpers -----------------------------------------------------------
  arrayElemAt(arr: AnyExpr, idx: AnyExpr): Unresolved;
  concatArrays(...args: AnyExpr[]): Unresolved;
  firstElem(a: AnyExpr): Unresolved;
  lastElem(a: AnyExpr): Unresolved;
  isIn(elem: AnyExpr, arr: AnyExpr): Computed<TOps, '$in'>;
  indexOfArray(arr: AnyExpr, value: AnyExpr, ...rest: AnyExpr[]): Computed<TOps, '$indexOfArray'>;
  isArray(a: AnyExpr): Computed<TOps, '$isArray'>;
  reverseArray(a: AnyExpr): Unresolved;
  slice(arr: AnyExpr, ...rest: AnyExpr[]): Unresolved;
  zip(args: {
    inputs: Unresolved[];
    useLongestLength?: BooleanExpr<CT, TOps>;
    defaults?: Unresolved;
  }): Unresolved;
  range(start: AnyExpr, end: AnyExpr, step: AnyExpr): Unresolved;

  // -- Set helpers -------------------------------------------------------------
  setUnion(...args: AnyExpr[]): Unresolved;
  setIntersection(...args: AnyExpr[]): Unresolved;
  setDifference(a: AnyExpr, b: AnyExpr): Unresolved;
  setEquals(...args: AnyExpr[]): Computed<TOps, '$setEquals'>;
  setIsSubset(a: AnyExpr, b: AnyExpr): Computed<TOps, '$setIsSubset'>;
  anyElementTrue(a: AnyExpr): Computed<TOps, '$anyElementTrue'>;
  allElementsTrue(a: AnyExpr): Computed<TOps, '$allElementsTrue'>;

  // -- Type helpers ------------------------------------------------------------
  typeOf(a: AnyExpr): Computed<TOps, '$type'>;
  convert(args: {
    input: AnyExpr;
    to: StringOrNumericExpr<CT, TOps>;
    onError?: AnyExpr;
    onNull?: AnyExpr;
  }): Unresolved;
  toInt(a: AnyExpr): Computed<TOps, '$toInt'>;
  toLong(a: AnyExpr): Computed<TOps, '$toLong'>;
  toDouble(a: AnyExpr): Computed<TOps, '$toDouble'>;
  toDecimal(a: AnyExpr): Computed<TOps, '$toDecimal'>;
  toString_(a: AnyExpr): Computed<TOps, '$toString'>;
  toObjectId(a: AnyExpr): Computed<TOps, '$toObjectId'>;
  toBool(a: AnyExpr): Computed<TOps, '$toBool'>;
  toDate(a: AnyExpr): Computed<TOps, '$toDate'>;

  // -- Object helpers ----------------------------------------------------------
  objectToArray(a: AnyExpr): Unresolved;
  arrayToObject(a: AnyExpr): Unresolved;
  getField(args: { field: StringExpr<CT, TOps>; input?: AnyExpr }): Unresolved;
  setField(args: { field: StringExpr<CT, TOps>; input: AnyExpr; value: AnyExpr }): Unresolved;
}

const UNRESOLVED: UnresolvedField = { codecId: '', nullable: false, unresolved: true };
const UNRESOLVED_NULLABLE: UnresolvedField = { codecId: '', nullable: true, unresolved: true };

function namedArgs(
  args: Readonly<Record<string, AnyExpr | undefined>>,
): Record<string, MongoAggExpr> {
  const nodeArgs: Record<string, MongoAggExpr> = {};
  for (const [key, val] of Object.entries(args)) {
    if (val !== undefined) {
      nodeArgs[key] = val.node;
    }
  }
  return nodeArgs;
}

function nodesOf(args: ReadonlyArray<AnyExpr>): MongoAggExpr[] {
  return args.map((a) => a.node);
}

/**
 * Mint the context-bound `fn` helpers from an adapter-declared
 * operation→output-codec table. There is deliberately no context-free
 * counterpart: a detached helper has no codec source to consult.
 */
export function createFn<
  TOps extends MongoOperationCodecTable,
  CT extends CodecTypesBase = CodecTypesBase,
>(table: TOps): MongoFn<TOps, CT> {
  const lookup: Readonly<Record<string, string>> = table;

  function computed<Op extends string>(
    op: Op,
    args: MongoAggExpr | ReadonlyArray<MongoAggExpr> | Readonly<Record<string, MongoAggExpr>>,
  ): Computed<TOps, Op> {
    return {
      _field: blindCast<
        ComputedField<TOps, Op>,
        'codecId is read from the adapter table entry for this operator'
      >({ codecId: lookup[op] ?? '', nullable: false }),
      node: MongoAggOperator.of(op, args),
    };
  }

  function unresolvedExpr(
    op: string,
    args: MongoAggExpr | ReadonlyArray<MongoAggExpr> | Readonly<Record<string, MongoAggExpr>>,
    field: UnresolvedField = UNRESOLVED,
  ): Unresolved {
    return { _field: field, node: MongoAggOperator.of(op, args) };
  }

  function literal(value: string): TypedAggExpr<LiteralField<CT, TOps, string, StringOutputOps>>;
  function literal(value: number): TypedAggExpr<LiteralField<CT, TOps, number, NumericOutputOps>>;
  function literal(value: boolean): TypedAggExpr<LiteralField<CT, TOps, boolean, BooleanOutputOps>>;
  function literal(value: Date): TypedAggExpr<LiteralField<CT, TOps, Date, DateOutputOps>>;
  function literal<F extends DocField>(value: unknown): TypedAggExpr<F>;
  function literal(value: unknown): AnyExpr {
    return {
      _field: blindCast<never, 'literals carry no runtime codec; typing is contextual'>(undefined),
      node: MongoAggLiteral.of(value),
    };
  }

  return {
    add: (...args) => computed('$add', nodesOf(args)),
    subtract: (a, b) => computed('$subtract', nodesOf([a, b])),
    multiply: (...args) => computed('$multiply', nodesOf(args)),
    divide: (a, b) => computed('$divide', nodesOf([a, b])),

    concat: (...args) => computed('$concat', nodesOf(args)),
    toLower: (a) => computed('$toLower', a.node),
    toUpper: (a) => computed('$toUpper', a.node),

    size: (a) => computed('$size', a.node),

    cond: <F extends DocField>(
      condition: MongoAggExpr,
      thenExpr: TypedAggExpr<F>,
      elseExpr: AnyExpr,
    ): TypedAggExpr<F> => ({
      _field: thenExpr._field,
      node: new MongoAggCond(condition, thenExpr.node, elseExpr.node),
    }),

    literal,

    year: (a) => computed('$year', a.node),
    month: (a) => computed('$month', a.node),
    dayOfMonth: (a) => computed('$dayOfMonth', a.node),
    hour: (a) => computed('$hour', a.node),
    minute: (a) => computed('$minute', a.node),
    second: (a) => computed('$second', a.node),
    millisecond: (a) => computed('$millisecond', a.node),
    dateToString: (args) => computed('$dateToString', namedArgs(args)),
    dateFromString: (args) => computed('$dateFromString', namedArgs(args)),
    dateDiff: (args) => computed('$dateDiff', namedArgs(args)),
    dateAdd: (args) => computed('$dateAdd', namedArgs(args)),
    dateSubtract: (args) => computed('$dateSubtract', namedArgs(args)),
    dateTrunc: (args) => computed('$dateTrunc', namedArgs(args)),

    substr: (str, start, length) => computed('$substr', nodesOf([str, start, length])),
    substrBytes: (str, start, count) => computed('$substrBytes', nodesOf([str, start, count])),
    trim: (args) => computed('$trim', namedArgs(args)),
    ltrim: (args) => computed('$ltrim', namedArgs(args)),
    rtrim: (args) => computed('$rtrim', namedArgs(args)),
    split: (str, delimiter) => unresolvedExpr('$split', nodesOf([str, delimiter])),
    strLenCP: (a) => computed('$strLenCP', a.node),
    strLenBytes: (a) => computed('$strLenBytes', a.node),
    regexMatch: (args) => computed('$regexMatch', namedArgs(args)),
    regexFind: (args) => unresolvedExpr('$regexFind', namedArgs(args)),
    regexFindAll: (args) => unresolvedExpr('$regexFindAll', namedArgs(args)),
    replaceOne: (args) => computed('$replaceOne', namedArgs(args)),
    replaceAll: (args) => computed('$replaceAll', namedArgs(args)),

    cmp: (a, b) => computed('$cmp', nodesOf([a, b])),
    eq: (a, b) => computed('$eq', nodesOf([a, b])),
    ne: (a, b) => computed('$ne', nodesOf([a, b])),
    gt: (a, b) => computed('$gt', nodesOf([a, b])),
    gte: (a, b) => computed('$gte', nodesOf([a, b])),
    lt: (a, b) => computed('$lt', nodesOf([a, b])),
    lte: (a, b) => computed('$lte', nodesOf([a, b])),

    arrayElemAt: (arr, idx) =>
      unresolvedExpr('$arrayElemAt', nodesOf([arr, idx]), UNRESOLVED_NULLABLE),
    concatArrays: (...args) => unresolvedExpr('$concatArrays', nodesOf(args)),
    firstElem: (a) => unresolvedExpr('$first', a.node, UNRESOLVED_NULLABLE),
    lastElem: (a) => unresolvedExpr('$last', a.node, UNRESOLVED_NULLABLE),
    isIn: (elem, arr) => computed('$in', nodesOf([elem, arr])),
    indexOfArray: (arr, value, ...rest) =>
      computed('$indexOfArray', nodesOf([arr, value, ...rest])),
    isArray: (a) => computed('$isArray', a.node),
    reverseArray: (a) => unresolvedExpr('$reverseArray', a.node),
    slice: (arr, ...rest) => unresolvedExpr('$slice', nodesOf([arr, ...rest])),
    zip: (args) => {
      const nodeArgs: Record<string, MongoAggExpr | ReadonlyArray<MongoAggExpr>> = {
        inputs: args.inputs.map((a) => a.node),
      };
      if (args.useLongestLength) nodeArgs['useLongestLength'] = args.useLongestLength.node;
      if (args.defaults) nodeArgs['defaults'] = args.defaults.node;
      return { _field: UNRESOLVED, node: MongoAggOperator.of('$zip', nodeArgs) };
    },
    range: (start, end, step) => unresolvedExpr('$range', nodesOf([start, end, step])),

    setUnion: (...args) => unresolvedExpr('$setUnion', nodesOf(args)),
    setIntersection: (...args) => unresolvedExpr('$setIntersection', nodesOf(args)),
    setDifference: (a, b) => unresolvedExpr('$setDifference', nodesOf([a, b])),
    setEquals: (...args) => computed('$setEquals', nodesOf(args)),
    setIsSubset: (a, b) => computed('$setIsSubset', nodesOf([a, b])),
    anyElementTrue: (a) => computed('$anyElementTrue', a.node),
    allElementsTrue: (a) => computed('$allElementsTrue', a.node),

    typeOf: (a) => computed('$type', a.node),
    convert: (args) => unresolvedExpr('$convert', namedArgs(args)),
    toInt: (a) => computed('$toInt', a.node),
    toLong: (a) => computed('$toLong', a.node),
    toDouble: (a) => computed('$toDouble', a.node),
    toDecimal: (a) => computed('$toDecimal', a.node),
    toString_: (a) => computed('$toString', a.node),
    toObjectId: (a) => computed('$toObjectId', a.node),
    toBool: (a) => computed('$toBool', a.node),
    toDate: (a) => computed('$toDate', a.node),

    objectToArray: (a) => unresolvedExpr('$objectToArray', a.node),
    arrayToObject: (a) => unresolvedExpr('$arrayToObject', a.node),
    getField: (args) => unresolvedExpr('$getField', namedArgs(args)),
    setField: (args) => unresolvedExpr('$setField', namedArgs(args)),
  };
}
