import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow, seedLocalStorageNow, getStoredTracks } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');
const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');

test.describe('Saved Tracks Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('should save uploaded track to localStorage', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Check localStorage has the track
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('track1.gpx');
    expect(stored[0].data).toContain('<gpx');
  });

  test('should populate dropdown with saved tracks', async ({ page }) => {
    // Seed localStorage with tracks
    await seedLocalStorageNow(page, [
      { name: 'track1.gpx', data: track1Data },
      { name: 'track2.gpx', data: track2Data },
    ]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    const options = dropdown.locator('option');

    // Should have placeholder + 2 tracks = 3 options
    await expect(options).toHaveCount(3);
    await expect(options.nth(1)).toHaveText('track1.gpx');
    await expect(options.nth(2)).toHaveText('track2.gpx');
  });

  test('should load track when selected from dropdown', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption('track1.gpx');

    // Track should be displayed on map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(selectors.legendContainer)).toContainText('Date:');
  });

  test('should add uploaded track to dropdown', async ({ page }) => {
    const dropdown = page.locator(selectors.savedTracksDropdown);
    const fileInput = page.locator(selectors.fileInput);

    // Initially just placeholder
    await expect(dropdown.locator('option')).toHaveCount(1);

    // Upload a track
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Dropdown should now have placeholder + new track
    await expect(dropdown.locator('option')).toHaveCount(2);
    await expect(dropdown.locator('option').nth(1)).toHaveText('track1.gpx');
  });

  test('should prevent loading duplicate tracks', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Load track first time
    await dropdown.selectOption('track1.gpx');
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Set up dialog handler for duplicate alert
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('already loaded');
      await dialog.accept();
    });

    // Try to load same track again
    await dropdown.selectOption('track1.gpx');

    // Should still have only 1 track
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1);
  });

  test('should remove track from display on delete click', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption('track1.gpx');
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Click delete button (normal click - removes from view only)
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click();

    // Track should be removed from map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // But track should still be in localStorage
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(1);
  });

  test('should delete track permanently on Shift+click', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption('track1.gpx');
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Set up dialog handler for confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Shift+click delete button - permanently deletes
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click({ modifiers: ['Shift'] });

    // Track should be removed from map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Track should be removed from localStorage
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(0);

    // Track should be removed from dropdown
    await expect(dropdown.locator('option')).toHaveCount(1); // Only placeholder
  });

  test('should persist tracks across page reload', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Upload a track
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Reload page
    await page.reload();

    // Map should be empty (no auto-load)
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // But dropdown should have the track
    const dropdown = page.locator(selectors.savedTracksDropdown);
    await expect(dropdown.locator('option')).toHaveCount(2);

    // Can load track from dropdown
    await dropdown.selectOption('track1.gpx');
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
  });
});
