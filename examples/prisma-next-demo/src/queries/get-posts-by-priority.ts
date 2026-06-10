import { db } from '../prisma/db';

export async function getPostsByPriority(limit = 10) {
  const plan = db.sql.public.post
    .select('id', 'title', 'priority')
    .orderBy('priority')
    .orderBy('id')
    .limit(limit)
    .build();
  return db.runtime().execute(plan);
}

type PriorityMemberName = keyof (typeof db.enums.public.Priority)['members'];

export async function getPostsByPriorityMember(priorityMember: PriorityMemberName, limit = 10) {
  const value = db.enums.public.Priority.members[priorityMember];
  const plan = db.sql.public.post
    .select('id', 'title', 'priority')
    .where((cols, ops) => ops.eq(cols.priority, value))
    .orderBy('id')
    .limit(limit)
    .build();
  return db.runtime().execute(plan);
}
