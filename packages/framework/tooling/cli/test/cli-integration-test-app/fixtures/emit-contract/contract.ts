import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

// Adapter-agnostic column type descriptors
const int4Column: ColumnTypeDescriptor = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const;

const textColumn: ColumnTypeDescriptor = {
  codecId: 'pg/text@1',
  nativeType: 'text',
} as const;

const contractObj = defineContract<Record<string, never>>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();

export const contract = {
  ...contractObj,
  extensions: {
    postgres: {
      version: '15.0.0',
    },
    pg: {},
  },
};
