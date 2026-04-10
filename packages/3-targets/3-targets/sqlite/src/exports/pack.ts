import type { CodecTypes } from '@prisma-next/adapter-sqlite/codec-types';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';

const sqlitePack = sqliteTargetDescriptorMeta;

export default sqlitePack as typeof sqliteTargetDescriptorMeta & {
  readonly __codecTypes?: CodecTypes;
};
