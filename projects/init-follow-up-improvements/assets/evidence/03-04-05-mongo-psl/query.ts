import { db } from './prisma/db';

async function main() {
  const client = await db.connect(process.env['DATABASE_URL']!, 'mydb');
  const user = await client.orm.User.where((u) => u.email.eq('alice@example.com')).first();
  console.log(user);
}

main().catch(console.error);
