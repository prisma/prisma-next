import type { IndexTypes } from '../types/index-types';
import { paradedbIndexTypes } from '../types/index-types';
import { PARADEDB_EXTENSION_ID } from './constants';

const paradedbPackMetaBase = {
  kind: 'extension',
  id: PARADEDB_EXTENSION_ID,
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'paradedb/bm25': true,
    },
  },
  indexTypes: paradedbIndexTypes.entries,
} as const;

export const paradedbPackMeta: typeof paradedbPackMetaBase & {
  readonly __indexTypes?: IndexTypes;
} = paradedbPackMetaBase;
