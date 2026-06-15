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
  // A namespace-qualified name `[space ':']? Ident ('.' Ident)*`, parsed as a
  // single unit and reused in every position a qualified name appears: type
  // annotations, qualified constructor/function calls, qualified default-function
  // calls, and qualified `@@`-block attribute names.
  | 'QualifiedName'
  | 'FunctionCall'
  | 'ArrayLiteral'
  | 'StringLiteralExpr'
  | 'NumberLiteralExpr'
  | 'BooleanLiteralExpr'
  | 'ObjectLiteralExpr'
  | 'ObjectField';
