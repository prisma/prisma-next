import contract from '../.prisma/contract.json' assert { type: 'json' };
import { makeT } from '@prisma/sql';
import type { Tables } from '../.prisma/types.d.ts';

export const t = makeT<Tables>(contract);
