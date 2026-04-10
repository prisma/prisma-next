'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../src/components/ui/button';

interface CartActionsProps {
  productId?: string;
  mode: 'remove' | 'clear';
}

export function CartActions({ productId, mode }: CartActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleAction() {
    setLoading(true);
    try {
      const url = mode === 'remove' ? `/api/cart?productId=${productId}` : '/api/cart';
      await fetch(url, { method: 'DELETE' });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'remove') {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleAction}
        disabled={loading}
        className="text-destructive"
      >
        Remove
      </Button>
    );
  }

  return (
    <Button variant="outline" onClick={handleAction} disabled={loading}>
      {loading ? 'Clearing...' : 'Clear Cart'}
    </Button>
  );
}
