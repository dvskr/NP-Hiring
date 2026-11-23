/**
 * An in-memory stand-in for the five OAuth tables, so the OAuth server's
 * real code paths (register, authorize, consent, exchange, verify, rotate,
 * revoke) run end to end without a database.
 *
 * It implements only the query shapes lib/mcp/oauth uses: equality, null,
 * { gt } / { lt } on dates, a top-level OR, and the `{ none: {} }` relation
 * filters the client cleanup uses. Reads return copies, as a database
 * would, so a later write cannot reach back into a row a test already holds.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((w) => matches(row, w));
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition && typeof condition === 'object') {
      const c = condition as { gt?: Date; lt?: Date; in?: unknown[] };
      if (c.in) return c.in.includes(value);
      if (c.gt) return value instanceof Date && value.getTime() > c.gt.getTime();
      if (c.lt) return value instanceof Date && value.getTime() < c.lt.getTime();
      return false;
    }
    return value === condition;
  });
}

export interface FakeUser {
  supabaseId: string;
  email: string;
  role: string;
  deletedAt: Date | null;
}

function build() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;
  const clients = new Map<string, Row>();
  const requests = new Map<string, Row>();
  const grants = new Map<string, Row>();
  const codes = new Map<string, Row>();
  const tokens = new Map<string, Row>();
  const users = new Map<string, FakeUser>();

  const grantView = (grantId: unknown) => {
    const grant = grants.get(String(grantId));
    if (!grant) return null;
    return {
      ...grant,
      client: { ...clients.get(String(grant.clientId)) },
      user: { ...(users.get(String(grant.userId)) ?? { supabaseId: grant.userId, email: '', role: 'job_seeker', deletedAt: null }) },
    };
  };

  const updateWhere = (table: Map<string, Row>, where: Where, data: Row) => {
    let count = 0;
    for (const row of table.values()) {
      if (matches(row, where)) {
        Object.assign(row, data);
        count++;
      }
    }
    return { count };
  };

  const deleteWhere = (table: Map<string, Row>, where: Where) => {
    let count = 0;
    for (const [key, row] of table.entries()) {
      if (matches(row, where)) {
        table.delete(key);
        count++;
      }
    }
    return { count };
  };

  const prisma = {
    oAuthClient: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: nextId('client'), createdAt: new Date(), ...data };
        clients.set(String(row.clientId), row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { clientId: string } }) => {
        const row = clients.get(where.clientId);
        return row ? { ...row } : null;
      },
      // `grants: { none: {} }` and `authorizationRequests: { none: {} }`: no related rows.
      deleteMany: async ({ where }: { where: Where }) => {
        const { grants: noGrants, authorizationRequests: noRequests, ...columns } = where;
        let count = 0;
        for (const [key, row] of clients.entries()) {
          if (!matches(row, columns)) continue;
          if (noGrants && [...grants.values()].some((g) => g.clientId === row.clientId)) continue;
          if (noRequests && [...requests.values()].some((r) => r.clientId === row.clientId)) continue;
          clients.delete(key);
          count++;
        }
        return { count };
      },
    },
    oAuthAuthorizationRequest: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = { createdAt: new Date(), ...data };
        requests.set(String(row.id), row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = requests.get(where.id);
        return row ? { ...row, client: { ...clients.get(String(row.clientId)) } } : null;
      },
      deleteMany: async ({ where }: { where: Where }) => deleteWhere(requests, where),
    },
    oAuthGrant: {
      upsert: async ({ where, update, create }: { where: { clientId_userId_resource: Row }; update: Row; create: Row }) => {
        const key = where.clientId_userId_resource;
        const existing = [...grants.values()].find(
          (g) => g.clientId === key.clientId && g.userId === key.userId && g.resource === key.resource,
        );
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return { ...existing };
        }
        const row: Row = { id: nextId('grant'), createdAt: new Date(), updatedAt: new Date(), lastUsedAt: null, revokedAt: null, ...create };
        grants.set(String(row.id), row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = grants.get(where.id);
        if (!row) throw new Error('grant not found');
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => updateWhere(grants, where, data),
      // Cascades to the grant's codes and tokens, as the foreign keys do.
      deleteMany: async ({ where }: { where: Where }) => {
        let count = 0;
        for (const [key, row] of grants.entries()) {
          if (!matches(row, where)) continue;
          grants.delete(key);
          for (const [codeKey, code] of codes.entries()) if (code.grantId === row.id) codes.delete(codeKey);
          for (const [tokenKey, token] of tokens.entries()) if (token.grantId === row.id) tokens.delete(tokenKey);
          count++;
        }
        return { count };
      },
      findFirst: async ({ where }: { where: Where }) => {
        const row = [...grants.values()].find((g) => matches(g, where));
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where: Where }) =>
        [...grants.values()].filter((g) => matches(g, where)).map((g) => grantView(g.id)!),
    },
    oAuthAuthorizationCode: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: nextId('code'), createdAt: new Date(), consumedAt: null, ...data };
        codes.set(String(row.id), row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { codeHash: string } }) => {
        const row = [...codes.values()].find((c) => c.codeHash === where.codeHash);
        return row ? { ...row, grant: grantView(row.grantId) } : null;
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => updateWhere(codes, where, data),
      deleteMany: async ({ where }: { where: Where }) => deleteWhere(codes, where),
    },
    oAuthToken: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const d of data) {
          const row: Row = { id: nextId('token'), createdAt: new Date(), revokedAt: null, rotatedAt: null, ...d };
          tokens.set(String(row.id), row);
        }
        return { count: data.length };
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = [...tokens.values()].find((t) => t.tokenHash === where.tokenHash);
        return row ? { ...row, grant: grantView(row.grantId) } : null;
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => updateWhere(tokens, where, data),
      deleteMany: async ({ where }: { where: Where }) => deleteWhere(tokens, where),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return { prisma, clients, requests, grants, codes, tokens, users };
}

let current = build();

/** The live fake. Its prisma object stays the same across reset(). */
export const fakeOAuthDb = {
  get state() {
    return current;
  },
  prisma: new Proxy({} as ReturnType<typeof build>['prisma'], {
    get: (_target, prop: string) => current.prisma[prop as keyof typeof current.prisma],
  }),
  reset() {
    current = build();
  },
};
