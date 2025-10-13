import { SchemaAST } from '@prisma/psl';
import { emitSchema } from './ir-emitter';
import { emitContractTypes } from './contract-types-emitter';

export async function emitContractAndTypes(
  ast: SchemaAST,
  namespace?: string,
): Promise<{ contract: string; contractTypes: string }> {
  const contract = await emitSchema(ast);
  const contractTypes = emitContractTypes(contract, namespace);

  return {
    contract: JSON.stringify(contract, null, 2),
    contractTypes,
  };
}
