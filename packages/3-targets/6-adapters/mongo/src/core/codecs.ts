import { mongoCodec } from '@prisma-next/mongo-core';
import { ObjectId } from 'mongodb';
import {
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
} from './codec-ids';

export const mongoObjectIdCodec = mongoCodec({
  typeId: MONGO_OBJECTID_CODEC_ID,
  targetTypes: ['objectId'],
  decode: (wire: ObjectId) => wire.toHexString(),
  encode: (value: string) => new ObjectId(value),
});

export const mongoStringCodec = mongoCodec({
  typeId: MONGO_STRING_CODEC_ID,
  targetTypes: ['string'],
  decode: (wire: string) => wire,
  encode: (value: string) => value,
});

export const mongoInt32Codec = mongoCodec({
  typeId: MONGO_INT32_CODEC_ID,
  targetTypes: ['int'],
  decode: (wire: number) => wire,
  encode: (value: number) => value,
});

export const mongoBooleanCodec = mongoCodec({
  typeId: MONGO_BOOLEAN_CODEC_ID,
  targetTypes: ['bool'],
  decode: (wire: boolean) => wire,
  encode: (value: boolean) => value,
});

export const mongoDateCodec = mongoCodec({
  typeId: MONGO_DATE_CODEC_ID,
  targetTypes: ['date'],
  decode: (wire: Date) => wire,
  encode: (value: Date) => value,
});

export const codecDefinitions = {
  objectId: mongoObjectIdCodec,
  string: mongoStringCodec,
  int32: mongoInt32Codec,
  boolean: mongoBooleanCodec,
  date: mongoDateCodec,
} as const;
