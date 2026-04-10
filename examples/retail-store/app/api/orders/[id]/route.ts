import { NextResponse } from 'next/server';
import { deleteOrder, getOrderWithUser, updateOrderStatus } from '../../../../src/data/orders';
import { getDb } from '../../../../src/db-singleton';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const order = await getOrderWithUser(db, id);
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  return NextResponse.json(order);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const deleted = await deleteOrder(db, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  return NextResponse.json(deleted);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = await getDb();
  await updateOrderStatus(db, id, {
    status: body.status,
    timestamp: new Date(),
  });
  const order = await getOrderWithUser(db, id);
  return NextResponse.json(order);
}
