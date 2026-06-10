import {
  type AnyQueryAst,
  type ContractCodecRegistry,
  type LoweredStatement,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAstCodecRegistry,
  deriveParamMetadata,
  encodeParamsWithMetadata,
} from '@prisma-next/sql-runtime';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';

export const CONTROL_CODECS = createAstCodecRegistry(postgresCodecRegistry);

export async function encodeControlQueryParams(
  lowered: LoweredStatement,
  ast: AnyQueryAst,
  codecs: ContractCodecRegistry = CONTROL_CODECS,
): Promise<readonly unknown[]> {
  const values = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new Error(`control query lowered to a bind slot '${slot.name}', which is unsupported`);
  });
  return encodeParamsWithMetadata(values, deriveParamMetadata(ast), {}, codecs);
}
