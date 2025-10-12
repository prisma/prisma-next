import { Column, TABLE_NAME, SchemaIR } from './types';

// Factory function to create typed tables from schema IR
export function makeT<TTables>(ir: any): TTables {
  const tables: any = {};

  for (const model of ir.models) {
    const tableName = model.name.toLowerCase();
    const table: any = {
      [TABLE_NAME]: tableName,
    };

    for (const field of model.fields) {
      const fieldName = field.name;

      // Create Column object with operators
      table[fieldName] = {
        __t: undefined as any,
        table: tableName,
        name: fieldName,
        eq: (value: any) => ({ __t: undefined as any, type: 'eq' as const, field: fieldName, value }),
        ne: (value: any) => ({ __t: undefined as any, type: 'ne' as const, field: fieldName, value }),
        gt: (value: any) => ({ __t: undefined as any, type: 'gt' as const, field: fieldName, value }),
        lt: (value: any) => ({ __t: undefined as any, type: 'lt' as const, field: fieldName, value }),
        gte: (value: any) => ({ __t: undefined as any, type: 'gte' as const, field: fieldName, value }),
        lte: (value: any) => ({ __t: undefined as any, type: 'lte' as const, field: fieldName, value }),
        in: (values: any[]) => ({ __t: undefined as any, type: 'in' as const, field: fieldName, values }),
      } as Column<any>;
    }

    tables[tableName] = table;
  }

  return tables as TTables;
}
