import { createFromBuilder } from './builder';
import { Tables, Table, TABLE_NAME, TableName } from './types';

export function sql(): {
  from<TTables extends Tables>(
    table: Table<any> | TableName<TTables>
  ): ReturnType<typeof createFromBuilder<any>>;
} {
  return {
    from<TTables extends Tables>(table: Table<any> | TableName<TTables>) {
      const tableName = typeof table === 'string' ? table : table[TABLE_NAME];
      return createFromBuilder(tableName) as any;
    },
  };
}
