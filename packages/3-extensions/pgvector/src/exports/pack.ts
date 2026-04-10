import { pgvectorPackMeta } from '../core/descriptor-meta';
import type { CodecTypes } from '../types/codec-types';

const pgvectorPack = pgvectorPackMeta;

export default pgvectorPack as typeof pgvectorPackMeta & {
  readonly __codecTypes?: CodecTypes;
};
