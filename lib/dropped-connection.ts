/**
 * Chrome's rejection when a response body stops mid-read: "TypeError: network
 * error". The error pages meet it when the page data of a client navigation
 * lost its connection after the server had answered 200 (Sentry NP-HIRING-3).
 * No frame of ours is in it, so the error pages do not report it, and their
 * retry reloads the page: reset() renders again without fetching the page data
 * again.
 */
export function isDroppedConnection(error: Error): boolean {
  return error.name === 'TypeError' && error.message === 'network error';
}
