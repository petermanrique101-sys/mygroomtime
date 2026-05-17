export type PriceSeed = {
  id: string;
  productId: string;
  productName: string;
  unitAmount: number;
  currency: 'usd';
  interval: 'month';
};

export const SEEDED_PRICES: ReadonlyArray<PriceSeed> = [
  {
    id: 'price_starter_twin',
    productId: 'prod_starter_twin',
    productName: 'Starter',
    unitAmount: 4900,
    currency: 'usd',
    interval: 'month',
  },
  {
    id: 'price_pro_twin',
    productId: 'prod_pro_twin',
    productName: 'Pro',
    unitAmount: 9900,
    currency: 'usd',
    interval: 'month',
  },
  {
    id: 'price_business_twin',
    productId: 'prod_business_twin',
    productName: 'Business',
    unitAmount: 14900,
    currency: 'usd',
    interval: 'month',
  },
];

export function lookupPrice(id: string): PriceSeed | undefined {
  return SEEDED_PRICES.find((p) => p.id === id);
}
