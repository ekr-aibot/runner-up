const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const assert = require("assert");

// ---------------------------------------------------------------------------
// Setup: load gpx.js into a jsdom window so DOMParser etc. are available
// ---------------------------------------------------------------------------
const gpxSource = fs.readFileSync(
  path.join(__dirname, "..", "static", "gpx.js"),
  "utf-8",
);
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost",
  runScripts: "dangerously",
});
const scriptEl = dom.window.document.createElement("script");
scriptEl.textContent = gpxSource;
dom.window.document.body.appendChild(scriptEl);

const gpx = {
  parseGPX: dom.window.parseGPX,
  findMatchingSegments: dom.window.findMatchingSegments,
  getDistanceFromPointInKm: dom.window.getDistanceFromPointInKm,
  getDistanceFromLatLonInKm: dom.window.getDistanceFromLatLonInKm,
  getPositionAtTime: dom.window.getPositionAtTime,
  getValueAtPosition: dom.window.getValueAtPosition,
  normalizeTracks: dom.window.normalizeTracks,
  consolidateSegments: dom.window.consolidateSegments,
  getStartDate: dom.window.getStartDate,
  computeDistanceForTrack: dom.window.computeDistanceForTrack,
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let failed = 0;
let passed = 0;
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n${name}`);
}

let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function skipTest(name, reason) {
  console.log(`  SKIP  ${name} (${reason})`);
  skipped++;
}

// ---------------------------------------------------------------------------
// Helpers: synthetic track generation
// ---------------------------------------------------------------------------
const DEG_PER_METER = 1 / 111000;

// Build a straight-line track heading north from a start point.
// Options:
//   count       - number of points
//   spacing     - meters between points (default 3)
//   startLat/Lon
//   sampleEvery - take every Nth point (simulates lower sample rate)
//   stop        - { at: <index>, duration: <points> } inject a stop
function makeStraightTrack(opts = {}) {
  const {
    count = 200,
    spacing = 3,
    startLat = 37.36,
    startLon = -122.24,
    sampleEvery = 1,
    stop = null,
  } = opts;

  const raw = [];
  let cumDist = 0;
  let geoIndex = 0; // geographic position index (pauses during stops)

  for (let i = 0; i < count; i++) {
    if (stop && i >= stop.at && i < stop.at + stop.duration) {
      // Stopped: GPS jitter within ~0.3m
      const jitter = (Math.sin(i * 7.3) * 0.1) * DEG_PER_METER;
      const lat = startLat + geoIndex * spacing * DEG_PER_METER + jitter;
      const lon = startLon;
      if (i > 0) cumDist += Math.abs(lat - raw[i - 1].lat) / DEG_PER_METER;
      raw.push({ lat, lon, distance: cumDist, time: i, elevation: 100 });
    } else {
      if (stop && i >= stop.at + stop.duration) {
        // After stop, resume from where we stopped
        geoIndex = stop.at + (i - stop.at - stop.duration);
      } else {
        geoIndex = i;
      }
      const lat = startLat + geoIndex * spacing * DEG_PER_METER;
      const lon = startLon;
      if (i > 0) cumDist += Math.abs(lat - raw[i - 1].lat) / DEG_PER_METER;
      raw.push({ lat, lon, distance: cumDist, time: i, elevation: 100 });
    }
  }

  // Subsample
  if (sampleEvery > 1) {
    return raw.filter((_, i) => i % sampleEvery === 0);
  }
  return raw;
}

// Build a track with a hairpin (out-and-back) at a given point.
function makeHairpinTrack(opts = {}) {
  const {
    count = 400,
    spacing = 3,
    startLat = 37.36,
    startLon = -122.24,
    hairpinAt = 150,   // index where hairpin starts
    hairpinDepth = 30,  // how many points deep the hairpin goes
    legSpacing = 10,    // meters between the two legs of the hairpin
  } = opts;

  const track = [];
  let cumDist = 0;

  for (let i = 0; i < count; i++) {
    let lat, lon;
    if (i < hairpinAt) {
      // Approach: heading north
      lat = startLat + i * spacing * DEG_PER_METER;
      lon = startLon;
    } else if (i < hairpinAt + hairpinDepth) {
      // Hairpin out-leg: heading east
      const depth = i - hairpinAt;
      lat = startLat + hairpinAt * spacing * DEG_PER_METER;
      lon = startLon + depth * spacing * DEG_PER_METER / Math.cos(startLat * Math.PI / 180);
    } else if (i < hairpinAt + hairpinDepth * 2) {
      // Hairpin return-leg: heading west, offset north by legSpacing
      const returnProgress = i - hairpinAt - hairpinDepth;
      lat = startLat + hairpinAt * spacing * DEG_PER_METER + legSpacing * DEG_PER_METER;
      lon = startLon + (hairpinDepth - returnProgress) * spacing * DEG_PER_METER / Math.cos(startLat * Math.PI / 180);
    } else {
      // After hairpin: continue north
      const afterHairpin = i - hairpinAt - hairpinDepth * 2;
      lat = startLat + (hairpinAt + afterHairpin) * spacing * DEG_PER_METER + legSpacing * DEG_PER_METER;
      lon = startLon;
    }

    if (i > 0) {
      cumDist += gpx.getDistanceFromLatLonInKm(
        track[i - 1].lat, track[i - 1].lon, lat, lon,
      ) * 1000;
    }
    track.push({ lat, lon, distance: cumDist, time: i, elevation: 100 });
  }

  return track;
}

// Add GPS noise to a track (simulates different GPS unit)
function addNoise(track, meters = 1) {
  return track.map((p, i) => {
    const noiseLat = Math.sin(i * 13.7) * meters * DEG_PER_METER;
    const noiseLon = Math.cos(i * 17.3) * meters * DEG_PER_METER;
    return { ...p, lat: p.lat + noiseLat, lon: p.lon + noiseLon };
  });
}

// ---------------------------------------------------------------------------
// Load real GPX test data (if available — these files are gitignored)
// ---------------------------------------------------------------------------
const GPX_DIR = path.join(__dirname, "..", "test_files");
const GPX_2023 = path.join(GPX_DIR, "30815-Activity_2023-08-01_08-11_73103637.gpx");
const GPX_2026 = path.join(GPX_DIR, "30815-Activity_2026-02-28_06-59_168300495.gpx");
const HAS_GPX_FILES = fs.existsSync(GPX_2023) && fs.existsSync(GPX_2026);

let track2023 = [];
let track2026 = [];
if (HAS_GPX_FILES) {
  track2023 = gpx.parseGPX(fs.readFileSync(GPX_2023, "utf-8"));
  track2026 = gpx.parseGPX(fs.readFileSync(GPX_2026, "utf-8"));
}

// ===========================================================================
console.log("GPX Test Suite");
// ===========================================================================

// ---------------------------------------------------------------------------
section("parseGPX");
// ---------------------------------------------------------------------------

if (HAS_GPX_FILES) {
  test("parses 2023 GPX file with correct point count", () => {
    assert.ok(track2023.length > 4000, `Expected >4000 points, got ${track2023.length}`);
  });

  test("parses 2026 GPX file with correct point count", () => {
    assert.ok(track2026.length > 4000, `Expected >4000 points, got ${track2026.length}`);
  });

  test("parsed points have required fields", () => {
    const p = track2023[0];
    assert.ok("lat" in p, "Missing lat");
    assert.ok("lon" in p, "Missing lon");
    assert.ok("elevation" in p, "Missing elevation");
    assert.ok("time" in p, "Missing time");
    assert.ok("distance" in p, "Missing distance");
    assert.ok("absoluteTime" in p, "Missing absoluteTime");
  });

  test("first point has time=0 and distance=0", () => {
    assert.strictEqual(track2023[0].time, 0);
    assert.strictEqual(track2023[0].distance, 0);
  });

  test("cumulative distance is monotonically non-decreasing", () => {
    for (let i = 1; i < track2023.length; i++) {
      assert.ok(
        track2023[i].distance >= track2023[i - 1].distance,
        `Distance decreased at index ${i}: ${track2023[i].distance} < ${track2023[i - 1].distance}`,
      );
    }
  });

  test("time is monotonically non-decreasing", () => {
    for (let i = 1; i < track2023.length; i++) {
      assert.ok(
        track2023[i].time >= track2023[i - 1].time,
        `Time decreased at index ${i}`,
      );
    }
  });
} else {
  skipTest("parseGPX real file tests (6)", "test_files/ not present");
}

test("returns empty array for GPX with no trackpoints", () => {
  const empty = gpx.parseGPX("<gpx><trk><trkseg></trkseg></trk></gpx>");
  assert.ok(Array.isArray(empty), "Should return an array");
  assert.strictEqual(empty.length, 0, "Should be empty");
});

// ---------------------------------------------------------------------------
section("getDistanceFromLatLonInKm");
// ---------------------------------------------------------------------------

test("same point returns 0", () => {
  const d = gpx.getDistanceFromLatLonInKm(37.36, -122.24, 37.36, -122.24);
  assert.strictEqual(d, 0);
});

test("1 degree latitude ≈ 111km", () => {
  const d = gpx.getDistanceFromLatLonInKm(0, 0, 1, 0);
  assert.ok(d > 110 && d < 112, `Expected ~111km, got ${d}`);
});

test("distance is symmetric", () => {
  const d1 = gpx.getDistanceFromLatLonInKm(37.36, -122.24, 37.77, -122.42);
  const d2 = gpx.getDistanceFromLatLonInKm(37.77, -122.42, 37.36, -122.24);
  assert.ok(Math.abs(d1 - d2) < 1e-10, "Distance should be symmetric");
});

test("SF to NYC ≈ 4130km", () => {
  const d = gpx.getDistanceFromLatLonInKm(37.77, -122.42, 40.71, -74.01);
  assert.ok(d > 4100 && d < 4200, `Expected ~4130km, got ${d.toFixed(0)}`);
});

// ---------------------------------------------------------------------------
section("getDistanceFromPointInKm");
// ---------------------------------------------------------------------------

test("delegates correctly to haversine", () => {
  const p1 = { lat: 37.36, lon: -122.24 };
  const p2 = { lat: 37.77, lon: -122.42 };
  const d1 = gpx.getDistanceFromPointInKm(p1, p2);
  const d2 = gpx.getDistanceFromLatLonInKm(p1.lat, p1.lon, p2.lat, p2.lon);
  assert.strictEqual(d1, d2);
});

// ---------------------------------------------------------------------------
section("getPositionAtTime");
// ---------------------------------------------------------------------------

test("returns null for empty track", () => {
  assert.strictEqual(gpx.getPositionAtTime(null, 5), null);
  assert.strictEqual(gpx.getPositionAtTime([], 5), null);
});

if (HAS_GPX_FILES) {
  test("returns first point for time before start", () => {
    const pos = gpx.getPositionAtTime(track2023, -10);
    assert.strictEqual(pos.lat, track2023[0].lat);
    assert.strictEqual(pos.lon, track2023[0].lon);
  });

  test("returns last point for time after end", () => {
    const lastTime = track2023[track2023.length - 1].time;
    const pos = gpx.getPositionAtTime(track2023, lastTime + 100);
    assert.strictEqual(pos.lat, track2023[track2023.length - 1].lat);
  });

  test("interpolates position at midpoint between two track points", () => {
    const t1 = track2023[100].time;
    const t2 = track2023[101].time;
    const midTime = (t1 + t2) / 2;
    const pos = gpx.getPositionAtTime(track2023, midTime);
    const minLat = Math.min(track2023[100].lat, track2023[101].lat);
    const maxLat = Math.max(track2023[100].lat, track2023[101].lat);
    assert.ok(pos.lat >= minLat - 1e-10 && pos.lat <= maxLat + 1e-10);
  });
} else {
  skipTest("getPositionAtTime real file tests (3)", "test_files/ not present");
}

// ---------------------------------------------------------------------------
section("getValueAtPosition");
// ---------------------------------------------------------------------------

test("returns null for empty track", () => {
  assert.strictEqual(gpx.getValueAtPosition(null, "distance", 100, "time"), null);
  assert.strictEqual(gpx.getValueAtPosition([], "distance", 100, "time"), null);
});

if (HAS_GPX_FILES) {
  test("clamps to first value before min position", () => {
    const val = gpx.getValueAtPosition(track2023, "distance", -10, "time");
    assert.strictEqual(val, track2023[0].time);
  });

  test("clamps to last value after max position", () => {
    const lastDist = track2023[track2023.length - 1].distance;
    const val = gpx.getValueAtPosition(track2023, "distance", lastDist + 1000, "time");
    assert.strictEqual(val, track2023[track2023.length - 1].time);
  });

  test("interpolates value at intermediate position", () => {
    const midDist = track2023[track2023.length - 1].distance / 2;
    const val = gpx.getValueAtPosition(track2023, "distance", midDist, "time");
    assert.ok(val > track2023[0].time, "Should be after start");
    assert.ok(val < track2023[track2023.length - 1].time, "Should be before end");
  });
} else {
  skipTest("getValueAtPosition real file tests (3)", "test_files/ not present");
}

// ---------------------------------------------------------------------------
section("normalizeTracks");
// ---------------------------------------------------------------------------

if (HAS_GPX_FILES) {
  test("normalizes two tracks to same total distance", () => {
    // Clone to avoid mutating originals
    const t1 = track2023.map((p) => ({ ...p }));
    const t2 = track2026.map((p) => ({ ...p }));
    gpx.normalizeTracks([t1, t2]);
    const nd1 = t1[t1.length - 1].normalizedDistance;
    const nd2 = t2[t2.length - 1].normalizedDistance;
    assert.ok(
      Math.abs(nd1 - nd2) < 1,
      `Normalized distances should match: ${nd1.toFixed(1)} vs ${nd2.toFixed(1)}`,
    );
  });

  test("normalized distance is monotonically non-decreasing", () => {
    const t = track2023.map((p) => ({ ...p }));
    gpx.normalizeTracks([t]);
    for (let i = 1; i < t.length; i++) {
      assert.ok(t[i].normalizedDistance >= t[i - 1].normalizedDistance);
    }
  });
} else {
  skipTest("normalizeTracks real file tests (2)", "test_files/ not present");
}

// ---------------------------------------------------------------------------
section("findMatchingSegments — real GPS data");
// ---------------------------------------------------------------------------

if (HAS_GPX_FILES) {
  test("same course, different GPS units: single segment (no false divergence)", () => {
    const segments = gpx.findMatchingSegments(track2023, track2026);
    assert.ok(segments !== null, "Should not be null");
    assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
  });

  test("single segment covers >99% of both tracks", () => {
    const segments = gpx.findMatchingSegments(track2023, track2026);
    const seg = segments[0];
    const t1Coverage = (seg[0][1] - seg[0][0]) / track2023.length;
    const t2Coverage = (seg[1][1] - seg[1][0]) / track2026.length;
    assert.ok(t1Coverage > 0.99, `Track 1 coverage ${(t1Coverage * 100).toFixed(1)}%`);
    assert.ok(t2Coverage > 0.99, `Track 2 coverage ${(t2Coverage * 100).toFixed(1)}%`);
  });

  test("reversed argument order: single segment", () => {
    const segments = gpx.findMatchingSegments(track2026, track2023);
    assert.ok(segments !== null);
    assert.strictEqual(segments.length, 1, `Expected 1, got ${segments.length}`);
  });

  test("identical track: single segment", () => {
    const segments = gpx.findMatchingSegments(track2023, track2023);
    assert.ok(segments !== null);
    assert.strictEqual(segments.length, 1);
  });

  test("tracks starting far apart returns null", () => {
    const far = [{ lat: 0, lon: 0, distance: 0, time: 0 }];
    const result = gpx.findMatchingSegments(track2023, far);
    assert.strictEqual(result, null);
  });
} else {
  skipTest("findMatchingSegments real GPS tests (5)", "test_files/ not present");
}

// ---------------------------------------------------------------------------
section("findMatchingSegments — hairpin turns");
// ---------------------------------------------------------------------------

test("synthetic hairpin: no false divergence", () => {
  const trackA = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 });
  const trackB = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("hairpin with different sampling rates: no false divergence", () => {
  const trackA = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 });
  // Subsample track B to every 2nd point (~2x ratio)
  const trackBFull = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 });
  const trackB = trackBFull.filter((_, i) => i % 2 === 0);
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("hairpin with GPS noise: no false divergence", () => {
  const trackA = addNoise(makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 }), 2);
  const trackB = addNoise(makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 }), 2);
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("tight hairpin (legs 5m apart): no false divergence", () => {
  const trackA = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30, legSpacing: 5 });
  const trackB = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30, legSpacing: 5 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

// ---------------------------------------------------------------------------
section("findMatchingSegments — stops");
// ---------------------------------------------------------------------------

test("stop in track1 mid-course: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 300, stop: { at: 100, duration: 50 } });
  const trackB = makeStraightTrack({ count: 300 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("stop in track2 mid-course: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 300 });
  const trackB = makeStraightTrack({ count: 300, stop: { at: 120, duration: 40 } });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("long stop (100 points) in track1: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 400, stop: { at: 100, duration: 100 } });
  const trackB = makeStraightTrack({ count: 400 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("stop near start of track: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 300, stop: { at: 10, duration: 30 } });
  const trackB = makeStraightTrack({ count: 300 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("stop near end of track: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 300, stop: { at: 250, duration: 30 } });
  const trackB = makeStraightTrack({ count: 300 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

// ---------------------------------------------------------------------------
section("findMatchingSegments — different sampling rates");
// ---------------------------------------------------------------------------

test("2x sampling rate difference: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 400 });
  const trackB = makeStraightTrack({ count: 400, sampleEvery: 2 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("3x sampling rate difference: no false divergence", () => {
  const trackA = makeStraightTrack({ count: 600 });
  const trackB = makeStraightTrack({ count: 600, sampleEvery: 3 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

// ---------------------------------------------------------------------------
section("findMatchingSegments — genuine divergence");
// ---------------------------------------------------------------------------

test("tracks that actually diverge mid-course produce multiple segments", () => {
  // Track A goes north. Track B goes north, then detours east, then returns.
  const trackA = makeStraightTrack({ count: 300 });
  const trackB = [];
  let cumDist = 0;
  for (let i = 0; i < 300; i++) {
    let lat = 37.36 + i * 3 * DEG_PER_METER;
    let lon = -122.24;
    // Detour east from index 100-150 (150m detour, well above 30m threshold)
    if (i >= 100 && i < 150) {
      lon += (i - 100) * 10 * DEG_PER_METER;
    }
    if (i > 0) {
      cumDist += gpx.getDistanceFromLatLonInKm(
        trackB[i - 1].lat, trackB[i - 1].lon, lat, lon,
      ) * 1000;
    }
    trackB.push({ lat, lon, distance: cumDist, time: i, elevation: 100 });
  }
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.ok(segments.length >= 2, `Expected >=2 segments for divergent tracks, got ${segments.length}`);
});

test("completely different tracks produce minimal matching", () => {
  const trackA = makeStraightTrack({ count: 200, startLat: 37.36, startLon: -122.24 });
  // Track B is 1km east — well outside threshold
  const trackB = makeStraightTrack({ count: 200, startLat: 37.36, startLon: -122.23 });
  const result = gpx.findMatchingSegments(trackA, trackB);
  // Should return null (start points too far apart)
  assert.strictEqual(result, null, "Tracks 1km apart should return null");
});

// ---------------------------------------------------------------------------
section("findMatchingSegments — combined edge cases");
// ---------------------------------------------------------------------------

test("hairpin with stop: no false divergence", () => {
  const trackA = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 });
  // Inject a stop into trackA right before the hairpin
  const withStop = [];
  let cumDist = 0;
  for (let i = 0; i < trackA.length; i++) {
    if (i === 140) {
      // Insert 30 stopped points
      for (let s = 0; s < 30; s++) {
        withStop.push({ ...trackA[i], distance: cumDist, time: withStop.length });
      }
    }
    if (withStop.length > 0) {
      cumDist += gpx.getDistanceFromPointInKm(
        withStop[withStop.length - 1], trackA[i],
      ) * 1000;
    }
    withStop.push({ ...trackA[i], distance: cumDist, time: withStop.length });
  }
  const trackB = makeHairpinTrack({ count: 400, hairpinAt: 150, hairpinDepth: 30 });
  const segments = gpx.findMatchingSegments(withStop, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1, `Expected 1 segment, got ${segments.length}`);
});

test("short tracks (20 points): works correctly", () => {
  const trackA = makeStraightTrack({ count: 20 });
  const trackB = makeStraightTrack({ count: 20 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1);
});

test("one track much longer than other: matches the overlap", () => {
  const trackA = makeStraightTrack({ count: 100 });
  const trackB = makeStraightTrack({ count: 300 });
  const segments = gpx.findMatchingSegments(trackA, trackB);
  assert.ok(segments !== null);
  assert.strictEqual(segments.length, 1);
  // Track A should be fully covered
  const t1Coverage = (segments[0][0][1] - segments[0][0][0]) / trackA.length;
  assert.ok(t1Coverage > 0.9, `Short track coverage: ${(t1Coverage * 100).toFixed(1)}%`);
});

// ---------------------------------------------------------------------------
section("consolidateSegments");
// ---------------------------------------------------------------------------

if (HAS_GPX_FILES) {
  test("consolidates single segment preserving all points", () => {
    const t1 = track2023.map((p) => ({ ...p }));
    const t2 = track2026.map((p) => ({ ...p }));
    const segments = [[
      [0, track2023.length - 1],
      [0, track2026.length - 1],
    ]];
    const result = gpx.consolidateSegments([t1, t2], segments);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].length, track2023.length);
    assert.strictEqual(result[1].length, track2026.length);
  });

  test("consolidates two segments, adjusting time to be contiguous", () => {
    const t1 = track2023.map((p) => ({ ...p }));
    const t2 = track2023.map((p) => ({ ...p }));
    const mid = Math.floor(track2023.length / 2);
    const segments = [
      [[0, mid], [0, mid]],
      [[mid + 10, track2023.length - 1], [mid + 10, track2023.length - 1]],
    ];
    const result = gpx.consolidateSegments([t1, t2], segments);
    assert.strictEqual(result.length, 2);
    // Time should be contiguous (no big gap from removed segment)
    const lastTimeFirstSeg = result[0][mid].time;
    const firstTimeSecondSeg = result[0][mid + 1].time;
    assert.ok(
      firstTimeSecondSeg > lastTimeFirstSeg,
      "Time should increase across segment boundary",
    );
  });
} else {
  skipTest("consolidateSegments real file tests (2)", "test_files/ not present");
}

// ---------------------------------------------------------------------------
section("computeDistanceForTrack");
// ---------------------------------------------------------------------------

test("recomputes cumulative distance from a start value", () => {
  const t = makeStraightTrack({ count: 10 }).map((p) => ({ ...p }));
  t.forEach((p) => (p.distance = 0)); // zero out distances
  gpx.computeDistanceForTrack(t, 100);
  assert.strictEqual(t[0].distance, 0); // first point unchanged
  assert.ok(t[9].distance > 100, "Last point should include start offset");
  // Should be monotonically increasing
  for (let i = 2; i < t.length; i++) {
    assert.ok(t[i].distance > t[i - 1].distance);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`${"=".repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
