let minTime = Infinity;
let maxTime = -Infinity;

// The raw GPX data we loaded in.
let data = [];

// The tracks to actually plot transformed into read-to-plot
// version.
let tracks = [];

// The individual matching segments for each track.
let segments = null;

// The map object.
let lmap = undefined;

function initializeSlider() {
  const slider = document.getElementById("time-slider");
  slider.min = minTime;
  slider.max = maxTime;
  slider.value = minTime;
  slider.step = 1; // 1 second steps

  slider.addEventListener("input", updateMarkers);
  updateMarkers(); // Call updateMarkers() immediately after initialization
}

function updateMarkers() {
  const slider = document.getElementById("time-slider");
  const currentTime = parseInt(slider.value);
  console.log(`current Time = ${currentTime}`);

  lmap.clearMarkers();
  for (let i in tracks) {
    let track = tracks[i];
    const position = getPositionAtTime(track, currentTime);
    if (position) {
      lmap.setMarker(position, i);
    }
  }

  drawGraphs(currentTime);
}

function updateTracks() {
  // TODO(ekr@rtfm.com): Handle >2 tracks.
  segments = findMatchingSegments(data[0], data[1], 0.03, 20);

  const trim_tracks = document.querySelector("#trim-tracks");
  if (segments.length > 1) {
    console.log("More than one segment");
    trim_tracks.style.display = "flex";
  } else {
    console.log("All segments match");
    trim_tracks.style.display = "none";
  }

  displayTracks();
}

function displayTracks() {
  tracks = structuredClone(data);

  if (segments.length > 1) {
    const trim_tracks = document.querySelector("#trim-tracks-checkbox");
    if (trim_tracks.checked) {
      tracks = consolidateSegments(tracks, segments);
      normalizeTracks(tracks);
    }
  } else {
    normalizeTracks(tracks);
  }
  tracks.forEach((track) => {
    track.forEach((point) => {
      point.displayDistance = point.normalizedDistance ?? point.distance;
    });
  });

  // Clean up
  lmap.clear();
  removeGraphs();

  for (i in tracks) {
    const track = tracks[i];

    minTime = Math.min(track[0].time, minTime);
    maxTime = Math.max(track[track.length - 1].time, maxTime);

    lmap.drawTrack(track);
  }
  lmap.createLegend(tracks);
  initializeSlider();
}

function removeGraphs() {
  const graphContainer = document.getElementById("graph");
  while (graphContainer.children.length) {
    graphContainer.removeChild(graphContainer.children[0]);
  }
}

function drawGraphs(currentTime) {
  removeGraphs();
  let type = document.querySelector("#compare-by-menu").value;

  drawElevationGraph(currentTime);

  if (type === "time") {
    drawDifferenceGraph(
      currentTime,
      "displayDistance",
      "time",
      "Time Behind (s)",
    );
  } else if (type === "distance") {
    drawDifferenceGraph(
      currentTime,
      "time",
      "displayDistance",
      `Distance Behind (${Units().distanceDiffUnits()})`,
      (v) => Units().distanceDiffValue(-1 * v),
    );
  }
}

function drawDifferenceGraph(
  currentTime,
  x_name,
  y_name,
  y_label,
  transform = (v) => v,
) {
  if (tracks.length < 2) {
    return;
  }

  let differences = [];
  const graphStart = minTime;
  const graphEnd = tracks.reduce(
    (a, c) => Math.min(a, c[c.length - 1].time),
    Infinity,
  );
  let comparisonTracks = tracks.slice(1);

  for (let t = graphStart; t <= graphEnd; t += 1) {
    const baseline = tracks[0][t][y_name];
    const x_value =
      x_name === "time" ? t : getValueAtPosition(tracks[0], "time", t, x_name);

    comparisonTracks.map((track) => {
      const comparator = getValueAtPosition(track, x_name, x_value, y_name);
      differences.push({
        time: t,
        diff: transform(comparator) - transform(baseline),
        trackDate: getStartDate(track),
      });
    });
  }

  const graphContainer = document.getElementById("graph");

  const chart = Plot.plot({
    width: graphContainer.clientWidth,
    marks: [
      Plot.line(differences, {
        x: "time",
        y: "diff",
        stroke: (d) => d.trackDate,
      }),
      Plot.ruleX([currentTime], { stroke: "red" }), // Vertical bar
      /*
      Plot.text([{ x: currentTime, y: 0, label: "Diff" }], {
        x: "x",
        y: "y",
        text: "label",
      }),*/
    ],
    x: {
      type: "linear",
      label: "Time (s)",
    },
    y: {
      label: y_label,
    },
  });

  graphContainer.appendChild(chart);
}

function drawElevationGraph(currentTime) {
  const graphContainer = document.getElementById("graph");
  if (tracks.length < 1) {
    return;
  }

  let marks = [
    Plot.line(tracks[0], {
      x: (d) => Units().distanceValue(d.displayDistance),
      y: (d) => Units().elevationValue(d.elevation),
    }),
  ];

  let dots = [];

  tracks.forEach((track, index) => {
    // First get the distance on this track.
    const distance = getValueAtPosition(
      track,
      "time",
      currentTime,
      "displayDistance",
    );

    // Now get the elevation on track[0];
    const elevation = getValueAtPosition(
      tracks[0],
      "displayDistance",
      distance,
      "elevation",
    );
    dots.push({
      x: Units().distanceValue(distance),
      y: Units().elevationValue(elevation),
      color: getColor(index),
    });
  });

  marks.push(
    Plot.dot(dots, {
      x: "x",
      y: "y",
      fill: (d) => d.color,
      r: 6,
    }),
  );

  const chart = Plot.plot({
    width: graphContainer.clientWidth,
    marks: marks,
    x: {
      type: "linear",
      label: `Distance (${Units().distanceUnits()})`,
    },
    y: {
      label: `Elevation (${Units().elevationUnits()})`,
    },
  });

  graphContainer.appendChild(chart);
}

function addGraphTypeListener() {
  document
    .querySelector("#compare-by-menu")
    .addEventListener("change", (_e) => {
      updateMarkers();
    });
}

function addFileListener(name) {
  const fileInput = document.getElementById(name);
  fileInput.style.opacity = 0;
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];

    if (file) {
      const reader = new FileReader();
      console.log(file);
      reader.onload = (e) => {
        const track = parseGPX(e.target.result);
        data.push(track);
        updateTracks();
      };
      reader.readAsText(file);
    }
  });
}

// Function to fetch and display a GPX track
function fetchGPXTrack(url) {
  fetch(url)
    .then((response) => response.text())
    .then((gpxData) => {
      const track = parseGPX(gpxData);
      data.push(track);
      updateTracks();
    })
    .catch((error) => console.error("Error loading GPX:", error));
}

document.addEventListener("DOMContentLoaded", () => {
  lmap = LeafletMap();

  // Set up the deploy date.
  fetch("deploy-date.txt")
    .then((response) => response.text())
    .then((v) => (document.querySelector("#deploy-date").textContent = v));

  // Check to see if we are in test mode.
  const url = new URL(window.location);
  console.log(url);
  if (url.hash == "#test") {
    console.log("Test mode");
    fetchGPXTrack("track1.gpx");
    fetchGPXTrack("track2.gpx");
  } else if (url.hash == "#test2") {
    console.log("Test2 mode");
    fetchGPXTrack("priest-kennedy.gpx");
    fetchGPXTrack("priest-sombroso.gpx");
  }

  addFileListener("track");
  addGraphTypeListener();
  document
    .querySelector("#trim-tracks-checkbox")
    .addEventListener("change", displayTracks);
});
