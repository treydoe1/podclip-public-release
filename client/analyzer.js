/*
 * Podclip — audio analyzer.
 *
 * Reads media files (the source clips referenced by Premiere's audio tracks)
 * and returns an RMS-dB-over-time curve per audio TRACK. We stitch each
 * track's clips together in timeline-time so the curve is continuous.
 *
 * Runs inside the CEP panel's Node.js context. Prefers bundled ffmpeg/ffprobe
 * binaries and falls back to PATH-based system installs.
 */

(function () {
  // Guard so this module also loads in browser preview where Node isn't available.
  var hasNode = typeof require === "function";
  var childProcess, fs, os, path;
  if (hasNode) {
    try {
      childProcess = require("child_process");
      fs = require("fs");
      os = require("os");
      path = require("path");
    } catch (e) { hasNode = false; }
  }

  var SAMPLE_MS = 50; // 20 samples per second
  var ffmpegCommand = null;
  var ffmpegLookupDetails = [];
  var channelCountCache = {};

  function normalizeCepPath(rawPath) {
    if (!rawPath) return null;
    var normalized = String(rawPath);
    if (normalized.indexOf("file://") === 0) {
      normalized = normalized.replace(/^file:\/+/, "/");
      try {
        normalized = decodeURIComponent(normalized);
      } catch (e) {}
    }
    return normalized;
  }

  function getExtensionRoot() {
    if (!hasNode || !path) return null;
    if (typeof window !== "undefined" && window.__adobe_cep__ && window.SystemPath) {
      try {
        var cepRoot = window.__adobe_cep__.getSystemPath(window.SystemPath.EXTENSION);
        if (cepRoot) return normalizeCepPath(cepRoot);
      } catch (e) {}
    }
    if (typeof __dirname !== "undefined") {
      var localDir = normalizeCepPath(__dirname);
      if (path.basename(localDir) === "client") return path.resolve(localDir, "..");
      return localDir;
    }
    return null;
  }

  function getBundledBinDirs() {
    if (!hasNode || !path || !os) return [];
    var arch = "";
    try {
      arch = os.arch();
    } catch (e) {
      arch = "";
    }
    var folder = arch === "arm64" ? "darwin-arm64" : (arch === "x64" ? "darwin-x64" : null);
    if (!folder) return [];

    var dirs = [];
    var extensionRoot = getExtensionRoot();
    if (extensionRoot) dirs.push(path.join(extensionRoot, "vendor", "ffmpeg", folder));
    if (typeof __dirname !== "undefined") {
      var localDir = normalizeCepPath(__dirname);
      var localRoot = path.basename(localDir) === "client" ? path.resolve(localDir, "..") : localDir;
      dirs.push(path.join(localRoot, "vendor", "ffmpeg", folder));
    }
    return dirs;
  }

  function findBundledTool(toolName) {
    var dirs = getBundledBinDirs();
    for (var i = 0; i < dirs.length; i++) {
      var candidate = path.join(dirs[i], toolName);
      try {
        ffmpegLookupDetails.push(candidate);
        if (fs.existsSync(candidate)) {
          try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
          } catch (e) {
            ffmpegLookupDetails.push(candidate + " exists but is not executable");
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function findFfmpegCommand() {
    if (!hasNode) return null;
    var bundled = findBundledTool("ffmpeg");
    if (bundled) return bundled;
    var candidates = [
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/usr/bin/ffmpeg",
      "ffmpeg"
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] === "ffmpeg") continue;
      try {
        if (fs.existsSync(candidates[i])) return candidates[i];
      } catch (e) {}
    }
    return "ffmpeg";
  }

  function checkFfmpeg() {
    return new Promise(function (resolve) {
      if (!hasNode) return resolve({ ok: false, error: "Node not available." });
      ffmpegLookupDetails = [];
      var cmd = findFfmpegCommand();
      var settled = false;
      var stderr = "";
      var p;
      function fail(message) {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: message, tried: ffmpegLookupDetails.slice() });
      }
      try {
        p = childProcess.spawn(cmd, ["-version"]);
      } catch (e) {
        return fail("ffmpeg could not be launched: " + (e && e.message ? e.message : e));
      }
      var found = false;
      p.on("error", function (e) {
        fail("ffmpeg could not be launched: " + (e && e.message ? e.message : e) + ". Reinstall Podclip or place ffmpeg in /opt/homebrew/bin or /usr/local/bin.");
      });
      p.stdout.on("data", function () { found = true; });
      p.stderr.on("data", function (d) {
        stderr += d.toString();
        if (stderr.length > 1200) stderr = stderr.slice(0, 1200);
      });
      p.on("close", function () {
        if (settled) return;
        settled = true;
        if (found) {
          ffmpegCommand = cmd;
          resolve({ ok: true, path: cmd });
        } else {
          var detail = stderr.trim();
          var message = "ffmpeg did not run successfully. Reinstall Podclip or place ffmpeg in /opt/homebrew/bin or /usr/local/bin.";
          if (detail) message += " Details: " + detail;
          resolve({ ok: false, error: message, tried: ffmpegLookupDetails.slice() });
        }
      });
    });
  }

  function findFfprobeCommand() {
    var bundled = findBundledTool("ffprobe");
    if (bundled) return bundled;
    var ffmpeg = ffmpegCommand || findFfmpegCommand();
    if (ffmpeg && ffmpeg !== "ffmpeg") {
      var sibling = ffmpeg.replace(/ffmpeg$/, "ffprobe");
      try {
        if (fs.existsSync(sibling)) return sibling;
      } catch (e) {}
    }
    return "ffprobe";
  }

  function getAudioChannelCount(mediaPath) {
    return new Promise(function (resolve) {
      if (channelCountCache[mediaPath] !== undefined) return resolve(channelCountCache[mediaPath]);
      var args = [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=channels",
        "-of", "default=noprint_wrappers=1:nokey=1",
        mediaPath
      ];
      var p = childProcess.spawn(findFfprobeCommand(), args);
      var out = "";
      p.stdout.on("data", function (d) { out += d.toString(); });
      p.on("error", function () {
        channelCountCache[mediaPath] = 1;
        resolve(1);
      });
      p.on("close", function () {
        var channels = parseInt(out, 10);
        if (!isFinite(channels) || channels < 1) channels = 1;
        channelCountCache[mediaPath] = channels;
        resolve(channels);
      });
    });
  }

  /*
   * Analyze a single source clip slice: from sourceInSec for durationSec.
   * Returns array of { tSec, dB } sampled every SAMPLE_MS milliseconds.
   *
   * Uses ffmpeg's astats filter, dumping per-window RMS_level via ametadata.
   */
  function runFfmpegAStats(mediaPath, sourceInSec, durationSec, channelIndex) {
    return new Promise(function (resolve, reject) {
      if (!hasNode) return reject(new Error("Node not available."));

      // Normalize to 48 kHz and force 50 ms audio frames before astats.
      // astats reset is frame-count based, so using asetnsamples gives us
      // stable panel-sized RMS readings without needing to know source rate.
      var analysisRate = 48000;
      var samplesPerWindow = Math.round(analysisRate * SAMPLE_MS / 1000);
      var filters = ["aresample=" + analysisRate];
      if (channelIndex !== null && channelIndex !== undefined) {
        filters.push("pan=mono|c0=c" + channelIndex);
      }
      filters.push("asetnsamples=n=" + samplesPerWindow + ":p=0");
      filters.push("astats=metadata=1:reset=1");
      filters.push("ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-");
      var args = [
        "-hide_banner",
        "-nostats",
        "-ss", String(sourceInSec),
        "-t",  String(durationSec),
        "-i",  mediaPath,
        "-vn",
        "-af", filters.join(","),
        "-f",  "null",
        "-"
      ];

      var p = childProcess.spawn(ffmpegCommand || findFfmpegCommand(), args);
      var out = "";
      var err = "";
      p.stdout.on("data", function (d) { out += d.toString(); });
      p.stderr.on("data", function (d) { err += d.toString(); });
      p.on("error", reject);
      p.on("close", function (code) {
        if (code !== 0 && out.length === 0) {
          return reject(new Error("ffmpeg exited " + code + ":\n" + err));
        }
        resolve(parseAStatsOutput(out));
      });
    });
  }

  function analyzeClip(mediaPath, sourceInSec, durationSec, channelIndex) {
    var requested = (channelIndex !== null && channelIndex !== undefined) ? channelIndex : null;
    return getAudioChannelCount(mediaPath).then(function (channels) {
      var effective = requested;
      if (effective !== null && effective >= channels) effective = 0;
      return runFfmpegAStats(mediaPath, sourceInSec, durationSec, effective).then(function (samples) {
        if (effective && effective > 0 && maxDb(samples) <= -100) {
          return runFfmpegAStats(mediaPath, sourceInSec, durationSec, 0);
        }
        return samples;
      }).catch(function (err) {
        if (effective && effective > 0) return runFfmpegAStats(mediaPath, sourceInSec, durationSec, 0);
        throw err;
      });
    });
  }

  function maxDb(samples) {
    var max = -120;
    for (var i = 0; i < samples.length; i++) {
      if (samples[i].dB > max) max = samples[i].dB;
    }
    return max;
  }

  // ametadata=print emits records like:
  //   frame:42 pts:120960 pts_time:2.520
  //   lavfi.astats.Overall.RMS_level=-31.428012
  function parseAStatsOutput(text) {
    var lines = text.split(/\r?\n/);
    var samples = [];
    var pendingTime = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var ptsMatch = /pts_time:([0-9.+-]+)/.exec(line);
      if (ptsMatch) { pendingTime = parseFloat(ptsMatch[1]); continue; }
      var rmsMatch = /lavfi\.astats\.Overall\.RMS_level=([0-9.+-eE]+|-?inf)/.exec(line);
      if (rmsMatch && pendingTime !== null) {
        var v = rmsMatch[1];
        var dB = (v === "-inf" || v === "inf" || v === "nan") ? -120 : parseFloat(v);
        if (!isFinite(dB)) dB = -120;
        samples.push({ tSec: pendingTime, dB: dB });
        pendingTime = null;
      }
    }
    return samples;
  }

  /*
   * Analyze every clip of an audio track and stitch their dB curves into
   * a continuous track-time curve. Empty sequence regions (no clip) are
   * filled with -120 dB (silence).
   */
  function analyzeAudioTrack(track, totalSeqDuration, onProgress, channelIndex) {
    var clips = (track.clips || []).slice().sort(function (a, b) {
      return a.startSec - b.startSec;
    });

    var total = Math.ceil(totalSeqDuration * 1000 / SAMPLE_MS);
    var curve = new Array(total);
    for (var i = 0; i < total; i++) curve[i] = -120;

    var seq = Promise.resolve();
    clips.forEach(function (clip, idx) {
      seq = seq.then(function () {
        if (!clip.mediaPath) return;
        var dur = clip.endSec - clip.startSec;
        if (dur <= 0) return;
        return analyzeClip(clip.mediaPath, clip.inPointSec, dur, channelIndex).then(function (samples) {
          for (var k = 0; k < samples.length; k++) {
            var s = samples[k];
            var seqT = clip.startSec + s.tSec;
            var bin = Math.floor(seqT * 1000 / SAMPLE_MS);
            if (bin >= 0 && bin < curve.length) curve[bin] = s.dB;
          }
          if (onProgress) onProgress(idx + 1, clips.length);
        });
      });
    });

    return seq.then(function () { return curve; });
  }

  window.PodclipAnalyzer = {
    SAMPLE_MS: SAMPLE_MS,
    checkFfmpeg: checkFfmpeg,
    analyzeAudioTrack: analyzeAudioTrack
  };
})();
