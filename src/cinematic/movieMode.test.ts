import { describe, expect, it } from 'vitest';
import { MOVIE_START, movieFromSearch, movieUrl, type MovieId } from './movieMode';

describe('movie-only mode url', () => {
  it('reads the movie id from the query', () => {
    expect(movieFromSearch('?level=surge&start=drive&movie=success')).toBe('success');
    expect(movieFromSearch('?movie=fail')).toBe('fail');
    expect(movieFromSearch('?level=camp2&start=intro&movie=intro')).toBe('intro');
    expect(movieFromSearch('?level=camp2&start=ending&movie=1')).toBe('ending');
    expect(movieFromSearch('?level=camp2&start=movie')).toBe('ending');
  });
  it('is off for normal play', () => {
    expect(movieFromSearch('')).toBeNull();
    expect(movieFromSearch('?level=camp2&start=boss')).toBeNull();
    expect(movieFromSearch('?level=surge&start=drive')).toBeNull();
    expect(movieFromSearch('?movie=bogus')).toBeNull();
  });
  it('every movie url round-trips to its own id', () => {
    for (const id of Object.keys(MOVIE_START) as MovieId[]) {
      expect(movieFromSearch(movieUrl(id).slice(movieUrl(id).indexOf('?')))).toBe(id);
    }
  });
});
