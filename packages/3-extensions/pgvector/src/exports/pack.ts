import type { ExtensionPackRef } from '@prisma-next/contract/framework-components';
import type { CodecTypes } from '@prisma-next/extension-pgvector/codec-types';
import { pgvectorPackMeta } from '../core/descriptor-meta';

const pgvectorPack = pgvectorPackMeta;

export default pgvectorPack as ExtensionPackRef<'sql', 'postgres'> & {
  readonly __codecTypes?: CodecTypes;
};
