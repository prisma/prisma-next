import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/postgres/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { expectTypeOf } from 'vitest';

// family and target are no longer accepted — the facade pre-binds them
// @ts-expect-error — family is no longer accepted; the facade pre-binds it
defineContract({ family: sqlFamilyPack, extensionPacks: undefined });

// @ts-expect-error — target is no longer accepted; the facade pre-binds it
defineContract({ target: postgresPack, extensionPacks: undefined });

// The returned contract carries literal 'sql' family-ID and 'postgres' target-ID
const result = defineContract({});
expectTypeOf(result.target).toEqualTypeOf<'postgres'>();
expectTypeOf(result.targetFamily).toEqualTypeOf<'sql'>();
