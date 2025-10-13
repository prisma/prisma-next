import { SchemaAST, ModelDeclaration, FieldDeclaration } from '@prisma/psl';
import { Schema, validateSchema, Table } from '@prisma/relational-ir';
import { canonicalJSONStringify } from './canonicalize';
import { sha256Hex } from './hash';

export async function emitSchema(ast: SchemaAST): Promise<Schema> {
  const tables: Record<string, any> = {};

  for (const model of ast.models) {
    const tableName = model.name.toLowerCase();
    tables[tableName] = emitTable(model);
  }

  const schema: Schema = {
    target: 'postgres',
    tables,
  };

  // Build clean IR for hashing (exclude meta.source fields)
  const cleanSchema = {
    target: schema.target,
    tables: Object.fromEntries(
      Object.entries(schema.tables).map(([tableName, table]: [string, Table]) => [
        tableName,
        {
          columns: table.columns,
          indexes: table.indexes,
          constraints: table.constraints,
          capabilities: table.capabilities,
          // Exclude meta.source from hash
        },
      ])
    ),
  };

  // Compute canonical hash
  const canonical = canonicalJSONStringify(cleanSchema);
  const hash = await sha256Hex(canonical);
  const contractHash = `sha256:${hash}`;

  // Return schema with contract hash
  const schemaWithHash = {
    ...schema,
    contractHash,
  };

  return validateSchema(schemaWithHash);
}

function emitTable(model: ModelDeclaration) {
  const columns: Record<string, any> = {};

  for (const field of model.fields) {
    columns[field.name] = emitColumn(field);
  }

  return {
    columns,
    indexes: [],
    constraints: [],
    capabilities: [],
    meta: {
      source: `model ${model.name}`,
    },
  };
}

function emitColumn(field: FieldDeclaration) {
  const column: any = {
    type: mapToPgType(field.fieldType),
    nullable: false, // PSL fields are non-nullable by default
  };

  for (const attr of field.attributes) {
    if (attr.name === 'id') {
      column.pk = true;
    } else if (attr.name === 'unique') {
      column.unique = true;
    } else if (attr.name === 'default') {
      column.default = emitDefaultValue(attr.args?.[0]?.value);
    }
  }

  return column;
}

function mapToPgType(pslType: string): string {
  switch (pslType) {
    case 'Int':
      return 'int4';
    case 'BigInt':
      return 'int8';
    case 'String':
      return 'text';
    case 'Boolean':
      return 'bool';
    case 'DateTime':
      return 'timestamptz';
    case 'Float':
      return 'float8';
    default:
      throw new Error(`Unknown PSL type: ${pslType}`);
  }
}

function emitDefaultValue(value: any) {
  if (value === 'autoincrement') return { kind: 'autoincrement' };
  if (value === 'now') return { kind: 'now' };
  return { kind: 'literal', value: String(value) };
}
