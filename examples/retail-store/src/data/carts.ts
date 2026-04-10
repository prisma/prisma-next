import { ObjectId } from 'mongodb';
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

export async function addToCart(
  db: Db,
  userId: string,
  item: {
    productId: string;
    name: string;
    brand: string;
    amount: number;
    price: { amount: number; currency: string };
    image: { url: string };
  },
) {
  const oid = userId instanceof ObjectId ? userId : new ObjectId(userId as string);
  const plan = db.raw
    .collection('carts')
    .updateOne({ userId: oid }, { $push: { items: item } })
    .build();
  for await (const _ of db.runtime.execute(plan)) {
    /* consume */
  }
}

export async function removeFromCart(db: Db, userId: string, productId: string) {
  const oid = userId instanceof ObjectId ? userId : new ObjectId(userId as string);
  const plan = db.raw
    .collection('carts')
    .updateOne({ userId: oid }, { $pull: { items: { productId } } })
    .build();
  for await (const _ of db.runtime.execute(plan)) {
    /* consume */
  }
}
