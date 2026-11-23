/**
 * The board this card belongs to, read from the document the server wrote
 * (lib/mcp/widgets/resources.ts widgetHtml puts it on #pm-root).
 *
 * One bundle serves every board, so it holds no board's name, role, host or
 * address: the server writes those into each document and the cards read
 * them here. Read once, at the first call, so a test can set the attributes
 * before a view renders.
 */

export interface BoardIdentity {
  /** The board's name, as it signs its pages. */
  readonly name: string;
  /** The name of its employer side. */
  readonly employerName: string;
  /** The role's token for a title ("Search <role> jobs"). */
  readonly role: string;
  /** The hosts a card may open: the board's own. */
  readonly hosts: readonly string[];
  /** Where an employer writes for help. */
  readonly support: string;
}

let cached: BoardIdentity | null = null;

function rootData(): DOMStringMap | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('pm-root')?.dataset ?? null;
}

export function board(): BoardIdentity {
  if (cached) return cached;
  const data = rootData();
  const name = data?.board?.trim() || 'this board';
  cached = {
    name,
    employerName: data?.boardEmployers?.trim() || name,
    role: data?.role?.trim() || '',
    hosts: (data?.hosts ?? '').split(/\s+/).filter(Boolean),
    support: data?.support?.trim() || '',
  };
  return cached;
}

/** For tests: forget what was read, so the next call reads the document again. */
export function resetBoardForTests(): void {
  cached = null;
}

/** For tests that render a view with no document: the identity the server would have written. */
export function setBoardForTests(identity: BoardIdentity): void {
  cached = identity;
}
