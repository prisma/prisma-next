import type { OperationDescriptor } from '@prisma-next/operations';
import { MONGO_VECTOR_CODEC_ID } from './codec-ids';

export const mongoVectorNearOperation = Object.freeze({
  method: 'near',
  self: { codecId: MONGO_VECTOR_CODEC_ID },
  impl: () => undefined as never,
}) satisfies OperationDescriptor;

export const mongoVectorOperationDescriptors: readonly OperationDescriptor[] = [
  mongoVectorNearOperation,
];
