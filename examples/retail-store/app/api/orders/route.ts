import { NextResponse } from 'next/server';
import { createOrder, getUserOrders } from '../../../src/data/orders';
import { getDb } from '../../../src/db-singleton';

const DEMO_USER_ID = process.env['DEMO_USER_ID'] ?? '';

export async function GET() {
  if (!DEMO_USER_ID) return NextResponse.json([]);
  const db = await getDb();
  const orders = await getUserOrders(db, DEMO_USER_ID);
  return NextResponse.json(orders);
}

export async function POST(req: Request) {
  if (!DEMO_USER_ID) return NextResponse.json({ error: 'DEMO_USER_ID not set' }, { status: 500 });
  const body = await req.json();
  const db = await getDb();
  const order = await createOrder(db, {
    userId: DEMO_USER_ID,
    items: body.items,
    shippingAddress: body.shippingAddress,
    type: body.type ?? 'home',
    statusHistory: [{ status: 'placed', timestamp: new Date() }],
  });
  return NextResponse.json(order, { status: 201 });
}
