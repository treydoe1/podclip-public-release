const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadDecideEdits() {
  const panelPath = path.join(__dirname, "..", "client", "panel.js");
  const source = fs.readFileSync(panelPath, "utf8");
  const start = source.indexOf("  function decideEdits(");
  const end = source.indexOf("\n  // ---------- handlers ----------", start);
  assert.notEqual(start, -1, "decideEdits function was not found");
  assert.notEqual(end, -1, "decideEdits function boundary was not found");
  return vm.runInNewContext("(" + source.slice(start, end).trim() + ")");
}

const decideEdits = loadDecideEdits();

function settings(overrides) {
  return Object.assign({
    speakerCount: 2,
    cameraCount: 3,
    wideFreq: "medium",
    delayCuts: 0.1,
    ignoreShort: 0.2,
    leadIn: 0,
    dbThreshold: -50,
    thresholds: { A1: -50, A2: -50 },
    tags: {
      V1_A1: true,
      V1_A2: false,
      V2_A1: false,
      V2_A2: true,
      V3_A1: true,
      V3_A2: true
    }
  }, overrides || {});
}

function constant(value, seconds) {
  return new Array(seconds * 20).fill(value);
}

function enabledCameraAtEnd(result) {
  for (const track of result.tracks) {
    if (track.segments.at(-1).enabled) return track.videoTrackIndex + 1;
  }
  return null;
}

test("silence produces one continuous fallback shot", () => {
  const result = decideEdits({ A1: constant(-120, 2), A2: constant(-120, 2) }, settings(), 2);
  assert.equal(result.eventCount, 1);
  assert.equal(result.tracks[0].segments[0].enabled, true);
  assert.equal(result.tracks[0].segments[0].startSec, 0);
  assert.equal(result.tracks[0].segments[0].endSec, 2);
});

test("an exact single-speaker tag selects that speaker camera", () => {
  const result = decideEdits({ A1: constant(-20, 2), A2: constant(-120, 2) }, settings(), 2);
  assert.equal(enabledCameraAtEnd(result), 1);
});

test("equal overlapping speakers select the exact wide camera", () => {
  const result = decideEdits({ A1: constant(-20, 2), A2: constant(-20, 2) }, settings(), 2);
  assert.equal(enabledCameraAtEnd(result), 3);
});

test("a sustained speaker change creates a deterministic camera switch", () => {
  const first = constant(-20, 2).concat(constant(-120, 2));
  const second = constant(-120, 2).concat(constant(-20, 2));
  const result = decideEdits({ A1: first, A2: second }, settings(), 4);
  assert.ok(result.eventCount >= 2);
  assert.equal(result.tracks[0].segments[0].enabled, true);
  assert.equal(enabledCameraAtEnd(result), 2);
});
