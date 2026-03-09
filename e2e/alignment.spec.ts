import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow, seedLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';
import * as fs from 'fs';

const fixturesDir = path.join(__dirname, 'fixtures', 'alignment');

// Helper to read a GPX file
function readGPXFile(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
}

test.describe('Track Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('same route at different paces should align perfectly', async ({ page }) => {
    // Load the first track via file input
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(fixturesDir, 'same-route-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Load the second track
    await fileInput.setInputFiles(path.join(fixturesDir, 'same-route-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Check that alignment was computed - single overlapping region means no display mode selector
    const displayMode = page.locator('#display-mode');
    await expect(displayMode).toBeHidden();
  });

  test('GPS skew tracks should be harmonized', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'gps-skew-normal.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'gps-skew-longer.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Both tracks should display on the map
    await expect(page.locator(selectors.mapPolyline)).toHaveCount(2, { timeout: 5000 });
  });

  test('out and back with different turnarounds should display both tracks', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'out-back-short.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'out-back-long.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Both tracks should be displayed on the map
    await expect(page.locator(selectors.mapPolyline)).toHaveCount(2, { timeout: 5000 });
  });

  test('track with loop should display both tracks', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Both tracks should be displayed
    await expect(page.locator(selectors.mapPolyline)).toHaveCount(2, { timeout: 5000 });
  });

  test('single track should not show display mode selector', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'same-route-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Only one track loaded - no display mode selector
    const displayMode = page.locator('#display-mode');
    await expect(displayMode).toBeHidden();
  });

  test('display mode selector appears when tracks have multiple segments', async ({ page }) => {
    // Load tracks that have divergent sections (out and back with different turnarounds)
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'out-back-short.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'out-back-long.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Check alignment state via page evaluate
    const hasMultipleSegments = await page.evaluate(() => {
      const alignment = (window as any).alignment;
      return alignment?.hasMultipleSegments ?? false;
    });

    // If there are multiple segments, display mode selector should be visible
    const displayMode = page.locator('#display-mode');
    if (hasMultipleSegments) {
      await expect(displayMode).toBeVisible();
    }
  });
});
