import type { Db } from '@prisma-next/sql-builder';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;

export { db };
