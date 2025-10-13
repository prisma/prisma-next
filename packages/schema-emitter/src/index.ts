import { SchemaAST } from '@prisma/psl';
import { emitSchema } from './ir-emitter';
import { emitTypes } from './types-emitter';

export async function emitContractAndTypes(
  ast: SchemaAST,
): Promise<{ contract: string; types: string }> {
  const contract = await emitSchema(ast);
  const types = emitTypes(contract);

  return {
    contract: JSON.stringify(contract, null, 2),
    types,
  };
}
