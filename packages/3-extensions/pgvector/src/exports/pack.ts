import type { ExtensionPackRef } from '@prisma-next/sql-contract/pack-types';
import { pgvectorPackMeta } from '../core/descriptor-meta';

const pgvectorPack: ExtensionPackRef<'sql', 'postgres'> = pgvectorPackMeta;

export default pgvectorPack;
