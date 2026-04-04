import type { OperationSignature } from '@prisma-next/operations';
import { MONGO_VECTOR_CODEC_ID } from './codec-ids';

export const mongoVectorNearOperation: OperationSignature = Object.freeze({
  forTypeId: MONGO_VECTOR_CODEC_ID,
  method: 'near',
  args: [{ kind: 'param' }],
  returns: { kind: 'builtin', type: 'number' },
});

export const mongoVectorOperationSignatures: readonly OperationSignature[] = [
  mongoVectorNearOperation,
];
