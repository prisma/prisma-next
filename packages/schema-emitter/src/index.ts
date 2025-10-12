import { SchemaAST } from '@prisma/psl';
import { emitSchema } from './ir-emitter';
import { emitTypes } from './types-emitter';

export function emitSchemaAndTypes(ast: SchemaAST): { schema: string; types: string } {
  const schema = emitSchema(ast);
  const types = emitTypes(schema);

  return {
    schema: JSON.stringify(schema, null, 2),
    types,
  };
}
