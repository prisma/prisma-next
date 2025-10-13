import { Column, TABLE_NAME } from './types';

export function makeT<TTables>(ir: any): TTables {
  const contractHash = ir.contractHash;
  const tables: any = {};

  for (const [tableName, table] of Object.entries(ir.tables)) {
    const tableObj: any = {
      [TABLE_NAME]: tableName,
      __contractHash: contractHash,
    };

    for (const [colName, column] of Object.entries((table as any).columns)) {
      tableObj[colName] = {
        __brand: 'Column' as const,
        __t: undefined as any,
        table: tableName,
        name: colName,
        __contractHash: contractHash,
        eq: (value: any) => ({ __t: undefined as any, type: 'eq' as const, field: colName, value }),
        ne: (value: any) => ({ __t: undefined as any, type: 'ne' as const, field: colName, value }),
        gt: (value: any) => ({ __t: undefined as any, type: 'gt' as const, field: colName, value }),
        lt: (value: any) => ({ __t: undefined as any, type: 'lt' as const, field: colName, value }),
        gte: (value: any) => ({
          __t: undefined as any,
          type: 'gte' as const,
          field: colName,
          value,
        }),
        lte: (value: any) => ({
          __t: undefined as any,
          type: 'lte' as const,
          field: colName,
          value,
        }),
        in: (values: any[]) => ({
          __t: undefined as any,
          type: 'in' as const,
          field: colName,
          values,
        }),
      } as Column<any, any, any>;
    }

    tables[tableName] = tableObj;
  }

  return tables as TTables;
}
