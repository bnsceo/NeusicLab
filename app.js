// ════════════════════════════════════════════════════════════════
// PAD/01 — browser beat machine  v3
// Fixes: tab/panel tap unresponsiveness, collapse overlap bug,
//        UI-zoom click-offset (now uses font-size scaling).
// New:   manual chop, piano-roll zoom, maximize overlay.
// ════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  const STEPS = 16;
  const ROLL_SEMITONES = 24;

  // ── Audio context ──────────────────────────────────────────────
  let ctx = null;
  let masterGain = null;

  function ensureAudio() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = parseFloat(els.masterVol.value) / 100;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  // ── DOM refs ───────────────────────────────────────────────────
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
    drumGrid:         $('drumGrid'),
    sampleGrid:       $('sampleGrid'),
    sampleGridHint:   $('sampleGridHint'),
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
    viewTabs:         document.querySelectorAll('.view-tab'),
    views: {
      drums:   $('view-drums'),
      synth:   $('view-synth'),
      sampler: $('view-sampler'),
    },
  };

  // ════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════

  const DRUM_VOICES = [
    { id: 'kick',  label: 'Kick'   },
    { id: 'snare', label: 'Snare'  },
    { id: 'chh',   label: 'Cl Hat' },
    { id: 'ohh',   label: 'Op Hat' },
    { id: 'clap',  label: 'Clap'   },
    { id: 'tom',   label: 'Tom'    },
    { id: 'perc',  label: 'Perc'   },
    { id: 'crash', label: 'Crash'  },
  ];

  function makePattern(label) {
    return {
      label,
      drums: {
        pattern: DRUM_VOICES.reduce((a, v) => { a[v.id] = new Array(STEPS).fill(false); return a; }, {}),
        volume:  DRUM_VOICES.reduce((a, v) => { a[v.id] = 0.85; return a; }, {}),
        muted:   DRUM_VOICES.reduce((a, v) => { a[v.id] = false; return a; }, {}),
      },
      synth: {
        waveform: 'sine', attack: 0.02, release: 0.25, cutoff: 1.0, octave: 4,
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
    chopMode: 'auto', // 'auto' | 'manual'
    sampler: { buffer: null, fileName: '', slices: [] },
  };

  const pat = () => state.patterns[state.activePatternIdx];

  // ── Undo / Redo ────────────────────────────────────────────────
  const undoStack = [], redoStack = [];
  const MAX_UNDO = 60;

  function snapshot() { return JSON.parse(JSON.stringify(state.patterns)); }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoBtns();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    state.patterns = undoStack.pop();
    if (state.activePatternIdx >= state.patterns.length) state.activePatternIdx = state.patterns.length - 1;
    rebuildAllUI(); buildPatternLibrary(); buildChainUI(); updateUndoRedoBtns();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    state.patterns = redoStack.pop();
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
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  });

  // ════════════════════════════════════════════════════════════════
  // PATTERN CHAIN
  // ════════════════════════════════════════════════════════════════

  function buildPatternLibrary() {
    els.patternLibrary.innerHTML = '';
    state.patterns.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'pat-btn' + (i === state.activePatternIdx ? ' selected' : '');
      btn.textContent = p.label;
      btn.title = `Edit pattern ${p.label}`;
      btn.addEventListener('click', () => {
        state.activePatternIdx = i;
        rebuildAllUI(); buildPatternLibrary();
      });
      els.patternLibrary.appendChild(btn);
    });
  }

  function buildChainUI() {
    els.chainSlots.innerHTML = '';
    state.chain.forEach((patIdx, slotIdx) => {
      const slot = document.createElement('div');
      slot.className = 'chain-slot';

      const btn = document.createElement('button');
      btn.className = 'chain-slot-btn' +
        (state.playing && state.chainMode === 'song' && state.chainStep === slotIdx ? ' active-slot' : '');
      btn.textContent = state.patterns[patIdx] ? state.patterns[patIdx].label : '?';
      btn.addEventListener('click', () => {
        state.activePatternIdx = patIdx; rebuildAllUI(); buildPatternLibrary();
      });

      const del = document.createElement('button');
      del.className = 'chain-slot-del'; del.textContent = '×';
      del.addEventListener('click', () => {
        pushUndo();
        state.chain.splice(slotIdx, 1);
        if (!state.chain.length) state.chain.push(0);
        buildChainUI();
      });

      slot.appendChild(btn); slot.appendChild(del);
      if (slotIdx < state.chain.length - 1) {
        const arr = document.createElement('span');
        arr.className = 'chain-slot-arrow'; arr.textContent = '→';
        slot.appendChild(arr);
      }
      els.chainSlots.appendChild(slot);
    });
  }

  els.chainAddBtn.addEventListener('click', () => {
    pushUndo(); state.chain.push(state.activePatternIdx); buildChainUI();
  });

  els.patternNewBtn.addEventListener('click', () => {
    pushUndo();
    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const next = state.patterns.length < labels.length ? labels[state.patterns.length] : `P${state.patterns.length + 1}`;
    state.patterns.push(makePattern(next));
    state.activePatternIdx = state.patterns.length - 1;
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
    gain.gain.linearRampToValueAtTime(0.35, time + atk);
    gain.gain.setValueAtTime(0.35, Math.max(time + atk, time + duration));
    gain.gain.linearRampToValueAtTime(0, time + duration + rel);
    osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
    osc.start(time); osc.stop(time + duration + rel + 0.05);
  }

  // ════════════════════════════════════════════════════════════════
  // DRUM SYNTHESIS
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
    const out = audioCtx.createGain(); out.gain.value = volume; out.connect(masterGain);
    switch (voiceId) {
      case 'kick': {
        const osc = audioCtx.createOscillator(); osc.type = 'sine';
        const g = audioCtx.createGain();
        osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(45, time + .12);
        g.gain.setValueAtTime(1, time); g.gain.exponentialRampToValueAtTime(.001, time + .35);
        osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .4); break;
      }
      case 'snare': {
        const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, .25);
        const bp = audioCtx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 900;
        const ng = audioCtx.createGain(); ng.gain.setValueAtTime(1, time); ng.gain.exponentialRampToValueAtTime(.001, time + .18);
        nb.connect(bp); bp.connect(ng); ng.connect(out);
        const osc = audioCtx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 180;
        const og = audioCtx.createGain(); og.gain.setValueAtTime(.6, time); og.gain.exponentialRampToValueAtTime(.001, time + .12);
        osc.connect(og); og.connect(out);
        nb.start(time); nb.stop(time + .25); osc.start(time); osc.stop(time + .12); break;
      }
      case 'chh': case 'ohh': {
        const open = voiceId === 'ohh'; const dur = open ? .3 : .06;
        const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, dur);
        const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(.8, time); g.gain.exponentialRampToValueAtTime(.001, time + dur);
        nb.connect(hp); hp.connect(g); g.connect(out); nb.start(time); nb.stop(time + dur); break;
      }
      case 'clap': {
        for (let i = 0; i < 3; i++) {
          const t = time + i * .012;
          const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, .08);
          const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
          const g = audioCtx.createGain(); g.gain.setValueAtTime(.7, t); g.gain.exponentialRampToValueAtTime(.001, t + .08);
          nb.connect(bp); bp.connect(g); g.connect(out); nb.start(t); nb.stop(t + .08);
        } break;
      }
      case 'tom': {
        const osc = audioCtx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(220, time); osc.frequency.exponentialRampToValueAtTime(90, time + .2);
        const g = audioCtx.createGain(); g.gain.setValueAtTime(1, time); g.gain.exponentialRampToValueAtTime(.001, time + .3);
        osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .3); break;
      }
      case 'perc': {
        const osc = audioCtx.createOscillator(); osc.type = 'square';
        osc.frequency.setValueAtTime(560, time); osc.frequency.exponentialRampToValueAtTime(340, time + .07);
        const g = audioCtx.createGain(); g.gain.setValueAtTime(.5, time); g.gain.exponentialRampToValueAtTime(.001, time + .08);
        osc.connect(g); g.connect(out); osc.start(time); osc.stop(time + .08); break;
      }
      case 'crash': {
        const nb = audioCtx.createBufferSource(); nb.buffer = noiseBuffer(audioCtx, 1.2);
        const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
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
    const src = audioCtx.createBufferSource(); src.buffer = state.sampler.buffer;
    const g = audioCtx.createGain(); g.gain.value = volume ?? .9;
    src.connect(g); g.connect(masterGain);
    src.start(time, slice.start, slice.end - slice.start);
  }

  // ════════════════════════════════════════════════════════════════
  // SEQUENCER
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

  function scheduleStep(stepIndex, time) {
    const p = getActivePattern();
    DRUM_VOICES.forEach(v => {
      if (!p.drums.muted[v.id] && p.drums.pattern[v.id][stepIndex]) playDrum(v.id, time, p.drums.volume[v.id]);
    });
    p.synth.pattern.forEach((row, ri) => {
      if (row[stepIndex]) playSynthNote((p.synth.octave + 2) * 12 - ri, time, stepDuration() * .85);
    });
    p.sampleRows.forEach(row => {
      if (!row.muted && row.steps[stepIndex]) playSliceAudio(row.sliceIndex, time, row.volume);
    });
  }

  function scheduler() {
    const audioCtx = ensureAudio();
    while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(state.currentStep, nextStepTime);
      const capturedStep = state.currentStep;
      const capturedChainStep = state.chainStep;
      const delay = Math.max(0, (nextStepTime - audioCtx.currentTime) * 1000);
      setTimeout(() => {
        updatePlayheadUI(capturedStep);
        if (state.chainMode === 'song') {
          const p = state.patterns[state.chain[capturedChainStep]];
          if (p) els.patternReadout.innerHTML = p.label + `<small> ×${capturedChainStep + 1}</small>`;
          document.querySelectorAll('.chain-slot-btn').forEach((b, i) => b.classList.toggle('active-slot', i === capturedChainStep));
        }
      }, delay);

      let dur = stepDuration();
      const swing = state.swing / 100;
      if (state.currentStep % 2 === 0) dur *= (1 + swing * .5);
      else dur *= (1 - swing * .5);
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
      els.stepReadout.innerHTML = String(stepIndex + 1).padStart(2,'0') + '<small>/16</small>';
    } else {
      els.stepReadout.innerHTML = '01<small>/16</small>';
    }
  }

  els.playBtn.addEventListener('click', () => { if (state.playing) stopPlayback(); else startPlayback(); });
  els.bpmInput.addEventListener('change', () => {
    state.bpm = Math.min(240, Math.max(40, parseInt(els.bpmInput.value,10) || 120));
    els.bpmInput.value = state.bpm;
  });
  els.swingInput.addEventListener('input', () => { state.swing = parseInt(els.swingInput.value,10); });
  els.masterVol.addEventListener('input', () => { if (masterGain) masterGain.gain.value = parseFloat(els.masterVol.value) / 100; });
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault(); els.playBtn.click();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // VIEW SWITCHING — FIX: use data attribute on button, not child spans
  // ════════════════════════════════════════════════════════════════

  els.viewTabs.forEach(tab => {
    tab.addEventListener('click', e => {
      // Walk up from clicked element to find the .view-tab button
      const btn = e.currentTarget;
      const view = btn.dataset.view;
      if (!view) return;
      els.viewTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      Object.entries(els.views).forEach(([k, el]) => { el.hidden = (k !== view); });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // COLLAPSIBLE PANELS — FIX: delegate to .panel-toggle buttons only
  // No nested button issues. Uses max-height CSS transition.
  // ════════════════════════════════════════════════════════════════

  const PANEL_STATE_KEY = 'pad01_panel_collapsed';

  function getPanelMap() {
    try { return JSON.parse(localStorage.getItem(PANEL_STATE_KEY)) || {}; } catch { return {}; }
  }
  function savePanelMap(map) { localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(map)); }

  function initPanels() {
    const map = getPanelMap();
    // Wire all panel-toggle buttons — they are NOT panel-header themselves,
    // avoiding the "button contains button" / event-capture bug.
    document.querySelectorAll('.panel-toggle').forEach(toggle => {
      const targetId = toggle.dataset.target;
      const panel = toggle.closest('.panel');
      if (!panel) return;

      // Restore saved state
      if (map[targetId]) panel.classList.add('collapsed');
      toggle.setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));

      toggle.addEventListener('click', e => {
        e.stopPropagation();
        const collapsed = panel.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        const m = getPanelMap(); m[targetId] = collapsed; savePanelMap(m);
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // MAXIMIZE OVERLAY — Sampler, Piano Roll, Drum Grid
  // ════════════════════════════════════════════════════════════════

  // Map panel id → what to clone/show
  const MAXIMIZE_CONTENT = {
    drumGrid:  () => els.drumGrid.cloneNode(true),
    pianoRoll: () => {
      const wrap = document.createElement('div');
      wrap.className = 'piano-roll-wrap';
      const scroll = document.createElement('div');
      scroll.className = 'roll-scroll';
      scroll.appendChild(els.rollGrid.cloneNode(true));
      wrap.appendChild(scroll);
      return wrap;
    },
    sampleLoad: () => $('sampleLoad-body').cloneNode(true),
  };

  document.querySelectorAll('.panel-max-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const panelId = btn.dataset.maximize;
      const contentFn = MAXIMIZE_CONTENT[panelId];
      if (!contentFn) return;
      els.maximizeInner.innerHTML = '';
      const clone = contentFn();
      // For drum grid maximize, re-wire step buttons to live state
      if (panelId === 'drumGrid') {
        clone.querySelectorAll('.step-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            // Find which voice and step this button corresponds to
            const step = parseInt(btn.dataset.step, 10);
            const rowEl = btn.closest('.pad-row');
            if (!rowEl) return;
            // Identify voice by row index
            const rows = [...clone.querySelectorAll('.pad-row')];
            const rowIdx = rows.indexOf(rowEl);
            const voice = DRUM_VOICES[rowIdx];
            if (!voice) return;
            pushUndo();
            const p = pat();
            p.drums.pattern[voice.id][step] = !p.drums.pattern[voice.id][step];
            btn.classList.toggle('on', p.drums.pattern[voice.id][step]);
            // Keep main grid in sync
            const mainBtn = els.drumGrid.querySelector(`.pad-row:nth-child(${rowIdx+1}) .step-btn[data-step="${step}"]`);
            if (mainBtn) mainBtn.classList.toggle('on', p.drums.pattern[voice.id][step]);
            if (p.drums.pattern[voice.id][step]) {
              const audioCtx = ensureAudio();
              playDrum(voice.id, audioCtx.currentTime, p.drums.volume[voice.id]);
            }
          });
        });
      }
      els.maximizeInner.appendChild(clone);
      els.maximizeOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
    });
  });

  els.maximizeClose.addEventListener('click', () => {
    els.maximizeOverlay.hidden = true;
    els.maximizeInner.innerHTML = '';
    document.body.style.overflow = '';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.maximizeOverlay.hidden) {
      els.maximizeClose.click();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // ZOOM CONTROLS — FIX: UI zoom via CSS font-size (no transform)
  // This avoids the click coordinate offset caused by transform: scale.
  // Piano Roll has its own independent zoom. Grid has its own.
  // ════════════════════════════════════════════════════════════════

  const ZOOM_KEY = 'pad01_zoom_v3';
  const zoomState = { ui: 14, roll: 1, grid: 1 }; // ui in px, others multipliers

  function loadZoomState() {
    try {
      const s = JSON.parse(localStorage.getItem(ZOOM_KEY));
      if (s) { zoomState.ui = s.ui || 14; zoomState.roll = s.roll || 1; zoomState.grid = s.grid || 1; }
    } catch {}
  }
  function saveZoomState() { localStorage.setItem(ZOOM_KEY, JSON.stringify(zoomState)); }

  function applyZoom() {
    // UI zoom: change root font-size so all em-based sizes scale
    document.documentElement.style.setProperty('--ui-zoom-px', zoomState.ui + 'px');
    els.uiZoomReadout.textContent = Math.round((zoomState.ui / 14) * 100) + '%';
    // Grid zoom: step button size
    document.documentElement.style.setProperty('--grid-cell', (30 * zoomState.grid).toFixed(1) + 'px');
    els.gridZoomReadout.textContent = Math.round(zoomState.grid * 100) + '%';
    // Roll zoom: piano roll cell dimensions
    document.documentElement.style.setProperty('--roll-cell-w', (26 * zoomState.roll).toFixed(1) + 'px');
    document.documentElement.style.setProperty('--roll-cell-h', (13 * zoomState.roll).toFixed(1) + 'px');
    els.rollZoomReadout.textContent = Math.round(zoomState.roll * 100) + '%';
  }

  const UI_PX_MIN = 10, UI_PX_MAX = 20, UI_PX_STEP = 1;
  const ZOOM_MULT_MIN = .5, ZOOM_MULT_MAX = 2, ZOOM_MULT_STEP = .1;

  els.uiZoomIn.addEventListener('click', () => { zoomState.ui = Math.min(UI_PX_MAX, zoomState.ui + UI_PX_STEP); applyZoom(); saveZoomState(); });
  els.uiZoomOut.addEventListener('click', () => { zoomState.ui = Math.max(UI_PX_MIN, zoomState.ui - UI_PX_STEP); applyZoom(); saveZoomState(); });
  els.rollZoomIn.addEventListener('click', () => { zoomState.roll = Math.min(ZOOM_MULT_MAX, +(zoomState.roll + ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });
  els.rollZoomOut.addEventListener('click', () => { zoomState.roll = Math.max(ZOOM_MULT_MIN, +(zoomState.roll - ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });
  els.gridZoomIn.addEventListener('click', () => { zoomState.grid = Math.min(ZOOM_MULT_MAX, +(zoomState.grid + ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });
  els.gridZoomOut.addEventListener('click', () => { zoomState.grid = Math.max(ZOOM_MULT_MIN, +(zoomState.grid - ZOOM_MULT_STEP).toFixed(2)); applyZoom(); saveZoomState(); });

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
  // DRUM GRID UI
  // ════════════════════════════════════════════════════════════════

  function buildDrumGrid() {
    els.drumGrid.innerHTML = '';
    const p = pat();
    DRUM_VOICES.forEach(v => {
      const row = document.createElement('div');
      row.className = 'pad-row';

      const label = document.createElement('div');
      label.className = 'pad-row-label' + (p.drums.muted[v.id] ? ' muted' : '');
      label.innerHTML = `<span class="mute-dot"></span>${v.label}`;
      label.title = 'Tap to mute/unmute';
      label.addEventListener('click', () => {
        pushUndo(); p.drums.muted[v.id] = !p.drums.muted[v.id];
        label.classList.toggle('muted', p.drums.muted[v.id]);
      });
      row.appendChild(label);

      const steps = document.createElement('div');
      steps.className = 'pad-steps';
      for (let i = 0; i < STEPS; i++) {
        const btn = document.createElement('button');
        btn.className = 'step-btn' + (p.drums.pattern[v.id][i] ? ' on' : '');
        btn.dataset.step = i;
        btn.setAttribute('aria-label', `${v.label} step ${i+1}`);
        btn.addEventListener('click', () => {
          pushUndo();
          p.drums.pattern[v.id][i] = !p.drums.pattern[v.id][i];
          btn.classList.toggle('on', p.drums.pattern[v.id][i]);
          if (p.drums.pattern[v.id][i]) { const a = ensureAudio(); playDrum(v.id, a.currentTime, p.drums.volume[v.id]); }
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
      row.innerHTML = `<div class="mixer-label"><span>${v.label}</span><span>${Math.round(p.drums.volume[v.id]*100)}</span></div>
        <input type="range" min="0" max="100" value="${Math.round(p.drums.volume[v.id]*100)}">`;
      const range = row.querySelector('input');
      const span = row.querySelector('.mixer-label span:last-child');
      range.addEventListener('input', () => { p.drums.volume[v.id] = parseFloat(range.value)/100; span.textContent = range.value; });
      els.drumMixer.appendChild(row);
    });
  }

  // ── Sample Sequencer Grid ──────────────────────────────────────

  function buildSampleSequencerGrid() {
    const p = pat();
    els.sampleGrid.innerHTML = '';
    if (!p.sampleRows || !p.sampleRows.length) {
      els.sampleGrid.innerHTML = '<p class="empty-hint">No slices loaded. Go to the Sampler tab, load a file and hit Auto-slice, then click "→ Sequencer".</p>';
      els.sampleGridHint.textContent = '— load slices in Sampler tab';
      return;
    }
    els.sampleGridHint.textContent = `— ${p.sampleRows.length} slice${p.sampleRows.length !== 1 ? 's' : ''} routed`;
    p.sampleRows.forEach(rowData => {
      const row = document.createElement('div');
      row.className = 'pad-row sample-pad-row';
      const label = document.createElement('div');
      label.className = 'pad-row-label' + (rowData.muted ? ' muted' : '');
      label.innerHTML = `<span class="mute-dot"></span>${rowData.label}`;
      label.style.fontSize = '.71em';
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
          if (rowData.steps[i]) { const a = ensureAudio(); playSliceAudio(rowData.sliceIndex, a.currentTime, rowData.volume); }
        });
        steps.appendChild(btn);
      }
      row.appendChild(steps);
      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round(rowData.volume*100);
      vol.style.cssText = 'width:48px;flex-shrink:0;';
      vol.title = 'Slice volume';
      vol.addEventListener('input', () => { rowData.volume = parseFloat(vol.value)/100; });
      row.appendChild(vol);
      els.sampleGrid.appendChild(row);
    });
  }

  els.addToSeqBtn.addEventListener('click', () => {
    if (!state.sampler.slices.length) { alert('No slices yet — use Auto-slice or add manual cuts first.'); return; }
    pushUndo();
    pat().sampleRows = state.sampler.slices.map((_, i) => ({
      label: `Sl${i+1}`, sliceIndex: i,
      steps: new Array(STEPS).fill(false), volume: .8, muted: false,
    }));
    buildSampleSequencerGrid();
    // Switch to drums view
    els.viewTabs.forEach(t => { t.classList.toggle('active', t.dataset.view === 'drums'); t.setAttribute('aria-selected', String(t.dataset.view === 'drums')); });
    Object.entries(els.views).forEach(([k, el]) => { el.hidden = k !== 'drums'; });
  });

  // ════════════════════════════════════════════════════════════════
  // CLEAR BUTTON
  // ════════════════════════════════════════════════════════════════

  els.clearBtn.addEventListener('click', () => {
    pushUndo(); const p = pat();
    DRUM_VOICES.forEach(v => p.drums.pattern[v.id].fill(false));
    p.synth.pattern.forEach(r => r.fill(false));
    p.sampleRows.forEach(r => r.steps.fill(false));
    document.querySelectorAll('.step-btn.on, .roll-cell.on').forEach(el => el.classList.remove('on'));
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
  els.synthAttack.addEventListener('input', () => { pat().synth.attack = parseFloat(els.synthAttack.value)/100*.5; });
  els.synthRelease.addEventListener('input', () => { pat().synth.release = parseFloat(els.synthRelease.value)/100*1.2; });
  els.synthCutoff.addEventListener('input', () => { pat().synth.cutoff = parseFloat(els.synthCutoff.value)/100; });
  els.octDown.addEventListener('click', () => { pat().synth.octave = Math.max(0, pat().synth.octave-1); els.octReadout.textContent = pat().synth.octave; });
  els.octUp.addEventListener('click', () => { pat().synth.octave = Math.min(7, pat().synth.octave+1); els.octReadout.textContent = pat().synth.octave; });

  function buildPianoRoll() {
    els.rollGrid.innerHTML = '';
    const p = pat();
    els.rollGrid.style.gridTemplateRows = `repeat(${ROLL_SEMITONES}, var(--roll-cell-h))`;
    for (let row = 0; row < ROLL_SEMITONES; row++) {
      const isBlack = [1,3,6,8,10].includes((11 - (row % 12) + 12) % 12);
      for (let col = 0; col < STEPS; col++) {
        const cell = document.createElement('div');
        cell.className = 'roll-cell' + (isBlack ? ' roll-row-black' : '') + (p.synth.pattern[row][col] ? ' on' : '');
        cell.dataset.step = col; cell.dataset.row = row;
        cell.addEventListener('click', () => {
          pushUndo();
          p.synth.pattern[row][col] = !p.synth.pattern[row][col];
          cell.classList.toggle('on', p.synth.pattern[row][col]);
          if (p.synth.pattern[row][col]) {
            const a = ensureAudio();
            playSynthNote((p.synth.octave + 2)*12 - row, a.currentTime, stepDuration()*.85);
          }
        });
        els.rollGrid.appendChild(cell);
      }
    }
  }

  const KEY_LAYOUT = [
    {note:0,type:'white',char:'a'},{note:1,type:'black',char:'w'},
    {note:2,type:'white',char:'s'},{note:3,type:'black',char:'e'},
    {note:4,type:'white',char:'d'},{note:5,type:'white',char:'f'},
    {note:6,type:'black',char:'t'},{note:7,type:'white',char:'g'},
    {note:8,type:'black',char:'y'},{note:9,type:'white',char:'h'},
    {note:10,type:'black',char:'u'},{note:11,type:'white',char:'j'},
    {note:12,type:'white',char:'k'},
  ];

  function buildKeyboard() {
    els.keyboard.innerHTML = '';
    const charToEl = {};
    KEY_LAYOUT.forEach(k => {
      const el = document.createElement('div');
      el.className = 'key' + (k.type === 'black' ? ' black' : '');
      el.textContent = k.char.toUpperCase();
      const trigger = () => {
        const midi = (pat().synth.octave + 4)*12 + k.note - 12;
        const a = ensureAudio(); playSynthNote(midi, a.currentTime, .18); el.classList.add('active');
      };
      const release = () => el.classList.remove('active');
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
      if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
      const k = e.key.toLowerCase();
      if (charToEl[k] && !pressed.has(k)) { pressed.add(k); charToEl[k].dispatchEvent(new MouseEvent('mousedown')); }
    });
    document.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      if (charToEl[k]) { pressed.delete(k); charToEl[k].dispatchEvent(new MouseEvent('mouseup')); }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // SAMPLER — load, waveform, chop (auto + manual), pads
  // ════════════════════════════════════════════════════════════════

  els.dropZone.addEventListener('click', () => els.fileInput.click());
  ['dragover','dragenter'].forEach(evt => els.dropZone.addEventListener(evt, e => { e.preventDefault(); els.dropZone.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach(evt => els.dropZone.addEventListener(evt, e => { e.preventDefault(); els.dropZone.classList.remove('drag-over'); }));
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
        drawWaveform(buffer);
        els.samplePads.innerHTML = '';
      }, () => alert('Could not decode that audio file. Try WAV or MP3.'));
    };
    reader.readAsArrayBuffer(file);
  }

  function drawWaveform(buffer) {
    const canvas = els.waveCanvas;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    canvas.width = cssW * dpr; canvas.height = 120 * dpr;
    const cx = canvas.getContext('2d');
    cx.scale(dpr, dpr);
    cx.clearRect(0, 0, cssW, 120);

    // Draw waveform
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / cssW);
    cx.strokeStyle = '#5c9eff'; cx.lineWidth = 1; cx.beginPath();
    for (let i = 0; i < cssW; i++) {
      let mn = 1, mx = -1;
      for (let j = 0; j < step; j++) { const v = data[i*step+j]||0; if(v<mn)mn=v; if(v>mx)mx=v; }
      cx.moveTo(i, 60 + mn*58); cx.lineTo(i, 60 + mx*58);
    }
    cx.stroke();

    drawSliceMarkers();
  }

  function drawSliceMarkers() {
    if (!state.sampler.buffer) return;
    const canvas = els.waveCanvas;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cx = canvas.getContext('2d');
    const dur = state.sampler.buffer.duration;

    cx.strokeStyle = 'rgba(201,162,104,0.85)';
    cx.lineWidth = 2;
    state.sampler.slices.forEach((s, idx) => {
      if (s.start === 0 && idx === 0) return; // don't draw line at very start
      const x = (s.start / dur) * cssW;
      cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, 120); cx.stroke();
      // Label
      cx.fillStyle = 'rgba(201,162,104,0.9)';
      cx.font = `bold ${Math.round(9 * dpr)}px monospace`;
      cx.fillText(`${idx+1}`, x+3, 14);
    });
  }

  // ── Chop Mode toggle ──────────────────────────────────────────
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
    });
  });

  // ── Auto chop ─────────────────────────────────────────────────
  els.chopCount.addEventListener('input', () => { els.chopCountReadout.textContent = els.chopCount.value; });

  els.chopBtn.addEventListener('click', () => {
    if (!state.sampler.buffer) return;
    const n = parseInt(els.chopCount.value, 10);
    const dur = state.sampler.buffer.duration;
    state.sampler.slices = Array.from({length:n}, (_,i) => ({
      start: dur/n*i, end: dur/n*(i+1)
    }));
    drawWaveform(state.sampler.buffer);
    buildSamplePads();
  });

  // ── Manual chop ───────────────────────────────────────────────
  // Click on waveform = add cut point; right-click nearest marker = remove.
  // Cursor line tracks mouse position.

  const waveContainer = els.waveCanvas.parentElement; // .waveform-container

  waveContainer.addEventListener('mousemove', e => {
    if (state.chopMode !== 'manual') return;
    const rect = waveContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    els.chopCursor.style.left = x + 'px';
    els.chopCursor.hidden = false;
  });
  waveContainer.addEventListener('mouseleave', () => { els.chopCursor.hidden = true; });

  waveContainer.addEventListener('click', e => {
    if (state.chopMode !== 'manual' || !state.sampler.buffer) return;
    const rect = waveContainer.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const timePos = xFrac * state.sampler.buffer.duration;

    // Don't allow very near the start or end
    if (timePos < .01 || timePos > state.sampler.buffer.duration - .01) return;
    // Don't add duplicate
    const tooClose = state.sampler.slices.some(s => Math.abs(s.start - timePos) < .02);
    if (tooClose) return;

    // Rebuild slices from all cut points + implicit 0 start
    const cutPoints = [
      0,
      ...state.sampler.slices.map(s => s.start).filter(t => t > 0),
      timePos
    ].sort((a,b) => a-b);
    const dur = state.sampler.buffer.duration;
    state.sampler.slices = cutPoints.map((t, i) => ({
      start: t,
      end: i < cutPoints.length-1 ? cutPoints[i+1] : dur
    }));
    drawWaveform(state.sampler.buffer);
    buildSamplePads();
  });

  waveContainer.addEventListener('contextmenu', e => {
    if (state.chopMode !== 'manual' || !state.sampler.buffer) return;
    e.preventDefault();
    const rect = waveContainer.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const timePos = xFrac * state.sampler.buffer.duration;
    const dur = state.sampler.buffer.duration;

    // Find nearest slice start > 0 within 3% of total duration
    const threshold = dur * .03;
    const nearest = state.sampler.slices.find(s => s.start > 0 && Math.abs(s.start - timePos) < threshold);
    if (!nearest) return;

    // Remove that cut point and rebuild
    const cutPoints = state.sampler.slices.map(s => s.start).filter(t => t !== nearest.start);
    if (!cutPoints.length || cutPoints[0] !== 0) cutPoints.unshift(0);
    cutPoints.sort((a,b) => a-b);
    state.sampler.slices = cutPoints.map((t, i) => ({
      start: t,
      end: i < cutPoints.length-1 ? cutPoints[i+1] : dur
    }));
    drawWaveform(state.sampler.buffer);
    buildSamplePads();
  });

  els.clearChopsBtn.addEventListener('click', () => {
    state.sampler.slices = [];
    if (state.sampler.buffer) drawWaveform(state.sampler.buffer);
    els.samplePads.innerHTML = '';
  });

  // ── Sample Pads ───────────────────────────────────────────────

  function buildSamplePads() {
    els.samplePads.innerHTML = '';
    const keys = ['1','2','3','4','5','6','7','8','9','0','q','w','e','r','t','y'];
    state.sampler.slices.forEach((slice, i) => {
      const pad = document.createElement('button');
      pad.className = 'sample-pad';
      pad.innerHTML = `<span>SLICE ${i+1}</span><span class="pad-key">${(keys[i]||'').toUpperCase()}</span>`;
      pad.addEventListener('click', () => {
        const a = ensureAudio(); playSliceAudio(i, a.currentTime, .9);
        pad.classList.add('playing'); setTimeout(() => pad.classList.remove('playing'), 140);
      });
      els.samplePads.appendChild(pad);
    });
  }

  els.addToPadsBtn.addEventListener('click', () => {
    if (!state.sampler.slices.length) { alert('No slices yet.'); return; }
    buildSamplePads();
  });

  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    const keys = ['1','2','3','4','5','6','7','8','9','0','q','w','e','r','t','y'];
    const idx = keys.indexOf(e.key.toLowerCase());
    if (idx !== -1 && state.sampler.slices[idx]) {
      const padEl = els.samplePads.children[idx];
      const a = ensureAudio(); playSliceAudio(idx, a.currentTime, .9);
      if (padEl) { padEl.classList.add('playing'); setTimeout(() => padEl.classList.remove('playing'), 140); }
    }
  });

  // ════════════════════════════════════════════════════════════════
  // SAVE / LOAD
  // ════════════════════════════════════════════════════════════════

  const STORAGE_KEY = 'pad01_projects_v3';

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
    projects[name] = {
      bpm: state.bpm, swing: state.swing,
      patterns: JSON.parse(JSON.stringify(state.patterns)),
      activePatternIdx: state.activePatternIdx,
      chain: [...state.chain], chainMode: state.chainMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    refreshLoadSelect(); els.loadSelect.value = name;
  });

  els.loadSelect.addEventListener('change', () => {
    const name = els.loadSelect.value; if (!name) return;
    const saved = getProjects()[name]; if (!saved) return;
    pushUndo();
    state.bpm = saved.bpm; els.bpmInput.value = saved.bpm;
    state.swing = saved.swing||0; els.swingInput.value = state.swing;
    if (saved.patterns) {
      state.patterns = saved.patterns;
      state.activePatternIdx = saved.activePatternIdx||0;
      state.chain = saved.chain||[0];
      state.chainMode = saved.chainMode||'pattern';
    }
    rebuildAllUI(); buildPatternLibrary(); buildChainUI();
  });

  // ════════════════════════════════════════════════════════════════
  // REBUILD ALL UI
  // ════════════════════════════════════════════════════════════════

  function rebuildAllUI() {
    buildDrumGrid();
    buildDrumMixer();
    buildPianoRoll();
    buildSampleSequencerGrid();
    const p = pat();
    els.octReadout.textContent = p.synth.octave;
    els.synthAttack.value = Math.round((p.synth.attack/.5)*100);
    els.synthRelease.value = Math.round((p.synth.release/1.2)*100);
    els.synthCutoff.value = Math.round(p.synth.cutoff*100);
    els.waveSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === p.synth.waveform));
    els.patternReadout.innerHTML = p.label + '<small> ×1</small>';
    updateUndoRedoBtns();
  }

  // ════════════════════════════════════════════════════════════════
  // WAV EXPORT
  // ════════════════════════════════════════════════════════════════

  els.exportBtn.addEventListener('click', async () => {
    const loopSeconds = (60/state.bpm)*4;
    const sampleRate = 44100;
    const offCtx = new OfflineAudioContext(2, Math.ceil(sampleRate*(loopSeconds+1.5)), sampleRate);
    const offMaster = offCtx.createGain();
    offMaster.gain.value = parseFloat(els.masterVol.value)/100;
    offMaster.connect(offCtx.destination);
    const realCtx = ctx, realMaster = masterGain;
    ctx = offCtx; masterGain = offMaster;
    const dur = stepDuration(); const p = pat();
    for (let i = 0; i < STEPS; i++) {
      const t = i*dur;
      DRUM_VOICES.forEach(v => { if(!p.drums.muted[v.id]&&p.drums.pattern[v.id][i]) playDrum(v.id,t,p.drums.volume[v.id]); });
      p.synth.pattern.forEach((row,ri) => { if(row[i]) playSynthNote((p.synth.octave+2)*12-ri,t,dur*.85); });
      p.sampleRows.forEach(row => { if(!row.muted&&row.steps[i]) playSliceAudio(row.sliceIndex,t,row.volume); });
    }
    const rendered = await offCtx.startRendering();
    ctx = realCtx; masterGain = realMaster;
    const blob = bufferToWav(rendered);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pad01-loop.wav';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function bufferToWav(buffer) {
    const nc = buffer.numberOfChannels, sr = buffer.sampleRate, nf = buffer.length;
    const ba = nc*2, ds = nf*ba, ab = new ArrayBuffer(44+ds), v = new DataView(ab);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');v.setUint32(4,36+ds,true);ws(8,'WAVE');ws(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nc,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*ba,true);v.setUint16(32,ba,true);
    v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,ds,true);
    const ch=Array.from({length:nc},(_,c)=>buffer.getChannelData(c));
    let off=44;
    for(let i=0;i<nf;i++) for(let c=0;c<nc;c++){const s=Math.max(-1,Math.min(1,ch[c][i]));v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true);off+=2;}
    return new Blob([ab],{type:'audio/wav'});
  }

  // ════════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════════

  buildDrumGrid();
  buildDrumMixer();
  buildSampleSequencerGrid();
  buildPianoRoll();
  buildKeyboard();
  buildPatternLibrary();
  buildChainUI();
  refreshLoadSelect();
  updatePlayheadUI(-1);
  updateUndoRedoBtns();
  initPanels();       // must come after DOM is ready
  loadZoomState();
  applyZoom();

})();
