import type { Db } from '../db';

export function getUserOrders(db: Db, userId: string) {
  return db.orm.orders.where({ userId }).all();
}

export function getOrderById(db: Db, id: string) {
  return db.orm.orders.where({ _id: id }).first();
}

export function getOrderWithUser(db: Db, id: string) {
  return db.orm.orders.include('user').where({ _id: id }).first();
}

export function createOrder(
  db: Db,
  order: {
    userId: string;
    items: ReadonlyArray<{
      productId: string;
      name: string;
      brand: string;
      amount: number;
      price: { amount: number; currency: string };
      image: { url: string };
    }>;
    shippingAddress: string;
    type: string;
    statusHistory: ReadonlyArray<{ status: string; timestamp: Date }>;
  },
) {
  return db.orm.orders.create({
    userId: order.userId,
    items: [...order.items],
    shippingAddress: order.shippingAddress,
    type: order.type,
    statusHistory: [...order.statusHistory],
  });
}

export function deleteOrder(db: Db, id: string) {
  return db.orm.orders.where({ _id: id }).delete();
}

export function updateOrderStatus(
  db: Db,
  orderId: string,
  entry: { status: string; timestamp: Date },
) {
  return db.orm.orders.where({ _id: orderId }).update((u) => [u.statusHistory.push(entry)]);
}
