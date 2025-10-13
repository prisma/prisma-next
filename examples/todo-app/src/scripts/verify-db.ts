import { sql } from '@prisma/sql';
import { connect } from '@prisma/runtime';
import ir from '../../.prisma/contract.json';
import { Schema, parseIR } from '@prisma/relational-ir';

const db = connect({
  ir: ir as Schema,
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
});

// Import the table types
import { t } from '../prisma/db';

try {
  console.log('🔍 Verifying DDL primitives created tables correctly...\n');

  const users = await db.execute(
    sql(parseIR(ir))
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email, active: t.user.active })
      .build(),
  );
  console.log('✅ Users table created successfully:');
  console.log(users);

  const posts = await db.execute(
    sql(parseIR(ir))
      .from(t.post)
      .select({ id: t.post.id, title: t.post.title, userId: t.post.user_id })
      .build(),
  );
  console.log('✅ Posts table created successfully:');
  console.log(posts);

  console.log('\n🎉 DDL primitives verification complete!');
  console.log('✨ Tables were created using type-safe ScriptAST and executed via AdminConnection');
} finally {
  await db.end();
}
