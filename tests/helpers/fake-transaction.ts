/**
 * Transactions for a fake database behind the mocked Prisma client, for
 * tests that must tell a write that committed from one that was rolled back.
 *
 * The fake's queries run when they are awaited, as Prisma's do (`deferred`):
 * on its own, a write commits at once; in a `$transaction`, batch or
 * interactive, every write commits, or none does (`fakeTransaction`), as in
 * Postgres. The fake keeps its state in one value that each write replaces,
 * so the transaction keeps the value it started from and puts it back when
 * anything in it fails.
 *
 * Used by tests/api/webhooks-stripe-revoke-atomicity.test.ts and
 * tests/api/activate-paid-job-atomic-publish.test.ts.
 */

/** A query that runs when it is awaited, as Prisma's do: on its own, or in a $transaction batch with the rest. */
export function deferred<T>(run: () => T): PromiseLike<T> {
    let result: Promise<T> | undefined;
    return {
        then<A = T, B = never>(
            onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
            onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
        ): PromiseLike<A | B> {
            result ??= new Promise<T>((resolve) => resolve(run()));
            return result.then(onFulfilled, onRejected);
        },
    };
}

/** Where a fake keeps its state: read before a transaction, put back after a failed one. */
export interface FakeState<S> {
    read: () => S;
    restore: (saved: S) => void;
}

/**
 * The fake's $transaction, batch or interactive. An interactive one runs on
 * `client`, the mocked Prisma client itself, so its writes are the fake's
 * own. Every write in it commits, or none does.
 */
export function fakeTransaction<S>(client: unknown, state: FakeState<S>): (queries: unknown) => Promise<unknown> {
    return async (queries) => {
        const before = state.read();
        try {
            if (typeof queries === 'function') return await (queries as (tx: unknown) => Promise<unknown>)(client);
            const results: unknown[] = [];
            for (const query of queries as PromiseLike<unknown>[]) results.push(await query);
            return results;
        } catch (err) {
            state.restore(before);
            throw err;
        }
    };
}
