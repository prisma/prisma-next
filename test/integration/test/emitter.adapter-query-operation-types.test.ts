import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import { generateContractDts } from '@prisma-next/emitter';
import { extractQueryOperationTypeImports } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlEmission } from '@prisma-next/sql-contract-emitter';
import { describe, expect, it } from 'vitest';

describe('emitter + postgres adapter descriptor', () => {
  it('surfaces adapter-declared queryOperationTypes.import in generated contract.d.ts', () => {
    const ir: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      roots: {},
      models: {},
      storage: { storageHash: 'storage:sha256:test' as never, tables: {} },
      capabilities: {},
      extensionPacks: {},
      profileHash: 'profile:sha256:test' as never,
      meta: {},
    };
    const queryOperationTypeImports = extractQueryOperationTypeImports([postgresAdapter]);

    const types = generateContractDts(
      ir,
      sqlEmission,
      [],
      [],
      { storageHash: 'h', profileHash: 'p' },
      { queryOperationTypeImports },
    );

    expect(types).toContain(
      "import type { QueryOperationTypes as PgAdapterQueryOps } from '@prisma-next/adapter-postgres/operation-types'",
    );
    expect(types).toContain('export type QueryOperationTypes = PgAdapterQueryOps');
  });
});
