/**
 * F32/F23 smoke — the new Inngest function modules must construct cleanly at
 * import time (bad trigger/concurrency config throws in createFunction) and
 * export the arrays the serve handler registers.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

import { paymentReconciliationFunctions } from '@/lib/inngest/functions/payment-reconciliation';
import { broadcastFunctions } from '@/lib/inngest/functions/broadcast-send';
import { BROADCAST_REQUESTED_EVENT } from '@/lib/inngest/client';

describe('payment reconciliation Inngest module', () => {
  it('exports exactly one constructed function', () => {
    expect(paymentReconciliationFunctions).toHaveLength(1);
    expect(paymentReconciliationFunctions[0]).toBeTruthy();
  });
});

describe('broadcast Inngest module', () => {
  it('exports the sender and the stuck-broadcast sweep', () => {
    expect(broadcastFunctions).toHaveLength(2);
    expect(broadcastFunctions[0]).toBeTruthy();
    expect(broadcastFunctions[1]).toBeTruthy();
  });

  it('event name matches what the admin route emits', () => {
    expect(BROADCAST_REQUESTED_EVENT).toBe('admin/broadcast.requested');
  });
});
