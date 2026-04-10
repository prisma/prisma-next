import type { Db } from '../db';
import { executeRaw } from './execute-raw';
import { objectIdEq, rawObjectIdFilter } from './object-id-filter';

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
  const plan = db.raw
    .collection('carts')
    .findOneAndUpdate(
      rawObjectIdFilter('userId', userId),
      { $push: { items: item }, $setOnInsert: rawObjectIdFilter('userId', userId) },
      { upsert: true },
    )
    .build();
  await executeRaw(db, plan);
}

export async function removeFromCart(db: Db, userId: string, productId: string) {
  const plan = db.raw
    .collection('carts')
    .updateOne(rawObjectIdFilter('userId', userId), { $pull: { items: { productId } } })
    .build();
  await executeRaw(db, plan);
}
