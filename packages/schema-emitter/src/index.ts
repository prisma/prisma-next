import { SchemaAST } from '@prisma/psl';
import { emitContract } from './ir-emitter';
import { emitContractTypes } from './contract-types-emitter';

export { emitContract };

export async function emitContractAndTypes(
  ast: SchemaAST,
  namespace?: string,
): Promise<{ contract: string; contractTypes: string }> {
  const contract = await emitContract(ast);
  const contractTypes = emitContractTypes(contract, namespace);

  return {
    contract: JSON.stringify(contract, null, 2),
    contractTypes,
  };
}
