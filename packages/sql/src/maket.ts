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
        eq: (value: any) => ({
          kind: 'eq' as const,
          left: { kind: 'column' as const, name: colName },
          right: { kind: 'literal' as const, value },
        }),
        ne: (value: any) => ({
          kind: 'ne' as const,
          left: { kind: 'column' as const, name: colName },
          right: { kind: 'literal' as const, value },
        }),
        gt: (value: any) => ({
          kind: 'gt' as const,
          left: { kind: 'column' as const, name: colName },
          right: { kind: 'literal' as const, value },
        }),
        lt: (value: any) => ({
          kind: 'lt' as const,
          left: { kind: 'column' as const, name: colName },
          right: { kind: 'literal' as const, value },
        }),
        gte: (value: any) => ({
          kind: 'gte' as const,
          left: { kind: 'column' as const, name: colName },
          right: { kind: 'literal' as const, value },
        }),
        lte: (value: any) => ({
          kind: 'lte' as const,
          left: { kind: 'column' as const, name: colName },
          right: { kind: 'literal' as const, value },
        }),
        in: (values: any[]) => ({
          kind: 'in' as const,
          left: { kind: 'column' as const, name: colName },
          right: values.map((v) => ({ kind: 'literal' as const, value: v })),
        }),
      } as Column<any, any, any>;
    }

    tables[tableName] = tableObj;
  }

  return tables as TTables;
}
