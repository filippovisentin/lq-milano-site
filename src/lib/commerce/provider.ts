// Commerce provider boundary.
//
// The storefront talks only to this module. Today it runs the DEMO provider:
// the cart is local and checkout shows a clearly labelled demo page, with no
// payment, no order and no stock reservation.
//
// To go live, implement `CommerceProvider` for the chosen platform and switch
// PUBLIC_COMMERCE_PROVIDER. Typical options:
//   - 'wix'     Wix Headless (@wix/sdk + @wix/ecom): keep the existing Wix
//               Stores catalogue, orders, payments and emails. createCheckout
//               -> currentCart.createCheckout -> redirect session URL.
//   - 'stripe'  Stripe Checkout via a server endpoint (Astro adapter for
//               Cloudflare Pages): POST cart -> Checkout Session -> redirect.
//   - 'shopify' Storefront API cart -> cart.checkoutUrl.
// Secrets stay server-side; the browser only receives a redirect URL.
import type { CartState } from './cart';

export interface CheckoutResult { redirectUrl: string }

export interface CommerceProvider {
  id: string;
  label: string;
  live: boolean;
  createCheckout(cart: CartState): Promise<CheckoutResult>;
}

const demo: CommerceProvider = {
  id: 'demo',
  label: 'Modalità demo',
  live: false,
  async createCheckout() {
    return { redirectUrl: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/checkout` };
  },
};

const providers: Record<string, CommerceProvider> = { demo };

export const commerce: CommerceProvider =
  providers[(import.meta.env.PUBLIC_COMMERCE_PROVIDER as string) ?? 'demo'] ?? demo;
