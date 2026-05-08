import { buildCodecDescriptorRegistry } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { codecDescriptors } from './codecs-class';

/**
 * Registry of every codec descriptor shipped by `@prisma-next/extension-pgvector`.
 *
 * Public consumer surface for the pgvector codec set. Currently a
 * single entry (`pg/vector@1`); the registry shape stays consistent
 * with the other codec-shipping packages so consumers don't need to
 * special-case extensions. See ADR 208.
 */
export const pgvectorCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);
