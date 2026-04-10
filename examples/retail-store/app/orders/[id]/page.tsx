import { notFound } from 'next/navigation';
import { getOrderWithUser } from '../../../src/data/orders';
import { getDb } from '../../../src/db-singleton';

export const dynamic = 'force-dynamic';

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const order = await getOrderWithUser(db, id);

  if (!order) {
    notFound();
  }

  const total = order.items.reduce((sum, item) => sum + Number(item.price.amount) * item.amount, 0);

  return (
    <div style={{ maxWidth: '600px' }}>
      <a
        href="/orders"
        style={{ fontSize: '0.85rem', marginBottom: '1rem', display: 'inline-block' }}
      >
        ← Back to orders
      </a>
      <div
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Order Detail</h1>

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Shipping Address</div>
          <div>{order.shippingAddress}</div>
        </div>

        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Items</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {order.items.map((item, i) => (
            <div
              key={`${item.productId}-${i}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>{item.name}</span>
                <span style={{ color: 'var(--muted)', marginLeft: '0.5rem' }}>×{item.amount}</span>
              </div>
              <div>${(Number(item.price.amount) * item.amount).toFixed(2)}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: '1rem',
            fontWeight: 700,
            fontSize: '1.1rem',
            textAlign: 'right',
          }}
        >
          Total: ${total.toFixed(2)}
        </div>

        <h2 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.75rem' }}>
          Status History
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {order.statusHistory.map((entry) => (
            <div
              key={`${entry.status}-${String(entry.timestamp)}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.85rem',
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  fontSize: '0.75rem',
                }}
              >
                {entry.status}
              </span>
              <span style={{ color: 'var(--muted)' }}>
                {new Date(entry.timestamp as unknown as string).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
