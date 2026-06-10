import type { EnumAccessor } from '@prisma-next/contract/enum-accessor';
import { blindCast } from '@prisma-next/utils/casts';
import { db } from '../prisma/db';

export function getPriorityEnumFromEmit(): EnumAccessor {
  const publicEnums = blindCast<
    Record<string, EnumAccessor | undefined>,
    'NamespaceEnumAccessors lacks index signature for runtime string lookup'
  >(db.enums['public']);
  const enumAccessor = publicEnums['Priority'];
  if (enumAccessor === undefined) {
    throw new Error("Contract is missing the 'Priority' enum in the 'public' namespace");
  }
  return enumAccessor;
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

export async function getPostsByPriorityMember(priorityMember: string, limit = 10) {
  const value = blindCast<
    'low' | 'high' | 'urgent',
    'EnumAccessor.members returns JsonValue; the emitted contract type does not carry literal enum types in domain.namespaces, so the cast is required here'
  >(getPriorityEnumFromEmit().members[priorityMember]);
  const plan = db.sql.public.post
    .select('id', 'title', 'priority')
    .where((cols, ops) => ops.eq(cols.priority, value))
    .orderBy('id')
    .limit(limit)
    .build();
  return db.runtime().execute(plan);
}
