import type { ExtensionPackRef } from '@prisma-next/contract/framework-components';
import { pgvectorPackMeta } from '../core/descriptor-meta';

const pgvectorPack: ExtensionPackRef<'sql', 'postgres'> = pgvectorPackMeta;

export default pgvectorPack;
