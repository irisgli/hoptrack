(() => {
  const KEY = "hoptrack.v1";
  const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
  const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const COLORS = ["#b9a7ff", "#ffb38a", "#8fd8b4", "#8ec5ff", "#ffd97a", "#ffa3c4", "#b8d98a", "#c6b3a1"];
  const THEMES = [
    { id: "paper", label: "paper", sw: "linear-gradient(135deg,#f1e5ee 55%,#2a37b8 55%)" },
    { id: "lilac", label: "lilac", sw: "linear-gradient(135deg,#f1edf8 55%,#6f5fb0 55%)" },
    { id: "coffee", label: "coffee", sw: "linear-gradient(135deg,#f6eee4 55%,#a9714f 55%)" },
    { id: "mono", label: "black + white", sw: "linear-gradient(135deg,#fbfbfa 55%,#141414 55%)" },
    { id: "noir", label: "noir", sw: "linear-gradient(135deg,#171717 55%,#f3f3f1 55%)" },
    { id: "night", label: "night", sw: "linear-gradient(135deg,#1c1c26 55%,#b9a0ff 55%)" },
    { id: "glass", label: "glass", sw: "linear-gradient(135deg,rgba(255,255,255,.9),rgba(220,222,228,.6))" },
  ];
  const THEME_IDS = THEMES.map((t) => t.id);
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const pad = (n) => String(n).padStart(2, "0");
  const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayKey = () => dkey(new Date());
  const shiftKey = (k, n) => dkey(addDays(fromKey(k), n));

  const track = (id, name, unit, target, days, match) => ({ id, name, unit, target, days: [...days], match, subs: [] });
  const defaults = () => ({
    v: 4, name: "iris", good: 70, mascot: null, theme: "paper", updatedAt: 0,
    profile: { motto: "", school: "UC Berkeley", focusGoal: 4 },
    pomo: { on: true, focus: 25, short: 5, long: 15, every: 4, autoBreak: true, sound: true },
    brk: null, pomoDone: { day: "", n: 0 }, pomoTotal: 0, show: { todos: true, coming: true }, since: todayKey(), mini: false,
    tracks: [
      track("cs188", "CS 188", "min", 60, ALL, "CS 188, COMPSCI 188"),
      track("cs187", "CS 187", "min", 60, ALL, "CS 187, COMPSCI 187"),
      track("data140", "DATA 140", "min", 60, ALL, "DATA 140, DATA C140, STAT C140, STAT 140"),
      track("jobs", "job apps", "count", 3, [1, 2, 3, 4, 5], ""),
      track("leet", "leetcode", "count", 2, ALL, ""),
      track("abs", "exercise + abs", "min", 30, ALL, ""),
      track("read", "reading", "min", 20, ALL, ""),
    ],
    log: {}, plan: {}, feeds: [], inbox: [], imported: {}, lastSync: 0, running: null,
  });

  function migrate(s) {
    const d = defaults();
    s = { ...d, ...s };
    const old = { light: "paper", dark: "night", glass: "glass", ink: "night", cream: "coffee" };
    s.theme = THEME_IDS.includes(s.theme) ? s.theme : old[s.theme] || old[s.appearance] || "paper";
    delete s.appearance;
    s.profile = { ...d.profile, ...(s.profile || {}) };
    s.pomo = { ...d.pomo, ...(s.pomo || {}) };
    s.show = { ...d.show, ...(s.show || {}) };
    s.tracks = (s.tracks || []).map((t, i) => {
      const base = d.tracks.find((x) => x.id === t.id);
      const out = { subs: [], match: base ? base.match : "", color: COLORS[i % COLORS.length], ...t };
      if (t.id === "data140" && /^data 140$/i.test(t.name)) out.name = "DATA 140";
      return out;
    });
    return s;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { /* storage blocked */ }
    return defaults();
  }
  let S = load();
  const mac = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hop;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };
  const save = () => { S.updatedAt = Date.now(); persist(); cloud.schedule(); };

  /* cloud save: every change is pushed to a private store keyed by a secret
     sync key, and pulled back on focus, so all devices stay the same. */
  const SYNC_KEY = "hoptrack.sync";
  const cloud = (() => {
    let meta = {};
    try { meta = JSON.parse(localStorage.getItem(SYNC_KEY) || "{}"); } catch (e) { meta = {}; }
    const keep = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ } };
    const newKey = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    let timer = null, busy = false, again = false;
    const api = { status: "connecting", at: 0, get key() { return meta.key; } };
    async function call(body) {
      const r = await fetch("api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: meta.key, ...body }) });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, code: r.status, j };
    }
    function adopt(state, etag) {
      S = migrate(state);
      meta.etag = etag; meta.pushedAt = S.updatedAt || 0; keep(); persist();
      if (document.activeElement && document.activeElement.matches("input,select,textarea")) renderHeader(); else render();
    }
    function setStatus(st) { api.status = st; if (st === "saved") api.at = Date.now(); const el = $("#cloudStatus"); if (el) el.textContent = api.label(); }
    api.label = () => api.status === "saved" ? `Saved to your cloud ${new Date(api.at).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }).toLowerCase()}`
      : api.status === "saving" ? "Saving..." : api.status === "offline" ? "Offline, will save when back online" : "Connecting...";
    api.push = async function push() {
      if (busy) { again = true; return; }
      busy = true; setStatus("saving");
      try {
        const sent = S.updatedAt || 0;
        const r = await call({ op: "push", state: S, etag: meta.etag || null });
        if (r.ok) { meta.etag = r.j.etag; meta.pushedAt = sent; keep(); setStatus("saved"); }
        else if (r.code === 409 && r.j.state) {
          if ((r.j.state.updatedAt || 0) > (S.updatedAt || 0)) { adopt(r.j.state, r.j.etag); setStatus("saved"); }
          else { meta.etag = r.j.etag; keep(); }
        } else setStatus("offline");
      } catch (e) { setStatus("offline"); }
      busy = false;
      if (again) { again = false; push(); }
    };
    api.pull = async function pull(force) {
      if (busy) return;
      busy = true;
      try {
        const r = await call({ op: "pull" });
        busy = false;
        if (!r.ok) { setStatus("offline"); return; }
        if (!r.j.state) { api.push(); return; }
        if (force || (r.j.etag !== meta.etag && (r.j.state.updatedAt || 0) > (S.updatedAt || 0))) adopt(r.j.state, r.j.etag);
        else if (r.j.etag !== meta.etag && (S.updatedAt || 0) > (r.j.state.updatedAt || 0)) { meta.etag = r.j.etag; keep(); api.push(); return; }
        else if (r.j.etag === meta.etag && (S.updatedAt || 0) > (meta.pushedAt || 0)) { api.push(); return; }
        setStatus("saved");
      } catch (e) { busy = false; setStatus("offline"); }
    };
    api.schedule = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; api.push(); }, 1200); };
    api.link = () => `${location.origin}${location.pathname}#k=${meta.key}`;
    api.connect = (key, local) => {
      key = String(key || "").trim().replace(/^.*#k=/, "");
      if (!/^[A-Za-z0-9_-]{32,80}$/.test(key)) return false;
      if (key === meta.key) { api.pull(false); return true; }
      meta = { key, etag: null }; keep();
      api.pull(!local);
      return true;
    };
    api.start = () => {
      const m = location.hash.match(/^#k=([A-Za-z0-9_-]{32,80})$/);
      if (m) { history.replaceState(null, "", location.pathname); api.connect(m[1]); return; }
      if (!meta.key) { meta = { key: newKey(), etag: null }; keep(); }
      api.pull(false);
    };
    window.addEventListener("focus", () => api.pull(false));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) api.pull(false); });
    window.addEventListener("online", () => api.push());
    window.addEventListener("pagehide", () => {
      if (!timer || !meta.key) return;
      clearTimeout(timer); timer = null;
      try { fetch("api/sync", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ key: meta.key, op: "push", state: S, etag: meta.etag || null }) }); } catch (e) { /* best effort */ }
    });
    setInterval(() => { if (!document.hidden) api.pull(false); }, 60e3);
    return api;
  })();

  let tab = "today";
  let viewDay = todayKey();
  let open = null;
  let statRange = 14;
  const prevVal = {};
  const popped = location.hash === "#mini";

  /* model */
  const dayPlan = (k) => (S.plan[k] = S.plan[k] || { targets: {}, tasks: [] });
  const peekPlan = (k) => S.plan[k] || { targets: {}, tasks: [] };
  const targetFor = (t, k) => {
    const ov = peekPlan(k).targets[t.id];
    if (ov !== undefined && ov !== null) return ov;
    return t.days.includes(fromKey(k).getDay()) ? t.target : 0;
  };
  const activeTracks = (k) => S.tracks.filter((t) => targetFor(t, k) > 0);
  const elapsedMs = () => (!S.running ? 0 : S.running.paused != null ? S.running.paused : Date.now() - S.running.start);
  const elapsedMin = () => Math.min(elapsedMs(), S.running && S.running.dur ? S.running.dur : Infinity) / 60000;
  const pomoCount = () => (S.pomoDone.day === todayKey() ? S.pomoDone.n : 0);
  const stored = (k, id) => (S.log[k] && S.log[k][id]) || 0;
  const val = (k, id) => stored(k, id) + (S.running && S.running.id === id && k === todayKey() ? elapsedMin() : 0);
  const setVal = (k, id, v) => { S.log[k] = S.log[k] || {}; S.log[k][id] = Math.max(0, Math.round(v * 100) / 100); };
  const ratio = (t, k) => { const g = targetFor(t, k); return g > 0 ? Math.min(1, val(k, t.id) / g) : 0; };

  function dayScore(k) {
    const ts = activeTracks(k);
    const tasks = peekPlan(k).tasks;
    const n = ts.length + tasks.length;
    if (!n) return null;
    let sum = 0, done = 0;
    ts.forEach((t) => { const r = ratio(t, k); sum += r; if (r >= 1) done++; });
    tasks.forEach((x) => { if (x.done) { sum += 1; done++; } });
    return { score: sum / n, done, total: n };
  }
  const isGood = (k) => { const s = dayScore(k); return s && s.score * 100 >= S.good; };
  const openSubs = (t, k) => t.subs.filter((s) => !s.done || s.doneOn === k)
    .sort((a, b) => (a.done - b.done) || ((a.due || 9e15) - (b.due || 9e15)));

  /* formatting */
  function fmtMin(m) {
    m = Math.floor(m);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h${pad(r)}` : `${h}h`;
  }
  const fmtAmt = (t, v, g) => (t.unit === "min" ? `${fmtMin(v)}/${fmtMin(g)}` : `${Math.floor(v)}/${g}`);
  const clock = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
  const prettyDate = (d) => d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
  function dayWord(k) {
    const t = todayKey();
    if (k === t) return "today";
    if (k === shiftKey(t, 1)) return "tomorrow";
    if (k === shiftKey(t, -1)) return "yesterday";
    return DAY_NAMES[fromKey(k).getDay()];
  }
  function dueChip(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const days = Math.round((fromKey(dkey(d)) - fromKey(todayKey())) / 864e5);
    const txt = days < 0 ? "overdue" : days === 0 ? "due today" : days === 1 ? "due tmrw" : days < 7 ? `due ${DAY_NAMES[d.getDay()]}` : `due ${d.getMonth() + 1}/${d.getDate()}`;
    return `<span class="due ${days <= 1 ? "hot" : ""}">${txt}</span>`;
  }

  /* timer */
  function stopTimer() {
    if (!S.running) return;
    if (S.running.paused != null) { S.running.start = Date.now() - S.running.paused; }
    const t = S.tracks.find((x) => x.id === S.running.id);
    const add = elapsedMin();
    if (t) setVal(todayKey(), t.id, stored(todayKey(), t.id) + add);
    S.running = null;
    save();
    if (t && add >= 1) toast(`+${fmtMin(add)} ${t.name}`);
  }
  function startFocus(id) {
    stopTimer();
    S.brk = null;
    S.running = { id, start: Date.now() };
    if (S.pomo.on) S.running.dur = S.pomo.focus * 60e3;
    save();
  }
  function pauseResume() {
    const r = S.running;
    if (!r) return;
    if (r.paused != null) { r.start = Date.now() - r.paused; delete r.paused; }
    else r.paused = Date.now() - r.start;
    save();
  }
  function toggleTimer(id) {
    if (S.running && S.running.id === id) { if (S.running.dur) pauseResume(); else stopTimer(); }
    else startFocus(id);
    render();
  }
  function finishFocus() {
    const t = S.tracks.find((x) => x.id === S.running.id);
    stopTimer();
    S.pomoDone = { day: todayKey(), n: pomoCount() + 1 };
    S.pomoTotal = (S.pomoTotal || 0) + 1;
    const kind = S.pomoDone.n % Math.max(1, S.pomo.every) === 0 ? "long" : "short";
    S.brk = { kind, dur: S.pomo[kind] * 60e3, start: S.pomo.autoBreak ? Date.now() : null, after: t ? t.id : null };
    chime(3);
    toast(`focus done! ${kind} break time`);
    save(); render();
  }
  function finishBreak(skipped) {
    const after = S.brk && S.brk.after;
    S.brk = null;
    if (!skipped) { chime(2); toast("break's over, back to it"); }
    if (skipped && after && S.pomo.on) startFocus(after);
    save(); render();
  }

  /* sound */
  let audio;
  function chime(times = 1) {
    if (!S.pomo.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime;
      for (let i = 0; i < times; i++) {
        [880, 1320].forEach((f, j) => {
          const o = audio.createOscillator(), g = audio.createGain();
          o.type = "sine"; o.frequency.value = f;
          const t0 = now + i * 0.45 + j * 0.12;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
          o.connect(g).connect(audio.destination);
          o.start(t0); o.stop(t0 + 0.65);
        });
      }
    } catch (e) { /* no audio */ }
  }

  /* icons */
  const I = {
    play: '<svg viewBox="0 0 16 16" class="fillme"><path d="M5.4 3.7c0-.8.9-1.3 1.6-.9l5.7 3.6c.7.4.7 1.4 0 1.8L7 11.8c-.7.4-1.6-.1-1.6-.9z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" class="fillme"><rect x="4" y="3.2" width="2.9" height="9.6" rx="1.45"/><rect x="9.1" y="3.2" width="2.9" height="9.6" rx="1.45"/></svg>',
    plus: '<svg viewBox="0 0 16 16" class="fillme"><rect x="6.8" y="3" width="2.4" height="10" rx="1.2"/><rect x="3" y="6.8" width="10" height="2.4" rx="1.2"/></svg>',
    minus: '<svg viewBox="0 0 16 16" class="fillme"><rect x="3" y="6.8" width="10" height="2.4" rx="1.2"/></svg>',
    check: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>',
    x: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    left: '<svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg>',
    right: '<svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>',
    car: '<svg class="car" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>',
    skip: '<svg viewBox="0 0 16 16"><path d="M4 3.5l6 4.5-6 4.5zM12 3.5v9"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>',
  };

  /* header */
  function greeting() {
    const h = new Date().getHours();
    const n = S.name ? `, ${S.name}` : "";
    if (h < 5) return `still up${n}?`;
    if (h < 12) return `morning${n}`;
    if (h < 18) return `afternoon${n}`;
    return `evening${n}`;
  }

  function renderHeader() {
    const k = tab === "today" ? viewDay : todayKey();
    const now = new Date();
    const ds = dayScore(k);
    const run = S.running && S.tracks.find((t) => t.id === S.running.id);
    let mood = "idle";
    if (run) mood = "focus";
    else if (ds && ds.score >= 1) mood = "done";
    else if (now.getHours() >= 23 || now.getHours() < 5) mood = "sleep";
    $("#bunny").dataset.mood = mood;
    $("#mascot").dataset.mood = mood;

    const big = $("#big");
    const pc = $("#pomoCtl");
    const cycle = Math.max(1, S.pomo.every);
    const sessionDots = (cur) => Array.from({ length: cycle }, (_, i) => {
      const done = pomoCount() % cycle === 0 && pomoCount() > 0 && !cur ? cycle : pomoCount() % cycle;
      return `<i class="dot ${i < done ? "full" : i === done && cur ? "half" : ""}"></i>`;
    }).join("");
    if (S.brk) {
      const left = S.brk.start ? S.brk.dur - (Date.now() - S.brk.start) : S.brk.dur;
      big.textContent = clock(Math.max(0, left) + 999);
      big.classList.add("clock");
      $("#subLabel").textContent = S.brk.kind === "long" ? "long break" : "break";
      $("#dots").innerHTML = sessionDots(false);
      pc.innerHTML = (S.brk.start ? "" : `<button class="rb solid" data-act="brk-start" aria-label="start break">${I.play}</button>`)
        + `<button class="pc-btn" data-act="brk-skip">skip break ${I.skip}</button>`;
      pc.hidden = false;
      $("#bunny").dataset.mood = $("#mascot").dataset.mood = "sleep";
      renderMini(run);
      return;
    }
    if (run) {
      const r = S.running;
      big.textContent = r.dur ? clock(Math.max(0, r.dur - elapsedMs()) + 999) : clock(elapsedMs());
      big.classList.add("clock");
      $("#subLabel").textContent = r.dur ? `${run.name} · focus` : run.name;
      if (r.dur) $("#dots").innerHTML = sessionDots(true);
      pc.innerHTML = `<button class="rb solid" data-act="pause" aria-label="${r.paused != null ? "resume" : "pause"}">${r.paused != null ? I.play : I.pause}</button>`
        + (r.dur ? `<button class="rb" data-act="skip-focus" aria-label="finish this session now">${I.skip}</button>` : "")
        + `<button class="rb" data-act="stop" aria-label="stop">${I.stop}</button>`;
      pc.hidden = false;
      if (r.paused != null) { $("#bunny").dataset.mood = $("#mascot").dataset.mood = "idle"; big.classList.add("paused"); } else big.classList.remove("paused");
    } else {
      pc.hidden = true;
      big.classList.remove("paused");
      big.classList.remove("clock");
      big.textContent = ds ? `${Math.round(ds.score * 100)}%` : "rest";
      const word = k === todayKey() ? greeting() : dayWord(k);
      $("#subLabel").textContent = ds && ds.score >= 1 ? "all done!" : word;
    }
    if (!run || !S.running.dur) {
      const segs = activeTracks(k).map((t) => ratio(t, k)).concat(peekPlan(k).tasks.map((x) => (x.done ? 1 : 0)));
      $("#dots").innerHTML = segs.map((r) => `<i class="dot ${r >= 1 ? "full" : r > 0 ? "half" : ""}"></i>`).join("");
    }
    renderMini(run);
  }

  function renderMini(run) {
    const tk = todayKey();
    const next = run || activeTracks(tk).find((t) => ratio(t, tk) < 1);
    const mn = $("#miniNext");
    if (!next) { mn.innerHTML = "<span>all clear. go rest</span>"; return; }
    const ctl = next.unit === "min"
      ? `<button class="rb solid" data-act="play" data-id="${next.id}" aria-label="${run ? "pause" : "start"} ${esc(next.name)}">${run ? I.pause : I.play}</button>`
      : `<button class="rb solid" data-act="inc" data-id="${next.id}" aria-label="add one ${esc(next.name)}">${I.plus}</button>`;
    mn.innerHTML = `<span>${run ? "on" : "next"} <b>${esc(next.name)}</b> ${fmtAmt(next, val(tk, next.id), targetFor(next, tk))}</span>${ctl}`;
  }

  /* today */
  function itemRow(o, act, extra = "") {
    return `<li class="item ${o.done ? "is-done" : ""}">
      <button class="check" data-act="${act}-check" data-sid="${o.id}" ${extra} aria-label="toggle ${esc(o.text)}">${I.check}</button>
      <span class="txt">${esc(o.text)}${o.src ? `<small>${esc(o.src)}</small>` : ""}</span>
      ${o.done ? "" : dueChip(o.due)}
      <button class="x" data-act="${act}-del" data-sid="${o.id}" ${extra} aria-label="remove">${I.x}</button>
    </li>`;
  }

  function renderToday() {
    const k = viewDay;
    const isToday = k === todayKey();
    const word = dayWord(k);
    const nav = `<div class="daynav">
      <button class="arrow" data-act="day-prev" aria-label="previous day">${I.left}</button>
      <div class="lbl">${esc(word)}<small>${isToday ? prettyDate(fromKey(k)) : `${prettyDate(fromKey(k))} · <button data-act="day-today">back to today</button>`}</small></div>
      <button class="arrow" data-act="day-next" aria-label="next day">${I.right}</button>
    </div>`;

    const ts = activeTracks(k);
    const rows = ts.map((t) => {
      const v = val(k, t.id);
      const g = targetFor(t, k);
      const r = Math.min(1, v / g);
      const running = S.running && S.running.id === t.id && isToday;
      const subs = openSubs(t, k);
      const left = subs.filter((s) => !s.done);
      const meta = left.length ? `${left.length} subtask${left.length > 1 ? "s" : ""} · next: ${esc(left[0].text)}` : t.subs.length ? "subtasks done" : "";
      let ctl = "";
      if (t.unit === "min") {
        const live = running && S.running.paused == null;
        if (isToday) ctl = `<button class="rb ${running ? "solid" : ""}" data-act="play" data-id="${t.id}" aria-label="${live ? "pause" : "start"} timer for ${esc(t.name)}">${live ? I.pause : I.play}</button>`;
      } else {
        ctl = `<button class="rb" data-act="dec" data-id="${t.id}" aria-label="minus one">${I.minus}</button><button class="rb solid" data-act="inc" data-id="${t.id}" aria-label="plus one">${I.plus}</button>`;
      }
      const isOpen = open === t.id;
      const panel = isOpen ? `<div class="panel" style="--c:${t.color}">
          ${subs.length ? `<ul class="subs">${subs.map((s) => itemRow(s, "sub", `data-id="${t.id}"`)).join("")}</ul>` : ""}
          <input class="addin" data-add="sub" data-id="${t.id}" placeholder="add a subtask, like project 3" maxlength="120">
          <div class="kv">
            <label>goal ${esc(word)} <input class="numin" type="number" min="0" data-pf="target" data-id="${t.id}" value="${g}"> ${t.unit === "min" ? "min" : "times"}</label>
            ${t.unit === "min" ? `<label>logged <input class="numin" type="number" min="0" data-pf="logged" data-id="${t.id}" value="${Math.floor(val(k, t.id))}"> min</label>` : ""}
          </div>
          <div class="kv"><button class="link" data-act="skip" data-id="${t.id}">skip ${esc(word)}</button>${peekPlan(k).targets[t.id] !== undefined ? `<button class="link" data-act="unset" data-id="${t.id}">use usual goal (${t.target})</button>` : ""}</div>
        </div>` : "";
      return `<div class="row ${r >= 1 ? "done" : ""} ${running ? "running" : ""} ${isOpen ? "opened" : ""}" data-row="${t.id}" style="--c:${t.color}">
          <div class="fill" style="width:${r * 100}%"></div>
          <button class="check" data-act="check" data-id="${t.id}" aria-label="mark ${esc(t.name)} done">${I.check}</button>
          <button class="main" data-act="open" data-id="${t.id}" aria-expanded="${isOpen}">
            <span class="name"><span>${esc(t.name)}</span>${I.car}</span>
            ${meta ? `<span class="meta">${meta}</span>` : ""}
          </button>
          <span class="amt" data-amt="${t.id}">${fmtAmt(t, v, g)}</span>
          <span class="ctl">${ctl}</span>
        </div>${panel}`;
    }).join("");

    const tasks = peekPlan(k).tasks;
    const taskSec = `<div class="sec"><div class="sec-h">${esc(word)}'s to-dos</div><div class="box">
        ${tasks.length ? `<ul class="subs">${tasks.map((x) => itemRow(x, "task")).join("")}</ul>` : ""}
        <input class="addin" data-add="task" placeholder="add a to-do for ${esc(word)}" maxlength="120">
      </div></div>`;

    const off = S.tracks.filter((t) => targetFor(t, k) <= 0);
    const offLine = off.length ? `<div class="offday">off ${esc(word)}: ${off.map((t) => `<button class="chipbtn" data-act="addback" data-id="${t.id}">+ ${esc(t.name)}</button>`).join("")}</div>` : "";
    const list = ts.length ? `<div class="list">${rows}</div>` : `<div class="empty">nothing planned. add a to-do or bring a track back below</div>`;
    return nav + list + (S.show.todos ? taskSec : "") + offLine;
  }

  /* stats */
  function streaks() {
    let cur = 0;
    let k = isGood(todayKey()) ? todayKey() : shiftKey(todayKey(), -1);
    while (k >= S.since) {
      const s = dayScore(k);
      if (s !== null) { if (s.score * 100 >= S.good) cur++; else break; }
      k = shiftKey(k, -1);
    }
    let best = 0, run = 0;
    for (let x = S.since; x <= todayKey(); x = shiftKey(x, 1)) {
      if (dayScore(x) === null) continue;
      if (isGood(x)) { run++; best = Math.max(best, run); } else if (x !== todayKey()) run = 0;
    }
    return { cur, best };
  }

  function barChart(n) {
    const W = 340, H = 150, top = 16, bottom = 22;
    const days = Array.from({ length: n }, (_, i) => addDays(new Date(), i - n + 1));
    const bw = W / n, ch = H - top - bottom;
    const gy = top + ch * (1 - S.good / 100);
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="daily completion, last ${n} days">`;
    out += `<path d="M0 ${H - bottom} H${W}" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.5" fill="none"/>`;
    out += `<path d="M0 ${gy} H${W}" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="4 4" fill="none"/>`;
    days.forEach((d, i) => {
      const k = dkey(d);
      const s = k >= S.since ? dayScore(k) : null;
      const p = s ? s.score : 0;
      const h = p > 0 ? Math.max(p * ch, 3) : 0;
      const x = i * bw + bw * 0.2, w = bw * 0.6;
      const y = H - bottom - h;
      const isT = k === todayKey();
      out += h > 0
        ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(5, w / 3)}" fill="var(--ink)" opacity="${isT ? 1 : 0.4 + 0.5 * p}"><title>${k}: ${Math.round(p * 100)}%</title></rect>`
        : `<rect x="${x}" y="${H - bottom - 2}" width="${w}" height="2" rx="1" fill="var(--ink)" opacity=".2"/>`;
      if (n <= 14 || i % 5 === n % 5 || isT) {
        const lab = n <= 14 ? DAY_LETTERS[d.getDay()] : `${d.getMonth() + 1}/${d.getDate()}`;
        out += `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle" font-size="${n > 14 ? 10 : 12}" opacity="${isT ? 1 : 0.55}">${lab}</text>`;
      }
      if (p > 0 && n <= 14) out += `<text x="${x + w / 2}" y="${y - 4}" text-anchor="middle" font-size="10.5" opacity=".65">${Math.round(p * 100)}</text>`;
    });
    return out + "</svg>";
  }

  function heatmap() {
    const weeks = 17, cell = 16, gap = 3;
    const today = new Date();
    const start = addDays(today, -((weeks - 1) * 7 + today.getDay()));
    const W = weeks * (cell + gap), H = 7 * (cell + gap) + 14;
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="completion heatmap">`;
    let lastMonth = -1;
    for (let c = 0; c < weeks; c++) {
      const colDate = addDays(start, c * 7);
      if (colDate.getMonth() !== lastMonth) {
        lastMonth = colDate.getMonth();
        out += `<text x="${c * (cell + gap)}" y="10" font-size="10.5" opacity=".55">${MONTHS[lastMonth]}</text>`;
      }
      for (let r = 0; r < 7; r++) {
        const d = addDays(start, c * 7 + r);
        if (d > today) continue;
        const k = dkey(d);
        const s = k >= S.since ? dayScore(k) : null;
        const p = s ? s.score : 0;
        const op = s === null ? 0.07 : p === 0 ? 0.1 : 0.22 + p * 0.78;
        out += `<rect x="${c * (cell + gap)}" y="${14 + r * (cell + gap)}" width="${cell}" height="${cell}" rx="4" fill="var(--ink)" opacity="${op}"${k === todayKey() ? ` stroke="var(--ink)" stroke-width="1.5"` : ""}><title>${k}: ${s ? Math.round(p * 100) + "%" : "no data"}</title></rect>`;
      }
    }
    return out + "</svg>";
  }

  function renderStats() {
    const { cur, best } = streaks();
    const week = Array.from({ length: 7 }, (_, i) => dkey(addDays(new Date(), i - 6)));
    let focusMin = 0, scoreSum = 0, scored = 0, todos = 0, steps = 0;
    week.forEach((k) => {
      S.tracks.forEach((t) => { if (t.unit === "min") focusMin += val(k, t.id); });
      const s = k >= S.since ? dayScore(k) : null;
      if (s) { scoreSum += s.score; scored++; }
      todos += peekPlan(k).tasks.filter((x) => x.done).length;
    });
    S.tracks.forEach((t) => t.subs.forEach((s) => { if (s.done && week.includes(s.doneOn)) steps++; }));
    const avg = scored ? Math.round((scoreSum / scored) * 100) : 0;
    const per = S.tracks.map((t) => {
      let got = 0, want = 0;
      week.forEach((k) => { got += val(k, t.id); want += targetFor(t, k); });
      const r = want ? Math.min(1, got / want) : 0;
      const amt = t.unit === "min" ? `${(got / 60).toFixed(1)}h / ${(want / 60).toFixed(1)}h` : `${Math.floor(got)} / ${want}`;
      return `<span>${esc(t.name)}</span><span class="n">${amt}</span><div class="tbar"><i style="width:${r * 100}%;background:${t.color}"></i></div>`;
    }).join("");

    return `
      <div class="stat-grid">
        <div class="stat"><b>${cur}</b><span>day streak</span></div>
        <div class="stat"><b>${(focusMin / 60).toFixed(1)}h</b><span>focused, 7 days</span></div>
        <div class="stat"><b>${avg}%</b><span>avg, 7 days</span></div>
      </div>
      <div class="h"><span>daily progress <small>dashed line = ${S.good}%</small></span><span class="seg">${[7, 14, 30].map((n) => `<button data-act="range" data-n="${n}" class="${n === statRange ? "on" : ""}">${n}d</button>`).join("")}</span></div>
      <div class="chart">${barChart(statRange)}</div>
      <div class="h"><span>last 7 days by track</span><small>${steps} subtasks · ${todos} to-dos done</small></div>
      <div class="wk">${per}</div>
      <div class="h"><span>consistency</span><small>best streak ${best}</small></div>
      <div class="chart">${heatmap()}</div>
      <div class="legend">less <i style="opacity:.15"></i><i style="opacity:.4"></i><i style="opacity:.7"></i><i></i> more</div>`;
  }

  /* me */
  function renderMe() {
    const { best } = streaks();
    let focusAll = 0, goodDays = 0, todos = 0;
    Object.entries(S.log).forEach(([k, row]) => S.tracks.forEach((t) => { if (t.unit === "min") focusAll += row[t.id] || 0; }));
    for (let x = S.since; x <= todayKey(); x = shiftKey(x, 1)) if (isGood(x)) goodDays++;
    Object.values(S.plan).forEach((p) => { todos += p.tasks.filter((x) => x.done).length; });
    const steps = S.tracks.reduce((n, t) => n + t.subs.filter((x) => x.done).length, 0);
    let focusToday = 0;
    S.tracks.forEach((t) => { if (t.unit === "min") focusToday += val(todayKey(), t.id); });
    const goal = Number(S.profile.focusGoal) || 0;
    const P = S.pomo;
    const tog = (key, on, label) => `<button class="tg ${on ? "on" : ""}" data-act="toggle" data-k="${key}" aria-pressed="${on}"><i></i>${label}</button>`;
    return `<div class="ed">
      <div class="panelbox me">
        <div class="me-top">
          <div class="avatar"></div>
          <div class="me-id">
            <input class="field big-name" data-prof="name" value="${esc(S.name)}" placeholder="your name" maxlength="24">
            <input class="field small" data-prof="school" value="${esc(S.profile.school)}" placeholder="school or job" maxlength="40">
          </div>
        </div>
        <input class="field small" data-prof="motto" value="${esc(S.profile.motto)}" placeholder="a little note to yourself" maxlength="80">
        <label class="pref">focus goal <input class="numin" data-prof="focusGoal" type="number" min="0" max="16" step="0.5" value="${goal}"> hours a day</label>
        ${goal ? `<div class="goalbar"><i style="width:${Math.min(100, (focusToday / 60 / goal) * 100)}%"></i></div><span class="status">${(focusToday / 60).toFixed(1)} of ${goal}h focused today</span>` : ""}
      </div>

      <div class="stat-grid">
        <div class="stat"><b>${(focusAll / 60).toFixed(0)}h</b><span>focused total</span></div>
        <div class="stat"><b>${S.pomoTotal || 0}</b><span>pomodoros</span></div>
        <div class="stat"><b>${best}</b><span>best streak</span></div>
        <div class="stat"><b>${goodDays}</b><span>good days</span></div>
        <div class="stat"><b>${steps}</b><span>subtasks done</span></div>
        <div class="stat"><b>${todos}</b><span>to-dos done</span></div>
      </div>

      <div class="panelbox">
        <span class="t">focus timer</span>
        <div class="seg wide"><button class="${P.on ? "on" : ""}" data-act="pomo-mode" data-v="1">pomodoro</button><button class="${P.on ? "" : "on"}" data-act="pomo-mode" data-v="0">stopwatch</button></div>
        ${P.on ? `<div class="kv">
          <label>focus <input class="numin" type="number" min="1" max="180" data-pomo="focus" value="${P.focus}"> min</label>
          <label>break <input class="numin" type="number" min="1" max="60" data-pomo="short" value="${P.short}"> min</label>
          <label>long break <input class="numin" type="number" min="1" max="90" data-pomo="long" value="${P.long}"> min</label>
          <label>long break every <input class="numin" type="number" min="1" max="12" data-pomo="every" value="${P.every}"> sessions</label>
        </div>` : `<p class="help">The play button counts up until you stop it.</p>`}
        <div class="btns">${tog("autoBreak", P.autoBreak, "start breaks by themselves")}${tog("sound", P.sound, "chime when time is up")}</div>
      </div>

      <div class="panelbox">
        <span class="t">today page</span>
        <div class="btns">${tog("todos", S.show.todos, "show to-dos")}</div>
      </div>
    </div>`;
  }

  /* customize */
  function renderEdit() {
    const rows = S.tracks.map((t, i) => `
      <div class="erow" data-tid="${t.id}">
        <div class="line">
          <input class="field" data-f="name" value="${esc(t.name)}" aria-label="track name" maxlength="40">
          <button class="mib" data-act="up" data-id="${t.id}" aria-label="move up" ${i === 0 ? "disabled" : ""}>${I.up}</button>
          <button class="mib" data-act="down" data-id="${t.id}" aria-label="move down" ${i === S.tracks.length - 1 ? "disabled" : ""}>${I.down}</button>
          <button class="mib" data-act="del" data-id="${t.id}" aria-label="delete track">${I.x}</button>
        </div>
        <div class="line">
          <span class="lab">usual goal</span>
          <input class="numin" data-f="target" type="number" min="1" value="${t.target}" aria-label="usual daily goal">
          <select class="sel" data-f="unit" aria-label="unit">
            <option value="min" ${t.unit === "min" ? "selected" : ""}>minutes</option>
            <option value="count" ${t.unit === "count" ? "selected" : ""}>times</option>
          </select>
          <span class="days">${DAY_LETTERS.map((l, d) => `<button class="day ${t.days.includes(d) ? "on" : ""}" data-act="day" data-d="${d}" data-id="${t.id}" aria-label="toggle ${DAY_NAMES[d]}">${l}</button>`).join("")}</span>
        </div>
      </div>`).join("");


    return `<div class="ed">
      ${rows}
      <button class="add" data-act="addtrack">+ add a track</button>

      <div class="panelbox">
        <span class="t">look</span>
        <div class="themes">${THEMES.map((th) => `<button class="sw ${S.theme === th.id ? "on" : ""}" data-act="theme" data-t="${th.id}"><i style="background:${th.sw}"></i>${th.label}</button>`).join("")}</div>
      </div>

      <div class="panelbox">
        <span class="t">you</span>
        <label class="pref">name <input class="field" data-pref="name" value="${esc(S.name)}" maxlength="24"></label>
        <label class="pref">a good day is <input class="numin" data-pref="good" type="number" min="10" max="100" value="${S.good}"> % done</label>
        <div class="btns"><button class="pill danger" data-act="wipe">clear history</button></div>
      </div>
    </div>`;
  }

  /* render */
  function applyAppearance() {
    document.body.dataset.theme = S.theme;
    document.documentElement.dataset.theme = S.theme;
    $("#themeName").textContent = S.theme;
    if (mac) mac.postMessage({ glass: S.theme === "glass", dark: ["night", "noir"].includes(S.theme) });
  }
  function render() {
    applyAppearance();
    const m = $("#mascot");
    const pic = S.mascot || "bunny.png";
    const ink = S.mascot ? !!S.mascotInk : true;
    m.hidden = false;
    $("#bunny").style.display = "none";
    if (m.dataset.src !== pic + ink) {
      m.dataset.src = pic + ink;
      const url = `url("${pic}")`;
      m.classList.toggle("ink", ink);
      m.style.webkitMaskImage = m.style.maskImage = ink ? url : "";
      m.style.backgroundImage = ink ? "" : url;
    }
    renderHeader();
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    $("#view").innerHTML = tab === "today" ? renderToday() : tab === "stats" ? renderStats() : tab === "me" ? renderMe() : renderEdit();
    const av = $(".avatar");
    if (av) { const m = $("#mascot"); av.className = m.className.replace("mascot", "avatar"); av.style.cssText = m.style.cssText; }
    $("#soundBtn").classList.toggle("muted", !S.pomo.sound);
  }

  function tick() {
    if (S.running && S.running.dur && S.running.paused == null && elapsedMs() >= S.running.dur) { finishFocus(); return; }
    if (S.brk && S.brk.start && Date.now() - S.brk.start >= S.brk.dur) { finishBreak(false); return; }
    renderHeader();
    if (!S.running || tab !== "today" || viewDay !== todayKey()) return;
    const t = S.tracks.find((x) => x.id === S.running.id);
    if (!t) return;
    const k = todayKey();
    const amt = document.querySelector(`[data-amt="${t.id}"]`);
    if (amt) amt.textContent = fmtAmt(t, val(k, t.id), targetFor(t, k));
    const row = document.querySelector(`[data-row="${t.id}"]`);
    if (row) {
      row.querySelector(".fill").style.width = `${ratio(t, k) * 100}%`;
      if (ratio(t, k) >= 1 && !row.classList.contains("done")) { row.classList.add("done"); toast(`${t.name} goal hit!`); }
    }
  }

  let toastT;
  function toast(msg) {
    let el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("show"), 1900);
  }

  /* events */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act],[data-tab]");
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; open = null; if (tab !== "today") viewDay = todayKey(); render(); return; }
    const id = b.dataset.id;
    const sid = b.dataset.sid;
    const t = S.tracks.find((x) => x.id === id);
    const k = viewDay;
    switch (b.dataset.act) {
      case "play": toggleTimer(id); return;
      case "pause": pauseResume(); break;
      case "stop": stopTimer(); break;
      case "skip-focus": finishFocus(); return;
      case "brk-start": if (S.brk) S.brk.start = Date.now(); break;
      case "brk-skip": finishBreak(true); return;
      case "inc": {
        const key = tab === "today" ? k : todayKey();
        setVal(key, id, stored(key, id) + 1);
        if (t && stored(key, id) === targetFor(t, key)) toast(`${t.name} goal hit!`);
        break;
      }
      case "dec": setVal(k, id, stored(k, id) - 1); break;
      case "open": open = open === id ? null : id; break;
      case "check": {
        if (!t) break;
        if (S.running && S.running.id === id) stopTimer();
        const g = targetFor(t, k);
        const v = stored(k, id);
        if (v >= g) setVal(k, id, prevVal[id] ?? 0);
        else { prevVal[id] = v; setVal(k, id, g); toast(`${t.name} done!`); }
        break;
      }
      case "skip": dayPlan(k).targets[id] = 0; if (S.running && S.running.id === id && k === todayKey()) stopTimer(); open = null; break;
      case "unset": delete dayPlan(k).targets[id]; break;
      case "addback": dayPlan(k).targets[id] = t.target; break;
      case "sub-check": {
        const s = t.subs.find((x) => x.id === sid);
        s.done = !s.done; s.doneOn = s.done ? k : null;
        if (s.done) toast("subtask done!");
        break;
      }
      case "sub-del": t.subs = t.subs.filter((x) => x.id !== sid); break;
      case "task-check": { const x = dayPlan(k).tasks.find((y) => y.id === sid); x.done = !x.done; if (x.done) toast("nice!"); break; }
      case "task-del": dayPlan(k).tasks = dayPlan(k).tasks.filter((y) => y.id !== sid); break;
      case "day-prev": viewDay = shiftKey(viewDay, -1); open = null; break;
      case "day-next": viewDay = shiftKey(viewDay, 1); open = null; break;
      case "day-today": viewDay = todayKey(); open = null; break;
      case "range": statRange = Number(b.dataset.n); break;
      case "pomo-mode": S.pomo.on = b.dataset.v === "1"; if (S.running) { if (S.pomo.on) S.running.dur = S.pomo.focus * 60e3; else delete S.running.dur; } break;
      case "toggle": {
        const key = b.dataset.k;
        if (key in S.pomo) S.pomo[key] = !S.pomo[key]; else S.show[key] = !S.show[key];
        break;
      }
      case "up": case "down": {
        const i = S.tracks.indexOf(t), j = b.dataset.act === "up" ? i - 1 : i + 1;
        if (j >= 0 && j < S.tracks.length) [S.tracks[i], S.tracks[j]] = [S.tracks[j], S.tracks[i]];
        break;
      }
      case "del":
        if (t && confirm(`delete "${t.name}" and its subtasks?`)) {
          if (S.running && S.running.id === id) S.running = null;
          S.tracks = S.tracks.filter((x) => x !== t);
        }
        break;
      case "day": {
        const d = Number(b.dataset.d);
        t.days = t.days.includes(d) ? t.days.filter((x) => x !== d) : [...t.days, d].sort();
        break;
      }
      case "addtrack": S.tracks.push(track(uid(), "new track", "min", 30, ALL, "")); break;
      case "color": t.color = b.dataset.c; break;
      case "theme": S.theme = b.dataset.t; break;
      case "wipe":
        if (confirm("clear all logged progress and to-dos? tracks and subtasks stay. this cannot be undone.")) { S.log = {}; S.plan = {}; S.running = null; S.since = todayKey(); }
        break;
      default: return;
    }
    save();
    render();
  });

  document.addEventListener("keydown", (e) => {
    const el = e.target;
    if (e.key !== "Enter" || !el.dataset || !el.dataset.add) return;
    const text = el.value.trim();
    if (!text) return;
    if (el.dataset.add === "sub") {
      const t = S.tracks.find((x) => x.id === el.dataset.id);
      t.subs.push({ id: uid(), text, due: null, src: "", done: false, doneOn: null });
    } else {
      dayPlan(viewDay).tasks.push({ id: uid(), text, due: null, src: "", done: false });
    }
    save();
    render();
    const again = document.querySelector(`[data-add="${el.dataset.add}"]${el.dataset.id ? `[data-id="${el.dataset.id}"]` : ""}`);
    if (again) again.focus();
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.pf) return;
    const t = S.tracks.find((x) => x.id === el.dataset.id);
    const n = Math.max(0, Number(el.value) || 0);
    if (el.dataset.pf === "target") dayPlan(viewDay).targets[t.id] = n;
    if (el.dataset.pf === "logged") {
      if (S.running && S.running.id === t.id && viewDay === todayKey()) S.running = null;
      setVal(viewDay, t.id, n);
    }
    save();
    render();
  });

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.pref) {
      S[el.dataset.pref] = el.dataset.pref === "good" ? Math.min(100, Math.max(10, Number(el.value) || 70)) : el.value.trim();
      save(); renderHeader(); return;
    }
    if (el.dataset.prof) {
      const f = el.dataset.prof;
      if (f === "name") S.name = el.value.trim();
      else if (f === "focusGoal") S.profile.focusGoal = Math.max(0, Math.min(16, Number(el.value) || 0));
      else S.profile[f] = el.value;
      save(); renderHeader(); return;
    }
    if (el.dataset.pomo) {
      const f = el.dataset.pomo;
      const n = Math.max(1, Math.round(Number(el.value) || 0));
      if (n) S.pomo[f] = n;
      if (f === "focus" && S.running && S.running.dur) S.running.dur = n * 60e3;
      save(); return;
    }
    const row = el.closest("[data-tid]");
    if (!row || !el.dataset.f) return;
    const t = S.tracks.find((x) => x.id === row.dataset.tid);
    const f = el.dataset.f;
    if (f === "name") t.name = el.value.trim() || "untitled";
    if (f === "target") t.target = Math.max(1, Number(el.value) || 1);
    if (f === "unit") { if (S.running && S.running.id === t.id) stopTimer(); t.unit = el.value; }
    save(); renderHeader();
  });

  $("#themeBtn").addEventListener("click", () => {
    S.theme = THEME_IDS[(THEME_IDS.indexOf(S.theme) + 1) % THEME_IDS.length];
    save(); render();
    toast(THEMES.find((t) => t.id === S.theme).label);
  });

  /* Liquid Glass: real refraction where the browser supports it, and a
     highlight that follows the pointer like light moving across glass */
  const canRefract = /Chrome\//.test(navigator.userAgent) && !mac;
  document.documentElement.classList.toggle("refract", canRefract);
  const card = $("#card");
  const sizeLens = () => {
    const m = $("#lensMap");
    const f = $("#liquid");
    if (m) { m.setAttribute("width", card.offsetWidth); m.setAttribute("height", card.offsetHeight); }
    if (f) { f.setAttribute("width", card.offsetWidth); f.setAttribute("height", card.offsetHeight); }
  };
  if (window.ResizeObserver) new ResizeObserver(sizeLens).observe(card);
  sizeLens();
  window.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, { passive: true });

  function setMini(m) {
    document.body.classList.toggle("mini", m);
    if (!popped) { S.mini = m; save(); }
    if (mac) mac.postMessage({ mini: m });
  }

  $("#soundBtn").addEventListener("click", () => {
    S.pomo.sound = !S.pomo.sound;
    save(); render();
    if (S.pomo.sound) chime(1);
    toast(S.pomo.sound ? "sound on" : "sound off");
  });
  $("#miniBtn").addEventListener("click", () => setMini(!document.body.classList.contains("mini")));
  window.hopSetMini = setMini;
  $("#popBtn").addEventListener("click", () => {
    window.open(location.href.split("#")[0] + "#mini", "hoptrack", "popup,width=340,height=260");
  });

  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    S = load();
    if (document.activeElement && document.activeElement.matches("input,select,textarea")) { renderHeader(); return; }
    render();
  });

  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) { if (viewDay === lastDay) viewDay = todayKey(); lastDay = todayKey(); render(); return; }
    tick();
  }, 1000);

  document.body.classList.toggle("mini", popped || !!S.mini);
  if (mac) mac.postMessage({ mini: document.body.classList.contains("mini") });
  render();
  cloud.start();

})();
