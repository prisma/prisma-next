import type { Db } from '@prisma-next/sql-builder';
import type { Contract } from '../fixtures/generated/contract';

// The builder surface is always qualified; alias `db` to the `public` namespace
// facet (the sole shape) so playground tables are reached as `db.<table>`.
declare const db: Db<Contract>['public'];

export { db };
