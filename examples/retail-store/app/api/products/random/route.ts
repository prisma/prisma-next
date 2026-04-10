import { type NextRequest, NextResponse } from 'next/server';
import { getRandomProducts } from '../../../../src/data/products';
import { getDb } from '../../../../src/db-singleton';

export async function GET(req: NextRequest) {
  const count = Number(req.nextUrl.searchParams.get('count') ?? '4');
  const db = await getDb();
  const products = await getRandomProducts(db, count);
  return NextResponse.json(products);
}
