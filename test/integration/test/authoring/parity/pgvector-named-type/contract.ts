import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const embedding1536Type = {
  codecId: 'pg/vector@1',
  nativeType: 'vector',
  typeParams: { length: 1536 },
} as const;

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  types: {
    Embedding1536: embedding1536Type,
  },
  models: {
    Document: model('Document', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        embedding: field.namedType(embedding1536Type),
      },
    }).sql({ table: 'document' }),
  },
});
