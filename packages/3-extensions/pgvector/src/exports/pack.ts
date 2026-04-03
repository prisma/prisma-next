import type { ExtensionPackRef } from '@prisma-next/contract/framework-components';
import { pgvectorPackMeta } from '../core/descriptor-meta';
import type { CodecTypes } from '../types/codec-types';

const pgvectorPack = pgvectorPackMeta;

export default pgvectorPack as typeof pgvectorPackMeta &
  ExtensionPackRef<'sql', 'postgres'> & {
    readonly __codecTypes?: CodecTypes;
  };
