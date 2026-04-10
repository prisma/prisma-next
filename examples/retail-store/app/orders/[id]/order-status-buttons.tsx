'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../src/components/ui/button';

const statusFlow: Record<string, string> = {
  placed: 'shipped',
  shipped: 'delivered',
};

export function OrderStatusButtons({
  orderId,
  currentStatus,
}: {
  orderId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const nextStatus = statusFlow[currentStatus];

  if (!nextStatus) return null;

  async function handleAdvance() {
    setLoading(true);
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleAdvance} disabled={loading}>
      {loading ? 'Updating...' : `Mark as ${nextStatus}`}
    </Button>
  );
}
