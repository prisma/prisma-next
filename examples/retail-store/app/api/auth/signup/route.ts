import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createUser } from '../../../../src/data/users';
import { getDb } from '../../../../src/db-singleton';

export async function POST() {
  const db = await getDb();
  const shortId = Math.random().toString(36).slice(2, 8);
  const user = await createUser(db, {
    name: `User-${shortId}`,
    email: `user-${shortId}@demo.local`,
    address: null,
  });

  const cookieStore = await cookies();
  cookieStore.set('userId', String(user._id), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ id: String(user._id), name: user.name });
}
