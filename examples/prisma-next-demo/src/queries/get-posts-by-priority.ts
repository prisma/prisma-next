import type { EnumAccessor } from '@prisma-next/contract/enum-accessor';
import { blindCast } from '@prisma-next/utils/casts';
import { db } from '../prisma/db';

export function getPriorityEnumFromEmit(): EnumAccessor {
  const publicEnums = blindCast<
    Record<string, EnumAccessor | undefined>,
    'NamespaceEnumAccessors lacks index signature for runtime string lookup'
  >(db.enums['public']);
  const Priority = publicEnums['Priority'];
  if (Priority === undefined) {
    throw new Error("Contract is missing the 'Priority' enum in the 'public' namespace");
  }
  return Priority;
}

export async function getPostsByPriority(limit = 10) {
  const plan = db.sql.public.post
    .select('id', 'title', 'priority')
    .orderBy('priority')
    .orderBy('id')
    .limit(limit)
    .build();
  return db.runtime().execute(plan);
}
