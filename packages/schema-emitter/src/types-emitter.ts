import { Schema, Model, Field } from '@prisma/relational-ir';

export function emitTypes(schema: Schema): string {
  const modelTypes = schema.models.map(emitModelType).join('\n\n');
  const tableAccessors = emitTableAccessors(schema);

  return `// Generated TypeScript definitions
// This file is auto-generated. Do not edit manually.

${modelTypes}

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

function emitTableAccessors(schema: Schema): string {
  const accessors = schema.models
    .map((model) => {
      const fieldAccessors = model.fields
        .map((field) => {
          return `    ${field.name}: {
      eq: (value: ${mapToTypeScriptType(field.type)}) => ({ type: 'eq', field: '${field.name}', value }),
      ne: (value: ${mapToTypeScriptType(field.type)}) => ({ type: 'ne', field: '${field.name}', value }),
      gt: (value: ${mapToTypeScriptType(field.type)}) => ({ type: 'gt', field: '${field.name}', value }),
      lt: (value: ${mapToTypeScriptType(field.type)}) => ({ type: 'lt', field: '${field.name}', value }),
      gte: (value: ${mapToTypeScriptType(field.type)}) => ({ type: 'gte', field: '${field.name}', value }),
      lte: (value: ${mapToTypeScriptType(field.type)}) => ({ type: 'lte', field: '${field.name}', value }),
      in: (values: ${mapToTypeScriptType(field.type)}[]) => ({ type: 'in', field: '${field.name}', values }),
    }`;
        })
        .join(',\n');

      return `  ${model.name.toLowerCase()}: {
${fieldAccessors}
  }`;
    })
    .join(',\n');

  return `export const t = {
${accessors}
};

// Schema object for runtime
const schema = ${JSON.stringify(schema, null, 2)} as const;`;
}
