/**
 * P10 messaging-alerts regressions (survived re-verification round 1):
 *
 *   1. POST /api/employer/messages reused a (pair, job) conversation the
 *      candidate had deleted without clearing deletedByA / deletedByB, so the
 *      follow-up never reappeared in the candidate's inbox.
 *   2. GET /api/conversations/[id] blanked every message carrying
 *      deletedBySender for the other party, so a READ reply the sender removed
 *      from their own view reached the recipient as an empty tombstone.
 *   3. A double-submit of /job-alerts stored two identical alerts: no client
 *      in-flight guard and a non-atomic find-then-create on the server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    userProfile: { findUnique: vi.fn() },
    conversation: { findUnique: vi.fn() },
    employerMessage: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: h.userProfile,
        conversation: h.conversation,
        employerMessage: h.employerMessage,
    },
}));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue({ auth: { getUser: h.getUser } }),
}));
vi.mock('@/lib/email-service', () => ({
    sendEmployerMessageNotification: vi.fn(),
    sendCandidateInquiryNotification: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn().mockReturnValue(null) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/document-storage', () => ({
    mintDocReadUrl: vi.fn().mockResolvedValue('signed-url'),
    extractRequestContext: vi.fn().mockReturnValue({}),
    toBareDocPath: vi.fn(),
}));

import {
    isDeletedForViewer,
    isVisibleToViewer,
    visibleToViewerWhere,
} from '@/app/api/conversations/_lib/message-visibility';
import { GET as GET_THREAD } from '@/app/api/conversations/[id]/route';
import { DELETE as DELETE_MESSAGE } from '@/app/api/conversations/[id]/messages/[messageId]/route';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SENDER = 'profile-candidate';
const RECIPIENT = 'profile-employer';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('message visibility rules (defect 2)', () => {
    const base = { senderId: SENDER, recipientId: RECIPIENT, deletedBySender: false, deletedByRecipient: false };

    it('a read message the sender deleted stays intact for the recipient', () => {
        const m = { ...base, deletedBySender: true };
        expect(isVisibleToViewer(m, SENDER)).toBe(false);
        expect(isVisibleToViewer(m, RECIPIENT)).toBe(true);
        expect(isDeletedForViewer(m, RECIPIENT)).toBe(false);
    });

    it('an unread message deleted for everyone is hidden from both sides', () => {
        const m = { ...base, deletedBySender: true, deletedByRecipient: true };
        expect(isVisibleToViewer(m, SENDER)).toBe(false);
        expect(isVisibleToViewer(m, RECIPIENT)).toBe(false);
        expect(isDeletedForViewer(m, RECIPIENT)).toBe(true);
    });

    it('the where fragment mirrors isVisibleToViewer', () => {
        expect(visibleToViewerWhere(RECIPIENT)).toEqual({
            OR: [
                { senderId: RECIPIENT, deletedBySender: false },
                { recipientId: RECIPIENT, deletedByRecipient: false },
            ],
        });
    });
});

describe('GET /api/conversations/[id] serves sender-only deletions intact (defect 2)', () => {
    it('the recipient receives the full body, not a tombstone', async () => {
        h.getUser.mockResolvedValue({ data: { user: { id: 'auth-employer' } }, error: null });
        h.userProfile.findUnique.mockResolvedValue({ id: RECIPIENT });
        const person = { id: SENDER, supabaseId: 'auth-candidate', firstName: 'Casey', lastName: 'Seeker', company: null, role: 'job_seeker', avatarUrl: null, email: 'c@example.com', headline: null, specialties: null, licenseStates: null };
        h.conversation.findUnique.mockResolvedValue({
            id: 'conv-1', subject: 'Hello', participantA: SENDER, participantB: RECIPIENT,
            userA: person, userB: { ...person, id: RECIPIENT, firstName: 'Emma' }, job: null,
        });
        h.employerMessage.findMany.mockResolvedValue([{
            id: 'm-read', senderId: SENDER, recipientId: RECIPIENT, body: 'Reply the employer has already read',
            sentAt: new Date('2026-09-01T00:00:00Z'), readAt: new Date('2026-09-01T01:00:00Z'), editedAt: null,
            attachmentUrl: null, attachmentName: null, deletedBySender: true, deletedByRecipient: false,
            sender: { supabaseId: 'auth-candidate' },
        }]);
        h.employerMessage.updateMany.mockResolvedValue({ count: 0 });

        const res = await GET_THREAD(new NextRequest('http://localhost/api/conversations/conv-1'), { params: Promise.resolve({ id: 'conv-1' }) });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.messages).toHaveLength(1);
        expect(data.messages[0]).toMatchObject({ body: 'Reply the employer has already read', isDeleted: false });
        expect(h.employerMessage.findMany.mock.calls[0][0].where).toMatchObject(visibleToViewerWhere(RECIPIENT));
    });
});

describe('DELETE /api/conversations/[id]/messages/[messageId] (defect 2 companion)', () => {
    const call = () => DELETE_MESSAGE(
        new NextRequest('http://localhost/api/conversations/conv-1/messages/m1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'conv-1', messageId: 'm1' }) },
    );
    beforeEach(() => {
        h.getUser.mockResolvedValue({ data: { user: { id: 'auth-candidate' } }, error: null });
        h.userProfile.findUnique.mockResolvedValue({ id: SENDER });
    });

    it('a read message is deleted for the sender only', async () => {
        h.employerMessage.findUnique.mockResolvedValue({ id: 'm1', senderId: SENDER, recipientId: RECIPIENT, conversationId: 'conv-1', readAt: new Date() });
        const data = await (await call()).json();
        expect(data).toEqual({ deleted: true, deletedForBoth: false });
        expect(h.employerMessage.updateMany).not.toHaveBeenCalled();
        expect(h.employerMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deletedBySender: true } });
    });

    it('an unread message is deleted for everyone, guarded on readAt still null', async () => {
        h.employerMessage.findUnique.mockResolvedValue({ id: 'm1', senderId: SENDER, recipientId: RECIPIENT, conversationId: 'conv-1', readAt: null });
        h.employerMessage.updateMany.mockResolvedValue({ count: 1 });
        const data = await (await call()).json();
        expect(data).toEqual({ deleted: true, deletedForBoth: true });
        expect(h.employerMessage.updateMany).toHaveBeenCalledWith({
            where: { id: 'm1', readAt: null },
            data: { deletedBySender: true, deletedByRecipient: true },
        });
        expect(h.employerMessage.update).not.toHaveBeenCalled();
    });

    it('if the recipient reads it mid-delete, it falls back to sender-only', async () => {
        h.employerMessage.findUnique.mockResolvedValue({ id: 'm1', senderId: SENDER, recipientId: RECIPIENT, conversationId: 'conv-1', readAt: null });
        h.employerMessage.updateMany.mockResolvedValue({ count: 0 });
        const data = await (await call()).json();
        expect(data).toEqual({ deleted: true, deletedForBoth: false });
        expect(h.employerMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deletedBySender: true } });
    });
});

describe('POST /api/employer/messages restores a deleted thread (defect 1)', () => {
    it('the transactional conversation bump clears both deletion flags', () => {
        const src = read('app/api/employer/messages/route.ts');
        const tx = src.slice(src.indexOf('prisma.$transaction(async (tx)'), src.indexOf('const result = await sendMessage()'));
        expect(tx).toMatch(/tx\.conversation\.update\(\{[\s\S]*?data: \{[^}]*lastMessageAt: new Date\(\)[^}]*deletedByA: false[^}]*deletedByB: false[^}]*\}/);
    });
});

describe('job alerts double-submit (defect 3)', () => {
    it('server: find-or-create runs in a transaction behind a per-email advisory lock', () => {
        const src = read('app/api/job-alerts/route.ts');
        const txStart = src.indexOf('prisma.$transaction(async (tx)');
        expect(txStart).toBeGreaterThan(-1);
        const lock = src.indexOf('pg_advisory_xact_lock', txStart);
        const find = src.indexOf('tx.jobAlert.findFirst', txStart);
        const create = src.indexOf('tx.jobAlert.create', txStart);
        expect(lock).toBeGreaterThan(txStart);
        expect(find).toBeGreaterThan(lock);
        expect(create).toBeGreaterThan(find);
        // No find or create outside the locked transaction.
        expect(src).not.toMatch(/prisma\.jobAlert\.(findFirst|create)\(/);
    });

    it('client: a ref guard blocks a second submit before React re-renders', () => {
        const src = read('app/job-alerts/page.tsx');
        const handler = src.slice(src.indexOf('const handleSubmit'), src.indexOf('const isCustomLocation'));
        const guard = handler.indexOf('if (submitInFlightRef.current) return;');
        const set = handler.indexOf('submitInFlightRef.current = true;');
        const fetchAt = handler.indexOf("fetch('/api/job-alerts'");
        expect(guard).toBeGreaterThan(-1);
        expect(set).toBeGreaterThan(guard);
        expect(fetchAt).toBeGreaterThan(set);
        expect(handler.slice(handler.indexOf('finally'))).toContain('submitInFlightRef.current = false;');
    });
});
