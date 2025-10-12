export interface ModelDeclaration {
  type: 'ModelDeclaration';
  name: string;
  fields: FieldDeclaration[];
}

export interface FieldDeclaration {
  type: 'FieldDeclaration';
  name: string;
  fieldType: string;
  attributes: AttributeDeclaration[];
}

export interface AttributeDeclaration {
  type: 'AttributeDeclaration';
  name: string;
  args?: AttributeArgument[];
}

export interface AttributeArgument {
  type: 'AttributeArgument';
  value: string | boolean;
}

export interface SchemaAST {
  type: 'Schema';
  models: ModelDeclaration[];
}

