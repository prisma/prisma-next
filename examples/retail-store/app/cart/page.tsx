import { getCartByUserId } from '../../src/data/carts';
import { getDb } from '../../src/db-singleton';

export const dynamic = 'force-dynamic';

const DEMO_USER_ID = process.env['DEMO_USER_ID'] ?? '';

export default async function CartPage() {
  const db = await getDb();
  const cart = DEMO_USER_ID ? await getCartByUserId(db, DEMO_USER_ID) : null;
  const items = cart?.items ?? [];

  const total = items.reduce((sum, item) => sum + Number(item.price.amount) * item.amount, 0);

  return (
    <div style={{ maxWidth: '600px' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Shopping Cart</h1>

      {items.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Your cart is empty.</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {items.map((item, i) => (
              <div
                key={`${item.productId}-${i}`}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                    {item.brand} · Qty: {item.amount}
                  </div>
                </div>
                <div style={{ fontWeight: 600 }}>
                  ${(Number(item.price.amount) * item.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1rem',
              borderTop: '2px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '1.1rem',
              fontWeight: 700,
            }}
          >
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  );
}
