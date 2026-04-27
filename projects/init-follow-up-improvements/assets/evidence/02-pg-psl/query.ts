import { db } from './prisma/db';

async function main() {
  const user = await db.orm.User.where((u) => u.email.eq('alice@example.com')).first();
  console.log(user);
}

main().catch(console.error);
