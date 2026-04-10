import { NextResponse } from 'next/server';
import {
  deleteOrder,
  getOrderById,
  getOrderWithUser,
  updateOrderStatus,
} from '../../../../src/data/orders';
import { getDb } from '../../../../src/db-singleton';
import { getAuthUserId } from '../../../../src/lib/auth';

const UNAUTHORIZED = NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
const NOT_FOUND = NextResponse.json({ error: 'Order not found' }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return UNAUTHORIZED;
  const { id } = await params;
  const db = await getDb();
  const order = await getOrderWithUser(db, id);
  if (!order || String(order.userId) !== userId) return NOT_FOUND;
  return NextResponse.json(order);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return UNAUTHORIZED;
  const { id } = await params;
  const db = await getDb();
  const order = await getOrderById(db, id);
  if (!order || String(order.userId) !== userId) return NOT_FOUND;
  const deleted = await deleteOrder(db, id);
  return NextResponse.json(deleted);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return UNAUTHORIZED;
  const { id } = await params;
  const body = await req.json();
  const db = await getDb();
  const order = await getOrderById(db, id);
  if (!order || String(order.userId) !== userId) return NOT_FOUND;
  await updateOrderStatus(db, id, {
    status: body.status,
    timestamp: new Date(),
  });
  const updated = await getOrderWithUser(db, id);
  return NextResponse.json(updated);
}
