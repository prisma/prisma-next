import { Schema, Table, Column } from '@prisma/relational-ir';
import { buildRelationGraph } from '@prisma/relational-ir';

export function emitContractTypes(schema: Schema, namespace: string = 'Contract'): string {
  const interfaces: string[] = [];

  // Generate shape interfaces
  for (const [tableName, table] of Object.entries(schema.tables) as [string, Table][]) {
    const shapeName = capitalize(tableName) + 'Shape';
    const fields: string[] = [];

    for (const [colName, col] of Object.entries(table.columns) as [string, Column][]) {
      const tsType = mapPgTypeToTS(col.type);
      fields.push(`    ${colName}: ${tsType};`);
    }

    interfaces.push(`  export type ${shapeName} {\n${fields.join('\n')}\n  }`);
  }

  // Generate Tables interface
  const tableEntries: string[] = [];
  for (const tableName of Object.keys(schema.tables)) {
    const shapeName = capitalize(tableName) + 'Shape';
    tableEntries.push(`    ${tableName}: Table<${shapeName}>;`);
  }

  interfaces.push(`  export type Tables = {\n${tableEntries.join('\n')}\n  };`);

  // Generate relations types
  const graph = buildRelationGraph(schema);
  const relationTypes: string[] = [];

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const relations: string[] = [];

    // 1:N relations (outgoing edges from reverseEdges)
    const oneToMany = graph.reverseEdges.get(tableName) ?? [];
    for (const edge of oneToMany) {
      relations.push(`      ${edge.name}: {
        to: '${edge.from.table}';
        cardinality: '1:N';
        on: { parentCols: ${JSON.stringify(edge.to.columns)}; childCols: ${JSON.stringify(edge.from.columns)} };
      };`);
    }

    // N:1 relations (incoming edges from edges)
    const manyToOne = graph.edges.get(tableName) ?? [];
    for (const edge of manyToOne) {
      relations.push(`      ${edge.name}: {
        to: '${edge.to.table}';
        cardinality: 'N:1';
        on: { parentCols: ${JSON.stringify(edge.from.columns)}; childCols: ${JSON.stringify(edge.to.columns)} };
      };`);
    }

    if (relations.length > 0) {
      relationTypes.push(`    ${tableName}: {\n${relations.join('\n')}\n    };`);
    }
  }

  if (relationTypes.length > 0) {
    interfaces.push(`  export type Relations = {\n${relationTypes.join('\n')}\n  };`);
  }

  // Generate uniques types
  const uniqueTypes: string[] = [];
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const uniques: string[] = [];

    // Primary key
    if (table.primaryKey) {
      uniques.push(`      ['${table.primaryKey.columns.join("', '")}']`);
    }

    // Unique constraints
    if (table.uniques) {
      for (const unique of table.uniques) {
        uniques.push(`      ['${unique.columns.join("', '")}']`);
      }
    }

    if (uniques.length > 0) {
      uniqueTypes.push(`    ${tableName}: ${uniques.join(' | ')};`);
    }
  }

  if (uniqueTypes.length > 0) {
    interfaces.push(`  export type Uniques = {\n${uniqueTypes.join('\n')}\n  };`);
  }

  return `// Generated TypeScript definitions
// This file is auto-generated. Do not edit manually.

import { Column, Table } from '@prisma/sql';

export namespace ${namespace} {
${interfaces.join('\n\n')}
}
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
