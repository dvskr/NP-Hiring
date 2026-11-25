/**
 * A visitor can fill the /post-job form signed out (2026-11-25), so the copy
 * in the browser and an account's server draft can disagree. These pin the
 * rule that the newer work wins, so logging in never discards what was just
 * typed, and that an empty or broken browser copy never beats a real server
 * draft.
 */
import { describe, it, expect } from 'vitest';
import {
  LOCAL_DRAFT_KEY,
  LOCAL_DRAFT_SAVED_AT_KEY,
  deviceDraftIsNewer,
  localDraftSavedAt,
} from '@/app/post-job/_lib/local-job-draft';
import { hasMeaningfulDraftContent } from '@/app/post-job/_lib/draft-hydration';

function storageWith(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key: string) => (key in values ? values[key] : null) };
}

const T_LOCAL = '2026-11-25T10:00:00.000Z';
const filled = JSON.stringify({ title: 'Family Nurse Practitioner', companyName: 'Clinic' });

describe('hasMeaningfulDraftContent', () => {
  it('counts a title, a company or a description with visible text', () => {
    expect(hasMeaningfulDraftContent({ title: 'Family NP' })).toBe(true);
    expect(hasMeaningfulDraftContent({ companyName: 'Clinic' })).toBe(true);
    expect(hasMeaningfulDraftContent({ description: '<p>Outpatient role</p>' })).toBe(true);
  });

  it('does not count blank fields or markup with no text', () => {
    expect(hasMeaningfulDraftContent(null)).toBe(false);
    expect(hasMeaningfulDraftContent({})).toBe(false);
    expect(hasMeaningfulDraftContent({ title: '   ', description: '<p> </p>' })).toBe(false);
  });

  it('does not count the space "Write from scratch" puts in the editor', () => {
    expect(hasMeaningfulDraftContent({ description: '<p>&nbsp;</p>' })).toBe(false);
    expect(hasMeaningfulDraftContent({ description: '<p>&NBSP;&nbsp;</p>', pricingTier: 'pro' })).toBe(false);
  });
});

describe('localDraftSavedAt', () => {
  it('reads the keys the wizard, the preview and the checkout share', () => {
    expect(LOCAL_DRAFT_KEY).toBe('jobFormData');
    expect(LOCAL_DRAFT_SAVED_AT_KEY).not.toBe(LOCAL_DRAFT_KEY);
  });

  it('returns the stamp of a meaningful browser copy', () => {
    const storage = storageWith({ [LOCAL_DRAFT_KEY]: filled, [LOCAL_DRAFT_SAVED_AT_KEY]: T_LOCAL });
    expect(localDraftSavedAt(storage)).toBe(Date.parse(T_LOCAL));
  });

  it('ignores a stamp when the copy is empty, missing or not JSON', () => {
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_SAVED_AT_KEY]: T_LOCAL }))).toBeNull();
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_KEY]: '{}', [LOCAL_DRAFT_SAVED_AT_KEY]: T_LOCAL }))).toBeNull();
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_KEY]: 'null', [LOCAL_DRAFT_SAVED_AT_KEY]: T_LOCAL }))).toBeNull();
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_KEY]: '{not json', [LOCAL_DRAFT_SAVED_AT_KEY]: T_LOCAL }))).toBeNull();
  });

  it('ignores a stamp on a copy that holds only the "Write from scratch" space', () => {
    const scratch = JSON.stringify({ description: '<p>&nbsp;</p>', pricingTier: 'pro' });
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_KEY]: scratch, [LOCAL_DRAFT_SAVED_AT_KEY]: T_LOCAL }))).toBeNull();
  });

  it('returns null for a copy with no usable stamp, and never throws', () => {
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_KEY]: filled }))).toBeNull();
    expect(localDraftSavedAt(storageWith({ [LOCAL_DRAFT_KEY]: filled, [LOCAL_DRAFT_SAVED_AT_KEY]: 'yesterday' }))).toBeNull();
    const broken = { getItem: () => { throw new Error('storage disabled'); } };
    expect(localDraftSavedAt(broken)).toBeNull();
  });
});

describe('deviceDraftIsNewer', () => {
  const local = Date.parse(T_LOCAL);

  it('keeps the browser copy when it changed after the server draft was saved', () => {
    expect(deviceDraftIsNewer(local, '2026-11-24T09:00:00.000Z')).toBe(true);
  });

  it('keeps the server draft when it is the newer one', () => {
    expect(deviceDraftIsNewer(local, '2026-11-25T11:00:00.000Z')).toBe(false);
  });

  it('keeps the server draft when both were saved at the same instant', () => {
    expect(deviceDraftIsNewer(local, T_LOCAL)).toBe(false);
  });

  it('keeps the server draft when there is no meaningful browser copy', () => {
    expect(deviceDraftIsNewer(null, '2026-11-24T09:00:00.000Z')).toBe(false);
    expect(deviceDraftIsNewer(null, undefined)).toBe(false);
  });

  it('keeps the browser copy when the server draft has no usable time', () => {
    expect(deviceDraftIsNewer(local, undefined)).toBe(true);
    expect(deviceDraftIsNewer(local, 'not a date')).toBe(true);
  });
});
