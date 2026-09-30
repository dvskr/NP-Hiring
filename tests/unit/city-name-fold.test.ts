/**
 * CQ-08: the state city directories fold neighborhoods, districts and parser
 * leftovers onto the city they belong to (lib/pseo/city-name-fold.ts and
 * foldDirectoryCityRows in app/jobs/locations/[state]/directory.ts).
 */
import { describe, it, expect } from 'vitest';
import { foldCityName } from '@/lib/pseo/city-name-fold';
import {
  buildStateCityDirectory,
  foldDirectoryCityRows,
  selectCityDetails,
  tallyDirectoryCities,
} from '@/app/jobs/locations/[state]/directory';

describe('foldCityName', () => {
  it('strips trailing parser punctuation ("Boston-")', () => {
    expect(foldCityName('Boston-', 'MA')).toBe('Boston');
    expect(foldCityName('South Deerfield- ', 'MA')).toBe('South Deerfield');
    expect(foldCityName(' Belmont,', 'MA')).toBe('Belmont');
  });

  it('folds a district named with its city onto the city', () => {
    expect(foldCityName('Uptown Dallas', 'TX')).toBe('Dallas');
    expect(foldCityName('Southwest Fort Worth', 'TX')).toBe('Fort Worth');
  });

  it('folds Chicago neighborhoods onto Chicago', () => {
    expect(foldCityName('Irving Park', 'IL')).toBe('Chicago');
    expect(foldCityName('Lincoln Park', 'IL')).toBe('Chicago');
    expect(foldCityName('lincoln park', 'il')).toBe('Chicago');
  });

  it('never folds a real place of the same state, or a neighborhood name in another state', () => {
    // Lincoln Park is a city in Michigan and New Jersey.
    expect(foldCityName('Lincoln Park', 'MI')).toBe('Lincoln Park');
    expect(foldCityName('Lincoln Park', 'NJ')).toBe('Lincoln Park');
    // Illinois municipalities that share a Chicago area name are not in the list.
    expect(foldCityName('Oak Park', 'IL')).toBe('Oak Park');
    expect(foldCityName('Bridgeport', 'IL')).toBe('Bridgeport');
    // Directional names that are cities of their own stay, and plain names pass through.
    expect(foldCityName('North Richland Hills', 'TX')).toBe('North Richland Hills');
    expect(foldCityName('Austin', 'TX')).toBe('Austin');
  });

  it('keeps an input that is only punctuation as it was (trimmed)', () => {
    expect(foldCityName(' - ', 'TX')).toBe('-');
  });
});

describe('foldDirectoryCityRows', () => {
  it('sums counts under the folded city and keeps the exact-spelling count for the link gate', () => {
    const rows = foldDirectoryCityRows(
      [
        { city: 'Boston', count: 3 },
        { city: 'Boston-', count: 5 },
        { city: 'Swansea', count: 3 },
      ],
      'MA',
    );
    expect(rows).toEqual(expect.arrayContaining([
      { city: 'Boston', count: 8, linkCount: 3 },
      { city: 'Swansea', count: 3, linkCount: 3 },
    ]));
    expect(rows).toHaveLength(2);
  });

  it('a city reached only through folded spellings is counted but never linked below the floor', () => {
    const rows = foldDirectoryCityRows(
      [{ city: 'Irving Park', count: 2 }, { city: 'Lincoln Park', count: 2 }],
      'IL',
    );
    expect(rows).toEqual([{ city: 'Chicago', count: 4, linkCount: 0 }]);
    const directory = buildStateCityDirectory(rows);
    expect(directory.linkable).toEqual([]);
    expect(directory.emerging.map((r) => r.city)).toEqual(['Chicago']);
  });

  it('is idempotent', () => {
    const once = foldDirectoryCityRows([{ city: 'Boston', count: 3 }, { city: 'Boston-', count: 5 }], 'MA');
    expect(foldDirectoryCityRows(once, 'MA')).toEqual(once);
  });
});

describe('the directory readers fold', () => {
  it('tallyDirectoryCities (the sitemap input) returns folded rows', () => {
    const tally = tallyDirectoryCities([
      { city: 'Chicago', state: 'Illinois', count: 17, newest: null },
      { city: 'Irving Park', state: 'Illinois', count: 1, newest: null },
      { city: 'Lincoln Park', state: 'Illinois', count: 1, newest: null },
    ]);
    expect(tally.get('Illinois')?.rows).toEqual([{ city: 'Chicago', count: 19, linkCount: 17 }]);
  });

  it('selectCityDetails groups a card under the folded city when given the state', () => {
    const details = selectCityDetails(
      [
        { city: 'Uptown Dallas', employer: 'Alpha Health', isRemote: false, isHybrid: true },
        { city: 'Dallas', employer: 'Beta Clinic', isRemote: false, isHybrid: false },
      ],
      3,
      'TX',
    );
    expect([...details.keys()]).toEqual(['Dallas']);
    expect(details.get('Dallas')?.employers).toHaveLength(2);
  });
});
