import { connect, createRuntime, lint, verification } from '@prisma/runtime';
import _ir from '../../.prisma/contract.json';
import { validateContract } from '@prisma/relational-ir';
import contract from '../../.prisma/contract.json';
import { makeT } from '@prisma/sql';
import * as Contract from '../../.prisma/contract';
import { orm } from '@prisma/orm';

export const dataContract = validateContract(_ir);

// Export the raw connection for scripts that need it (like setup-db.ts)
export const db = connect({
  ir: dataContract,
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
});

// Create a runtime with lint and verification plugins for enhanced query execution
export const runtime = createRuntime({
  ir: dataContract,
  driver: db,
  plugins: [
    verification({ mode: 'onFirstUse' }),
    lint({
      rules: {
        'no-select-star': 'error',
        'mutation-requires-where': 'error',
        'no-missing-limit': 'warn',
        'no-unindexed-column-in-where': 'warn',
      },
    }),
  ],
});

type ContractTypes = {
  Tables: Contract.Contract.Tables;
  Relations: Contract.Contract.Relations;
  Uniques: Contract.Contract.Uniques;
};

export const t = makeT<Contract.Contract.Tables>(dataContract);
export const r = orm<ContractTypes>(dataContract);
