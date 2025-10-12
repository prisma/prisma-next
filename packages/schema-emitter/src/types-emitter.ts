import { Schema } from '@prisma/relational-ir';

export function emitTypes(schema: Schema): string {
  const interfaces: string[] = [];

  // Generate shape interfaces
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const shapeName = capitalize(tableName) + 'Shape';
    const fields: string[] = [];

    for (const [colName, col] of Object.entries(table.columns)) {
      const tsType = mapPgTypeToTS(col.type);
      fields.push(`  ${colName}: ${tsType};`);
    }

    interfaces.push(`export interface ${shapeName} {\n${fields.join('\n')}\n}`);
  }

  // Generate Tables interface
  const tableEntries: string[] = [];
  for (const tableName of Object.keys(schema.tables)) {
    const shapeName = capitalize(tableName) + 'Shape';
    tableEntries.push(`  ${tableName}: Table<${shapeName}>;`);
  }

  interfaces.push(`export interface Tables {\n${tableEntries.join('\n')}\n}`);

  return `// Generated TypeScript definitions
// This file is auto-generated. Do not edit manually.

import { Column, Table } from '@prisma/sql';

${interfaces.join('\n\n')}
`;
}

function mapPgTypeToTS(pgType: string): string {
  switch (pgType) {
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
      return 'number';
    case 'text':
    case 'varchar':
    case 'uuid':
      return 'string';
    case 'bool':
      return 'boolean';
    case 'timestamptz':
    case 'timestamp':
      return 'Date';
    case 'json':
    case 'jsonb':
      return 'any';
    default:
      return 'unknown';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
