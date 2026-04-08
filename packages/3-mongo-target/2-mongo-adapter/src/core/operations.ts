import type { OperationDescriptor } from '@prisma-next/operations';
import { MONGO_INT32_CODEC_ID, MONGO_VECTOR_CODEC_ID } from './codec-ids';

export const mongoVectorNearOperation = Object.freeze({
  method: 'near',
  args: [{ codecId: MONGO_VECTOR_CODEC_ID, nullable: false }],
  returns: { codecId: MONGO_INT32_CODEC_ID, nullable: false },
}) satisfies OperationDescriptor;

export const mongoVectorOperationDescriptors: readonly OperationDescriptor[] = [
  mongoVectorNearOperation,
];
