import { PARADEDB_EXTENSION_ID } from './constants';

export const paradedbPackMeta = {
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
} as const;
