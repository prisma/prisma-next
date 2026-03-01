import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { vector } from '@prisma-next/extension-pgvector/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const embeddingColumn = {
  codecId: 'pg/vector@1',
  nativeType: 'vector(1536)',
  typeRef: 'Embedding1536',
} as const;

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .storageType('Embedding1536', vector(1536))
  .table('document', (t) =>
    t
      .column('id', {
        type: int4Column,
        nullable: false,
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('embedding', { type: embeddingColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('Document', 'document', (m) => m.field('id', 'id').field('embedding', 'embedding'))
  .build();
