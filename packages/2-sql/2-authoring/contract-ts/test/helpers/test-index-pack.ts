import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import { defineIndexTypes } from '@prisma-next/sql-contract/index-types';
import { type } from 'arktype';

const testIndexTypes = defineIndexTypes()
  .add('bm25', { options: type('object') })
  .add('hash', { options: type('object') });

const testIndexPackBase = {
  kind: 'extension',
  id: 'test-index-pack',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  indexTypes: testIndexTypes.entries,
} as const;

export const testIndexPack: typeof testIndexPackBase &
  ExtensionPackRef<'sql', 'postgres'> & {
    readonly __indexTypes?: typeof testIndexTypes.IndexTypes;
  } = testIndexPackBase;
