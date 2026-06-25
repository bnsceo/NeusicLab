// ════════════════════════════════════════════════════════════════
// NEUSIC ENGINE — merged build
// Combines:
//  • Neusic: dark theme, master FX rack (saturation + delay),
//    per-voice pitch tuning, mono/poly sampler mode, custom drum
//    sample upload, re-parenting maximize overlay.
//  • Pad/01: clean undo/redo snapshots, save/load projects,
//    persisted zoom + panel-collapse state, mobile-responsive
//    layout, full key-bound synth keyboard, separate "→ Pads" /
//    "→ Sequencer" sample routing, right-click marker removal.
//  • New: theme toggle (dark OLED ⇄ light clay), symmetric
//    three-column workspace grid, buffer-safe snapshot/restore
//    so undo/redo never silently drops loaded AudioBuffers.
// ════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  const STEPS = 16;
  const ROLL_SEMITONES = 24;

  // ── Audio Context & Master FX Rack ─────────────────────────────
  let ctx = null;
  let masterGain = null;
  let rackDelay = null;
  let rackDelayFeedback = null;
  let rackDistortion = null;

  let activeSampleNodes = [];
  let activeDrumNodes = {};

  function ensureAudio() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = parseFloat(els.masterVol.value) / 100;

    rackDistortion = ctx.createWaveShaper();
    rackDistortion.curve = makeDistortionCurve(parseInt(els.fxDrive.value, 10));
    rackDistortion.oversample = '4x';

    rackDelay = ctx.createDelay(2.0);
    rackDelay.delayTime.value = parseFloat(els.fxDelayTime.value) / 100;

    rackDelayFeedback = ctx.createGain();
    rackDelayFeedback.gain.value = parseFloat(els.fxDelayFeedback.value) / 100;

    rackDelay.connect(rackDelayFeedback);
    rackDelayFeedback.connect(rackDelay);

    rackDistortion.connect(masterGain);
    rackDelay.connect(masterGain);
    masterGain.connect(ctx.destination);

    return ctx;
  }

  function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 30;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ── DOM Mappings ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const els = {
    playBtn:          $('playBtn'),
    iconPlay:         document.querySelector('.icon-play'),
    iconStop:         document.querySelector('.icon-stop'),
    bpmInput:         $('bpmInput'),
    stepReadout:      $('stepReadout'),
    patternReadout:   $('patternReadout'),
    swingInput:       $('swingInput'),
    masterVol:        $('masterVol'),
    clearBtn:         $('clearBtn'),
    exportBtn:        $('exportBtn'),
    saveBtn:          $('saveBtn'),
    loadSelect:       $('loadSelect'),
    undoBtn:          $('undoBtn'),
    redoBtn:          $('redoBtn'),
    themeToggle:      $('themeToggle'),
    themeIcon:        $('themeIcon'),
    drumGrid:         $('drumGrid'),
    sampleGrid:       $('sampleGrid'),
    drumMixer:        $('drumMixer'),
    chainSlots:       $('chainSlots'),
    chainAddBtn:      $('chainAddBtn'),
    chainModeSeg:     $('chainModeSeg'),
    patternLibrary:   $('patternLibrary'),
    patternNewBtn:    $('patternNewBtn'),
    waveSeg:          $('waveSeg'),
    synthAttack:      $('synthAttack'),
    synthRelease:     $('synthRelease'),
    synthCutoff:      $('synthCutoff'),
    octDown:          $('octDown'),
    octUp:            $('octUp'),
    octReadout:       $('octReadout'),
    rollGrid:         $('rollGrid'),
    keyboard:         $('keyboard'),
    dropZone:         $('dropZone'),
    fileInput:        $('fileInput'),
    waveformWrap:     $('waveformWrap'),
    waveCanvas:       $('waveCanvas'),
    chopModeSeg:      $('chopModeSeg'),
    polyModeSeg:      $('polyModeSeg'),
    autoChopGroup:    $('autoChopGroup'),
    chopCount:        $('chopCount'),
    chopCountReadout: $('chopCountReadout'),
    chopBtn:          $('chopBtn'),
    clearChopsBtn:    $('clearChopsBtn'),
    addToPadsBtn:     $('addToPadsBtn'),
    addToSeqBtn:      $('addToSeqBtn'),
    manualChopHint:   $('manualChopHint'),
    chopCursor:       $('chopCursor'),
    samplePads:       $('samplePads'),
    sampleGridHint:   $('sampleGridHint'),
    uiZoomIn:         $('uiZoomIn'),
    uiZoomOut:        $('uiZoomOut'),
    uiZoomReadout:    $('uiZoomReadout'),
    rollZoomIn:       $('rollZoomIn'),
    rollZoomOut:      $('rollZoomOut'),
    rollZoomReadout:  $('rollZoomReadout'),
    gridZoomIn:       $('gridZoomIn'),
    gridZoomOut:      $('gridZoomOut'),
    gridZoomReadout:  $('gridZoomReadout'),
    maximizeOverlay:  $('maximizeOverlay'),
    maximizeInner:    $('maximizeInner'),
    maximizeClose:    $('maximizeClose'),
    fxDrive:          $('fxDrive'),
    fxDelayTime:      $('fxDelayTime'),
    fxDelayFeedback:  $('fxDelayFeedback'),
    viewTabs:         document.querySelectorAll('.view-tab'),
    views: {
      sampler:        $('view-sampler'),
      drums:          $('view-drums'),
      synth:          $('view-synth')
    }
  };

  // ── Note name helper ───────────────────────────────────────────
  function octaveLabel(octave) { return `C${octave}`; }

  // ════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════

  const DRUM_VOICES = [
    { id: 'kick',  label: 'Kick' },
    { id: 'snare', label: 'Snare' },
    { id: 'chh',   label: 'Cl Hat' },
    { id: 'ohh',   label: 'Op Hat' },
    { id: 'clap',  label: 'Clap' },
    { id: 'tom',   label: 'Tom' },
    { id: 'perc',  label: 'Perc' },
    { id: 'crash', label: 'Crash' }
  ];

  function makePattern(label) {
    return {
      label,
      drums: {
        pattern: DRUM_VOICES.reduce((a, v) => { a[v.id] = new Array(STEPS).fill(false); return a; }, {}),
        volume:  DRUM_VOICES.reduce((a, v) => { a[v.id] = 0.85; return a; }, {}),
        muted:   DRUM_VOICES.reduce((a, v) => { a[v.id] = false; return a; }, {}),
        tuning:  DRUM_VOICES.reduce((a, v) => { a[v.id] = 0; return a; }, {}),
        buffers: DRUM_VOICES.reduce((a, v) => { a[v.id] = null; return a; }, {})
      },
      synth: {
        waveform: 'sine', attack: 0.02, release: 0.25, cutoff: 0.8, octave: 4,
        pattern: Array.from({ length: ROLL_SEMITONES }, () => new Array(STEPS).fill(false)),
      },
      sampleRows: [],
    };
  }

  const state = {
    bpm: 120, swing: 0,
    playing: false, currentStep: -1,
    patterns: [makePattern('A')],
    activePatternIdx: 0,
    chain: [0], chainMode: 'pattern', chainStep: 0,
    chopMode: 'auto',
    sampler: { buffer: null, fileName: '', slices: [], playMode: 'mono' },
  };

  const pat = () => state.patterns[state.activePatternIdx];

  // ── Undo/Redo — buffer-safe snapshots ───────────────────────────
  // AudioBuffers (custom drum samples) cannot survive JSON
  // serialization — JSON.stringify silently turns them into `{}`.
  // We snapshot everything EXCEPT buffers via clean JSON round-trip,
  // then re-attach the live buffer references afterward so loaded
  // custom samples are never lost on undo/redo.
  const undoStack = [], redoStack = [];
  const MAX_UNDO = 60;

  function snapshot() {
    const bufferMap = state.patterns.map(p => ({ ...p.drums.buffers }));
    const json = JSON.stringify(state.patterns, (key, value) => (key === 'buffers' ? undefined : value));
    return { patterns: JSON.parse(json), bufferMap };
  }

  function restoreSnapshot(snap) {
    snap.patterns.forEach((p, i) => {
      p.drums.buffers = snap.bufferMap[i] || DRUM_VOICES.reduce((a, v) => { a[v.id] = null; return a; }, {});
    });
    return snap.patterns;
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoBtns();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    state.patterns = restoreSnapshot(undoStack.pop());
    if (state.activePatternIdx >= state.patterns.length) state.activePatternIdx = state.patterns.length - 1;
    rebuildAllUI(); buildPatternLibrary(); buildChainUI(); updateUndoRedoBtns();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    state.patterns = restoreSnapshot(redoStack.pop());
    if (state.activePatternIdx >= state.patterns.length) state.activePatternIdx = state.patterns.length - 1;
    rebuildAllUI(); buildPatternLibrary(); buildChainUI(); updateUndoRedoBtns();
  }

  function updateUndoRedoBtns() {
    els.undoBtn.disabled = !undoStack.length;
    els.redoBtn.disabled = !redoStack.length;
  }

  els.undoBtn.addEventListener('click', undo);
  els.redoBtn.addEventListener('click', redo);

  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  });

  // ════════════════════════════════════════════════════════════════
  // THEME TOGGLE — dark OLED ⇄ light clay, persisted
  // ════════════════════════════════════════════════════════════════
  const THEME_KEY = 'neusic_theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (els.themeIcon) els.themeIcon.textContent = theme === 'dark' ? '☾' : '☀';
    if (els.themeToggle) els.themeToggle.title = theme === 'dark'
      ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function loadTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch {}
    applyTheme(theme);
  }

  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      // Re-paint the waveform so its colors follow the new theme immediately.
      if (typeof drawWaveform === 'function' && state.sampler.buffer) drawWaveform();
    });
  }

  // ════════════════════════════════════════════════════════════════
  // DRUM SYNTHESIS (with custom-sample playback + choke group)
  // ════════════════════════════════════════════════════════════════

  function noiseBuffer(audioCtx, dur) {
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function playDrum(voiceId, time, volume) {
    const audioCtx = ensureAudio();
    const p = pat();
    const out = audioCtx.createGain();
    out.gain.value = volume;
    out.connect(rackDistortion);

    // MPC-style choke group: closed hat instantly cuts an open hat's tail.
    if (voiceId === 'chh' && activeDrumNodes['ohh']) {
      activeDrumNodes['ohh'].forEach(node => { try { node.stop(time); } catch (e) {} });
      activeDrumNodes['ohh'] = [];
    }

    // Custom-loaded sample takes priority over the built-in synthesized voice.
    if (p.drums.buffers[voiceId]) {
      const src = audioCtx.createBufferSource();
      src.buffer = p.drums.buffers[voiceId];
      const semitones = p.drums.tuning[voiceId] || 0;
      src.playbackRate.setValueAtTime(Math.pow(2, semitones / 12), time);
      src.connect(out);
      src.start(time);
      if (!activeDrumNodes[voiceId]) activeDrumNodes[voiceId] = [];
      activeDrumNodes[voiceId].push(src);
      return;
    }

    switch (voiceId) {
      case 'kick': {
        const osc = audioCtx.createOscillator(); osc.type = 'sine';
        const g = audioCtx.createGain();
        const baseFreq = 150 * Math.pow(2, (p.drums.tuning.kick || 0) / 12);
        osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(42, time + .14);
        g.gain.setValueAtTime(1, time); g.gain.exponentialRampToValueAtTime(.001, time + .32);
        osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .35); break;
      }
      case 'snare': {
        const osc = audioCtx.createOscillator(); osc.type = 'triangle';
        const centerFreq = 180 * Math.pow(2, (p.drums.tuning.snare || 0) / 12);
        osc.frequency.value = centerFreq;
        const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, .18);
        const bp = audioCtx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 900;
        const og = audioCtx.createGain(); og.gain.setValueAtTime(.5, time); og.gain.exponentialRampToValueAtTime(.001, time + .11);
        const ng = audioCtx.createGain(); ng.gain.setValueAtTime(.4, time); ng.gain.exponentialRampToValueAtTime(.001, time + .18);
        osc.connect(og); og.connect(out);
        nb.connect(bp); bp.connect(ng); ng.connect(out);
        osc.start(time); osc.stop(time + .12);
        nb.start(time); nb.stop(time + .18);
        break;
      }
      case 'chh': case 'ohh': {
        const open = voiceId === 'ohh'; const dur = open ? .3 : .06;
        const baseFreq = 7000 * Math.pow(2, (p.drums.tuning[voiceId] || 0) / 12);
        const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, dur);
        const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = baseFreq;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(.8, time); g.gain.exponentialRampToValueAtTime(.001, time + dur);
        nb.connect(hp); hp.connect(g); g.connect(out); nb.start(time); nb.stop(time + dur);
        if (open) {
          if (!activeDrumNodes['ohh']) activeDrumNodes['ohh'] = [];
          activeDrumNodes['ohh'].push(nb);
        }
        break;
      }
      case 'clap': {
        for (let i = 0; i < 3; i++) {
          const t = time + i * .012;
          const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, .08);
          const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass';
          bp.frequency.value = 1100 * Math.pow(2, (p.drums.tuning.clap || 0) / 12); bp.Q.value = 1.2;
          const g = audioCtx.createGain(); g.gain.setValueAtTime(.7, t); g.gain.exponentialRampToValueAtTime(.001, t + .08);
          nb.connect(bp); bp.connect(g); g.connect(out); nb.start(t); nb.stop(t + .08);
        } break;
      }
      case 'tom': {
        const osc = audioCtx.createOscillator(); osc.type = 'sine';
        const baseFreq = 220 * Math.pow(2, (p.drums.tuning.tom || 0) / 12);
        osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.41, time + .2);
        const g = audioCtx.createGain(); g.gain.setValueAtTime(1, time); g.gain.exponentialRampToValueAtTime(.001, time + .3);
        osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .3); break;
      }
      case 'perc': {
        const osc = audioCtx.createOscillator(); osc.type = 'square';
        const baseFreq = 560 * Math.pow(2, (p.drums.tuning.perc || 0) / 12);
        osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.6, time + .07);
        const g = audioCtx.createGain(); g.gain.setValueAtTime(.5, time); g.gain.exponentialRampToValueAtTime(.001, time + .08);
        osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .08); break;
      }
      case 'crash': {
        const baseFreq = 5000 * Math.pow(2, (p.drums.tuning.crash || 0) / 12);
        const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, 1.2);
        const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = baseFreq;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(.55, time); g.gain.exponentialRampToValueAtTime(.001, time + 1.1);
        nb.connect(hp); hp.connect(g); g.connect(out); nb.start(time); nb.stop(time + 1.2); break;
      }
    }
  }

  function playSliceAudio(sliceIdx, time, volume) {
    if (!state.sampler.buffer) return;
    const slice = state.sampler.slices[sliceIdx];
    if (!slice) return;
    const audioCtx = ensureAudio();

    // MPC-style mono choke: a new slice trigger cuts any other slice
    // still ringing out, when in Mono voice mode.
    if (state.sampler.playMode === 'mono') {
      activeSampleNodes.forEach(node => { try { node.stop(time); } catch (e) {} });
      activeSampleNodes = [];
    }

    const src = audioCtx.createBufferSource();
    src.buffer = state.sampler.buffer;
    const g = audioCtx.createGain();
    g.gain.value = volume ?? .85;

    src.connect(g);
    g.connect(rackDistortion);
    g.connect(rackDelay);

    src.start(time, slice.start, Math.max(0.01, slice.end - slice.start));
    activeSampleNodes.push(src);
  }

  // ════════════════════════════════════════════════════════════════
  // SYNTH ENGINE
  // ════════════════════════════════════════════════════════════════

  function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function playSynthNote(midiNote, time, duration) {
    const audioCtx = ensureAudio();
    const p = pat();
    const osc = audioCtx.createOscillator();
    osc.type = p.synth.waveform;
    osc.frequency.value = midiToFreq(midiNote);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200 * Math.pow(60, p.synth.cutoff);

    const gain = audioCtx.createGain();
    const atk = Math.max(0.002, p.synth.attack);
    const rel = Math.max(0.02, p.synth.release);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.32, time + atk);
    gain.gain.setValueAtTime(0.32, Math.max(time + atk, time + duration));
    gain.gain.linearRampToValueAtTime(0, time + duration + rel);

    osc.connect(filter); filter.connect(gain); gain.connect(rackDistortion);
    osc.start(time); osc.stop(time + duration + rel + 0.05);
  }

  // ════════════════════════════════════════════════════════════════
  // SEQUENCER / SCHEDULER
  // Lookahead scheduler: a fast 25ms setInterval polls and queues
  // precise micro-events ~100ms ahead into AudioContext's
  // hardware-clocked timeline, so playback stays jitter-free
  // regardless of UI/render load.
  // ════════════════════════════════════════════════════════════════

  let nextStepTime = 0, schedulerTimer = null;
  const LOOKAHEAD_MS = 25, SCHEDULE_AHEAD_S = .1;

  function stepDuration() { return 60 / state.bpm / 4; }

  function getActivePattern() {
    if (state.chainMode === 'song' && state.playing) {
      return state.patterns[state.chain[state.chainStep]] || state.patterns[0];
    }
    return pat();
  }

  function scheduler() {
    const audioCtx = ensureAudio();
    while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
      const p = getActivePattern();

      DRUM_VOICES.forEach(v => {
        if (!p.drums.muted[v.id] && p.drums.pattern[v.id][state.currentStep]) {
          playDrum(v.id, nextStepTime, p.drums.volume[v.id]);
        }
      });
      p.synth.pattern.forEach((row, ri) => {
        if (row[state.currentStep]) playSynthNote((p.synth.octave + 2) * 12 - ri, nextStepTime, stepDuration() * .85);
      });
      p.sampleRows.forEach(row => {
        if (!row.muted && row.steps[state.currentStep]) playSliceAudio(row.sliceIndex, nextStepTime, row.volume);
      });

      const capturedStep = state.currentStep;
      const capturedChainStep = state.chainStep;
      const delay = Math.max(0, (nextStepTime - audioCtx.currentTime) * 1000);
      setTimeout(() => {
        updatePlayheadUI(capturedStep);
        if (state.chainMode === 'song' && state.playing) {
          const currentPat = state.patterns[state.chain[capturedChainStep]];
          if (currentPat) els.patternReadout.innerHTML = currentPat.label + `<small> ×${capturedChainStep + 1}</small>`;
          document.querySelectorAll('.chain-slot-btn').forEach((b, i) => b.classList.toggle('active-slot', i === capturedChainStep));
        }
      }, delay);

      let dur = stepDuration();
      const swing = state.swing / 100;
      if (state.currentStep % 2 === 0) dur *= (1 + swing * .4);
      else dur *= (1 - swing * .4);
      nextStepTime += dur;

      const next = (state.currentStep + 1) % STEPS;
      if (next === 0 && state.chainMode === 'song') {
        state.chainStep = (state.chainStep + 1) % Math.max(1, state.chain.length);
      }
      state.currentStep = next;
    }
  }

  function startPlayback() {
    const audioCtx = ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    state.playing = true; state.currentStep = 0; state.chainStep = 0;
    nextStepTime = audioCtx.currentTime + .05;
    schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
    els.playBtn.classList.add('is-playing');
    els.iconPlay.hidden = true; els.iconStop.hidden = false;
  }

  function stopPlayback() {
    state.playing = false;
    clearInterval(schedulerTimer); schedulerTimer = null;
    state.currentStep = -1; state.chainStep = 0;
    updatePlayheadUI(-1);
    els.playBtn.classList.remove('is-playing');
    els.iconPlay.hidden = false; els.iconStop.hidden = true;
    document.querySelectorAll('.chain-slot-btn').forEach(b => b.classList.remove('active-slot'));
    els.patternReadout.innerHTML = pat().label + '<small> ×1</small>';
  }

  function updatePlayheadUI(stepIndex) {
    document.querySelectorAll('.step-btn.playhead').forEach(el => el.classList.remove('playhead'));
    document.querySelectorAll('.roll-cell.playhead').forEach(el => el.classList.remove('playhead'));
    if (stepIndex >= 0) {
      document.querySelectorAll(`.step-btn[data-step="${stepIndex}"]`).forEach(el => el.classList.add('playhead'));
      document.querySelectorAll(`.roll-cell[data-step="${stepIndex}"]`).forEach(el => el.classList.add('playhead'));
      els.stepReadout.innerHTML = String(stepIndex + 1).padStart(2, '0') + '<small>/16</small>';
    } else {
      els.stepReadout.innerHTML = '01<small>/16</small>';
    }
  }

  els.playBtn.addEventListener('click', () => { if (state.playing) stopPlayback(); else startPlayback(); });
  els.bpmInput.addEventListener('change', () => {
    state.bpm = Math.min(240, Math.max(40, parseInt(els.bpmInput.value, 10) || 120));
    els.bpmInput.value = state.bpm;
  });
  els.swingInput.addEventListener('input', () => { state.swing = parseInt(els.swingInput.value, 10); });
  els.masterVol.addEventListener('input', () => { if (masterGain) masterGain.gain.value = parseFloat(els.masterVol.value) / 100; });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault(); els.playBtn.click();
    }
  });

  // ── FX Rack ────────────────────────────────────────────────────
  els.fxDrive.addEventListener('input', () => {
    if (rackDistortion) rackDistortion.curve = makeDistortionCurve(parseInt(els.fxDrive.value, 10));
  });
  els.fxDelayTime.addEventListener('input', () => {
    if (rackDelay) rackDelay.delayTime.setValueAtTime(parseFloat(els.fxDelayTime.value) / 100, ensureAudio().currentTime);
  });
  els.fxDelayFeedback.addEventListener('input', () => {
    if (rackDelayFeedback) rackDelayFeedback.gain.setValueAtTime(parseFloat(els.fxDelayFeedback.value) / 100, ensureAudio().currentTime);
  });

  // ════════════════════════════════════════════════════════════════
  // VIEW SWITCHING
  // ════════════════════════════════════════════════════════════════

  els.viewTabs.forEach(tab => {
    tab.addEventListener('click', e => {
      const btn = e.currentTarget;
      const view = btn.dataset.view;
      if (!view) return;
      els.viewTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
      Object.entries(els.views).forEach(([k, el]) => { if (el) el.hidden = (k !== view); });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // COLLAPSIBLE PANELS — persisted across reloads
  // ════════════════════════════════════════════════════════════════

  const PANEL_STATE_KEY = 'neusic_panel_collapsed';

  function getPanelMap() {
    try { return JSON.parse(localStorage.getItem(PANEL_STATE_KEY)) || {}; } catch { return {}; }
  }
  function savePanelMap(map) { try { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(map)); } catch {} }

  function panelKeyFor(panel) {
    // Identify a panel by its section id or heading text, since markup
    // doesn't always carry a data-target attribute.
    return panel.id || panel.querySelector('.panel-title-block span')?.textContent || '';
  }

  function initPanels() {
    const map = getPanelMap();
    document.querySelectorAll('.panel-toggle').forEach(toggle => {
      const panel = toggle.closest('.panel, .view-container');
      if (!panel) return;
      const contents = panel.querySelector('.panel-contents');
      if (!contents) return;
      const key = panelKeyFor(panel);

      if (map[key]) {
        contents.classList.add('collapsed');
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        toggle.setAttribute('aria-expanded', 'true');
      }

      toggle.addEventListener('click', () => {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!isExpanded));
        contents.classList.toggle('collapsed', isExpanded);
        const m = getPanelMap(); m[key] = isExpanded; savePanelMap(m);
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // MAXIMIZE OVERLAY — re-parenting (moves the live DOM branch
  // rather than cloning), so the maximized panel is never out of
  // sync with the underlying state, and event listeners never
  // need to be re-wired against a duplicate node.
  // ════════════════════════════════════════════════════════════════

  document.querySelectorAll('.panel-max-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const targetViewId = btn.dataset.maximize;
      const targetPanelContainer = $(targetViewId);
      if (!targetPanelContainer) return;

      const contentsNode = targetPanelContainer.querySelector('.panel-contents');
      if (!contentsNode) return;

      els.maximizeInner.innerHTML = '';
      els.maximizeInner.appendChild(contentsNode);
      els.maximizeOverlay.hidden = false;
      els.maximizeOverlay.dataset.sourcePanelId = targetViewId;
      document.body.style.overflow = 'hidden';
    });
  });

  els.maximizeClose.addEventListener('click', () => {
    const originalPanelId = els.maximizeOverlay.dataset.sourcePanelId;
    if (!originalPanelId) return;

    const originalPanel = $(originalPanelId);
    const contentsNode = els.maximizeInner.firstElementChild;

    if (originalPanel && contentsNode) {
      originalPanel.appendChild(contentsNode);
    }

    els.maximizeOverlay.hidden = true;
    els.maximizeInner.innerHTML = '';
    document.body.style.overflow = '';
    rebuildAllUI();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.maximizeOverlay.hidden) {
      els.maximizeClose.click();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // ZOOM CONTROLS — font-size / CSS-variable driven (never
  // transform: scale, which desyncs click coordinates from the
  // rendered position), persisted across reloads.
  // ════════════════════════════════════════════════════════════════

  const ZOOM_KEY = 'neusic_zoom';
  const zoomState = { ui: 14, roll: 1, grid: 1 };

  function loadZoomState() {
    try {
      const s = JSON.parse(localStorage.getItem(ZOOM_KEY));
      if (s) { zoomState.ui = s.ui || 14; zoomState.roll = s.roll || 1; zoomState.grid = s.grid || 1; }
    } catch {}
  }
  function saveZoomState() { try { localStorage.setItem(ZOOM_KEY, JSON.stringify(zoomState)); } catch {} }

  function applyZoom() {
    document.documentElement.style.setProperty('--ui-zoom-px', zoomState.ui + 'px');
    if (els.uiZoomReadout) els.uiZoomReadout.textContent = Math.round((zoomState.ui / 14) * 100) + '%';
    document.documentElement.style.setProperty('--grid-cell', (30 * zoomState.grid).toFixed(1) + 'px');
    if (els.gridZoomReadout) els.gridZoomReadout.textContent = Math.round(zoomState.grid * 100) + '%';
    document.documentElement.style.setProperty('--roll-cell-w', (26 * zoomState.roll).toFixed(1) + 'px');
    document.documentElement.style.setProperty('--roll-cell-h', (13 * zoomState.roll).toFixed(1) + 'px');
    if (els.rollZoomReadout) els.rollZoomReadout.textContent = Math.round(zoomState.roll * 100) + '%';
  }

  const UI_PX_MIN = 10, UI_PX_MAX = 20, UI_PX_STEP = 1;
  const ZOOM_MULT_MIN = .5, ZOOM_MULT_MAX = 2, ZOOM_MULT_STEP = .1;

  if (els.uiZoomIn) els.uiZoomIn.addEventListener('click', () => { zoomState.ui = Math.min(UI_PX_MAX, zoomState.ui + UI_PX_STEP); applyZoom(); saveZoomState(); });
  if (els.uiZoomOut) els.uiZoomOut.addEventListener('click', () => { zoomState.ui = Math.max(UI_PX_MIN, zoomState.ui - UI_PX_STEP); applyZoom(); saveZoomState(); });
  if (els.rollZoomIn) els.rollZoomIn.addEventListener('click', () => { zoomState.roll = Math.min(ZOOM_MULT_MAX, +(zoomState.roll + ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });
  if (els.rollZoomOut) els.rollZoomOut.addEventListener('click', () => { zoomState.roll = Math.max(ZOOM_MULT_MIN, +(zoomState.roll - ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });
  if (els.gridZoomIn) els.gridZoomIn.addEventListener('click', () => { zoomState.grid = Math.min(ZOOM_MULT_MAX, +(zoomState.grid + ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });
  if (els.gridZoomOut) els.gridZoomOut.addEventListener('click', () => { zoomState.grid = Math.max(ZOOM_MULT_MIN, +(zoomState.grid - ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });

  // Ctrl+scroll = UI zoom
  document.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomState.ui = e.deltaY < 0
      ? Math.min(UI_PX_MAX, zoomState.ui + 1)
      : Math.max(UI_PX_MIN, zoomState.ui - 1);
    applyZoom(); saveZoomState();
  }, { passive: false });

  // ════════════════════════════════════════════════════════════════
  // DRUM GRID UI (with custom-sample upload via right-click)
  // ════════════════════════════════════════════════════════════════

  function buildDrumGrid() {
    els.drumGrid.innerHTML = '';
    const p = pat();
    DRUM_VOICES.forEach(v => {
      const row = document.createElement('div');
      row.className = 'pad-row';

      const label = document.createElement('div');
      label.className = 'pad-row-label' + (p.drums.muted[v.id] ? ' muted' : '');
      if (p.drums.buffers[v.id]) label.style.color = 'var(--blue)';
      label.innerHTML = `<span class="mute-dot"></span>${v.label}`;
      label.title = 'Click to mute/unmute · Right-click to load a custom sample';

      label.addEventListener('click', () => {
        pushUndo(); p.drums.muted[v.id] = !p.drums.muted[v.id];
        label.classList.toggle('muted', p.drums.muted[v.id]);
      });

      label.addEventListener('contextmenu', e => {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'audio/*';
        input.onchange = evt => {
          const file = evt.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = readEvent => {
            const audioCtx = ensureAudio();
            audioCtx.decodeAudioData(readEvent.target.result, decodedBuffer => {
              pushUndo();
              p.drums.buffers[v.id] = decodedBuffer;
              buildDrumGrid();
            }, () => alert('Could not decode that audio file. Try WAV or MP3.'));
          };
          reader.readAsArrayBuffer(file);
        };
        input.click();
      });

      row.appendChild(label);

      const steps = document.createElement('div');
      steps.className = 'pad-steps';
      for (let i = 0; i < STEPS; i++) {
        const btn = document.createElement('button');
        btn.className = 'step-btn' + (p.drums.pattern[v.id][i] ? ' on' : '');
        btn.dataset.step = i;
        btn.setAttribute('aria-label', `${v.label} step ${i + 1}`);
        btn.addEventListener('click', () => {
          pushUndo();
          p.drums.pattern[v.id][i] = !p.drums.pattern[v.id][i];
          btn.classList.toggle('on', p.drums.pattern[v.id][i]);
          if (p.drums.pattern[v.id][i]) playDrum(v.id, ensureAudio().currentTime, p.drums.volume[v.id]);
        });
        steps.appendChild(btn);
      }
      row.appendChild(steps);
      els.drumGrid.appendChild(row);
    });
  }

  function buildDrumMixer() {
    els.drumMixer.innerHTML = '';
    const p = pat();
    DRUM_VOICES.forEach(v => {
      const row = document.createElement('div');
      row.className = 'mixer-row';
      row.innerHTML = `
        <div class="mixer-label"><span>${v.label}</span><span class="val-txt">${Math.round(p.drums.volume[v.id] * 100)}</span></div>
        <input type="range" class="vol-slider" min="0" max="100" value="${Math.round(p.drums.volume[v.id] * 100)}">
        <div class="tune-row">
          <span>TUNE</span>
          <input type="range" class="tune-slider" min="-12" max="12" step="1" value="${p.drums.tuning[v.id] || 0}">
        </div>
      `;
      const volSlider = row.querySelector('.vol-slider');
      const tuneSlider = row.querySelector('.tune-slider');
      const valTxt = row.querySelector('.val-txt');

      volSlider.addEventListener('input', () => { p.drums.volume[v.id] = parseFloat(volSlider.value) / 100; valTxt.textContent = volSlider.value; });
      tuneSlider.addEventListener('input', () => { p.drums.tuning[v.id] = parseInt(tuneSlider.value, 10); });
      els.drumMixer.appendChild(row);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // CLEAR BUTTON
  // ════════════════════════════════════════════════════════════════

  els.clearBtn.addEventListener('click', () => {
    pushUndo();
    const p = pat();
    DRUM_VOICES.forEach(v => p.drums.pattern[v.id].fill(false));
    p.synth.pattern.forEach(r => r.fill(false));
    if (p.sampleRows) p.sampleRows.forEach(r => r.steps.fill(false));
    rebuildAllUI();
  });

  // ════════════════════════════════════════════════════════════════
  // PATTERN LIBRARY & ARRANGEMENT CHAIN
  // ════════════════════════════════════════════════════════════════

  function buildPatternLibrary() {
    els.patternLibrary.innerHTML = '';
    state.patterns.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.className = 'pat-btn' + (idx === state.activePatternIdx ? ' selected' : '');
      btn.textContent = `Pattern ${p.label}`;
      btn.title = `Edit pattern ${p.label}`;
      btn.addEventListener('click', () => {
        state.activePatternIdx = idx;
        els.patternReadout.innerHTML = pat().label + '<small> ×1</small>';
        syncSynthSliders();
        updateOctaveReadout();
        rebuildAllUI();
        buildPatternLibrary();
      });
      els.patternLibrary.appendChild(btn);
    });
  }

  function syncSynthSliders() {
    const p = pat();
    if (els.synthAttack) els.synthAttack.value = Math.round(p.synth.attack * 1000 / 2 * 100);
    if (els.synthRelease) els.synthRelease.value = Math.round(p.synth.release / 2 * 100);
    if (els.synthCutoff) els.synthCutoff.value = Math.round(p.synth.cutoff * 100);
    els.waveSeg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.val === p.synth.waveform);
    });
  }

  function buildChainUI() {
    els.chainSlots.innerHTML = '';
    state.chain.forEach((patIdx, slotIdx) => {
      const slot = document.createElement('div');
      slot.className = 'chain-slot';
      const btn = document.createElement('button');
      btn.className = 'chain-slot-btn' + (state.playing && state.chainMode === 'song' && state.chainStep === slotIdx ? ' active-slot' : '');
      btn.textContent = state.patterns[patIdx] ? state.patterns[patIdx].label : '?';
      btn.addEventListener('click', () => {
        state.activePatternIdx = patIdx; rebuildAllUI(); buildPatternLibrary();
      });

      const del = document.createElement('button');
      del.className = 'chain-slot-del'; del.textContent = '×';
      del.title = 'Remove from chain';
      del.addEventListener('click', () => {
        pushUndo();
        state.chain.splice(slotIdx, 1);
        if (!state.chain.length) state.chain.push(0);
        buildChainUI();
      });

      slot.appendChild(btn); slot.appendChild(del);
      els.chainSlots.appendChild(slot);
    });
  }

  els.chainAddBtn.addEventListener('click', () => { pushUndo(); state.chain.push(state.activePatternIdx); buildChainUI(); });

  els.patternNewBtn.addEventListener('click', () => {
    pushUndo();
    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const next = state.patterns.length < labels.length ? labels[state.patterns.length] : `P${state.patterns.length + 1}`;
    state.patterns.push(makePattern(next));
    state.activePatternIdx = state.patterns.length - 1;
    els.patternReadout.innerHTML = pat().label + '<small> ×1</small>';
    buildPatternLibrary(); buildChainUI(); rebuildAllUI();
  });

  els.chainModeSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      els.chainModeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chainMode = btn.dataset.val;
      if (state.chainMode === 'song') state.chainStep = 0;
    });
  });

  // ════════════════════════════════════════════════════════════════
  // SYNTH CONTROLS + PIANO ROLL + KEYBOARD
  // ════════════════════════════════════════════════════════════════

  els.waveSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      els.waveSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); pat().synth.waveform = btn.dataset.val;
    });
  });
  els.synthAttack.addEventListener('input', () => { pat().synth.attack = parseFloat(els.synthAttack.value) / 1000 * 2; });
  els.synthRelease.addEventListener('input', () => { pat().synth.release = parseFloat(els.synthRelease.value) / 100 * 2; });
  els.synthCutoff.addEventListener('input', () => { pat().synth.cutoff = parseFloat(els.synthCutoff.value) / 100; });

  function updateOctaveReadout() {
    if (els.octReadout) els.octReadout.textContent = octaveLabel(pat().synth.octave);
  }
  els.octDown.addEventListener('click', () => {
    const p = pat();
    if (p.synth.octave > 1) { p.synth.octave--; updateOctaveReadout(); }
  });
  els.octUp.addEventListener('click', () => {
    const p = pat();
    if (p.synth.octave < 8) { p.synth.octave++; updateOctaveReadout(); }
  });

  function buildPianoRoll() {
    els.rollGrid.innerHTML = '';
    const p = pat();
    els.rollGrid.style.gridTemplateRows = `repeat(${ROLL_SEMITONES}, var(--roll-cell-h))`;
    for (let row = 0; row < ROLL_SEMITONES; row++) {
      const isBlack = [1, 3, 6, 8, 10].includes((11 - (row % 12) + 12) % 12);
      for (let col = 0; col < STEPS; col++) {
        const cell = document.createElement('div');
        cell.className = 'roll-cell' + (isBlack ? ' roll-row-black' : '') + (p.synth.pattern[row][col] ? ' on' : '');
        cell.dataset.step = col; cell.dataset.row = row;
        cell.addEventListener('click', () => {
          pushUndo();
          p.synth.pattern[row][col] = !p.synth.pattern[row][col];
          cell.classList.toggle('on', p.synth.pattern[row][col]);
          if (p.synth.pattern[row][col]) {
            playSynthNote((p.synth.octave + 2) * 12 - row, ensureAudio().currentTime, stepDuration() * .85);
          }
        });
        els.rollGrid.appendChild(cell);
      }
    }
  }

  // Full key-bound keyboard: white keys A S D F G H J K, black keys W E T Y U
  const KEY_LAYOUT = [
    { note: 0,  type: 'white', char: 'a' }, { note: 1,  type: 'black', char: 'w' },
    { note: 2,  type: 'white', char: 's' }, { note: 3,  type: 'black', char: 'e' },
    { note: 4,  type: 'white', char: 'd' }, { note: 5,  type: 'white', char: 'f' },
    { note: 6,  type: 'black', char: 't' }, { note: 7,  type: 'white', char: 'g' },
    { note: 8,  type: 'black', char: 'y' }, { note: 9,  type: 'white', char: 'h' },
    { note: 10, type: 'black', char: 'u' }, { note: 11, type: 'white', char: 'j' },
    { note: 12, type: 'white', char: 'k' },
  ];

  function buildKeyboard() {
    els.keyboard.innerHTML = '';
    const charToEl = {};
    KEY_LAYOUT.forEach(k => {
      const el = document.createElement('div');
      el.className = 'key' + (k.type === 'black' ? ' black' : '');
      const trigger = () => {
        const midi = (pat().synth.octave + 4) * 12 + k.note - 12;
        playSynthNote(midi, ensureAudio().currentTime, .18);
        el.classList.add('key-active');
      };
      const release = () => el.classList.remove('key-active');
      el.addEventListener('mousedown', trigger);
      el.addEventListener('mouseup', release);
      el.addEventListener('mouseleave', release);
      el.addEventListener('touchstart', e => { e.preventDefault(); trigger(); }, { passive: false });
      el.addEventListener('touchend', release);
      els.keyboard.appendChild(el);
      charToEl[k.char] = el;
    });
    const pressed = new Set();
    document.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      const k = e.key.toLowerCase();
      if (charToEl[k] && !pressed.has(k)) { pressed.add(k); charToEl[k].dispatchEvent(new MouseEvent('mousedown')); }
    });
    document.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      if (charToEl[k]) { pressed.delete(k); charToEl[k].dispatchEvent(new MouseEvent('mouseup')); }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // SAMPLER — load, waveform, chop (auto + manual), pads, routing
  // ════════════════════════════════════════════════════════════════

  els.dropZone.addEventListener('click', () => els.fileInput.click());
  ['dragover', 'dragenter'].forEach(evt => els.dropZone.addEventListener(evt, e => { e.preventDefault(); els.dropZone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => els.dropZone.addEventListener(evt, e => { e.preventDefault(); els.dropZone.classList.remove('drag-over'); }));
  els.dropZone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadSampleFile(f); });
  els.fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadSampleFile(f); });

  function loadSampleFile(file) {
    const audioCtx = ensureAudio();
    const reader = new FileReader();
    reader.onload = e => {
      audioCtx.decodeAudioData(e.target.result, buffer => {
        state.sampler.buffer = buffer;
        state.sampler.fileName = file.name;
        state.sampler.slices = [];
        els.waveformWrap.hidden = false;
        drawWaveform();
        els.samplePads.innerHTML = '';
      }, () => alert('Could not decode that audio file. Try WAV or MP3.'));
    };
    reader.readAsArrayBuffer(file);
  }

  function recalculateAutoChops() {
    if (!state.sampler.buffer) return;
    const n = parseInt(els.chopCount.value, 10);
    const dur = state.sampler.buffer.duration;
    state.sampler.slices = Array.from({ length: n }, (_, i) => ({ start: dur / n * i, end: dur / n * (i + 1) }));
    drawWaveform();
    buildSamplePads();
  }

  function drawWaveform() {
    const buffer = state.sampler.buffer;
    if (!buffer) return;
    const canvas = els.waveCanvas;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    canvas.width = cssW * dpr; canvas.height = 120 * dpr;
    const cx = canvas.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.scale(dpr, dpr);

    const wellBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || '#141518';
    cx.fillStyle = wellBg;
    cx.fillRect(0, 0, cssW, 120);

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / cssW);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6b00';
    cx.strokeStyle = 'rgba(120,160,255,0.55)';
    cx.lineWidth = 1; cx.beginPath();
    for (let i = 0; i < cssW; i++) {
      let mn = 1, mx = -1;
      for (let j = 0; j < step; j++) { const v = data[i * step + j] || 0; if (v < mn) mn = v; if (v > mx) mx = v; }
      cx.moveTo(i, 60 + mn * 55); cx.lineTo(i, 60 + mx * 55);
    }
    cx.stroke();

    drawSliceMarkers(cx, cssW, accent, dpr);
  }

  function drawSliceMarkers(cx, cssW, accent, dpr) {
    if (!state.sampler.buffer) return;
    const dur = state.sampler.buffer.duration;
    cx.strokeStyle = accent;
    cx.lineWidth = 1.5;
    state.sampler.slices.forEach((s, idx) => {
      if (s.start === 0 && idx === 0) return;
      const x = (s.start / dur) * cssW;
      cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, 120); cx.stroke();
      cx.fillStyle = accent;
      cx.font = `bold ${Math.round(9 * dpr) / dpr}px monospace`;
      cx.fillText(`${idx + 1}`, x + 3, 14);
    });
  }

  function buildSamplePads() {
    els.samplePads.innerHTML = '';
    const mapTriggers = ['1', '2', '3', '4', '5', '6', '7', '8', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I'];
    state.sampler.slices.forEach((slice, i) => {
      if (i >= 16) return;
      const pad = document.createElement('button');
      pad.className = 'sample-pad';
      pad.dataset.padIndex = i;
      pad.innerHTML = `<span>CHOP ${String(i + 1).padStart(2, '0')}</span><span class="pad-key">${mapTriggers[i]}</span>`;
      const trigger = () => {
        playSliceAudio(i, ensureAudio().currentTime, .9);
        pad.classList.add('playing');
        setTimeout(() => pad.classList.remove('playing'), 140);
      };
      pad.addEventListener('mousedown', trigger);
      els.samplePads.appendChild(pad);
    });
  }

  // ── Chop Mode toggle ────────────────────────────────────────────
  els.chopModeSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      els.chopModeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chopMode = btn.dataset.val;
      const isManual = state.chopMode === 'manual';
      els.autoChopGroup.style.display = isManual ? 'none' : '';
      els.chopBtn.style.display = isManual ? 'none' : '';
      els.manualChopHint.hidden = !isManual;
      els.waveCanvas.parentElement.style.cursor = isManual ? 'crosshair' : 'default';
      if (els.chopCursor) els.chopCursor.hidden = true;
    });
  });

  els.polyModeSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      els.polyModeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); state.sampler.playMode = btn.dataset.val;
    });
  });

  // ── Auto chop ───────────────────────────────────────────────────
  els.chopCount.addEventListener('input', () => { els.chopCountReadout.textContent = els.chopCount.value; });
  els.chopBtn.addEventListener('click', recalculateAutoChops);
  els.clearChopsBtn.addEventListener('click', () => {
    state.sampler.slices = [];
    if (state.sampler.buffer) drawWaveform();
    els.samplePads.innerHTML = '';
  });

  // ── Manual chop ─────────────────────────────────────────────────
  // Click on waveform = add cut point; right-click nearest marker = remove.
  const waveContainer = els.waveCanvas.parentElement;

  waveContainer.addEventListener('mousemove', e => {
    if (state.chopMode !== 'manual' || !state.sampler.buffer) {
      if (els.chopCursor) els.chopCursor.hidden = true;
      return;
    }
    const rect = waveContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    els.chopCursor.style.left = x + 'px';
    els.chopCursor.hidden = false;
  });
  waveContainer.addEventListener('mouseleave', () => { if (els.chopCursor) els.chopCursor.hidden = true; });

  waveContainer.addEventListener('click', e => {
    if (state.chopMode !== 'manual' || !state.sampler.buffer) return;
    const rect = waveContainer.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const timePos = xFrac * state.sampler.buffer.duration;
    const dur = state.sampler.buffer.duration;

    if (timePos < .01 || timePos > dur - .01) return;
    const tooClose = state.sampler.slices.some(s => Math.abs(s.start - timePos) < .02);
    if (tooClose) return;

    const cutPoints = [0, ...state.sampler.slices.map(s => s.start).filter(t => t > 0), timePos].sort((a, b) => a - b);
    const uniqueStarts = [...new Set(cutPoints)];
    state.sampler.slices = uniqueStarts.map((t, idx) => ({
      start: t,
      end: idx < uniqueStarts.length - 1 ? uniqueStarts[idx + 1] : dur,
    }));
    drawWaveform();
    buildSamplePads();
  });

  waveContainer.addEventListener('contextmenu', e => {
    if (state.chopMode !== 'manual' || !state.sampler.buffer) return;
    e.preventDefault();
    const rect = waveContainer.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const timePos = xFrac * state.sampler.buffer.duration;
    const dur = state.sampler.buffer.duration;

    const threshold = dur * .03;
    const nearest = state.sampler.slices.find(s => s.start > 0 && Math.abs(s.start - timePos) < threshold);
    if (!nearest) return;

    const cutPoints = state.sampler.slices.map(s => s.start).filter(t => t !== nearest.start);
    if (!cutPoints.length || cutPoints[0] !== 0) cutPoints.unshift(0);
    cutPoints.sort((a, b) => a - b);
    state.sampler.slices = cutPoints.map((t, idx) => ({
      start: t,
      end: idx < cutPoints.length - 1 ? cutPoints[idx + 1] : dur,
    }));
    drawWaveform();
    buildSamplePads();
  });

  // ── Keyboard triggers for sample pads (1-8 / Q-I) ────────────────
  const PAD_KEY_MAP = {
    '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7,
    'q': 8, 'w': 9, 'e': 10, 'r': 11, 't': 12, 'y': 13, 'u': 14, 'i': 15,
  };
  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();
    if (PAD_KEY_MAP.hasOwnProperty(key)) {
      const padIdx = PAD_KEY_MAP[key];
      if (padIdx < state.sampler.slices.length) {
        playSliceAudio(padIdx, ensureAudio().currentTime, .9);
        const padEl = els.samplePads.querySelector(`[data-pad-index="${padIdx}"]`);
        if (padEl) {
          padEl.classList.add('playing');
          setTimeout(() => padEl.classList.remove('playing'), 140);
        }
      }
    }
  });

  // ── Routing: slices → performance pads, and/or → step sequencer ──
  els.addToPadsBtn.addEventListener('click', () => {
    if (!state.sampler.slices.length) { alert('No slices yet — use Auto Split or add manual cuts first.'); return; }
    buildSamplePads();
  });

  els.addToSeqBtn.addEventListener('click', () => {
    if (!state.sampler.slices.length) { alert('No slices yet — use Auto Split or add manual cuts first.'); return; }
    pushUndo();
    pat().sampleRows = state.sampler.slices.map((_, i) => ({
      label: `Chop ${i + 1}`, sliceIndex: i,
      steps: new Array(STEPS).fill(false), volume: .8, muted: false,
    }));
    if (els.sampleGridHint) els.sampleGridHint.textContent = `— ${state.sampler.slices.length} slice${state.sampler.slices.length !== 1 ? 's' : ''} routed`;
    buildSampleSequencerGrid();
  });

  function buildSampleSequencerGrid() {
    els.sampleGrid.innerHTML = '';
    const p = pat();
    if (!p.sampleRows || !p.sampleRows.length) {
      els.sampleGrid.innerHTML = '<p class="empty-hint">No slices routed. Load a sample, chop it, then click "→ Sequencer".</p>';
      if (els.sampleGridHint) els.sampleGridHint.textContent = '— unassigned';
      return;
    }
    if (els.sampleGridHint) els.sampleGridHint.textContent = `— ${p.sampleRows.length} slice${p.sampleRows.length !== 1 ? 's' : ''} routed`;

    p.sampleRows.forEach(rowData => {
      const row = document.createElement('div');
      row.className = 'pad-row sample-pad-row';
      const label = document.createElement('div');
      label.className = 'pad-row-label' + (rowData.muted ? ' muted' : '');
      label.innerHTML = `<span class="mute-dot"></span>${rowData.label}`;
      label.addEventListener('click', () => { pushUndo(); rowData.muted = !rowData.muted; label.classList.toggle('muted', rowData.muted); });
      row.appendChild(label);

      const steps = document.createElement('div');
      steps.className = 'pad-steps';
      for (let i = 0; i < STEPS; i++) {
        const btn = document.createElement('button');
        btn.className = 'step-btn sample-step-btn' + (rowData.steps[i] ? ' on' : '');
        btn.dataset.step = i;
        btn.addEventListener('click', () => {
          pushUndo(); rowData.steps[i] = !rowData.steps[i];
          btn.classList.toggle('on', rowData.steps[i]);
          if (rowData.steps[i]) playSliceAudio(rowData.sliceIndex, ensureAudio().currentTime, rowData.volume);
        });
        steps.appendChild(btn);
      }
      row.appendChild(steps);
      els.sampleGrid.appendChild(row);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // SAVE / LOAD — named projects in localStorage
  // ════════════════════════════════════════════════════════════════

  const STORAGE_KEY = 'neusic_projects';

  function getProjects() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }

  function refreshLoadSelect() {
    const projects = getProjects();
    els.loadSelect.innerHTML = '<option value="">Load…</option>';
    Object.keys(projects).forEach(name => {
      const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
      els.loadSelect.appendChild(opt);
    });
  }

  els.saveBtn.addEventListener('click', () => {
    const name = prompt('Save project as:', 'My beat'); if (!name) return;
    const projects = getProjects();
    // Custom drum AudioBuffers can't survive localStorage — they are
    // intentionally dropped on save (the sample audio itself isn't
    // persisted to disk; patterns, tuning, and mix levels still are).
    const patternsForSave = state.patterns.map(p => ({
      ...p,
      drums: { ...p.drums, buffers: DRUM_VOICES.reduce((a, v) => { a[v.id] = null; return a; }, {}) },
    }));
    projects[name] = {
      bpm: state.bpm, swing: state.swing,
      patterns: patternsForSave,
      activePatternIdx: state.activePatternIdx,
      chain: [...state.chain], chainMode: state.chainMode,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      refreshLoadSelect(); els.loadSelect.value = name;
    } catch {
      alert('Could not save — storage may be full.');
    }
  });

  els.loadSelect.addEventListener('change', () => {
    const name = els.loadSelect.value; if (!name) return;
    const saved = getProjects()[name]; if (!saved) return;
    pushUndo();
    state.bpm = saved.bpm; els.bpmInput.value = saved.bpm;
    state.swing = saved.swing || 0; els.swingInput.value = state.swing;
    if (saved.patterns) {
      state.patterns = saved.patterns;
      state.activePatternIdx = saved.activePatternIdx || 0;
      state.chain = saved.chain || [0];
      state.chainMode = saved.chainMode || 'pattern';
      els.chainModeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === state.chainMode));
    }
    syncSynthSliders(); updateOctaveReadout();
    rebuildAllUI(); buildPatternLibrary(); buildChainUI();
  });

  // ════════════════════════════════════════════════════════════════
  // EXPORT / BOUNCE TO WAV
  // ════════════════════════════════════════════════════════════════

  els.exportBtn.addEventListener('click', async () => {
    const dur = stepDuration();
    const loopSeconds = dur * STEPS;
    const sampleRate = 44100;
    const offCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * (loopSeconds + 1.5)), sampleRate);

    const offMaster = offCtx.createGain();
    offMaster.gain.value = parseFloat(els.masterVol.value) / 100;

    const offDistortion = offCtx.createWaveShaper();
    offDistortion.curve = makeDistortionCurve(parseInt(els.fxDrive.value, 10));
    offDistortion.oversample = '4x';

    const offDelay = offCtx.createDelay(2.0);
    offDelay.delayTime.value = parseFloat(els.fxDelayTime.value) / 100;
    const offDelayFeedback = offCtx.createGain();
    offDelayFeedback.gain.value = parseFloat(els.fxDelayFeedback.value) / 100;
    offDelay.connect(offDelayFeedback); offDelayFeedback.connect(offDelay);

    offDistortion.connect(offMaster);
    offDelay.connect(offMaster);
    offMaster.connect(offCtx.destination);

    // Temporarily redirect the live engine's context/bus references so
    // the existing playDrum/playSliceAudio/playSynthNote functions
    // render into the offline graph without any code duplication.
    const real = { ctx, masterGain, rackDistortion, rackDelay, rackDelayFeedback };
    ctx = offCtx; masterGain = offMaster; rackDistortion = offDistortion; rackDelay = offDelay; rackDelayFeedback = offDelayFeedback;

    const p = pat();
    for (let i = 0; i < STEPS; i++) {
      const t = i * dur;
      DRUM_VOICES.forEach(v => { if (!p.drums.muted[v.id] && p.drums.pattern[v.id][i]) playDrum(v.id, t, p.drums.volume[v.id]); });
      p.synth.pattern.forEach((row, ri) => { if (row[i]) playSynthNote((p.synth.octave + 2) * 12 - ri, t, dur * .85); });
      p.sampleRows.forEach(row => { if (!row.muted && row.steps[i] && state.sampler.buffer) playSliceAudio(row.sliceIndex, t, row.volume); });
    }

    const rendered = await offCtx.startRendering();
    ctx = real.ctx; masterGain = real.masterGain; rackDistortion = real.rackDistortion; rackDelay = real.rackDelay; rackDelayFeedback = real.rackDelayFeedback;

    const blob = bufferToWavBlob(rendered);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `neusic-loop-${state.bpm}bpm.wav`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function bufferToWavBlob(buffer) {
    const nc = buffer.numberOfChannels, sr = buffer.sampleRate, nf = buffer.length;
    const ba = nc * 2, ds = nf * ba;
    const ab = new ArrayBuffer(44 + ds), v = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + ds, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ba, true); v.setUint16(32, ba, true);
    v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, ds, true);
    const channels = Array.from({ length: nc }, (_, c) => buffer.getChannelData(c));
    let offset = 44;
    for (let i = 0; i < nf; i++) {
      for (let c = 0; c < nc; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  // ════════════════════════════════════════════════════════════════
  // REBUILD ALL UI
  // ════════════════════════════════════════════════════════════════

  function rebuildAllUI() {
    buildDrumGrid();
    buildDrumMixer();
    buildSampleSequencerGrid();
    buildPianoRoll();
    buildKeyboard();
    updateOctaveReadout();
    syncSynthSliders();
    updateUndoRedoBtns();
  }

  // ── Init ───────────────────────────────────────────────────────
  loadTheme();
  rebuildAllUI();
  buildPatternLibrary();
  buildChainUI();
  refreshLoadSelect();
  loadZoomState();
  applyZoom();
  initPanels();
  updatePlayheadUI(-1);

})();
