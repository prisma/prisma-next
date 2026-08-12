import type {
  AnyQueryAst,
  ContractCodecRegistry,
  LoweredStatement,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAstCodecRegistry,
  deriveParamMetadata,
  encodeParamsWithMetadata,
} from '@prisma-next/sql-runtime';
import { sqliteCodecRegistry } from '@prisma-next/target-sqlite/codecs';
import { InternalError } from '@prisma-next/utils/internal-error';

export const CONTROL_CODECS = createAstCodecRegistry(sqliteCodecRegistry);

export async function encodeControlQueryParams(
  lowered: LoweredStatement,
  ast: AnyQueryAst,
  codecs: ContractCodecRegistry = CONTROL_CODECS,
): Promise<readonly unknown[]> {
  const values = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new InternalError(
      `control query lowered to a bind slot '${slot.name}', which is unsupported`,
    );
  });
  return encodeParamsWithMetadata(values, deriveParamMetadata(ast), {}, codecs);
}
