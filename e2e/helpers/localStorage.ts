import { Page } from '@playwright/test';

export interface StoredTrack {
  id?: string;
  name: string;
  data: string;
}

/**
 * Generate a unique ID for storage entries.
 */
function generateStorageId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Clear localStorage after page has loaded (one-time clear).
 * Use this when you need to clear storage without affecting subsequent navigations.
 */
export async function clearLocalStorageNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('gpxUploads');
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('setting:')) {
        localStorage.removeItem(key);
      }
    }
  });
}

/**
 * Seed localStorage with tracks after page has loaded.
 * Call this after page.goto(), then reload for the app to pick up the data.
 * Automatically generates IDs if not provided.
 */
export async function seedLocalStorageNow(page: Page, tracks: StoredTrack[]): Promise<void> {
  // Add IDs to tracks that don't have them
  const tracksWithIds = tracks.map((track, index) => ({
    id: track.id || generateStorageId() + index,
    name: track.name,
    data: track.data,
  }));
  await page.evaluate((tracksJson) => {
    localStorage.setItem('gpxUploads', tracksJson);
  }, JSON.stringify(tracksWithIds));
}

/**
 * Get the stored tracks from localStorage.
 */
export async function getStoredTracks(page: Page): Promise<StoredTrack[]> {
  return await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('gpxUploads') || '[]');
  });
}

/**
 * Get a setting value from localStorage.
 */
export async function getSetting(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => {
    return localStorage.getItem(`setting:${k}`);
  }, key);
}
