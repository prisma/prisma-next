import { Schema, Model, Field } from '@prisma/relational-ir';

export function emitTypes(schema: Schema): string {
  const modelTypes = schema.models.map(emitModelType).join('\n\n');
  const tableTypes = emitTableTypes(schema);
  const tablesInterface = emitTablesInterface(schema);

  return `// Generated TypeScript definitions
// This file is auto-generated. Do not edit manually.

import { Column, Table } from '@prisma/sql';

${modelTypes}

${tableTypes}

${tablesInterface}
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
  // Don't make fields optional - all fields are always present in the table
  return `${field.name}: ${tsType};`;
}

function emitTableTypes(schema: Schema): string {
  const tableShapes = schema.models
    .map((model) => {
      const fieldTypes = model.fields
        .map((field) => {
          const tsType = mapToTypeScriptType(field.type);
          // Don't make fields optional - all fields are always present in the table
          return `  ${field.name}: ${tsType};`;
        })
        .join('\n');

      return `export interface ${model.name}Shape {
${fieldTypes}
}`;
    })
    .join('\n\n');

  return tableShapes;
}

function emitTablesInterface(schema: Schema): string {
  const tableEntries = schema.models
    .map((model) => {
      return `  ${model.name.toLowerCase()}: Table<${model.name}Shape>;`;
    })
    .join('\n');

  return `export interface Tables {
${tableEntries}
}`;
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
      return 'any';
  }
}

function hasDefaultValue(field: Field): boolean {
  return field.attributes.some(attr =>
    attr.name === 'default' ||
    attr.name === 'id'
  );
}
