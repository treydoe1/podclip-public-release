/*
 * Podclip — ExtendScript host code.
 *
 * Runs inside Premiere. Bridges between the panel and the active sequence.
 *
 * Phase 1 surface:
 *   Podclip.getSequenceSummary()      -> JSON describing active sequence tracks
 *   Podclip.getSequenceInfo()         -> JSON describing tracks + clips
 *   Podclip.getSequenceIDs()                    -> project sequence IDs
 *   Podclip.duplicateActiveSequence(sequenceID) -> clone sequence
 *   Podclip.resolveDuplicatedSequence(ids)      -> identify clone
 *   Podclip.activateSequence(sequenceID)        -> open sequence
 *   Podclip.getActiveSequenceID()               -> active sequence ID
 *   Podclip.applyEditDecisions(json)  -> razor + toggle Enabled per the EDL
 *   Podclip.ping()                    -> "pong" (sanity check)
 */

#target premierepro

var Podclip = (function () {
  var TICKS_PER_SECOND = 254016000000; // Premiere's internal time unit

  function ping() {
    return "pong";
  }

  function ticksToSeconds(ticksStr) {
    // ticks come back from the API as strings to avoid 32-bit precision loss.
    var ticks = parseFloat(ticksStr);
    if (!isFinite(ticks)) return 0;
    return ticks / TICKS_PER_SECOND;
  }

  function getSequenceInfo() {
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ ok: false, error: "No active sequence." });
    }

    var fps = 1.0 / seq.timebase * TICKS_PER_SECOND;
    // seq.timebase is ticks per frame; fps = TICKS_PER_SECOND / timebase.
    // The expression above is just rearranged; keep simple form for clarity:
    fps = TICKS_PER_SECOND / parseFloat(seq.timebase);

    var info = {
      ok: true,
      name: seq.name,
      sequenceID: seq.sequenceID,
      fps: fps,
      sampleRate: seq.audioFrameRate ? parseFloat(seq.audioFrameRate.seconds) : null,
      audioTracks: [],
      videoTracks: []
    };

    var i, j, track, clip, clipInfo, clips;

    for (i = 0; i < seq.audioTracks.numTracks; i++) {
      track = seq.audioTracks[i];
      clips = [];
      for (j = 0; j < track.clips.numItems; j++) {
        clip = track.clips[j];
        clipInfo = {
          index: j,
          name: clip.name,
          startSec: ticksToSeconds(clip.start.ticks),
          endSec: ticksToSeconds(clip.end.ticks),
          inPointSec: ticksToSeconds(clip.inPoint.ticks),
          outPointSec: ticksToSeconds(clip.outPoint.ticks),
          mediaPath: clip.projectItem ? clip.projectItem.getMediaPath() : null
        };
        clips.push(clipInfo);
      }
      info.audioTracks.push({
        index: i,
        name: track.name || ("A" + (i + 1)),
        clips: clips
      });
    }

    for (i = 0; i < seq.videoTracks.numTracks; i++) {
      track = seq.videoTracks[i];
      clips = [];
      for (j = 0; j < track.clips.numItems; j++) {
        clip = track.clips[j];
        clipInfo = {
          index: j,
          name: clip.name,
          startSec: ticksToSeconds(clip.start.ticks),
          endSec: ticksToSeconds(clip.end.ticks)
        };
        clips.push(clipInfo);
      }
      info.videoTracks.push({
        index: i,
        name: track.name || ("V" + (i + 1)),
        clips: clips
      });
    }

    return JSON.stringify(info);
  }

  function getSequenceSummary() {
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ ok: false, error: "No active sequence." });
    }

    var fps = TICKS_PER_SECOND / parseFloat(seq.timebase);
    var info = {
      ok: true,
      name: seq.name,
      sequenceID: seq.sequenceID,
      fps: fps,
      sampleRate: seq.audioFrameRate ? parseFloat(seq.audioFrameRate.seconds) : null,
      audioTracks: [],
      videoTracks: []
    };

    var i, track;
    for (i = 0; i < seq.audioTracks.numTracks; i++) {
      track = seq.audioTracks[i];
      info.audioTracks.push({ index: i, name: track.name || ("A" + (i + 1)), clips: [] });
    }
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
      track = seq.videoTracks[i];
      info.videoTracks.push({ index: i, name: track.name || ("V" + (i + 1)), clips: [] });
    }

    return JSON.stringify(info);
  }

  function duplicateActiveSequence(expectedSequenceID) {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ ok: false, error: "No active sequence." });
    if (expectedSequenceID && seq.sequenceID !== expectedSequenceID) {
      return JSON.stringify({
        ok: false,
        error: "The scanned timeline is no longer active. Click Scan Timeline on the sequence you want and run again."
      });
    }
    if (typeof seq.clone !== "function") {
      return JSON.stringify({ ok: false, error: "This Premiere version does not expose sequence.clone()." });
    }
    // Check the undocumented razor bridge before making a duplicate. A future
    // Premiere release may keep CEP working while removing the QE interface.
    try {
      app.enableQE();
      var qeSeq = qe.project.getActiveSequence();
      var qeTrack = qeSeq && qeSeq.getVideoTrackAt(0);
      if (!qeTrack || typeof qeTrack.razor !== "function") {
        return JSON.stringify({ ok: false, error: "This Premiere version does not expose QE video-track razor. No sequence was duplicated." });
      }
    } catch (compatibilityError) {
      return JSON.stringify({ ok: false, error: "Premiere QE razor is unavailable. No sequence was duplicated: " + compatibilityError.toString() });
    }

    try {
      seq.clone();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "Could not duplicate sequence: " + e.toString() });
    }
    return JSON.stringify({ ok: true });
  }

  function getSequenceIDs() {
    return JSON.stringify(collectSequenceIDs());
  }

  function resolveDuplicatedSequence(beforeIDsJSON, originalName) {
    var beforeIDs;
    try {
      beforeIDs = JSON.parse(beforeIDsJSON);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "Could not verify duplicated sequence: " + e.toString() });
    }
    if (app.project.sequences.numSequences <= beforeIDs.length) {
      return JSON.stringify({ ok: false, error: "Premiere did not create a duplicate sequence." });
    }

    var newSeq = findNewSequence(beforeIDs);
    if (!newSeq) return JSON.stringify({ ok: false, error: "Could not find duplicated sequence." });

    var duplicateSequenceID;
    var duplicateName;
    try {
      duplicateSequenceID = newSeq.sequenceID;
      duplicateName = newSeq.name || (originalName + " Copy");
    } catch (e1) {
      return JSON.stringify({ ok: false, error: "Duplicated sequence, but could not read its identity: " + e1.toString() });
    }

    return JSON.stringify({
      ok: true,
      originalName: originalName,
      duplicateName: duplicateName,
      sequenceID: duplicateSequenceID
    });
  }

  function activateSequence(sequenceID) {
    var seq = findSequenceByID(sequenceID);
    if (!seq) return JSON.stringify({ ok: false, error: "Could not find the duplicated sequence." });
    try {
      app.project.openSequence(sequenceID);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "Could not open the duplicated sequence: " + e.toString() });
    }
    return JSON.stringify({ ok: true, sequenceID: sequenceID });
  }

  function getActiveSequenceID() {
    var seq = app.project.activeSequence;
    return JSON.stringify({ ok: true, sequenceID: seq ? seq.sequenceID : "" });
  }

  /*
   * applyEditDecisions(payload)
   *
   * payload: {
   *   tracks: [
   *     {
   *       videoTrackIndex: 0,
   *       segments: [
   *         { startSec: 0.0,   endSec: 2.3,  enabled: true  },
   *         { startSec: 2.3,   endSec: 2.6,  enabled: false },
   *         ...
   *       ]
   *     },
   *     ...
   *   ]
   * }
   *
   * For every distinct boundary time, razor the track if a clip crosses it.
   * Then walk segments and toggle each resulting sub-clip's Enabled flag.
   */
  function applyEditDecisions(jsonPayload) {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ ok: false, error: "No active sequence." });

    var payload;
    try {
      payload = JSON.parse(jsonPayload);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "Bad payload: " + e.toString() });
    }
    if (payload.targetSequenceID && seq.sequenceID !== payload.targetSequenceID) {
      return JSON.stringify({ ok: false, error: "Refusing to write: the duplicated sequence is not active." });
    }

    var razorCount = 0;
    var toggleCount = 0;
    var i, j, t, trackPlan, vTrack, boundaries, boundary, segments, seg;

    try {
      app.enableQE();
      var qeSeq = qe.project.getActiveSequence();
      if (!qeSeq) return JSON.stringify({ ok: false, error: "Premiere QE timeline is unavailable." });
    } catch (qeError) {
      return JSON.stringify({ ok: false, error: "Premiere QE timeline is unavailable: " + qeError.toString() });
    }

    for (i = 0; i < payload.tracks.length; i++) {
      trackPlan = payload.tracks[i];
      vTrack = seq.videoTracks[trackPlan.videoTrackIndex];
      if (!vTrack) continue;
      var qeTrack = qeSeq.getVideoTrackAt(trackPlan.videoTrackIndex);
      if (!qeTrack || typeof qeTrack.razor !== "function") {
        return JSON.stringify({ ok: false, error: "Premiere QE razor is unavailable for V" + (trackPlan.videoTrackIndex + 1) + "." });
      }

      // 1. Collect razor boundaries (every segment edge).
      boundaries = [];
      segments = trackPlan.segments;
      for (j = 0; j < segments.length; j++) {
        if (j === 0) boundaries.push(segments[j].startSec);
        boundaries.push(segments[j].endSec);
      }

      // 2. Razor at each boundary that falls inside a clip.
      for (j = 0; j < boundaries.length; j++) {
        boundary = boundaries[j];
        var tc = secondsToTimecodeString(boundary, seq);
        try {
          qeTrack.razor(tc);
          razorCount++;
        } catch (e) { /* boundary outside any clip — ignore */ }
      }

      // 3. Walk segments; for each clip on this track that falls within a
      //    segment, set Enabled to match the segment's flag.
      for (j = 0; j < segments.length; j++) {
        seg = segments[j];
        for (var k = 0; k < vTrack.clips.numItems; k++) {
          var clip = vTrack.clips[k];
          var clipStart = parseFloat(clip.start.ticks) / TICKS_PER_SECOND;
          var clipEnd = parseFloat(clip.end.ticks) / TICKS_PER_SECOND;
          var clipMid = (clipStart + clipEnd) / 2;
          if (clipMid >= seg.startSec && clipMid < seg.endSec) {
            try {
              clip.disabled = !seg.enabled;
              toggleCount++;
            } catch (e) { /* read-only clip type */ }
          }
        }
      }
    }

    return JSON.stringify({
      ok: true,
      razored: razorCount,
      toggled: toggleCount
    });
  }

  function secondsToTimecodeString(sec, seq) {
    // Premiere's QE razor accepts a timecode string. Build HH:MM:SS:FF.
    var fps = TICKS_PER_SECOND / parseFloat(seq.timebase);
    var totalFrames = Math.round(sec * fps);
    var fpsInt = Math.round(fps);
    var ff = totalFrames % fpsInt;
    var totalSec = Math.floor(totalFrames / fpsInt);
    var ss = totalSec % 60;
    var mm = Math.floor(totalSec / 60) % 60;
    var hh = Math.floor(totalSec / 3600);
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return pad(hh) + ":" + pad(mm) + ":" + pad(ss) + ":" + pad(ff);
  }

  function collectSequenceIDs() {
    var ids = [];
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      ids.push(app.project.sequences[i].sequenceID);
    }
    return ids;
  }

  function hasID(ids, id) {
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === id) return true;
    }
    return false;
  }

  function findNewSequence(beforeIDs) {
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var seq = app.project.sequences[i];
      if (seq && !hasID(beforeIDs, seq.sequenceID)) return seq;
    }
    return null;
  }

  function findSequenceByID(sequenceID) {
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var seq = app.project.sequences[i];
      if (seq && seq.sequenceID === sequenceID) return seq;
    }
    return null;
  }

  return {
    ping: ping,
    getSequenceSummary: getSequenceSummary,
    getSequenceInfo: getSequenceInfo,
    getSequenceIDs: getSequenceIDs,
    duplicateActiveSequence: duplicateActiveSequence,
    resolveDuplicatedSequence: resolveDuplicatedSequence,
    activateSequence: activateSequence,
    getActiveSequenceID: getActiveSequenceID,
    applyEditDecisions: applyEditDecisions
  };
})();
