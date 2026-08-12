import { buildCodecDescriptorRegistry } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { codecDescriptors } from './codecs';

/**
 * Registry of every codec descriptor shipped by `@prisma-next/extension-postgis`.
 *
 * Public consumer surface for the postgis codec set. Currently a single
 * entry (`pg/geometry@1`); the registry shape stays consistent with
 * the other codec-shipping packages so consumers don't need to
 * special-case extensions.
 */
export const postgisCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);
