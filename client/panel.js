/*
 * Podclip — panel logic.
 *
 * Wires the UI to:
 *   1. host.jsx (via CSInterface.evalScript) for sequence read + edit write
 *   2. analyzer.js (via Node child_process) for ffmpeg dB curves
 *   3. the cut-decision algorithm (below)
 *
 * Phase 1 flow when "Build Speaker Cut" is clicked:
 *   - read sequence info from host
 *   - validate that required A/V lanes exist
 *   - run ffmpeg per audio track to build dB curves
 *   - run cut algorithm to produce per-video-track segment lists
 *   - send EDL back to host to razor + toggle
 */

(function () {
  var CONTROLLER_BUILD = "0.1.11";
  var cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;
  var inPremiere = cs && typeof window.__adobe_cep__ !== "undefined";

  // ---------- logging ----------
  var logEl = document.getElementById("log");
  var logCard = document.getElementById("logCard");
  var toggleLogBtn = document.getElementById("toggleLog");
  var clearLogBtn = document.getElementById("clearLog");
  var progressPanel = document.getElementById("progressPanel");
  var progressFill = document.getElementById("progressFill");
  var progressLabel = document.getElementById("progressLabel");
  var progressPct = document.getElementById("progressPct");
  var lastSequenceInfo = null;
  function log(msg, kind) {
    var span = document.createElement("span");
    if (kind) span.className = kind;
    span.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg + "\n";
    logEl.appendChild(span);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(percent, label, visible) {
    var pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
    progressFill.style.width = pct + "%";
    progressPct.textContent = pct + "%";
    progressLabel.textContent = label || "Working...";
    if (visible === false) progressPanel.className = "progress-card";
    else progressPanel.className = "progress-card active";
  }

  function finishProgress(label, kind) {
    setProgress(100, label || "Done", true);
    window.setTimeout(function () {
      progressPanel.className = "progress-card";
      if (kind === "err") setProgress(0, "Ready", false);
    }, 1400);
  }

  toggleLogBtn.addEventListener("click", function () {
    var hidden = logCard.className.indexOf("is-hidden") !== -1;
    logCard.className = hidden ? "card log-card" : "card log-card is-hidden";
  });

  clearLogBtn.addEventListener("click", function () {
    logEl.innerHTML = "";
  });

  // ---------- settings ----------
  function getSettings() {
    return {
      speakerCount: parseInt(document.getElementById("speakerCount").value, 10),
      cameraCount: parseInt(document.getElementById("cameraCount").value, 10),
      wideFreq: document.getElementById("wideFreq").value,
      delayCuts: parseFloat(document.getElementById("delayCuts").value),
      ignoreShort: parseFloat(document.getElementById("ignoreShort").value),
      leadIn: parseFloat(document.getElementById("leadIn").value),
      dbThreshold: parseFloat(document.getElementById("dbThreshold").value),
      speakerNames: readSpeakerNames(),
      thresholds: readThresholdGrid(),
      tags: readTagGrid()
    };
  }

  function bindSliderOutput(id, suffix, fmt) {
    var el = document.getElementById(id);
    var out = document.getElementById(id + "Out");
    function update() { out.textContent = fmt(parseFloat(el.value)) + suffix; }
    el.addEventListener("input", update);
    update();
  }
  bindSliderOutput("delayCuts",   " s",  function (v) { return v.toFixed(2); });
  bindSliderOutput("ignoreShort", " s",  function (v) { return v.toFixed(2); });
  bindSliderOutput("leadIn",      " s",  function (v) { return v.toFixed(2); });
  bindSliderOutput("dbThreshold", " dB", function (v) { return v.toFixed(0); });

  function enhanceSelect(id, labelMode) {
    var select = document.getElementById(id);
    var group = document.createElement("div");
    group.className = "segmented-control segmented-" + id;
    group.setAttribute("role", "group");

    function buttonLabel(option) {
      if (labelMode === "value") return option.value;
      return option.text.replace(/\s+Speakers?|\s+Cameras?/g, "");
    }

    function sync() {
      var buttons = group.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].className = buttons[i].dataset.value === select.value ? "active" : "";
      }
    }

    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.value = option.value;
      btn.textContent = buttonLabel(option);
      btn.addEventListener("click", function () {
        select.value = this.dataset.value;
        sync();
        var event = document.createEvent("HTMLEvents");
        event.initEvent("change", true, false);
        select.dispatchEvent(event);
      });
      group.appendChild(btn);
    }

    select.className += " native-select";
    select.parentNode.appendChild(group);
    select.addEventListener("change", sync);
    sync();
  }
  enhanceSelect("speakerCount", "value");
  enhanceSelect("cameraCount", "value");
  enhanceSelect("wideFreq", "text");

  // ---------- dynamic speaker names + Tag Speakers grid ----------
  function speakerLabel(index, names) {
    var key = "A" + index;
    var name = names && names[key] ? names[key] : "";
    return name ? name + " (" + key + ")" : key;
  }

  function renderSpeakerNameGrid() {
    var nSpk = parseInt(document.getElementById("speakerCount").value, 10);
    var existing = readSpeakerNames();
    var grid = document.getElementById("speakerNameGrid");
    grid.innerHTML = "";
    for (var s = 1; s <= nSpk; s++) {
      var key = "A" + s;
      var row = document.createElement("label");
      row.className = "speaker-name-row";

      var label = document.createElement("span");
      label.textContent = key + ":";

      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Enter name...";
      input.dataset.spk = key;
      input.value = existing[key] || "";
      input.addEventListener("input", renderTagGrid);

      row.appendChild(label);
      row.appendChild(input);
      grid.appendChild(row);
    }
  }

  function readSpeakerNames() {
    var grid = document.getElementById("speakerNameGrid");
    var names = {};
    if (!grid) return names;
    var inputs = grid.querySelectorAll("input[type=text]");
    for (var i = 0; i < inputs.length; i++) {
      names[inputs[i].dataset.spk] = inputs[i].value.replace(/^\s+|\s+$/g, "");
    }
    return names;
  }

  function renderTagGrid() {
    var nSpk = parseInt(document.getElementById("speakerCount").value, 10);
    var nCam = parseInt(document.getElementById("cameraCount").value, 10);
    var names = readSpeakerNames();
    var grid = document.getElementById("tagGrid");
    var existing = readTagGrid();
    grid.innerHTML = "";
    for (var c = 1; c <= nCam; c++) {
      var row = document.createElement("div");
      row.className = "tag-row";

      var label = document.createElement("span");
      label.className = "tag-label";
      label.textContent = "V" + c;
      row.appendChild(label);

      var dropdown = document.createElement("div");
      dropdown.className = "speaker-select";
      var button = document.createElement("button");
      button.type = "button";
      button.className = "speaker-select-button";
      var menu = document.createElement("div");
      menu.className = "speaker-select-menu";

      function updateButtonText(btn, menuEl) {
        var selected = [];
        var inputs = menuEl.querySelectorAll("input[type=checkbox]");
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].checked) selected.push(speakerLabel(parseInt(inputs[i].dataset.spk, 10), names));
        }
        btn.textContent = selected.length ? selected.join(", ") : "Select speakers...";
      }

      button.addEventListener("click", function () {
        var host = this.parentNode;
        var isOpen = host.className.indexOf(" open") !== -1;
        closeSpeakerMenus();
        host.className = isOpen ? "speaker-select" : "speaker-select open";
      });

      for (var s = 1; s <= nSpk; s++) {
        var key = "V" + c + "_A" + s;
        var defaultChecked = (c === s) || (c > nSpk); // V1=A1, V2=A2 by default; "extra" cams default to all
        var cb = document.createElement("label");
        var input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.cam = c;
        input.dataset.spk = s;
        input.checked = (existing[key] !== undefined) ? existing[key] : defaultChecked;
        cb.className = input.checked ? "checked" : "";
        input.addEventListener("change", function () {
          this.parentNode.className = this.checked ? "checked" : "";
          updateButtonText(this.parentNode.parentNode.parentNode.querySelector(".speaker-select-button"), this.parentNode.parentNode);
        });
        var sp = document.createElement("span");
        sp.textContent = speakerLabel(s, names);
        cb.appendChild(input);
        cb.appendChild(sp);
        menu.appendChild(cb);
      }
      dropdown.appendChild(button);
      dropdown.appendChild(menu);
      row.appendChild(dropdown);
      grid.appendChild(row);
      updateButtonText(button, menu);
    }
  }

  function readTagGrid() {
    var grid = document.getElementById("tagGrid");
    if (!grid) return {};
    var inputs = grid.querySelectorAll("input[type=checkbox]");
    var map = {};
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      map["V" + inp.dataset.cam + "_A" + inp.dataset.spk] = inp.checked;
    }
    return map;
  }

  function closeSpeakerMenus() {
    var menus = document.querySelectorAll(".speaker-select.open");
    for (var i = 0; i < menus.length; i++) menus[i].className = "speaker-select";
  }

  document.addEventListener("click", function (event) {
    var node = event.target;
    while (node) {
      if (node.className && typeof node.className === "string" && node.className.indexOf("speaker-select") !== -1) return;
      node = node.parentNode;
    }
    closeSpeakerMenus();
  });

  document.getElementById("speakerCount").addEventListener("change", function () {
    renderSpeakerNameGrid();
    renderTagGrid();
  });
  document.getElementById("cameraCount").addEventListener("change", renderTagGrid);
  renderSpeakerNameGrid();
  renderTagGrid();

  // ---------- dynamic per-mic thresholds ----------
  function renderThresholdGrid(forceReset) {
    var nSpk = parseInt(document.getElementById("speakerCount").value, 10);
    var base = parseFloat(document.getElementById("dbThreshold").value);
    var existing = forceReset ? {} : readThresholdGrid();
    var grid = document.getElementById("thresholdGrid");
    grid.innerHTML = "";
    for (var s = 1; s <= nSpk; s++) {
      var name = "A" + s;
      var value = (existing[name] !== undefined) ? existing[name] : base;
      var row = document.createElement("label");
      row.className = "slider threshold-row";
      var label = document.createElement("span");
      label.textContent = name;
      var input = document.createElement("input");
      input.type = "range";
      input.min = "-60";
      input.max = "-10";
      input.step = "1";
      input.value = String(value);
      input.dataset.spk = name;
      var output = document.createElement("output");
      function bind(inp, out) {
        function update() { out.textContent = parseFloat(inp.value).toFixed(0) + " dB"; }
        inp.addEventListener("input", update);
        update();
      }
      bind(input, output);
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(output);
      grid.appendChild(row);
    }
  }

  function readThresholdGrid() {
    var grid = document.getElementById("thresholdGrid");
    var values = {};
    if (!grid) return values;
    var inputs = grid.querySelectorAll("input[type=range]");
    for (var i = 0; i < inputs.length; i++) {
      values[inputs[i].dataset.spk] = parseFloat(inputs[i].value);
    }
    return values;
  }

  document.getElementById("speakerCount").addEventListener("change", function () {
    renderThresholdGrid(false);
  });
  document.getElementById("dbThreshold").addEventListener("input", function () {
    renderThresholdGrid(true);
  });
  document.getElementById("resetThresholds").addEventListener("click", function () {
    renderThresholdGrid(true);
  });
  renderThresholdGrid(false);

  // ---------- host bridge ----------
  function callHost(fn, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!inPremiere) return reject(new Error("Not running inside Premiere."));
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("Premiere did not respond. Try clicking the timeline you want, then run Podclip again."));
      }, timeoutMs || 180000);
      cs.evalScript(fn, function (result) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (typeof result !== "string") return reject(new Error("Host returned non-string."));
        if (result.indexOf("EvalScript error") === 0) return reject(new Error(result));
        resolve(result);
      });
    });
  }

  function summarizeCurve(curve, threshold) {
    var max = -120;
    var sum = 0;
    var count = 0;
    var hot = 0;
    for (var i = 0; i < curve.length; i++) {
      var v = curve[i];
      if (!isFinite(v)) v = -120;
      if (v > max) max = v;
      sum += v;
      count++;
      if (v > threshold) hot++;
    }
    return {
      max: max,
      avg: count ? sum / count : -120,
      hotPct: count ? (hot / count) * 100 : 0
    };
  }

  // ---------- cut-decision algorithm ----------
  /*
   * Inputs:
   *   curves     - { "A1": [dB, dB, ...], "A2": [...] }     (parallel arrays)
   *   settings   - getSettings() output
   *   nSpk, nCam - counts
   *
   * Output:
   *   { tracks: [ { videoTrackIndex: 0, segments: [...] }, ... ] }
   *
   *   Each segment has { startSec, endSec, enabled }. For each video track we
   *   emit a continuous timeline of segments covering [0, totalDuration],
   *   with `enabled=true` for the segments where that camera is the active
   *   one and `enabled=false` for the rest.
   */
  function decideEdits(curves, settings, totalDurationSec) {
    var SAMPLE_MS = 50;
    var samplesPerSec = 1000 / SAMPLE_MS;
    var sampleCount = Math.floor(totalDurationSec * samplesPerSec);

    var nSpk = settings.speakerCount;
    var nCam = settings.cameraCount;

    // Build list of camera tag-sets.
    var camTags = []; // [{ cam: 1, set: Set('A1','A2') }, ...]
    for (var c = 1; c <= nCam; c++) {
      var set = {};
      for (var s = 1; s <= nSpk; s++) {
        if (settings.tags["V" + c + "_A" + s]) set["A" + s] = true;
      }
      camTags.push({ cam: c, set: set, size: Object.keys(set).length });
    }

    function setKey(set) {
      var keys = Object.keys(set);
      keys.sort();
      return keys.join(",");
    }
    function isSuperset(a, b) {
      for (var k in b) if (!a[k]) return false;
      return true;
    }
    function pickCamera(activeSet, allowMulti) {
      var activeSize = Object.keys(activeSet).length;
      if (activeSize === 0) return null;
      // 1. Exact match.
      var k = setKey(activeSet);
      for (var i = 0; i < camTags.length; i++) {
        if (setKey(camTags[i].set) === k) return camTags[i].cam;
      }
      // 2. Superset.
      var bestSuper = null;
      for (i = 0; i < camTags.length; i++) {
        if (camTags[i].size >= activeSize && isSuperset(camTags[i].set, activeSet)) {
          if (!bestSuper || camTags[i].size < bestSuper.size) bestSuper = camTags[i];
        }
      }
      if (bestSuper) return bestSuper.cam;
      // 3. Single-speaker fallback if we were forced to allow only singles:
      //    pick the loudest speaker's single-speaker camera (caller handles).
      return null;
    }

    // Pre-collect single-speaker camera lookups for "wide off" fallback.
    var singleSpeakerCam = {};
    for (var i = 0; i < camTags.length; i++) {
      var keys = Object.keys(camTags[i].set);
      if (keys.length === 1) singleSpeakerCam[keys[0]] = camTags[i].cam;
    }

    function loudestSpeaker(t) {
      var best = null, bestDb = -Infinity;
      for (var s = 1; s <= nSpk; s++) {
        var curve = curves["A" + s];
        var v = curve ? (curve[t] !== undefined ? curve[t] : -120) : -120;
        if (v > bestDb) { bestDb = v; best = "A" + s; }
      }
      return best;
    }

    function dominantSet(qualifiedSet, t) {
      var keys = Object.keys(qualifiedSet);
      if (keys.length <= 1) return qualifiedSet;

      var best = null;
      var bestDb = -Infinity;
      var secondDb = -Infinity;
      for (var i = 0; i < keys.length; i++) {
        var curve = curves[keys[i]];
        var v = curve ? (curve[t] !== undefined ? curve[t] : -120) : -120;
        if (v > bestDb) {
          secondDb = bestDb;
          bestDb = v;
          best = keys[i];
        } else if (v > secondDb) {
          secondDb = v;
        }
      }

      // If one mic is clearly louder, treat bleed on other mics as spill.
      if (best && bestDb - secondDb >= 6) {
        var only = {};
        only[best] = true;
        return only;
      }
      return qualifiedSet;
    }

    // ---------- main loop ----------
    var delayCutsSamples = Math.round(settings.delayCuts * samplesPerSec);
    var attackSamples = Math.max(1, Math.round(settings.ignoreShort * samplesPerSec));
    var releaseSamples = Math.round(0.45 * samplesPerSec);
    var minShotSamples = Math.round(0.75 * samplesPerSec);
    var leadInSamples = Math.round(settings.leadIn * samplesPerSec);
    var defaultThresh = settings.dbThreshold;

    // Attack/release envelope:
    // - attack requires a short sustained start before a speaker can take focus
    // - release keeps a speaker alive through breaths, laughs, and tiny waveform gaps
    var attackCounts = {};
    var releaseCounts = {};
    var activeLatch = {};
    for (var s = 1; s <= nSpk; s++) {
      attackCounts["A" + s] = 0;
      releaseCounts["A" + s] = 0;
      activeLatch["A" + s] = false;
    }

    var currentCam = null;
    var candidate = null;
    var candidateSince = -1;
    var events = []; // { sample, cam }

    for (var t = 0; t < sampleCount; t++) {
      // Update hold counts.
      var qualifiedSet = {};
      for (var s = 1; s <= nSpk; s++) {
        var dB = curves["A" + s] ? (curves["A" + s][t] !== undefined ? curves["A" + s][t] : -120) : -120;
        var thresh = (settings.thresholds && settings.thresholds["A" + s] !== undefined)
          ? settings.thresholds["A" + s]
          : defaultThresh;
        var key = "A" + s;
        if (dB > thresh) {
          attackCounts[key] += 1;
          releaseCounts[key] = releaseSamples;
          if (attackCounts[key] >= attackSamples) activeLatch[key] = true;
        } else {
          attackCounts[key] = 0;
          if (releaseCounts[key] > 0) {
            releaseCounts[key] -= 1;
          } else {
            activeLatch[key] = false;
          }
        }
        if (activeLatch[key]) {
          qualifiedSet[key] = true;
        }
      }

      var decisionSet = dominantSet(qualifiedSet, t);
      var allowMulti = (settings.wideFreq !== "off") && Object.keys(decisionSet).length >= 2;
      var bestCam;
      if (Object.keys(decisionSet).length === 0) {
        bestCam = currentCam; // no one qualified → hold
      } else if (settings.wideFreq === "off" && Object.keys(decisionSet).length >= 2) {
        // wide off + 2+ hot → hold previous shot
        bestCam = currentCam;
      } else {
        bestCam = pickCamera(decisionSet, allowMulti);
        if (bestCam === null) {
          // No camera covers this set. Fall back to loudest single-speaker.
          var loud = loudestSpeaker(t);
          bestCam = loud ? singleSpeakerCam[loud] || currentCam : currentCam;
        }
      }

      if (bestCam === null) bestCam = currentCam;

      if (bestCam === currentCam) {
        candidate = null;
        candidateSince = -1;
        continue;
      }

      if (candidate !== bestCam) {
        candidate = bestCam;
        candidateSince = t;
        continue;
      }

      // candidate has been the proposed camera for some samples now
      if ((t - candidateSince) >= delayCutsSamples &&
          (currentCam === null || (t - lastEventSample(events)) >= minShotSamples)) {
        var cutAt = Math.max(0, t - leadInSamples);
        events.push({ sample: cutAt, cam: candidate });
        currentCam = candidate;
        candidate = null;
        candidateSince = -1;
      }
    }

    events = smoothEvents(events, minShotSamples);

    // First event covers from 0; if first event isn't at sample 0, prepend
    // a holding event that starts on whatever camera the first event picks.
    if (events.length === 0) {
      events.push({ sample: 0, cam: 1 });
    } else if (events[0].sample > 0) {
      events.unshift({ sample: 0, cam: events[0].cam });
    }

    // Convert events → per-camera segments (enabled / disabled).
    var trackSegments = {};
    for (var c = 1; c <= nCam; c++) trackSegments[c] = [];
    for (var e = 0; e < events.length; e++) {
      var startSample = events[e].sample;
      var endSample = (e + 1 < events.length) ? events[e + 1].sample : sampleCount;
      var startSec = startSample / samplesPerSec;
      var endSec = endSample / samplesPerSec;
      for (var c = 1; c <= nCam; c++) {
        trackSegments[c].push({
          startSec: startSec,
          endSec: endSec,
          enabled: (events[e].cam === c)
        });
      }
    }

    // Build payload using video track index = c-1 (V1 → videoTrackIndex 0).
    var tracks = [];
    for (var c = 1; c <= nCam; c++) {
      tracks.push({
        videoTrackIndex: c - 1,
        segments: trackSegments[c]
      });
    }
    return { tracks: tracks, eventCount: events.length };

    function lastEventSample(list) {
      return list.length ? list[list.length - 1].sample : 0;
    }

    function smoothEvents(input, minSamples) {
      if (input.length < 3) return input;
      var out = input.slice();
      var changed = true;
      while (changed) {
        changed = false;
        for (var i = 1; i < out.length - 1; i++) {
          var dur = out[i + 1].sample - out[i].sample;
          if (dur > 0 && dur < minSamples) {
            out.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      return out;
    }
  }

  // ---------- handlers ----------
  document.getElementById("checkSequence").addEventListener("click", function () {
    if (!inPremiere) {
      log("Not running inside Premiere — open this panel via Window > Extensions > Podclip.", "warn");
      return;
    }
    log("Reading active sequence...", "info");
    setProgress(12, "Checking active sequence...", true);
    callHost("Podclip.getSequenceSummary()", 30000).then(function (json) {
      var info;
      try { info = JSON.parse(json); }
      catch (e) { return log("Bad host response: " + json, "err"); }
      if (!info.ok) return log("Host: " + info.error, "err");
      lastSequenceInfo = info;
      renderSpeakerNameGrid();
      log("Sequence: " + info.name + " @ " + info.fps.toFixed(3) + " fps", "ok");
      log("Audio tracks: " + info.audioTracks.map(function (t) { return "A" + (t.index + 1); }).join(", "));
      log("Video tracks: " + info.videoTracks.map(function (t) { return "V" + (t.index + 1); }).join(", "));
      finishProgress("Sequence verified", "ok");
    }).catch(function (e) {
      log(e.message, "err");
      finishProgress("Check failed", "err");
    });
  });

  document.getElementById("createEdit").addEventListener("click", function () {
    if (!inPremiere) {
      log("Not running inside Premiere — open via Window > Extensions > Podclip.", "warn");
      return;
    }
    var btn = this;
    btn.disabled = true;

    var settings = getSettings();
    log("Starting speaker cut. Voice lanes=" + settings.speakerCount + " Video angles=" + settings.cameraCount, "info");
    setProgress(3, "Starting speaker cut...", true);

    if (!window.PodclipAnalyzer) {
      log("Analyzer not loaded.", "err");
      finishProgress("Analyzer missing", "err");
      btn.disabled = false;
      return;
    }

    window.PodclipAnalyzer.checkFfmpeg().then(function (chk) {
      setProgress(8, "Checking ffmpeg...", true);
      if (!chk.ok) {
        if (chk.tried && chk.tried.length) log("ffmpeg lookup tried: " + chk.tried.join(" | "), "warn");
        throw new Error(chk.error);
      }
      log("ffmpeg found: " + chk.path, "ok");
      setProgress(14, "Locking source sequence...", true);
      return callHost("Podclip.getSequenceInfo()");
    }).then(function (json) {
      var info = JSON.parse(json);
      if (!info.ok) throw new Error(info.error);
      if (!info.sequenceID) throw new Error("Premiere did not provide a sequence ID. Podclip stopped before making changes.");
      log("Source sequence locked: " + info.name, "ok");
      setProgress(20, "Source sequence locked", true);

      // Premiere exposes track header names, but Podclip addresses timeline
      // audio tracks by lane: A1, A2, A3, ...
      var missing = [];
      var audioBySpeaker = {};
      for (var s = 1; s <= settings.speakerCount; s++) {
        var speakerKey = "A" + s;
        var assignedTrack = info.audioTracks[s - 1];
        if (!assignedTrack) missing.push(speakerKey);
        else audioBySpeaker[speakerKey] = assignedTrack;
      }
      if (missing.length) {
        throw new Error("Audio tracks missing for: " + missing.join(", ") +
                        ". Add matching Premiere audio lanes for each speaker.");
      }
      if (info.videoTracks.length < settings.cameraCount) {
        throw new Error("Video tracks missing: expected V1 through V" + settings.cameraCount +
                        ", but the sequence only has " + info.videoTracks.length + " video track(s).");
      }

      // Sequence duration = max clip end across all tracks.
      var totalDur = 0;
      info.audioTracks.concat(info.videoTracks).forEach(function (t) {
        t.clips.forEach(function (c) { if (c.endSec > totalDur) totalDur = c.endSec; });
      });
      log("Sequence duration: " + totalDur.toFixed(2) + " s");

      // Analyze each speaker's track.
      log("Analyzing audio with ffmpeg...", "info");
      var curves = {};
      var seq = Promise.resolve();
      for (var s = 1; s <= settings.speakerCount; s++) {
        (function (s) {
          var name = "A" + s;
          seq = seq.then(function () {
            log("  " + name + " ← A" + (audioBySpeaker[name].index + 1) + "...");
            setProgress(20 + Math.round(((s - 1) / settings.speakerCount) * 42), "Analyzing " + name + "...", true);
            return window.PodclipAnalyzer.analyzeAudioTrack(audioBySpeaker[name], totalDur, null, s - 1)
              .then(function (curve) {
                curves[name] = curve;
                var thresh = (settings.thresholds && settings.thresholds[name] !== undefined)
                  ? settings.thresholds[name]
                  : settings.dbThreshold;
                var stats = summarizeCurve(curve, thresh);
                log("    " + name + " stats: max " + stats.max.toFixed(1) +
                    " dB, avg " + stats.avg.toFixed(1) +
                    " dB, above threshold " + stats.hotPct.toFixed(1) + "%");
                setProgress(20 + Math.round((s / settings.speakerCount) * 42), "Analyzed " + name, true);
              });
          });
        })(s);
      }
      return seq.then(function () {
        return { totalDur: totalDur, curves: curves, sourceSequenceID: info.sequenceID, sourceSequenceName: info.name };
      });
    }).then(function (analysis) {
      log("Computing cuts...", "info");
      setProgress(66, "Computing cuts...", true);
      var edl = decideEdits(analysis.curves, settings, analysis.totalDur);
      edl.sourceSequenceID = analysis.sourceSequenceID;
      edl.sourceSequenceName = analysis.sourceSequenceName;
      log("Cut events: " + edl.eventCount + " across " + edl.tracks.length + " video tracks", "ok");
      if (edl.eventCount <= 1) {
        throw new Error("Only one camera state was detected, so Podclip did not write to the timeline. Check per-speaker stats, lower thresholds, or verify each A track contains a distinct mic.");
      }

      log("Duplicating checked sequence before writing...", "info");
      setProgress(76, "Duplicating sequence...", true);
      return callHost("Podclip.getSequenceIDs()").then(function (beforeIDsJSON) {
        return callHost("Podclip.duplicateActiveSequence(" + JSON.stringify(edl.sourceSequenceID) + ")").catch(function (e) {
          // Premiere 26.3 can invalidate the evalScript call after it
          // successfully clones and activates the new sequence.
          if (e.message.indexOf("EvalScript error") !== 0) throw e;
          log("Clone completed; Premiere reset the host bridge.", "info");
        }).then(function (json) {
          if (json) {
            var cloned = JSON.parse(json);
            if (!cloned.ok) throw new Error(cloned.error);
          }
          log("Locating duplicated sequence...", "info");
          return new Promise(function (resolve) {
            window.setTimeout(resolve, 500);
          }).then(function () {
            return callHost("Podclip.resolveDuplicatedSequence(" +
              JSON.stringify(beforeIDsJSON) + "," +
              JSON.stringify(edl.sourceSequenceName) + ")");
          });
        }).then(function (json) {
          var dup = JSON.parse(json);
          if (!dup.ok) throw new Error(dup.error);
          log("Editing duplicate: " + dup.duplicateName, "ok");
          edl.targetSequenceID = dup.sequenceID;
          edl.targetSequenceName = dup.duplicateName;
          return edl;
        });
      });
    }).then(function (edl) {
      log("Opening duplicated timeline...", "info");
      setProgress(81, "Opening duplicate...", true);
      return callHost("Podclip.getActiveSequenceID()").then(function (activeSequenceJSON) {
        var active = JSON.parse(activeSequenceJSON);
        if (active.ok && active.sequenceID === edl.targetSequenceID) return;
        return callHost("Podclip.activateSequence(" + JSON.stringify(edl.targetSequenceID) + ")").catch(function (e) {
          // Premiere 26.3 can invalidate the evalScript call after it successfully
          // changes the active sequence. The next call verifies the actual state.
          if (e.message.indexOf("EvalScript error") !== 0) throw e;
        }).then(function (json) {
          if (json) {
            var opened = JSON.parse(json);
            if (!opened.ok) throw new Error(opened.error);
          }
        });
      }).then(function () {
        return callHost("Podclip.getActiveSequenceID()");
      }).then(function (activeSequenceJSON) {
        var active = JSON.parse(activeSequenceJSON);
        if (!active.ok || active.sequenceID !== edl.targetSequenceID) {
          throw new Error("Premiere did not activate the duplicated sequence, so Podclip refused to write cuts.");
        }
        log("Duplicate timeline active.", "ok");
        return edl;
      });
    }).then(function (edl) {
      log("Writing to duplicated timeline...", "info");
      setProgress(86, "Writing cuts to duplicate...", true);
      return callHost("Podclip.applyEditDecisions(" + JSON.stringify(JSON.stringify(edl)) + ")");
    }).then(function (json) {
      var res = JSON.parse(json);
      if (!res.ok) throw new Error(res.error);
      log("Done. Razored " + res.razored + " times, toggled " + res.toggled + " clips.", "ok");
      finishProgress("Speaker cut created", "ok");
    }).catch(function (e) {
      log(e.message, "err");
      finishProgress("Speaker cut failed", "err");
    }).then(function () {
      btn.disabled = false;
    });
  });

  // ---------- startup ----------
  if (inPremiere) {
    log("Podclip loaded. Click Scan Timeline to verify.", "info");
    log("Controller build: " + CONTROLLER_BUILD, "info");
    callHost("Podclip.ping()").then(function (r) {
      if (r.replace(/['"]/g, "") === "pong") log("Host bridge OK.", "ok");
      else log("Host bridge unexpected: " + r, "warn");
    }).catch(function (e) { log(e.message, "err"); });
  } else {
    log("Preview mode (not in Premiere). UI only.", "warn");
  }

  // expose a few internals for debugging from the panel console
  window.PodclipPanel = {
    getSettings: getSettings,
    decideEdits: decideEdits
  };
})();
