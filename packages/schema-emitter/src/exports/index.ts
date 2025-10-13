// Main convenience export - re-exports everything
import { SchemaAST } from '@prisma/psl';
import { emitSchema } from '../ir-emitter';
import { emitContractTypes } from '../contract-types-emitter';

export async function emitSchemaAndTypes(ast: SchemaAST, namespace?: string): Promise<{ schema: string; types: string }> {
  const schema = await emitSchema(ast);
  const types = emitContractTypes(schema, namespace);

  return {
    schema: JSON.stringify(schema, null, 2),
    types,
  };
}
