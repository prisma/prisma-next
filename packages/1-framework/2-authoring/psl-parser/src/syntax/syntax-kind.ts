export type SyntaxKind =
  | 'Document'
  | 'ModelDeclaration'
  | 'EnumDeclaration'
  | 'CompositeTypeDeclaration'
  | 'Namespace'
  | 'TypesBlock'
  // The generic/extension block node — the `kw [name] { key = value }` form
  // produced by `parseGenericBlock`. Deliberately distinct from the reserved
  // `model`/`enum`/`namespace`/`type`/`types` declarations above.
  | 'GenericBlockDeclaration'
  | 'FieldDeclaration'
  | 'EnumValueDeclaration'
  | 'NamedTypeDeclaration'
  | 'KeyValuePair'
  | 'FieldAttribute'
  | 'ModelAttribute'
  | 'AttributeArgList'
  | 'AttributeArg'
  | 'TypeAnnotation'
  | 'Identifier'
  | 'FunctionCall'
  | 'ArrayLiteral'
  | 'StringLiteralExpr'
  | 'NumberLiteralExpr'
  | 'BooleanLiteralExpr'
  | 'ObjectLiteralExpr'
  | 'ObjectField';
