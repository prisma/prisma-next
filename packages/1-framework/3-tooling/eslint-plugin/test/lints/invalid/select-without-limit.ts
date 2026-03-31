import { sql } from '@prisma-next/sql-builder/runtime';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { Contract } from '../../fixtures/user';
import { loadContract } from '../../utils';

const contract = loadContract<Contract>('user');
const adapter = createStubAdapter();
const context = createTestContext(contract, adapter);
const runtime = {} as Parameters<typeof sql>[0]['runtime'];
const db = sql<typeof contract>({ context, runtime });

db.user.select('id', 'email').all();
