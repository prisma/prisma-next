import {
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
} from './codec-ids';

/**
 * Adapter-declared operation→output-codec table: for every aggregation
 * operator whose output type is fixed and input-independent, the codec this
 * adapter decodes that output with. Consumed by the query builder (value
 * and type level) and by the pipeline result-shape reifier, so computed
 * scalars decode like any other read. The Mongo analog of the SQL
 * adapters' `queryOperationTypes`.
 */
export const mongoOperationOutputCodecs = {
  $concat: MONGO_STRING_CODEC_ID,
  $toLower: MONGO_STRING_CODEC_ID,
  $toUpper: MONGO_STRING_CODEC_ID,
  $toString: MONGO_STRING_CODEC_ID,
  $substr: MONGO_STRING_CODEC_ID,
  $substrBytes: MONGO_STRING_CODEC_ID,
  $trim: MONGO_STRING_CODEC_ID,
  $ltrim: MONGO_STRING_CODEC_ID,
  $rtrim: MONGO_STRING_CODEC_ID,
  $replaceOne: MONGO_STRING_CODEC_ID,
  $replaceAll: MONGO_STRING_CODEC_ID,
  $dateToString: MONGO_STRING_CODEC_ID,
  $type: MONGO_STRING_CODEC_ID,
  $eq: MONGO_BOOLEAN_CODEC_ID,
  $ne: MONGO_BOOLEAN_CODEC_ID,
  $gt: MONGO_BOOLEAN_CODEC_ID,
  $gte: MONGO_BOOLEAN_CODEC_ID,
  $lt: MONGO_BOOLEAN_CODEC_ID,
  $lte: MONGO_BOOLEAN_CODEC_ID,
  $in: MONGO_BOOLEAN_CODEC_ID,
  $regexMatch: MONGO_BOOLEAN_CODEC_ID,
  $isArray: MONGO_BOOLEAN_CODEC_ID,
  $toBool: MONGO_BOOLEAN_CODEC_ID,
  $setEquals: MONGO_BOOLEAN_CODEC_ID,
  $setIsSubset: MONGO_BOOLEAN_CODEC_ID,
  $anyElementTrue: MONGO_BOOLEAN_CODEC_ID,
  $allElementsTrue: MONGO_BOOLEAN_CODEC_ID,
  $toDate: MONGO_DATE_CODEC_ID,
  $dateAdd: MONGO_DATE_CODEC_ID,
  $dateSubtract: MONGO_DATE_CODEC_ID,
  $dateTrunc: MONGO_DATE_CODEC_ID,
  $dateFromString: MONGO_DATE_CODEC_ID,
  $add: MONGO_DOUBLE_CODEC_ID,
  $subtract: MONGO_DOUBLE_CODEC_ID,
  $multiply: MONGO_DOUBLE_CODEC_ID,
  $divide: MONGO_DOUBLE_CODEC_ID,
  $size: MONGO_DOUBLE_CODEC_ID,
  $year: MONGO_DOUBLE_CODEC_ID,
  $month: MONGO_DOUBLE_CODEC_ID,
  $dayOfMonth: MONGO_DOUBLE_CODEC_ID,
  $hour: MONGO_DOUBLE_CODEC_ID,
  $minute: MONGO_DOUBLE_CODEC_ID,
  $second: MONGO_DOUBLE_CODEC_ID,
  $millisecond: MONGO_DOUBLE_CODEC_ID,
  $dateDiff: MONGO_DOUBLE_CODEC_ID,
  $strLenCP: MONGO_DOUBLE_CODEC_ID,
  $strLenBytes: MONGO_DOUBLE_CODEC_ID,
  $cmp: MONGO_DOUBLE_CODEC_ID,
  $indexOfArray: MONGO_DOUBLE_CODEC_ID,
  $toInt: MONGO_DOUBLE_CODEC_ID,
  $toLong: MONGO_DOUBLE_CODEC_ID,
  $toDouble: MONGO_DOUBLE_CODEC_ID,
  $toDecimal: MONGO_DOUBLE_CODEC_ID,
  $count: MONGO_DOUBLE_CODEC_ID,
  $toObjectId: MONGO_OBJECTID_CODEC_ID,
} as const;

export type MongoOperationOutputCodecs = typeof mongoOperationOutputCodecs;
