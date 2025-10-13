import { orm } from '@prisma/orm';
import { makeT } from '@prisma/sql';
import contract from '../.prisma/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma/relational-ir';
import { Tables } from '../.prisma/types';

const ir = validateContract(contract);

const r = orm(ir);
const t = makeT<Tables>(ir);

// Example: Relation access
console.log('Relation handles:');
console.log('r.user.post:', r.user.post);
console.log('r.post.user:', r.post.user);

// Example: Basic query building (without includes for now)
const query = r.from(t.user).select({ id: t.user.id, email: t.user.email }).build();

console.log('Generated query:', query);
