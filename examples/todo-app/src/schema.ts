import contract from '../.prisma/contract.json' assert { type: 'json' };
import { makeT } from '@prisma/sql';
import type { Contract } from '../.prisma/contract';

export const t = makeT<Contract.Tables>(contract);
