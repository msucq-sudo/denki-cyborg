import { describe, expect, it } from 'vitest';
import { CUT_TOTAL } from '../level/camp2/cutscene';
import { ENDING_TOTAL } from '../level/camp2/ending';
import { movieFromSearch } from '../cinematic/movieMode';
import { MOVIE_LIST, fmtSec, movieTotal } from './movieCatalog';

describe('movie gallery catalog', () => {
  it('lists the 9 movies with shots, lengths and a play url that starts that movie', () => {
    expect(MOVIE_LIST.map((m) => m.id)).toEqual(['success', 'fail', 'drainSuccess', 'drainFail', 'drainStall', 'intro', 'ending', 'drainBoss', 'special']);
    for (const m of MOVIE_LIST) {
      expect(m.shots.length).toBeGreaterThan(3);
      expect(m.title.length).toBeGreaterThan(3);
      expect(movieFromSearch(m.url.slice(m.url.indexOf('?')))).toBe(m.id);
    }
  });
  it('keeps total lengths in sync with the scripts', () => {
    expect(movieTotal(MOVIE_LIST.find((m) => m.id === 'intro')!)).toBeCloseTo(CUT_TOTAL, 6);
    expect(movieTotal(MOVIE_LIST.find((m) => m.id === 'ending')!)).toBeCloseTo(ENDING_TOTAL, 6);
  });
  it('formats lengths', () => {
    expect(fmtSec(22.9)).toBe('23秒');
    expect(fmtSec(57.5)).toBe('58秒');
    expect(fmtSec(75)).toBe('1分15秒');
  });
});
