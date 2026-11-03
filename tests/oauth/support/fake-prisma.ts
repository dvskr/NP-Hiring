/**
 * An in-memory stand-in for the Prisma models lib/oauth uses (oauth_clients,
 * oauth_grants, oauth_authorization_codes, oauth_refresh_tokens and the
 * user_profiles rows a grant points at). The only database is production,
 * so the OAuth suites run against this instead.
 *
 * It models just the query shapes lib/oauth sends: equality, null, gt, gte,
 * lt, lte and OR in a where clause; select and include (grant, user); a
 * nested `codes: { create }` on a grant. Anything else throws, so code that
 * starts relying on another Prisma feature fails here loudly instead of
 * passing on a guess. Every method is a vi.fn, so a test can also pin the
 * exact arguments of an atomic update.
 *
 * Use from a test file:
 *   vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
 */
import { vi } from 'vitest';

type Row = Record<string, unknown>;

interface Tables {
    clients: Row[];
    grants: Row[];
    codes: Row[];
    refreshTokens: Row[];
    profiles: Row[];
}

export const db: Tables = { clients: [], grants: [], codes: [], refreshTokens: [], profiles: [] };

let sequence = 0;

export function resetDb(): void {
    db.clients = [];
    db.grants = [];
    db.codes = [];
    db.refreshTokens = [];
    db.profiles = [];
    sequence = 0;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function time(value: unknown): number {
    if (!(value instanceof Date)) throw new Error(`fake prisma: expected a Date, got ${String(value)}`);
    return value.getTime();
}

function matchesCondition(value: unknown, condition: unknown): boolean {
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition === 'object') {
        return Object.entries(condition as Row).every(([operator, operand]) => {
            if (value === null || value === undefined) return false;
            switch (operator) {
                case 'gt':
                    return time(value) > time(operand);
                case 'gte':
                    return time(value) >= time(operand);
                case 'lt':
                    return time(value) < time(operand);
                case 'lte':
                    return time(value) <= time(operand);
                default:
                    throw new Error(`fake prisma: unsupported operator ${operator}`);
            }
        });
    }
    return value === condition;
}

export function matchesWhere(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (key === 'OR') return (condition as Row[]).some((branch) => matchesWhere(row, branch));
        if (key === 'AND' || key === 'NOT') throw new Error(`fake prisma: unsupported ${key}`);
        return matchesCondition(row[key], condition);
    });
}

type Relation = (row: Row) => { table: Row[]; match: (candidate: Row) => boolean; model: ModelName };
type ModelName = 'client' | 'grant' | 'code' | 'refreshToken' | 'profile';

const RELATIONS: Record<ModelName, Record<string, Relation>> = {
    client: {},
    grant: {
        user: (row) => ({ table: db.profiles, match: (profile) => profile.supabaseId === row.userId, model: 'profile' }),
    },
    code: {
        grant: (row) => ({ table: db.grants, match: (grant) => grant.id === row.grantId, model: 'grant' }),
    },
    refreshToken: {
        grant: (row) => ({ table: db.grants, match: (grant) => grant.id === row.grantId, model: 'grant' }),
    },
    profile: {},
};

interface Shape {
    select?: Row;
    include?: Row;
}

/** A row as Prisma returns it under `shape`: the selected fields, or every scalar plus the included relations. */
function project(model: ModelName, row: Row, shape: Shape): Row {
    if (shape.select && shape.include) throw new Error('fake prisma: select and include together');
    const relations = RELATIONS[model];
    const resolve = (key: string, spec: unknown): unknown => {
        const relation = relations[key];
        if (!relation) throw new Error(`fake prisma: unknown relation ${model}.${key}`);
        const { table, match, model: target } = relation(row);
        const found = table.find(match);
        if (!found) return null;
        return spec === true ? clone(found) : project(target, found, spec as Shape);
    };
    if (shape.select) {
        return Object.fromEntries(
            Object.entries(shape.select)
                .filter(([, on]) => on)
                .map(([key, spec]) => [key, relations[key] ? resolve(key, spec) : clone(row[key])]),
        );
    }
    const base = clone(row);
    for (const [key, spec] of Object.entries(shape.include ?? {})) {
        if (spec) base[key] = resolve(key, spec);
    }
    return base;
}

function tableOf(model: ModelName): Row[] {
    switch (model) {
        case 'client':
            return db.clients;
        case 'grant':
            return db.grants;
        case 'code':
            return db.codes;
        case 'refreshToken':
            return db.refreshTokens;
        case 'profile':
            return db.profiles;
    }
}

const PRIMARY_KEY: Record<ModelName, string> = {
    client: 'id',
    grant: 'id',
    code: 'codeHash',
    refreshToken: 'tokenHash',
    profile: 'supabaseId',
};

function withDefaults(model: ModelName, data: Row): Row {
    const now = new Date();
    switch (model) {
        case 'client':
            return { createdAt: now, lastUsedAt: null, ...data };
        case 'grant':
            return { id: `grant_${++sequence}`, createdAt: now, lastUsedAt: null, revokedAt: null, revokedReason: null, ...data };
        case 'code':
        case 'refreshToken':
            return { consumedAt: null, createdAt: now, ...data };
        case 'profile':
            return { deletedAt: null, ...data };
    }
}

function insert(model: ModelName, data: Row): Row {
    const table = tableOf(model);
    const row = withDefaults(model, data);
    const key = PRIMARY_KEY[model];
    if (table.some((existing) => existing[key] === row[key])) {
        throw Object.assign(new Error(`fake prisma: unique constraint on ${model}.${key}`), { code: 'P2002' });
    }
    table.push(row);
    return row;
}

function model(name: ModelName) {
    return {
        findUnique: vi.fn(async (args: { where: Row } & Shape) => {
            const row = tableOf(name).find((candidate) => matchesWhere(candidate, args.where));
            return row ? project(name, row, args) : null;
        }),
        findMany: vi.fn(async (args: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'>; take?: number } & Shape) => {
            let rows = tableOf(name).filter((candidate) => matchesWhere(candidate, args.where ?? {}));
            const [orderKey, direction] = Object.entries(args.orderBy ?? {})[0] ?? [];
            if (orderKey) {
                rows = [...rows].sort((a, b) => {
                    const delta = time(a[orderKey]) - time(b[orderKey]);
                    return direction === 'desc' ? -delta : delta;
                });
            }
            if (args.take !== undefined) rows = rows.slice(0, args.take);
            return rows.map((row) => project(name, row, args));
        }),
        create: vi.fn(async (args: { data: Row } & Shape) => {
            const { codes, ...data } = args.data as Row & { codes?: { create: Row } };
            const row = insert(name, data);
            if (codes !== undefined) {
                if (name !== 'grant' || !codes.create) throw new Error('fake prisma: unsupported nested write');
                insert('code', { ...codes.create, grantId: row.id });
            }
            return project(name, row, args);
        }),
        updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
            const rows = tableOf(name).filter((candidate) => matchesWhere(candidate, args.where));
            for (const row of rows) Object.assign(row, clone(args.data));
            return { count: rows.length };
        }),
        deleteMany: vi.fn(async (args: { where: Row }) => {
            const table = tableOf(name);
            const keep = table.filter((candidate) => !matchesWhere(candidate, args.where));
            const count = table.length - keep.length;
            table.splice(0, table.length, ...keep);
            return { count };
        }),
    };
}

export const fakePrisma = {
    oauthClient: model('client'),
    oauthGrant: model('grant'),
    oauthAuthorizationCode: model('code'),
    oauthRefreshToken: model('refreshToken'),
    userProfile: model('profile'),
};

// ── Seeding ────────────────────────────────────────────────────────────────

export function addProfile(supabaseId: string, overrides: Row = {}): Row {
    return insert('profile', { id: `profile_${supabaseId}`, supabaseId, email: `${supabaseId}@example.com`, role: 'job_seeker', ...overrides });
}

export function addClient(id: string, overrides: Row = {}): Row {
    return insert('client', { id, clientName: 'Test client', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], ...overrides });
}

export function addGrant(overrides: Row = {}): Row {
    return insert('grant', {
        userId: 'user-1',
        clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
        clientName: 'Claude',
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
        scopes: ['profile:read', 'applications:read', 'applications:write'],
        resource: 'https://nphiring.com/mcp',
        ...overrides,
    });
}

export function addCode(overrides: Row): Row {
    return insert('code', { expiresAt: new Date(Date.now() + 5 * 60 * 1000), ...overrides });
}

export function addRefreshToken(overrides: Row): Row {
    return insert('refreshToken', { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), ...overrides });
}
