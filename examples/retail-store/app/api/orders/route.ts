import { NextResponse } from 'next/server';
import { clearCart } from '../../../src/data/carts';
import { createOrder, getUserOrders } from '../../../src/data/orders';
import { getDb } from '../../../src/db-singleton';
import { getAuthUserId } from '../../../src/lib/auth';

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json([], { status: 401 });
  const db = await getDb();
  const orders = await getUserOrders(db, userId);
  return NextResponse.json(orders);
}

export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await req.json();
  const db = await getDb();
  const order = await createOrder(db, {
    userId,
    items: body.items,
    shippingAddress: body.shippingAddress,
    type: body.type ?? 'home',
    statusHistory: [{ status: 'placed', timestamp: new Date() }],
  });
  await clearCart(db, userId);
  return NextResponse.json(order, { status: 201 });
}
