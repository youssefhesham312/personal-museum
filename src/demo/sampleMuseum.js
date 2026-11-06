import { normalizeMuseumConfig } from '../core/museumConfig.js';

/**
 * Development fixture: a complete museum that needs no storage at all.
 *
 * Open the app with `?demo=1` to walk straight into it. This exists so the
 * engine can be exercised on a device before the creator flow exists, and so
 * "does the museum render without IndexedDB?" has an obvious answer.
 */
const PHOTOS = [
  {
    file: 'photo-1.jpg',
    caption: 'The first evening we lost track of time',
    date: 'March 2021',
  },
  {
    file: 'photo-2.jpg',
    caption: 'The quiet walk home',
    date: 'June 2021',
  },
  {
    file: 'photo-3.jpg',
    caption: 'Coffee, twice, because it was raining',
    date: 'October 2022',
  },
  {
    file: 'photo-4.jpg',
    caption: 'You, mid-laugh, mid-sentence',
    date: 'January 2023',
  },
  {
    file: 'photo-5.jpg',
    caption: 'The window seat we always asked for',
    date: 'April 2024',
  },
  {
    file: 'photo-6.jpg',
    caption: 'Somewhere we said we would go back to',
    date: 'August 2025',
  },
];

const WIDTH = 1000;
const HEIGHT = 750;

export function createSampleMuseum(count = PHOTOS.length) {
  const requested = Math.max(1, Math.min(30, Math.floor(Number(count) || PHOTOS.length)));
  const photos = Array.from({ length: requested }, (_, index) => {
    const photo = PHOTOS[index % PHOTOS.length];
    const round = Math.floor(index / PHOTOS.length) + 1;
    return {
      id: `demo-${index + 1}`,
      url: `/demo/${photo.file}`,
      width: WIDTH,
      height: HEIGHT,
      caption: round > 1 ? `${photo.caption} (${round})` : photo.caption,
      date: photo.date,
    };
  });

  return normalizeMuseumConfig({
    title: 'A Museum of Small Things',
    recipient: 'Noor',
    dedication:
      'I could not put these in a drawer and call them enough.\nSo I built you a place to walk through instead.',
    finalMessage:
      'Every room here is a year, and every year is you.\n\nThank you for being the part of my life I keep going back to.',
    photos,
  });
}
