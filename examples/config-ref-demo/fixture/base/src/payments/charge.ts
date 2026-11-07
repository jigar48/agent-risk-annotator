// Synthetic example code. Not a real payment integration.
import { gateway } from './gateway';

export async function charge(orderId: string, amountCents: number) {
  return gateway.capture({
    orderId,
    amountCents,
    idempotencyKey: `capture-${orderId}`,
  });
}
