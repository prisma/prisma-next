'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCart } from '../../src/components/cart-provider';
import { Button } from '../../src/components/ui/button';
import { Input } from '../../src/components/ui/input';
import { RadioGroup, RadioGroupItem } from '../../src/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../src/components/ui/select';
import { Separator } from '../../src/components/ui/separator';

interface CartItem {
  productId: string;
  name: string;
  brand: string;
  amount: number;
  price: { amount: number; currency: string };
  image: { url: string };
}

interface Location {
  id: string;
  name: string;
  address: string;
}

interface CheckoutFormProps {
  defaultAddress: string;
  locations: Location[];
  cartItems: CartItem[];
}

export function CheckoutForm({ defaultAddress, locations, cartItems }: CheckoutFormProps) {
  const router = useRouter();
  const { invalidateCart } = useCart();
  const [orderType, setOrderType] = useState<'home' | 'bopis'>('home');
  const [address, setAddress] = useState(defaultAddress);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const shippingAddress =
        orderType === 'home' ? address : locations.find((l) => l.id === locationId)?.address;

      if (!shippingAddress?.trim()) {
        setError(
          orderType === 'home'
            ? 'Please enter a shipping address.'
            : 'Please select a pickup location.',
        );
        return;
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartItems,
          shippingAddress,
          type: orderType,
        }),
      });

      if (res.ok) {
        invalidateCart();
        const order = await res.json();
        router.push(`/orders/${order._id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Separator className="mb-6" />

      <h2 className="font-semibold mb-3">Delivery Method</h2>
      <RadioGroup
        value={orderType}
        onValueChange={(v: string) => setOrderType(v as 'home' | 'bopis')}
        className="mb-4"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="home" id="home" />
          <label htmlFor="home" className="text-sm cursor-pointer">
            Home Delivery
          </label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="bopis" id="bopis" />
          <label htmlFor="bopis" className="text-sm cursor-pointer">
            Buy Online, Pick Up In Store
          </label>
        </div>
      </RadioGroup>

      {orderType === 'home' ? (
        <div className="mb-6">
          <label htmlFor="address" className="text-sm font-medium mb-1.5 block">
            Shipping Address
          </label>
          <Input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, City, State, ZIP"
            required
          />
        </div>
      ) : (
        <div className="mb-6">
          <label htmlFor="pickup-location" className="text-sm font-medium mb-1.5 block">
            Pickup Location
          </label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a store" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name} — {loc.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && <p className="text-destructive text-sm mb-3">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Placing Order...' : 'Place Order'}
      </Button>
    </form>
  );
}
