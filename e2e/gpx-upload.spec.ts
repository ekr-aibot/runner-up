import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';

test.describe('GPX Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('should upload a GPX file and display track on map', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);
    const fixturesPath = path.join(__dirname, 'fixtures', 'sample-track.gpx');

    await fileInput.setInputFiles(fixturesPath);

    // Wait for track to be processed and displayed
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Check legend is populated
    await expect(page.locator(selectors.legendContainer)).not.toBeEmpty();
  });

  test('should display track markers after upload', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));

    // Wait for map polyline and marker
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(selectors.mapMarker)).toHaveCount(1);
  });
});
