import { connect } from '@prisma/runtime';
import ir from '../.prisma/contract.json' assert { type: 'json' };
import { Schema } from '@prisma/relational-ir';

export const db = connect({
  ir: ir as Schema,
  verify: 'onFirstUse',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
});
