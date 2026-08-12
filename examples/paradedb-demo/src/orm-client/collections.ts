import { Collection } from '@prisma-next/sql-orm-client';
import type { Contract } from '../prisma/contract.d';

export class ItemCollection extends Collection<Contract, 'Item'> {}
