import { buildCodecDescriptorRegistry } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { codecDescriptors } from './codecs';

/**
 * Registry of every codec descriptor shipped by `@prisma-next/extension-postgis`.
 *
 * Public consumer surface for the postgis codec set. See ADR 208.
 */
export const postgisCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);
