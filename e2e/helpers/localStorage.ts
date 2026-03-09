import { Page } from '@playwright/test';

export interface StoredTrack {
  name: string;
  data: string;
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
 */
export async function seedLocalStorageNow(page: Page, tracks: StoredTrack[]): Promise<void> {
  await page.evaluate((tracksJson) => {
    localStorage.setItem('gpxUploads', tracksJson);
  }, JSON.stringify(tracks));
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
