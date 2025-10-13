import { SchemaAST } from '@prisma/psl';
import { emitSchema } from './ir-emitter';
import { emitTypes } from './types-emitter';

export async function emitSchemaAndTypes(ast: SchemaAST): Promise<{ schema: string; types: string }> {
  const schema = await emitSchema(ast);
  const types = emitTypes(schema);

  return {
    schema: JSON.stringify(schema, null, 2),
    types,
  };
}
