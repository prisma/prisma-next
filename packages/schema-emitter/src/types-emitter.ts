import { Schema, Model, Field } from '@prisma/relational-ir';

export function emitTypes(schema: Schema): string {
  const modelTypes = schema.models.map(emitModelType).join('\n\n');
  const tableTypes = emitTableTypes(schema);
  const tableAccessors = emitTableAccessors(schema);

  return `// Generated TypeScript definitions
// This file is auto-generated. Do not edit manually.

import { Column, Table, Tables } from '@prisma/sql';

${modelTypes}

${tableTypes}

${tableAccessors}

// Export schema for runtime use
export default schema;
`;
}

function emitModelType(model: Model): string {
  const fieldTypes = model.fields.map(emitFieldType).join('\n  ');

  return `export interface ${model.name} {
  ${fieldTypes}
}`;
}

function emitFieldType(field: Field): string {
  const tsType = mapToTypeScriptType(field.type);
  const optional = hasDefaultValue(field) ? '?' : '';

  return `${field.name}${optional}: ${tsType};`;
}

function mapToTypeScriptType(fieldType: string): string {
  switch (fieldType) {
    case 'Int':
      return 'number';
    case 'String':
      return 'string';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'Date';
    case 'Float':
      return 'number';
    default:
      return 'unknown';
  }
}

function hasDefaultValue(field: Field): boolean {
  return field.attributes.some((attr) => attr.name === 'default');
}

function emitTableTypes(schema: Schema): string {
  const tableShapes = schema.models
    .map((model) => {
      const fieldTypes = model.fields
        .map((field) => {
          const tsType = mapToTypeScriptType(field.type);
          const optional = hasDefaultValue(field) ? '?' : '';
          return `  ${field.name}${optional}: ${tsType};`;
        })
        .join('\n');

      return `export interface ${model.name}Shape {
${fieldTypes}
}`;
    })
    .join('\n\n');

  return tableShapes;
}

function emitTableAccessors(schema: Schema): string {
  const accessors = schema.models
    .map((model) => {
      const fieldAccessors = model.fields
        .map((field) => {
          const tsType = mapToTypeScriptType(field.type);
          return `    ${field.name}: {
      table: '${model.name.toLowerCase()}',
      name: '${field.name}',
      eq: (value: ${tsType}) => ({ type: 'eq' as const, field: '${field.name}', value }),
      ne: (value: ${tsType}) => ({ type: 'ne' as const, field: '${field.name}', value }),
      gt: (value: ${tsType}) => ({ type: 'gt' as const, field: '${field.name}', value }),
      lt: (value: ${tsType}) => ({ type: 'lt' as const, field: '${field.name}', value }),
      gte: (value: ${tsType}) => ({ type: 'gte' as const, field: '${field.name}', value }),
      lte: (value: ${tsType}) => ({ type: 'lte' as const, field: '${field.name}', value }),
      in: (values: ${tsType}[]) => ({ type: 'in' as const, field: '${field.name}', values }),
    }`;
        })
        .join(',\n');

      return `  ${model.name.toLowerCase()}: {
${fieldAccessors}
  }`;
    })
    .join(',\n');

  return `export const t: Tables = {
${accessors}
};

// Schema object for runtime
const schema = ${JSON.stringify(schema, null, 2)} as const;`;
}
