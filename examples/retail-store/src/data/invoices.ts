import type { Db } from '../db';
import { objectIdEq } from './object-id-filter';

export function findInvoiceById(db: Db, id: string) {
  return db.orm.invoices.where(objectIdEq('_id', id)).first();
}

export function findInvoiceWithOrder(db: Db, id: string) {
  return db.orm.invoices.include('order').where(objectIdEq('_id', id)).first();
}

export function createInvoice(
  db: Db,
  invoice: {
    orderId: string;
    items: ReadonlyArray<{
      name: string;
      amount: number;
      unitPrice: number;
      lineTotal: number;
    }>;
    subtotal: number;
    tax: number;
    total: number;
    issuedAt: Date;
  },
) {
  return db.orm.invoices.create({
    orderId: invoice.orderId,
    items: [...invoice.items],
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    issuedAt: invoice.issuedAt,
  });
}
