import { createFromBuilder } from './builder';
import { Tables, Table, TABLE_NAME } from './types';

export function sql(): {
  from<T extends Table<any>>(
    table: T
  ): ReturnType<typeof createFromBuilder<T>>;
} {
  return {
    from<T extends Table<any>>(table: T) {
      return createFromBuilder(table[TABLE_NAME]) as any;
    },
  };
}
