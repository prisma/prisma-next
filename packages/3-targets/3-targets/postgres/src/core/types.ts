import type { ColumnDefault } from '@prisma-next/sql-contract/types';

export type PostgresColumnDefault =
  | ColumnDefault
  | { readonly kind: 'sequence'; readonly name: string };
