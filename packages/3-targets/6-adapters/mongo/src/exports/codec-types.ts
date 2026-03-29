import type { MongoCodecOutput } from '@prisma-next/mongo-core';
import type { codecDefinitions } from '../core/codecs';

export type CodecTypes = {
  readonly [K in keyof typeof codecDefinitions as (typeof codecDefinitions)[K]['id']]: {
    readonly input: MongoCodecOutput<(typeof codecDefinitions)[K]>;
    readonly output: MongoCodecOutput<(typeof codecDefinitions)[K]>;
  };
};

export {
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
} from '../core/codec-ids';
export { codecDefinitions } from '../core/codecs';
