export type SyntaxKind =
  | 'Document'
  | 'ModelDeclaration'
  | 'EnumDeclaration'
  | 'CompositeTypeDeclaration'
  | 'Namespace'
  | 'TypesBlock'
  // The generic/extension block node — the `kw [name] { key = value }` form
  // produced by `parseGenericBlock` (its node-side counterpart, named for its
  // shape rather than its parser). Deliberately distinct from the reserved
  // `model`/`enum`/`namespace`/`type`/`types` declarations above.
  | 'BlockDeclaration'
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
