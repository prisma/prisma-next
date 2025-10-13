import { connect, createRuntime, lint } from '@prisma/runtime';
import ir from '../../.prisma/contract.json';
import { validateContract, parseIR } from '@prisma/relational-ir';

// Create the raw database connection
const db = connect({
  ir: validateContract(ir),
  verify: 'onFirstUse',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
});

// Create a runtime with lint plugin for enhanced query execution
export const runtime = createRuntime({
  ir: parseIR(ir),
  driver: db,
  plugins: [
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

// Export the raw connection for scripts that need it (like setup-db.ts)
export { db };
