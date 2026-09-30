const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"), "utf8")
  .replace(/^#target[^\n]*\n/m, "");

function hostWith(qeTrack) {
  let clones = 0;
  const seq = { sequenceID: "source", clone() { clones++; } };
  const context = {
    app: { project: { activeSequence: seq }, enableQE() {} },
    qe: { project: { getActiveSequence() { return { getVideoTrackAt() { return qeTrack; } }; } } },
    JSON
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { panel: context.Podclip, cloneCount: () => clones };
}

test("missing QE razor stops before sequence duplication", () => {
  const host = hostWith({});
  const result = JSON.parse(host.panel.duplicateActiveSequence("source"));
  assert.equal(result.ok, false);
  assert.match(result.error, /QE video-track razor/);
  assert.equal(host.cloneCount(), 0);
});

test("available QE razor permits sequence duplication", () => {
  const host = hostWith({ razor() {} });
  const result = JSON.parse(host.panel.duplicateActiveSequence("source"));
  assert.equal(result.ok, true);
  assert.equal(host.cloneCount(), 1);
});
