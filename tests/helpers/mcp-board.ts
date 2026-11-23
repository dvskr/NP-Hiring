/**
 * The board identity the cards read (lib/mcp/widgets/src/board.ts), for tests
 * that render a view with no document. The values are the active pack's, as
 * lib/mcp/widgets/resources.ts writes them onto the document's root.
 */
import { brand } from '@/config/brand';
import { setBoardForTests, type BoardIdentity } from '@/lib/mcp/widgets/src/board';

export const TEST_BOARD: BoardIdentity = {
  name: brand.name,
  employerName: `${brand.name} for Employers`,
  role: brand.niche.short,
  hosts: [brand.domain, `www.${brand.domain}`],
  support: brand.email.support,
};

/** Give the views the active board's identity. Call before the first render. */
export function useTestBoard(): void {
  setBoardForTests(TEST_BOARD);
}

/** A board value (its name, its role, a namespace) as a literal inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
