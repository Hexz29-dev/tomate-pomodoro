'use strict';

/* =========================================================
   Tomate: timer Pomodoro com estatísticas.
   Dados no localStorage; animações com Motion (motion.dev).
   ========================================================= */

const STORAGE_KEY = 'tomate.v1';
const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15, longEvery: 4, goal: 8, autoStart: false, sound: true, notify: false };
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 90], longEvery: [2, 12], goal: [1, 24] };
const FLAGS = ['autoStart', 'sound', 'notify'];
const MODE_NAMES = { focus: 'Foco', short: 'Pausa curta', long: 'Pausa longa' };
const SVGNS = 'http://www.w3.org/2000/svg';

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Motion: tudo passa por aqui, e tudo funciona sem ele ---------- */

const M = window.Motion || null;
const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const canAnimate = () => !!M && !reduceMQ.matches;
const SPRING = { type: 'spring', stiffness: 420, damping: 32 };
const SPRING_SOFT = { type: 'spring', stiffness: 240, damping: 20 };
const EASE_OUT = [0.22, 1, 0.36, 1];

function animate(target, keyframes, options) {
  if (!target || !canAnimate()) return null;
  try { return M.animate(target, keyframes, options); } catch (err) { console.warn('[motion]', err); return null; }
}
function tween(from, to, options) {
  if (!canAnimate()) { options.onUpdate?.(to); return null; }
  try { return M.animate(from, to, options); } catch (err) { console.warn('[motion]', err); options.onUpdate?.(to); return null; }
}
const stagger = (each, opts) => (M ? M.stagger(each, opts) : 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const finished = (anim, max = 1500) => (anim ? Promise.race([Promise.resolve(anim).catch(() => {}), wait(max)]) : Promise.resolve());

/* ---------- formatação ---------- */

function fmtMin(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d; };
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const clock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const weekdayShort = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const monthShort = (d) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const longDate = (d) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });

/* ---------- estado e persistência ---------- */

function cleanSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(LIMITS)) {
      const n = Math.round(Number(raw[k]));
      if (raw[k] !== '' && raw[k] != null && Number.isFinite(n)) s[k] = clamp(n, ...LIMITS[k]);
    }
    for (const k of FLAGS) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  }
  return s;
}

function cleanSessions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && Number.isFinite(s.end) && Number.isFinite(s.minutes) && s.minutes > 0)
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : newId(),
      start: Number.isFinite(s.start) ? s.start : s.end - s.minutes * 60000,
      end: s.end,
      minutes: Math.round(s.minutes),
      task: typeof s.task === 'string' ? s.task.slice(0, 80) : '',
    }));
}

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const settings = cleanSettings(d.settings);
  const t = d.timer && typeof d.timer === 'object' ? d.timer : {};
  const mode = MODE_NAMES[t.mode] ? t.mode : 'focus';
  const total = Number.isFinite(t.total) && t.total > 0 ? t.total : settings[mode] * 60000;
  const running = t.running === true && Number.isFinite(t.endsAt);
  return {
    settings,
    sessions: cleanSessions(d.sessions),
    timer: {
      mode,
      total,
      running,
      endsAt: running ? t.endsAt : null,
      remainingMs: Number.isFinite(t.remainingMs) ? clamp(t.remainingMs, 0, total) : total,
      cycle: Number.isInteger(t.cycle) && t.cycle >= 0 ? t.cycle : 0,
      task: typeof t.task === 'string' ? t.task.slice(0, 80) : '',
    },
  };
}

function load() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { return normalize(null); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* armazenamento indisponível */ }
}

let state = load();
function commit() { save(); render(); }

/* ---------- lógica do timer ---------- */

const remaining = () => (state.timer.running ? Math.max(0, state.timer.endsAt - Date.now()) : state.timer.remainingMs);
const hasProgress = () => state.timer.running || state.timer.remainingMs < state.timer.total;

function setPeriod(mode, run) {
  const t = state.timer;
  t.mode = mode;
  t.total = state.settings[mode] * 60000;
  t.remainingMs = t.total;
  t.running = !!run;
  t.endsAt = run ? Date.now() + t.total : null;
}

function start() {
  const t = state.timer;
  if (t.running) return;
  unlockAudio();
  if (t.remainingMs <= 0) t.remainingMs = t.total;
  t.endsAt = Date.now() + t.remainingMs;
  t.running = true;
  commit();
  // o "clique" do botão do timer ao ser acionado
  animate(el.knobWrap, { scale: [0.95, 1] }, SPRING_SOFT);
}

function pause() {
  const t = state.timer;
  if (!t.running) return;
  t.remainingMs = Math.max(0, t.endsAt - Date.now());
  t.running = false;
  t.endsAt = null;
  commit();
}

const toggle = () => (state.timer.running ? pause() : start());

function reset() {
  setPeriod(state.timer.mode, false);
  commit();
}

function chooseMode(mode) {
  const t = state.timer;
  if (mode === t.mode && !hasProgress()) return;
  if (hasProgress() && !confirm('Trocar agora descarta o tempo deste período. Continuar?')) return;
  setPeriod(mode, false);
  commit();
}

function skip() {
  const t = state.timer;
  if (t.mode === 'focus' && hasProgress() && !confirm('Pular agora descarta este tomate. Continuar?')) return;
  let next;
  if (t.mode === 'focus') {
    next = t.cycle >= state.settings.longEvery ? 'long' : 'short';
  } else {
    if (t.mode === 'long') t.cycle = 0;
    next = 'focus';
  }
  setPeriod(next, false);
  commit();
}

function complete({ silent = false } = {}) {
  const t = state.timer;
  const endedAt = t.endsAt ?? Date.now();
  const finishedMode = t.mode;
  let next;

  if (finishedMode === 'focus') {
    state.sessions.push({
      id: newId(),
      start: endedAt - t.total,
      end: endedAt,
      minutes: Math.max(1, Math.round(t.total / 60000)),
      task: t.task.trim(),
    });
    t.cycle += 1;
    next = t.cycle >= state.settings.longEvery ? 'long' : 'short';
  } else {
    if (finishedMode === 'long') t.cycle = 0;
    next = 'focus';
  }

  if (!silent && canAnimate()) dialHoldUntil = Date.now() + 900; // o botão "toca" no zero antes de dar corda de novo
  setPeriod(next, !silent && state.settings.autoStart);
  commit();
  if (!silent) announce(finishedMode);
}

function tick() {
  const t = state.timer;
  if (t.running && !drag && Date.now() >= t.endsAt) complete();
  else renderTimer();
}

/* Ajustar o tempo girando o botão.
   Antes de começar: muda a duração do modo (fica salva nos ajustes).
   Com o período em andamento: muda só o tempo restante. */
function maxMinutes(idle) {
  const scaleMin = scaleMs(state.timer.total) / 60000;
  return idle ? Math.min(scaleMin, LIMITS[state.timer.mode][1]) : scaleMin;
}

function setTimerMinutes(minutes, idle) {
  const t = state.timer;
  if (idle) {
    state.settings[t.mode] = clamp(minutes, ...LIMITS[t.mode]);
    setPeriod(t.mode, false);
    commit();
    toast(`${MODE_NAMES[t.mode]} agora dura ${fmtMin(state.settings[t.mode])}.`);
  } else {
    const ms = minutes * 60000;
    const elapsed = Math.max(0, t.total - remaining()); // o tempo já focado continua valendo
    t.total = elapsed + ms;
    t.remainingMs = ms;
    if (t.running) t.endsAt = Date.now() + ms;
    commit();
  }
}

/* ---------- som, notificação, aviso ---------- */

let audioCtx = null;

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx && AC) audioCtx = new AC();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function bell() {
  if (!state.settings.sound || !audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.45, 0.9].forEach((offset) => {
    [[880, 0.25], [1320, 0.08]].forEach(([freq, vol]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(vol, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.42);
    });
  });
}

function announce(finishedMode) {
  const msg = finishedMode === 'focus' ? 'Tomate concluído. Hora de uma pausa.' : 'Pausa encerrada. Hora de focar.';
  bell();
  ring();
  toast(msg);
  if (state.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Tomate', { body: msg, icon: 'favicon.svg' }); } catch { /* sem suporte */ }
  }
}

/* o timer "toca": o mostrador balança e a marca do zero pisca */
function ring() {
  animate(el.dial, { rotate: [0, -5, 4.5, -3.5, 2.5, -1.2, 0] }, { duration: 0.85, ease: 'easeOut' });
  animate(el.zeroTick, { opacity: [1, 0.15, 1, 0.15, 1] }, { duration: 0.9 });
}

let toastTimer;
function toast(msg) {
  const node = el.toast;
  node.textContent = msg;
  clearTimeout(toastTimer);
  if (canAnimate()) animate(node, { opacity: [0, 1], y: [24, 0], scale: [0.96, 1] }, SPRING);
  else node.style.opacity = '1';
  toastTimer = setTimeout(() => {
    if (canAnimate()) animate(node, { opacity: 0, y: 10 }, { duration: 0.22 });
    else node.style.opacity = '0';
  }, 3800);
}

/* ---------- elementos ---------- */

const el = {
  dial: $('#dial'),
  sector: $('#sector'),
  arc: $('#arc'),
  mark: $('#mark'),
  ticks: $('#ticks'),
  knob: $('#knob'),
  knobWrap: $('#knobWrap'),
  readout: $('#readout'),
  modeLabel: $('#modeLabel'),
  cycle: $('#cycle'),
  toggle: $('#toggle'),
  toggleIcon: $('#toggleIcon'),
  toggleLabel: $('#toggleLabel'),
  task: $('#task'),
  modes: [...document.querySelectorAll('.modes button')],
  pill: $('#modesPill'),
  favicon: $('#favicon'),
  toast: $('#toast'),
  tip: $('#tip'),
  meter: $('#meter'),
  plot: $('#plot'),
  days: $('#days'),
  zeroTick: null,
  miniBar: $('#miniBar'),
  miniClock: $('#miniClock'),
  miniMode: $('#miniMode'),
  miniToggle: $('#miniToggle'),
};

/* ---------- mostrador (geometria do logo, em 512×512) ---------- */

const CX = 256;
const CY = 256;
const R_ARC = 192;
const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
};

const ticks = [];
for (let i = 0; i < 60; i++) {
  const major = i % 5 === 0;
  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('x1', CX);
  line.setAttribute('x2', CX);
  line.setAttribute('y1', i === 0 ? 52 : major ? 56 : 63);
  line.setAttribute('y2', i === 0 ? 76 : 72);
  line.setAttribute('pathLength', '1');
  line.setAttribute('transform', `rotate(${i * 6} ${CX} ${CY})`);
  line.setAttribute('class', `tick${major ? ' major' : ''}${i === 0 ? ' zero' : ''}`);
  el.ticks.append(line);
  ticks.push(line);
}
el.zeroTick = ticks[0];

/* escala de 60 min como num timer de cozinha; períodos maiores esticam a escala */
const scaleMs = (total) => (total <= 3600000 ? 3600000 : Math.ceil(total / 900000) * 900000);
const angleFor = (ms, total) => (ms / scaleMs(total)) * 360;

function arcD(deg, closed) {
  if (deg <= 0.05) return '';
  if (deg >= 359.95) {
    const ring = `M ${CX} ${CY - R_ARC} A ${R_ARC} ${R_ARC} 0 1 1 ${CX} ${CY + R_ARC} A ${R_ARC} ${R_ARC} 0 1 1 ${CX} ${CY - R_ARC}`;
    return closed ? `${ring} Z` : ring;
  }
  const [x, y] = polar(R_ARC, deg);
  const large = deg > 180 ? 1 : 0;
  const arc = `A ${R_ARC} ${R_ARC} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  return closed ? `M ${CX} ${CY} L ${CX} ${CY - R_ARC} ${arc} Z` : `M ${CX} ${CY - R_ARC} ${arc}`;
}

let dialAngle = null;
let dialTween = null;
let dialHoldUntil = 0;
let ticksOn = -1;

function setDial(angle) {
  dialAngle = angle;
  const a = clamp(angle, 0, 360);
  el.sector.setAttribute('d', arcD(a, true));
  el.arc.setAttribute('d', arcD(a, false));
  el.mark.setAttribute('transform', `rotate(${a.toFixed(2)} ${CX} ${CY})`);
  el.mark.style.opacity = a > 0.5 ? '1' : '0';
  el.knob.setAttribute('transform', `rotate(${angle.toFixed(2)} ${CX} ${CY})`); // o botão pode passar do ponto na mola
  const on = Math.floor(a / 6 + 1e-6);
  if (on !== ticksOn) {
    ticksOn = on;
    ticks.forEach((t, i) => t.classList.toggle('on', i <= on));
  }
}

/* passos pequenos (o tempo correndo) vão direto; saltos (reiniciar, trocar de modo) dão corda com mola */
function updateDial(target) {
  if (dialTween || Date.now() < dialHoldUntil) return;
  if (dialAngle === null || Math.abs(target - dialAngle) < 3 || !canAnimate()) {
    setDial(target);
    return;
  }
  dialTween = tween(dialAngle, target, { type: 'spring', stiffness: 110, damping: 15, onUpdate: setDial });
  finished(dialTween, 2200).then(() => {
    dialTween = null;
    setDial(angleFor(remaining(), state.timer.total));
  });
}

/* ---------- visor com dígitos que rolam ---------- */

let slots = [];
let lastText = '';
let lastSecs = null;
let booted = false;

function setReadout(text, secs) {
  const chars = [...text];
  if (slots.length !== chars.length) {
    el.readout.textContent = '';
    slots = chars.map((ch) => {
      const s = document.createElement('span');
      if (ch === ':') { s.className = 'colon'; s.textContent = ':'; } else s.className = 'slot-d';
      el.readout.append(s);
      return s;
    });
  }
  const up = lastSecs !== null && secs > lastSecs;
  chars.forEach((ch, i) => {
    const slot = slots[i];
    if (ch === ':' || slot.dataset.v === ch) return;
    roll(slot, ch, up);
  });
  lastSecs = secs;
}

function roll(slot, ch, up) {
  slot.dataset.v = ch;
  [...slot.children].slice(0, -1).forEach((c) => c.remove());
  const old = slot.lastElementChild;
  const nu = document.createElement('span');
  nu.textContent = ch;
  slot.append(nu);
  if (!old) return;
  if (!booted || !canAnimate()) { old.remove(); return; }
  // contagem regressiva: o número novo desce de cima; ao reiniciar, sobe de baixo
  animate(nu, { y: [up ? '100%' : '-100%', '0%'] }, { duration: 0.42, ease: EASE_OUT });
  finished(animate(old, { y: ['0%', up ? '-100%' : '100%'], opacity: [1, 0] }, { duration: 0.42, ease: EASE_OUT }), 700)
    .then(() => old.remove());
}

/* ---------- favicon que mostra o progresso ---------- */

const favCanvas = document.createElement('canvas');
favCanvas.width = favCanvas.height = 64;
let favKey = '';

function updateFavicon(angle, mode, active) {
  const key = active ? `${Math.round(angle)}|${mode}` : 'idle';
  if (key === favKey) return;
  favKey = key;
  if (!active) { el.favicon.href = 'favicon.svg'; return; }
  const c = favCanvas.getContext('2d');
  if (!c) return;
  const a = (clamp(angle, 0, 360) * Math.PI) / 180;
  c.clearRect(0, 0, 64, 64);
  c.fillStyle = '#F2F0EB';
  c.beginPath();
  if (c.roundRect) c.roundRect(0, 0, 64, 64, 14); else c.rect(0, 0, 64, 64);
  c.fill();
  if (a > 0.01) {
    c.strokeStyle = mode === 'focus' ? '#FF3B00' : '#141413';
    c.lineWidth = 7;
    c.beginPath();
    c.arc(32, 32, 25, -Math.PI / 2, -Math.PI / 2 + a);
    c.stroke();
  }
  c.fillStyle = '#141413';
  c.beginPath();
  c.arc(32, 32, 16.5, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#FF3B00';
  c.lineWidth = 5;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(32 + 2 * Math.sin(a), 32 - 2 * Math.cos(a));
  c.lineTo(32 + 12 * Math.sin(a), 32 - 12 * Math.cos(a));
  c.stroke();
  el.favicon.href = favCanvas.toDataURL('image/png');
}

/* ---------- renderização: timer ---------- */

const ICONS = { start: 'M8 5.5l11 6.5-11 6.5z', resume: 'M8 5.5l11 6.5-11 6.5z', pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' };
const LABELS = { start: 'Iniciar', resume: 'Continuar', pause: 'Pausar' };

function setToggle(kind) {
  if (el.toggle.dataset.kind === kind) return;
  el.toggle.dataset.kind = kind;
  el.toggleIcon.setAttribute('d', ICONS[kind]);
  el.toggleLabel.textContent = LABELS[kind];
  if (booted) animate([el.toggleLabel, el.toggleIcon.parentNode], { y: [8, 0], opacity: [0, 1] }, { duration: 0.25, ease: EASE_OUT });
}

let pillKey = '';
function placePill(animated) {
  const b = el.modes.find((x) => x.dataset.mode === state.timer.mode);
  if (!b || !b.offsetWidth) return;
  const x = b.offsetLeft;
  const w = b.offsetWidth;
  const key = `${x}|${w}`;
  if (key === pillKey) return;
  pillKey = key;
  if (M) {
    animate(el.pill, { x, width: w }, animated && canAnimate() ? SPRING : { duration: 0 });
    if (canAnimate()) return;
  }
  el.pill.style.width = `${w}px`;
  el.pill.style.transform = `translateX(${x}px)`;
}

function renderTimer() {
  const t = state.timer;
  const ms = drag ? drag.ms : remaining();
  const secs = Math.ceil(ms / 1000);
  const text = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  const paused = !t.running && t.remainingMs < t.total;
  const angle = angleFor(ms, t.total);

  if (text !== lastText) {
    setReadout(text, secs);
    lastText = text;
    el.readout.setAttribute('aria-label', `${text} restantes`);
  }
  document.title = t.running || paused ? `${text} – ${MODE_NAMES[t.mode]}${paused ? ' (pausado)' : ''}` : 'Tomate';

  if (!drag) updateDial(angle);
  updateFavicon(angle, t.mode, t.running || paused);
  el.dial.setAttribute('aria-valuemax', String(scaleMs(t.total) / 60000));
  el.dial.setAttribute('aria-valuenow', String(Math.round(ms / 60000)));
  el.dial.setAttribute('aria-valuetext', `${text} restantes`);

  el.modeLabel.textContent = paused ? 'Pausado' : MODE_NAMES[t.mode];
  const kind = t.running ? 'pause' : paused ? 'resume' : 'start';
  setToggle(kind);
  el.miniClock.textContent = text;
  el.miniMode.textContent = el.modeLabel.textContent;
  el.miniToggle.textContent = LABELS[kind];

  document.body.dataset.mode = t.mode;
  document.body.classList.toggle('is-running', t.running);
  document.body.classList.toggle('is-focusing', t.running && t.mode === 'focus');
  el.modes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === t.mode)));
  placePill(booted);

  const every = state.settings.longEvery;
  el.cycle.textContent =
    t.mode === 'focus' ? `Tomate ${Math.min(t.cycle + 1, every)} de ${every} até a pausa longa`
    : t.mode === 'short' ? `${Math.min(t.cycle, every)} de ${every} no ciclo`
    : 'Ciclo completo';

  if (document.activeElement !== el.task) el.task.value = t.task;
}

/* ---------- renderização: estatísticas ---------- */

function groupByDay() {
  const map = new Map();
  for (const s of state.sessions) {
    const k = dayKey(s.end);
    const v = map.get(k) || { count: 0, minutes: 0 };
    v.count += 1;
    v.minutes += s.minutes;
    map.set(k, v);
  }
  return map;
}

function level(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 7) return 3;
  return 4;
}

/* números que contam até o valor novo */
function countTo(node, value, fmt, intro) {
  const prev = node.dataset.v === undefined ? (intro ? 0 : value) : Number(node.dataset.v);
  node.dataset.v = String(value);
  if (prev === value || !canAnimate()) { node.textContent = fmt(value); return; }
  tween(prev, value, {
    duration: intro ? 1.1 : 0.7,
    ease: EASE_OUT,
    onUpdate: (v) => { node.textContent = fmt(Math.round(v)); },
  });
}

let firstStats = true;
let prevToday = { key: null, count: null };
let prevSessionIds = new Set();

function renderStats() {
  const intro = firstStats;
  firstStats = false;
  const map = groupByDay();
  const today = startOfDay(Date.now());
  const todayKey = dayKey(today);
  const tv = map.get(todayKey) || { count: 0, minutes: 0 };
  const gained = !intro && prevToday.key === todayKey && tv.count > prevToday.count;
  prevToday = { key: todayKey, count: tv.count };

  renderToday(tv, intro, gained);
  renderFigures(map, today, intro);
  renderBars(map, today, intro);
  renderHeatmap(map, today, gained);
  renderTasks(today, intro);
  renderSessions(todayKey, intro);
}

function renderToday(tv, intro, gained) {
  const goal = state.settings.goal;
  const countEl = $('#todayCount');
  countTo(countEl, tv.count, String, intro);
  if (gained) animate(countEl, { scale: [1.3, 1] }, SPRING_SOFT);
  $('#todayGoal').textContent = `de ${plural(goal, 'tomate', 'tomates')}`;
  $('#todayMinutes').textContent = tv.minutes ? `${fmtMin(tv.minutes)} de foco` : '';
  $('#todayNote').textContent =
    tv.count === 0 ? 'Nenhum tomate ainda. Escreva no que vai focar e clique em Iniciar.'
    : tv.count >= goal ? 'Meta do dia batida.'
    : `Faltam ${plural(goal - tv.count, 'tomate', 'tomates')} para a meta.`;

  const n = Math.max(goal, tv.count);
  if (el.meter.children.length !== n) el.meter.innerHTML = '<span class="seg"></span>'.repeat(n);
  const segs = [...el.meter.children];
  segs.forEach((s, i) => {
    s.classList.toggle('on', i < tv.count);
    s.classList.toggle('extra', i >= goal && i < tv.count);
  });
  el.meter.setAttribute('aria-label', `${tv.count} de ${goal} tomates da meta de hoje`);

  const filled = segs.slice(0, tv.count);
  if (intro && filled.length) {
    animate(filled, { scaleY: [0, 1] }, { duration: 0.45, ease: EASE_OUT, delay: stagger(0.05, { startDelay: 0.35 }) });
  } else if (gained) {
    animate(segs[tv.count - 1], { scaleY: [0, 1.3, 1] }, { duration: 0.6, ease: EASE_OUT, delay: 0.3 });
    if (tv.count === goal) animate(segs, { y: [0, -7, 0] }, { duration: 0.45, delay: stagger(0.04, { startDelay: 0.8 }) });
  }
}

function renderFigures(map, today, intro) {
  let streak = 0;
  let d = map.has(dayKey(today)) ? today : addDays(today, -1);
  while (map.has(dayKey(d))) { streak++; d = addDays(d, -1); }
  countTo($('#streak'), streak, (v) => plural(v, 'dia', 'dias'), intro);

  let week = 0;
  for (let i = 0; i < 7; i++) week += (map.get(dayKey(addDays(today, -i))) || { minutes: 0 }).minutes;
  countTo($('#average'), Math.round(week / 7), (v) => `${fmtMin(v)} por dia`, intro);

  countTo($('#total'), state.sessions.reduce((sum, s) => sum + s.minutes, 0), fmtMin, intro);
}

/* gráfico de 7 dias: colunas fixas, só a altura muda */
for (let i = 0; i < 7; i++) {
  const col = document.createElement('div');
  col.className = 'col';
  col.innerHTML = '<span class="val"></span><div class="bar"></div>';
  el.plot.append(col);
  el.days.append(document.createElement('span'));
}
const cols = [...el.plot.querySelectorAll('.col')];
const dayLabels = [...el.days.children];

function renderBars(map, today, intro) {
  const goalMin = state.settings.goal * state.settings.focus;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i);
    days.push({ day, key: dayKey(day), minutes: (map.get(dayKey(day)) || { minutes: 0 }).minutes, isToday: i === 0 });
  }
  const max = Math.max(goalMin, 1, ...days.map((x) => x.minutes));
  const SCALE = 84; // % da altura útil; o resto fica para o número acima da barra

  $('#goalLine').style.bottom = `${(goalMin / max) * SCALE}%`;
  $('#goalLineLabel').textContent = `meta ${fmtMin(goalMin)}`;
  const weekTotal = days.reduce((s, x) => s + x.minutes, 0);
  $('#weekTotal').textContent = `${fmtMin(weekTotal)} na semana`;
  $('#chart').setAttribute('aria-label', `Minutos de foco nos últimos 7 dias: ${days.map((x) => `${weekdayShort(x.day)} ${x.minutes}`).join(', ')}`);

  days.forEach((x, i) => {
    const col = cols[i];
    const bar = col.firstElementChild.nextElementSibling;
    const h = x.minutes ? Math.max(2, (x.minutes / max) * SCALE) : 0;
    const prevH = col.dataset.key === x.key ? Number(col.dataset.h) : null;
    col.dataset.key = x.key;
    col.dataset.h = String(h);
    col.dataset.tip = `${longDate(x.day)}: ${x.minutes ? fmtMin(x.minutes) : 'sem foco'}`;
    col.classList.toggle('is-today', x.isToday);
    col.classList.toggle('is-empty', !x.minutes);
    col.firstElementChild.textContent = x.minutes || '';
    dayLabels[i].textContent = x.isToday ? 'hoje' : weekdayShort(x.day);
    dayLabels[i].classList.toggle('is-today', x.isToday);

    if (intro && h && canAnimate()) {
      bar.style.height = `${h}%`;
      animate(bar, { height: ['0%', `${h}%`] }, { duration: 0.8, ease: EASE_OUT, delay: 0.25 + i * 0.05 });
    } else if (prevH !== null && prevH !== h && canAnimate()) {
      bar.style.height = `${h}%`;
      animate(bar, { height: [`${prevH}%`, `${h}%`] }, { duration: 0.6, ease: EASE_OUT, delay: 0.3 });
    } else {
      bar.style.height = `${h}%`;
    }
  });
}

/* quantas semanas cabem na largura disponível (até 53 = um ano), sem rolagem */
function weeksThatFit() {
  const box = $('#heatmapScroll');
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 11;
  const fit = Math.floor((box.clientWidth - 28 + 3) / (cell + 3));
  return clamp(fit || 53, 8, 53);
}

function renderHeatmap(map, today, gained) {
  const weeks = weeksThatFit();
  const start = addDays(today, -((weeks - 1) * 7) - today.getDay()); // domingo da primeira semana mostrada
  const parts = ['<div class="dlabels" style="grid-column:1;grid-row:2 / span 7"><span></span><span>seg</span><span></span><span>qua</span><span></span><span>sex</span><span></span></div>'];

  let week = 0;
  let lastMonth = -1;
  let yearCount = 0;
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow === 0 && d.getMonth() !== lastMonth) {
      if (lastMonth !== -1) parts.push(`<span class="month" style="grid-column:${week + 2} / span 4;grid-row:1">${monthShort(d)}</span>`);
      lastMonth = d.getMonth();
    }
    const v = map.get(dayKey(d));
    const count = v ? v.count : 0;
    yearCount += count;
    const isToday = d.getTime() === today.getTime();
    parts.push(`<div class="cell${isToday ? ' is-today' : ''}" data-level="${level(count)}" style="grid-column:${week + 2};grid-row:${dow + 2}" data-tip="${count ? plural(count, 'tomate', 'tomates') : 'Nenhum tomate'} em ${esc(longDate(d))}"></div>`);
    if (dow === 6) week++;
  }

  const heat = $('#heatmap');
  heat.style.gridTemplateColumns = `auto repeat(${week + 1}, var(--cell))`;
  heat.innerHTML = parts.join('');
  const period = weeks >= 53 ? 'nos últimos 12 meses' : `nas últimas ${weeks} semanas`;
  heat.setAttribute('aria-label', `${plural(yearCount, 'tomate', 'tomates')} ${period}`);
  $('#yearTotal').textContent = `${yearCount} ${period}`;
  if (gained) animate(heat.querySelector('.cell.is-today'), { scale: [1, 2, 1] }, { duration: 0.6, ease: EASE_OUT, delay: 0.4 });
}

function renderTasks(today, intro) {
  const since = addDays(today, -29).getTime();
  const groups = new Map();
  for (const s of state.sessions) {
    if (s.end < since) continue;
    const name = s.task.trim() || 'Sem descrição';
    const key = name.toLocaleLowerCase('pt-BR');
    const g = groups.get(key) || { name, minutes: 0, count: 0 };
    g.minutes += s.minutes;
    g.count += 1;
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 6);
  const box = $('#tasks');
  if (!list.length) {
    box.innerHTML = '<li class="empty">As tarefas em que você focar aparecem aqui.</li>';
    return;
  }
  const max = list[0].minutes;
  box.innerHTML = list.map((g) => `
    <li data-tip="${plural(g.count, 'tomate', 'tomates')}">
      <div class="task-row"><span class="task-name">${esc(g.name)}</span><span class="task-time">${fmtMin(g.minutes)}</span></div>
      <div class="task-track"><div class="task-fill" style="width:${(g.minutes / max) * 100}%"></div></div>
    </li>`).join('');
  if (intro && canAnimate()) {
    box.querySelectorAll('.task-fill').forEach((f, i) => {
      animate(f, { width: ['0%', f.style.width] }, { duration: 0.8, ease: EASE_OUT, delay: 0.35 + i * 0.06 });
    });
  }
}

function renderSessions(todayKey, intro) {
  const list = state.sessions.filter((s) => dayKey(s.end) === todayKey).sort((a, b) => b.end - a.end);
  const box = $('#sessions');
  const known = prevSessionIds;
  prevSessionIds = new Set(list.map((s) => s.id));
  if (!list.length) {
    box.innerHTML = '<li class="empty">Cada tomate concluído hoje aparece aqui.</li>';
    return;
  }
  box.innerHTML = list.map((s) => `
    <li data-id="${esc(s.id)}">
      <span class="s-time">${clock(s.end)}</span>
      <span class="s-task">${esc(s.task || 'Sem descrição')}</span>
      <span class="s-min">${fmtMin(s.minutes)}</span>
      <button type="button" class="s-remove" data-remove="${esc(s.id)}" aria-label="Remover a sessão das ${clock(s.end)}">Remover</button>
    </li>`).join('');
  if (!intro) {
    box.querySelectorAll('li[data-id]').forEach((li) => {
      if (!known.has(li.dataset.id)) animate(li, { opacity: [0, 1], x: [-16, 0] }, { ...SPRING, delay: 0.3 });
    });
  }
}

function render() {
  renderTimer();
  renderStats();
}

/* ---------- girar o botão ---------- */

let drag = null;

function pointerOnDial(e) {
  const r = el.dial.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  return { angle: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360, dist: Math.hypot(dx, dy), radius: r.width / 2 };
}

/* clique curto a cada minuto, como os dentes de um timer mecânico */
function detent() {
  try { navigator.vibrate?.(4); } catch { /* sem suporte */ }
  if (!state.settings.sound || !audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 2400;
  gain.gain.setValueAtTime(0.035, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.03);
}

el.dial.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag) return;
  const p = pointerOnDial(e);
  if (p.dist > p.radius) return; // cantos fora do círculo
  e.preventDefault();
  el.dial.setPointerCapture(e.pointerId);
  unlockAudio();
  if (dialTween) { dialTween.stop?.(); dialTween = null; }
  dialHoldUntil = 0;
  const t = state.timer;
  const ms = remaining();
  const scale = scaleMs(t.total);
  drag = {
    id: e.pointerId,
    idle: !hasProgress(),
    scale,
    last: p.angle,
    angle: (ms / scale) * 360,
    ms,
    minutes: Math.round(ms / 60000),
    moved: false,
    travel: 0,
  };
  el.dial.classList.add('is-dragging');
  animate(el.knobWrap, { scale: 0.97 }, SPRING);
});

el.dial.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const p = pointerOnDial(e);
  if (p.dist < p.radius * 0.08) return; // perto demais do centro, o ângulo fica instável
  let delta = p.angle - drag.last;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  drag.last = p.angle;
  drag.angle = clamp(drag.angle + delta, 0, 360);
  drag.travel += Math.abs(delta);
  if (drag.travel < 4) return; // um clique sem querer não mexe no tempo
  const scaleMin = drag.scale / 60000;
  const minutes = clamp(Math.round((drag.angle / 360) * scaleMin), 1, maxMinutes(drag.idle));
  if (minutes === drag.minutes && drag.moved) return;
  drag.minutes = minutes;
  drag.ms = minutes * 60000;
  drag.moved = true;
  detent();
  setDial((drag.ms / drag.scale) * 360);
  renderTimer();
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const done = drag;
  drag = null;
  el.dial.classList.remove('is-dragging');
  animate(el.knobWrap, { scale: 1 }, SPRING_SOFT);
  if (done.moved) setTimerMinutes(done.minutes, done.idle);
  else renderTimer();
}
el.dial.addEventListener('pointerup', endDrag);
el.dial.addEventListener('pointercancel', endDrag);
el.dial.addEventListener('lostpointercapture', endDrag);

/* teclado: setas ±1 min, PageUp/PageDown ±5 min */
el.dial.addEventListener('keydown', (e) => {
  const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
  if (!(e.key in steps) || drag) return;
  e.preventDefault();
  const idle = !hasProgress();
  const current = Math.round(remaining() / 60000);
  const minutes = clamp(current + steps[e.key], 1, maxMinutes(idle));
  if (minutes === current && Math.abs(remaining() - current * 60000) < 1000) return;
  unlockAudio();
  detent();
  setTimerMinutes(minutes, idle);
});

/* ---------- celular ---------- */

const mqSheet = window.matchMedia('(max-width: 600px)');
const mqCompact = window.matchMedia('(max-width: 600px), (orientation: landscape) and (max-height: 520px)');

/* no celular o rótulo do campo fica escondido, então a pergunta vai para o placeholder */
function setTaskPlaceholder() {
  el.task.placeholder = mqCompact.matches ? 'No que você vai focar?' : 'Ex.: estudar cálculo';
}
setTaskPlaceholder();
mqCompact.addEventListener('change', setTaskPlaceholder);

/* barra fixa com tempo e Iniciar/Pausar quando os controles saem da tela */
function setMiniBar(show) {
  el.miniBar.classList.toggle('show', show);
  el.miniBar.inert = !show;
  document.body.classList.toggle('has-minibar', show);
}
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    setMiniBar(!entry.isIntersecting && entry.boundingClientRect.top < 0);
  }).observe(document.querySelector('.controls'));
}
el.miniToggle.addEventListener('click', toggle);
$('#miniTime').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: reduceMQ.matches ? 'auto' : 'smooth' });
});

/* ---------- dica flutuante (gráfico e mapa) ---------- */

function hideTip() { el.tip.classList.remove('show'); }
document.addEventListener('pointerover', (e) => {
  const target = e.target.closest('[data-tip]');
  if (!target) { hideTip(); return; }
  const r = target.getBoundingClientRect();
  el.tip.textContent = target.dataset.tip;
  el.tip.style.left = `${clamp(r.left + r.width / 2, 90, window.innerWidth - 90)}px`;
  el.tip.style.top = `${r.top}px`;
  el.tip.classList.add('show');
});
document.addEventListener('pointerleave', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });
$('#heatmapScroll').addEventListener('scroll', hideTip, { passive: true });

/* ---------- ajustes e dados ---------- */

const dialog = $('#settings');
const form = $('#settingsForm');

function fillSettingsForm() {
  for (const k of Object.keys(LIMITS)) form.elements[k].value = state.settings[k];
  for (const k of FLAGS) form.elements[k].checked = state.settings[k];
}
function dataStatus(msg) { $('#dataStatus').textContent = msg; }

$('#openSettings').addEventListener('click', () => {
  fillSettingsForm();
  dataStatus('');
  dialog.returnValue = '';
  dialog.showModal();
  if (mqSheet.matches) animate(dialog, { y: ['100%', '0%'] }, { type: 'spring', stiffness: 320, damping: 34 });
  else animate(dialog, { opacity: [0, 1], y: [18, 0], scale: [0.97, 1] }, SPRING);
});

dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'save') return;
  const raw = {};
  for (const k of Object.keys(LIMITS)) raw[k] = form.elements[k].value;
  for (const k of FLAGS) raw[k] = form.elements[k].checked;
  state.settings = cleanSettings(raw);
  if (!hasProgress()) setPeriod(state.timer.mode, false); // nova duração vale se o período ainda não começou
  commit();
  toast('Ajustes salvos.');
});

$('#notifyBox').addEventListener('change', async (e) => {
  const box = e.target;
  if (!box.checked) return;
  if (!('Notification' in window)) {
    box.checked = false;
    dataStatus('Este navegador não mostra notificações.');
    return;
  }
  if (Notification.permission === 'granted') return;
  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    box.checked = false;
    dataStatus('O navegador bloqueou as notificações. Libere nas permissões do site para usar.');
  }
});

$('#exportBtn').addEventListener('click', () => {
  const data = { app: 'tomate', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, sessions: state.sessions };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tomate-backup-${dayKey(Date.now())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  dataStatus(`Backup exportado com ${plural(state.sessions.length, 'sessão', 'sessões')}.`);
});

const importInput = $('#importInput');
$('#importBtn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.sessions)) throw new Error('formato');
    const known = new Set(state.sessions.map((s) => s.id));
    const fresh = cleanSessions(data.sessions).filter((s) => !known.has(s.id));
    state.sessions.push(...fresh);
    if (data.settings) state.settings = cleanSettings(data.settings);
    commit();
    fillSettingsForm();
    dataStatus(`${plural(fresh.length, 'sessão importada', 'sessões importadas')}.`);
  } catch {
    dataStatus('Não deu para ler esse arquivo. Escolha um backup exportado pelo Tomate.');
  }
});

$('#clearBtn').addEventListener('click', () => {
  if (!state.sessions.length) { dataStatus('O histórico já está vazio.'); return; }
  if (!confirm(`Apagar ${plural(state.sessions.length, 'sessão salva', 'sessões salvas')}? Isso não pode ser desfeito.`)) return;
  state.sessions = [];
  state.timer.cycle = 0;
  commit();
  dataStatus('Histórico apagado.');
});

/* ---------- eventos ---------- */

el.toggle.addEventListener('click', toggle);
$('#reset').addEventListener('click', reset);
$('#skip').addEventListener('click', skip);
el.modes.forEach((b) => b.addEventListener('click', () => chooseMode(b.dataset.mode)));

el.task.addEventListener('input', () => { state.timer.task = el.task.value; save(); });
el.task.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); el.task.blur(); start(); }
});

$('#sessions').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  btn.disabled = true;
  await finished(animate(btn.closest('li'), { opacity: 0, x: 28 }, { duration: 0.22, ease: 'easeIn' }), 500);
  state.sessions = state.sessions.filter((s) => s.id !== btn.dataset.remove);
  commit();
  toast('Sessão removida.');
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || dialog.open) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === ' ') {
    if (tag === 'BUTTON') return; // o próprio botão já responde ao espaço
    e.preventDefault();
    toggle();
  } else if (e.key === 'r' || e.key === 'R') {
    reset();
  } else if (e.key === 'p' || e.key === 'P') {
    skip();
  }
});

window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) { state = load(); render(); }
});
let resizeTimer;
let lastWeeks = 0;
window.addEventListener('resize', () => {
  pillKey = '';
  placePill(false);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = weeksThatFit();
    if (w !== lastWeeks) { lastWeeks = w; renderHeatmap(groupByDay(), startOfDay(Date.now()), false); }
  }, 150);
});
document.addEventListener('visibilitychange', tick);
if (document.fonts) document.fonts.ready.then(() => { pillKey = ''; placePill(false); });

/* ---------- início: um único momento de abertura ---------- */

if (state.timer.running && Date.now() >= state.timer.endsAt) {
  complete({ silent: true });
  toast('Seu último período terminou enquanto a página estava fechada.');
}

setDial(canAnimate() ? 0 : angleFor(remaining(), state.timer.total));
render();

if (canAnimate()) {
  // as marcações se desenham em sentido horário enquanto o botão dá corda até o tempo atual
  animate(ticks, { strokeDashoffset: [1, 0] }, { duration: 0.3, ease: EASE_OUT, delay: stagger(0.012) });
  animate(el.readout.querySelectorAll('.slot-d > span, .colon'), { y: ['70%', '0%'], opacity: [0, 1] }, {
    duration: 0.55, ease: EASE_OUT, delay: stagger(0.05, { startDelay: 0.15 }),
  });
}
booted = true;

setInterval(tick, 250);
setInterval(renderStats, 60000); // virada do dia
