import { SchemaAST, ModelDeclaration, FieldDeclaration, RelationFieldType } from '@prisma/psl';
import { Schema, validateContract, Table } from '@prisma/relational-ir';
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
          capabilities: table.capabilities,
          // Exclude meta.source from hash
        },
      ]),
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

  return validateContract(schemaWithHash);
}

function emitTable(model: ModelDeclaration) {
  const columns: Record<string, any> = {};
  const foreignKeys: any[] = [];
  const primaryKey: any = { kind: 'primaryKey', columns: [] };
  const uniques: any[] = [];

  for (const field of model.fields) {
    const column = emitColumn(field);
    if (column) {
      columns[field.name] = column;

      // Track primary key columns
      if (column.pk) {
        primaryKey.columns.push(field.name);
      }

      // Track unique columns
      if (column.unique) {
        uniques.push({
          kind: 'unique',
          columns: [field.name],
        });
      }
    }

    // Handle relation fields
    if (typeof field.fieldType === 'object' && field.fieldType.type === 'RelationFieldType') {
      const relationType = field.fieldType as RelationFieldType;

      // For 1:N relations (array), we don't add a column - the FK is on the other side
      if (relationType.isArray) {
        // This is a 1:N relation, no column needed
        continue;
      }

      // For N:1 relations (single), we need to add a foreign key column
      if (!relationType.isArray) {
        const fkColumnName = `${relationType.targetModel.toLowerCase()}_id`;

        // Add the foreign key column
        columns[fkColumnName] = {
          type: 'int4',
          nullable: false,
        };

        // Add foreign key constraint
        foreignKeys.push({
          kind: 'foreignKey',
          columns: [fkColumnName],
          references: {
            table: relationType.targetModel.toLowerCase(),
            columns: ['id'], // Assume the target table has an 'id' primary key
          },
          name: `${model.name.toLowerCase()}_${fkColumnName}_fkey`,
        });
      }
    }
  }

  return {
    columns,
    primaryKey: primaryKey.columns.length > 0 ? primaryKey : undefined,
    uniques,
    foreignKeys,
    indexes: [],
    capabilities: [],
    meta: {
      source: `model ${model.name}`,
    },
  };
}

function emitColumn(field: FieldDeclaration) {
  // Skip relation fields - they're handled separately in emitTable
  if (typeof field.fieldType === 'object' && field.fieldType.type === 'RelationFieldType') {
    return null;
  }

  const column: any = {
    type: mapToPgType(field.fieldType as string),
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
