import type { OperationSignature } from '@prisma-next/operations';
import { MONGO_VECTOR_CODEC_ID } from './codec-ids';

export const mongoVectorNearOperation = Object.freeze({
  forTypeId: MONGO_VECTOR_CODEC_ID,
  method: 'near',
  args: [{ kind: 'param' as const }],
  returns: { kind: 'builtin' as const, type: 'number' as const },
}) satisfies OperationSignature;

export const mongoVectorOperationSignatures: readonly OperationSignature[] = [
  mongoVectorNearOperation,
];
