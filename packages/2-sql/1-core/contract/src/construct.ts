import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from './types';

type ValidatedContractInput = Contract<SqlStorage> & { _generated?: unknown };

function stripGenerated(obj: ValidatedContractInput): Omit<ValidatedContractInput, '_generated'> {
  const input = obj as unknown as Record<string, unknown>;
  const { _generated: _, ...rest } = input;
  return rest as Omit<ValidatedContractInput, '_generated'>;
}

export function constructContract<TContract extends Contract<SqlStorage>>(
  input: ValidatedContractInput,
): TContract {
  const stripped = stripGenerated(input);
  return stripped as TContract;
}
