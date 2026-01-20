import type { Brand, CoreHashBase } from '@prisma-next/contract/types';

export type ColumnReference<
  TName extends string = string,
  TTable extends string = string,
  THash extends CoreHashBase<string> = CoreHashBase<string>,
> = {
  readonly '~name': TName;
  readonly '~table': TTable;
} & Brand<
  '[info] this column reference belongs to the following table reference:',
  `${TTable}@${THash}`
>;
