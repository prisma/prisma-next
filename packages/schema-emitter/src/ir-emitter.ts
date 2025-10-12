import { SchemaAST, ModelDeclaration, FieldDeclaration, AttributeDeclaration } from '@prisma/psl';
import {
  Schema,
  Model,
  Field,
  FieldType,
  Attribute,
  DefaultValue,
  validateSchema,
} from '@prisma/relational-ir';

export function emitSchema(ast: SchemaAST): Schema {
  const models: Model[] = ast.models.map(emitModel);

  const schema: Schema = { models };

  // Validate the emitted schema
  return validateSchema(schema);
}

function emitModel(modelAst: ModelDeclaration): Model {
  const fields: Field[] = modelAst.fields.map(emitField);

  return {
    name: modelAst.name,
    fields,
  };
}

function emitField(fieldAst: FieldDeclaration): Field {
  const fieldType = mapFieldType(fieldAst.fieldType);
  const attributes: Attribute[] = fieldAst.attributes.map(emitAttribute);

  return {
    name: fieldAst.name,
    type: fieldType,
    attributes,
  };
}

function emitAttribute(attrAst: AttributeDeclaration): Attribute {
  switch (attrAst.name) {
    case 'id':
      return { name: 'id' };
    case 'unique':
      return { name: 'unique' };
    case 'default':
      const defaultValue = emitDefaultValue(attrAst.args?.[0]?.value);
      return { name: 'default', value: defaultValue };
    default:
      throw new Error(`Unknown attribute: ${attrAst.name}`);
  }
}

function emitDefaultValue(value: any): DefaultValue {
  if (typeof value === 'string') {
    switch (value) {
      case 'autoincrement':
        return { type: 'autoincrement' };
      case 'now':
        return { type: 'now' };
      default:
        return { type: 'literal', value };
    }
  }

  if (typeof value === 'boolean') {
    return { type: 'literal', value: value.toString() };
  }

  throw new Error(`Invalid default value: ${value}`);
}

function mapFieldType(astType: string): FieldType {
  switch (astType) {
    case 'Int':
      return 'Int';
    case 'String':
      return 'String';
    case 'Boolean':
      return 'Boolean';
    case 'DateTime':
      return 'DateTime';
    case 'Float':
      return 'Float';
    default:
      throw new Error(`Unknown field type: ${astType}`);
  }
}
