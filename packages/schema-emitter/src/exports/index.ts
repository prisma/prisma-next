// Main convenience export - re-exports everything
import { SchemaAST } from '@prisma/psl';
import { emitContract } from '../ir-emitter';
import { emitContractTypes } from '../contract-types-emitter';

export { emitContract };

export async function emitSchemaAndTypes(
  ast: SchemaAST,
  namespace?: string,
): Promise<{ schema: string; types: string }> {
  const schema = await emitContract(ast);
  const types = emitContractTypes(schema, namespace);

  return {
    schema: JSON.stringify(schema, null, 2),
    types,
  };
}
