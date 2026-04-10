import type { Db } from '../db';
import { objectIdEq } from './object-id-filter';

export function getCartByUserId(db: Db, userId: string) {
  return db.orm.carts.where(objectIdEq('userId', userId)).first();
}

export function getCartWithUser(db: Db, userId: string) {
  return db.orm.carts.include('user').where(objectIdEq('userId', userId)).first();
}

export function upsertCart(
  db: Db,
  userId: string,
  items: ReadonlyArray<{
    productId: string;
    name: string;
    brand: string;
    amount: number;
    price: { amount: number; currency: string };
    image: { url: string };
  }>,
) {
  return db.orm.carts.where(objectIdEq('userId', userId)).upsert({
    create: { userId, items: [...items] },
    update: { items: [...items] },
  });
}

export function clearCart(db: Db, userId: string) {
  return db.orm.carts.where(objectIdEq('userId', userId)).update({ items: [] });
}
