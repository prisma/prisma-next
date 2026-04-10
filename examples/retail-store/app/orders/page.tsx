import { getUserOrders } from '../../src/data/orders';
import { getDb } from '../../src/db-singleton';

export const dynamic = 'force-dynamic';

const DEMO_USER_ID = process.env['DEMO_USER_ID'] ?? '';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    placed: '#2563eb',
    shipped: '#d97706',
    delivered: '#16a34a',
    cancelled: '#dc2626',
  };
  const bg = colors[status] ?? '#666';
  return (
    <span
      style={{
        background: bg,
        color: '#fff',
        padding: '0.15rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  );
}

export default async function OrdersPage() {
  const db = await getDb();
  const orders = DEMO_USER_ID ? await getUserOrders(db, DEMO_USER_ID) : [];

  return (
    <div style={{ maxWidth: '700px' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Order History</h1>

      {orders.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No orders yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {orders.map((order) => {
            const lastStatus = order.statusHistory[order.statusHistory.length - 1];
            const total = order.items.reduce(
              (sum, item) => sum + Number(item.price.amount) * item.amount,
              0,
            );
            return (
              <a
                key={String(order._id)}
                href={`/orders/${String(order._id)}`}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '1.25rem',
                  textDecoration: 'none',
                  color: 'inherit',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                    {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                    {order.shippingAddress}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ marginBottom: '0.25rem' }}>
                    {lastStatus && <StatusBadge status={lastStatus.status as string} />}
                  </div>
                  <div style={{ fontWeight: 600 }}>${total.toFixed(2)}</div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
