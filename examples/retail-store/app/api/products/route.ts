import { NextResponse } from 'next/server';
import { findProducts } from '../../../src/data/products';
import { getDb } from '../../../src/db-singleton';

export async function GET() {
  const db = await getDb();
  const products = await findProducts(db);
  return NextResponse.json(products);
}
