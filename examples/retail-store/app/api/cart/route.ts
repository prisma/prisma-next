import { NextResponse } from 'next/server';
import { addToCart, clearCart, getCartByUserId, removeFromCart } from '../../../src/data/carts';
import { getDb } from '../../../src/db-singleton';

const DEMO_USER_ID = process.env['DEMO_USER_ID'] ?? '';

export async function GET() {
  const db = await getDb();
  const cart = await getCartByUserId(db, DEMO_USER_ID);
  return NextResponse.json(cart ?? { items: [] });
}

export async function POST(req: Request) {
  const body = await req.json();
  const db = await getDb();
  await addToCart(db, DEMO_USER_ID, body);
  const cart = await getCartByUserId(db, DEMO_USER_ID);
  return NextResponse.json(cart ?? { items: [] });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('productId');
  const db = await getDb();

  if (productId) {
    await removeFromCart(db, DEMO_USER_ID, productId);
  } else {
    await clearCart(db, DEMO_USER_ID);
  }

  const cart = await getCartByUserId(db, DEMO_USER_ID);
  return NextResponse.json(cart ?? { items: [] });
}
