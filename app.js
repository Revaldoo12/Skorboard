// ====== Konfigurasi ======
const CONFIG = {
  periodMs: loadPeriodMs(), // durasi per periode (bisa diubah di panel "Durasi periode")
  shotSeconds: 24,   // shot clock penuh
  shotReset14: 14,   // reset setelah offensive rebound
  penaltyFouls: 4,   // FIBA: setelah 4 team foul, foul berikutnya = lemparan bebas
};

// Durasi periode disimpan di browser supaya tetap ada setelah refresh
function loadPeriodMs() {
  const saved = Number(localStorage.getItem("periodMs"));
  return saved > 0 ? saved : 10 * 60 * 1000; // default 10 menit
}

// ====== State ======
const state = {
  gameMs: CONFIG.periodMs,
  shotMs: CONFIG.shotSeconds * 1000,
  running: false,
  period: 1,
  score: { home: 0, away: 0 },
  fouls: { home: 0, away: 0 },
  possession: null, // "home" | "away" | null
  lastTick: null,
};

const $ = (id) => document.getElementById(id);

const el = {
  gameClock: $("game-clock"),
  shotClock: $("shot-clock"),
  period: $("period"),
  otLamp: $("ot-lamp"),
  score: { home: $("score-home"), away: $("score-away") },
  fouls: { home: $("foul-home"), away: $("foul-away") },
  penalty: { home: $("penalty-home"), away: $("penalty-away") },
  poss: { home: $("poss-home"), away: $("poss-away") },
  label: { home: $("label-home"), away: $("label-away") },
};

// ====== Digit LED 7-segmen ======
// Segmen: a = atas, b = kanan atas, c = kanan bawah, d = bawah,
//         e = kiri bawah, f = kiri atas, g = tengah
const SEGMENTS = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
  "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg",
  " ": "",
};

function digitHTML(ch) {
  const lit = SEGMENTS[ch] ?? "";
  const segs = "abcdefg"
    .split("")
    .map((s) => `<i class="s${s}${lit.includes(s) ? " on" : ""}"></i>`)
    .join("");
  return `<span class="dg">${segs}</span>`;
}

function sepHTML(ch) {
  if (ch === ":") return `<span class="sep colon"><i class="on"></i><i class="on"></i></span>`;
  return `<span class="sep dot"><i class="on"></i></span>`;
}

// Tulis teks ke LED. `digits` = jumlah digit tetap; sisa kiri diisi digit mati.
function setLed(node, text, digits) {
  const count = (text.match(/\d/g) || []).length;
  const padded = " ".repeat(Math.max(0, digits - count)) + text;
  if (node.dataset.text === padded) return; // tidak berubah, lewati
  node.dataset.text = padded;
  node.innerHTML = [...padded].map((ch) => (ch === ":" || ch === "." ? sepHTML(ch) : digitHTML(ch))).join("");
}

// ====== Buzzer ======
// Kalau ada file buzzer.mp3 di folder ini, itu yang diputar.
// Kalau tidak ada, pakai bunyi sintetis yang mirip buzzer basket.
let audioCtx = null;
const buzzerFile = new Audio("buzzer.mp3");
buzzerFile.preload = "auto";

function playBuzzer(duration = 1.2) {
  buzzerFile.currentTime = 0;
  const p = buzzerFile.play();
  if (p && typeof p.then === "function") p.catch(() => synthBuzzer(duration));
}

function synthBuzzer(duration = 1.2) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    gain.gain.setValueAtTime(0.35, now + duration - 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(audioCtx.destination);

    [200, 100].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      const g = audioCtx.createGain();
      g.gain.value = i === 0 ? 1 : 0.5;
      osc.connect(g);
      g.connect(gain);
      osc.start(now);
      osc.stop(now + duration);
    });
  } catch (e) { /* audio tidak didukung */ }
}

// ====== Format waktu ======
function formatGame(ms) {
  const sec = Math.max(0, ms) / 1000;
  if (sec < 60) return (Math.floor(sec * 10) / 10).toFixed(1); // 59.9 ... 0.0
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatShot(ms) {
  const sec = Math.max(0, ms) / 1000;
  if (sec < 5) return (Math.floor(sec * 10) / 10).toFixed(1); // 4.9 ... 0.0
  return String(Math.ceil(sec));
}

// ====== Render ======
function render() {
  setLed(el.gameClock, formatGame(state.gameMs), 4);
  setLed(el.shotClock, formatShot(state.shotMs), 2);

  const isOT = state.period > 4;
  setLed(el.period, String(isOT ? state.period - 4 : state.period), 1);
  el.otLamp.classList.toggle("on", isOT);

  ["home", "away"].forEach((team) => {
    setLed(el.score[team], String(state.score[team]), 3);
    setLed(el.fouls[team], String(Math.min(state.fouls[team], 9)), 1);
    el.penalty[team].classList.toggle("on", state.fouls[team] >= CONFIG.penaltyFouls);
    el.poss[team].classList.toggle("on", state.possession === team);
  });

  document.body.classList.toggle("is-running", state.running);
}

// ====== Loop timer ======
function tick(now) {
  if (!state.running) return;
  if (state.lastTick == null) state.lastTick = now;
  const delta = now - state.lastTick;
  state.lastTick = now;

  state.gameMs -= delta;
  state.shotMs -= delta;

  if (state.gameMs <= 0) {
    state.gameMs = 0;
    playBuzzer(1.5); // akhir periode
    pause();
  } else if (state.shotMs <= 0) {
    state.shotMs = 0;
    playBuzzer(0.9); // shot clock violation
    pause();
  }

  render();
  if (state.running) requestAnimationFrame(tick);
}

// ====== Kontrol ======
function start() {
  if (state.running || state.gameMs <= 0) return;
  if (state.shotMs <= 0) state.shotMs = CONFIG.shotSeconds * 1000;
  state.running = true;
  state.lastTick = null;
  render();
  requestAnimationFrame(tick);
}

function pause() {
  state.running = false;
  state.lastTick = null;
  render();
}

function resetShot(seconds) {
  state.shotMs = seconds * 1000;
  render();
}

function resetGameClock() {
  state.gameMs = CONFIG.periodMs;
  state.shotMs = CONFIG.shotSeconds * 1000;
  render();
}

function togglePossession() {
  state.possession = state.possession === "home" ? "away" : "home";
  render();
}

function resetAll() {
  if (!confirm("Reset semua skor, foul, periode, dan jam?")) return;
  state.running = false;
  state.lastTick = null;
  state.gameMs = CONFIG.periodMs;
  state.shotMs = CONFIG.shotSeconds * 1000;
  state.period = 1;
  state.score = { home: 0, away: 0 };
  state.fouls = { home: 0, away: 0 };
  state.possession = null;
  render();
}

// ====== Event ======
$("btn-start").addEventListener("click", start);
$("btn-pause").addEventListener("click", pause);
$("btn-shot-24").addEventListener("click", () => resetShot(CONFIG.shotSeconds));
$("btn-shot-14").addEventListener("click", () => resetShot(CONFIG.shotReset14));
$("btn-reset-game").addEventListener("click", resetGameClock);
$("btn-reset-all").addEventListener("click", resetAll);
$("btn-poss").addEventListener("click", togglePossession);

document.querySelectorAll("[data-pts]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const team = btn.dataset.team;
    state.score[team] = Math.max(0, Math.min(999, state.score[team] + Number(btn.dataset.pts)));
    render();
  });
});

document.querySelectorAll("[data-foul]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const team = btn.dataset.foul;
    state.fouls[team] = Math.max(0, state.fouls[team] + Number(btn.dataset.delta));
    render();
  });
});

document.querySelectorAll("[data-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.period = Math.max(1, state.period + Number(btn.dataset.period));
    render();
  });
});

// nama tim di papan ikut tampil di panel operator
document.querySelectorAll(".team-name").forEach((input) => {
  const sync = () => { el.label[input.dataset.team].textContent = input.value || "—"; };
  input.addEventListener("input", sync);
  sync();
});

// ====== Pengaturan durasi periode ======
const setMin = $("set-min");
const setSec = $("set-sec");
const setMsg = $("set-msg");
const presetBtns = document.querySelectorAll("[data-preset]");

function showDurationInputs(ms) {
  const total = Math.round(ms / 1000);
  setMin.value = Math.floor(total / 60);
  setSec.value = String(total % 60).padStart(2, "0");
  presetBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.preset) * 60 === total));
}

function message(text, isError = false) {
  setMsg.textContent = text;
  setMsg.classList.toggle("err", isError);
}

function applyDuration(minutes, seconds) {
  if (state.running) return message("Stop jam dulu sebelum mengubah durasi.", true);

  const m = Math.floor(Number(minutes));
  const s = Math.floor(Number(seconds));
  if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || m > 99 || s < 0 || s > 59) {
    return message("Isi menit 0–99 dan detik 0–59.", true);
  }
  const ms = (m * 60 + s) * 1000;
  if (ms <= 0) return message("Durasi minimal 1 detik.", true);

  CONFIG.periodMs = ms;
  localStorage.setItem("periodMs", String(ms));
  state.gameMs = ms;
  state.shotMs = CONFIG.shotSeconds * 1000;
  showDurationInputs(ms);
  message(`Jam diatur ke ${m}:${String(s).padStart(2, "0")}.`);
  render();
}

$("time-form").addEventListener("submit", (e) => {
  e.preventDefault();
  applyDuration(setMin.value, setSec.value);
});

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => applyDuration(btn.dataset.preset, 0));
});

showDurationInputs(CONFIG.periodMs);

// ====== Header / profile event ======
const eventTitle = $("event-title");
const eventSub = $("event-sub");

// judul tab browser ikut nama event
function updateDocTitle() {
  const t = eventTitle.value.trim();
  const s = eventSub.value.trim();
  document.title = t ? (s ? `${t} — ${s}` : t) : "Scoreboard Basket";
}

// teks (judul + subjudul) disimpan di browser
function saveEventText() {
  localStorage.setItem("eventTitle", eventTitle.value);
  localStorage.setItem("eventSub", eventSub.value);
  updateDocTitle();
}

function loadEventText() {
  const t = localStorage.getItem("eventTitle");
  const s = localStorage.getItem("eventSub");
  if (t !== null) eventTitle.value = t;
  if (s !== null) eventSub.value = s;
  updateDocTitle();
}

eventTitle.addEventListener("input", saveEventText);
eventSub.addEventListener("input", saveEventText);

// bersihkan logo lama yang mungkin tersimpan dari versi sebelumnya
localStorage.removeItem("eventLogo");

// muat data tersimpan saat halaman dibuka
loadEventText();

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); state.running ? pause() : start(); }
  else if (k === "z") resetShot(CONFIG.shotSeconds);
  else if (k === "x") resetShot(CONFIG.shotReset14);
  else if (k === "p") togglePossession();
});

render();
