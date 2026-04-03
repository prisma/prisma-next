import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const embedding1536Type = {
  codecId: 'pg/vector@1',
  nativeType: 'vector',
  typeParams: { length: 1536 },
} as const;

// Uses typeRef to exercise the named-type-reference resolution path
// (the storage layer resolves column type metadata from the named type above).
const embedding1536Column = {
  codecId: 'pg/vector@1',
  nativeType: 'vector',
  typeRef: 'Embedding1536',
} as const;

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .storageType('Embedding1536', embedding1536Type)
  .table('document', (t) =>
    t
      .column('id', {
        type: int4Column,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('embedding', { type: embedding1536Column, nullable: false })
      .primaryKey(['id']),
  )
  .model('Document', 'document', (m) => m.field('id', 'id').field('embedding', 'embedding'))
  .build();
