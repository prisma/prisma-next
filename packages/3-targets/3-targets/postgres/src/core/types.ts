import type { ColumnDefault } from '@prisma-next/contract/types';

export type PostgresColumnDefault =
  | ColumnDefault
  | { readonly kind: 'sequence'; readonly name: string };
