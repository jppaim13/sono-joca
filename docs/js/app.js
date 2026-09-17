import { MIN, HOUR, DAY, midnight, overlap, fmtDur, fmtClock, dayKey } from "./time.js";
import { checkSleepDuration, isSleepForgotten } from "./validation.js";
import { resolveWrite, resolveEditorName } from "./conflict.js";
import { scheduleDelete, cancelDelete, isPending, isExpired, UNDO_WINDOW_MS } from "./undo.js";
import { parseDigitsToTime, offsetFromNow } from "./timeinput.js";
import { netSleepDuration, classifySleep, findSleepOverlap } from "./sleep.js";
import { ageWakeWindowRef, dailySleepRefHours, computeSchedule } from "./schedule.js";
import * as store from "./store.js";

const APP_VERSION = "2026.09.17-fase1";
const KIND = { "peito-e": "Peito esquerdo", "peito-d": "Peito direito", "mamadeira": "Mamadeira", "solido": "Comida" };
const DIAPER_LABEL = { "xixi": "Xixi", "coco": "Cocô", "ambos": "Xixi e cocô" };
const PLACE_LABEL = { berco: "berço", colo: "colo", carrinho: "carrinho", carro: "carro", sling: "sling" };
const MILK_LABEL = { formula: "fórmula", materno: "materno ordenhado", misto: "misto" };
const AGENDA_KIND_LABEL = { consulta: "Consulta", vacina: "Vacina", banho: "Banho", passeio: "Passeio", outro: "Compromisso" };
const HISTORY_DAYS = 60;

// Catálogo dos atalhos configuráveis da tela Hoje (além de Peito E/D/Mamadeira, que ficam
// sempre fixos na barra principal).
const SHORTCUT_CATALOG = {
  solido: { label: "Sólido" }, pump: { label: "Extração" }, diaper: { label: "Fralda" },
  medicine: { label: "Remédio" }, bath: { label: "Banho" }, activity: { label: "Atividade" },
  growth: { label: "Crescimento" }, agenda: { label: "Agenda" },
};
const DEFAULT_SHORTCUTS = ["diaper", "pump", "solido", "medicine", "bath", "activity", "growth", "agenda"].map(id => ({ id, visible: true }));

const ONBOARDING_SCREENS = [
  { title: "Como registrar", body: "Toque em <strong>Dormiu</strong> no centro do relógio para iniciar o cronômetro de sono, e em <strong>Acordou</strong> para parar. Peito E/D e Mamadeira ficam logo abaixo. Fralda, remédio, banho e outros ficam nos atalhos — escolha quais aparecem em Configurações." },
  { title: "Previsão × Plano", body: "O app mostra uma <strong>previsão</strong> do próximo sono, baseada na idade e, depois de alguns dias, no padrão real do bebê — não é uma regra fixa. Dá pra marcar um sono como noturno ou soneca manualmente, e ajustar horários depois." },
  { title: "Calibração", body: "Nos primeiros dias a previsão usa só a faixa típica da idade. Depois de alguns sonos nos últimos 3 dias, ela passa a seguir o padrão real do bebê — quanto mais registros, mais precisa fica." },
];

/* ---------- Supabase ---------- */
const SB_CONFIG_KEY = "sono-sb-config";
const loadSbConfig = () => { try { return JSON.parse(localStorage.getItem(SB_CONFIG_KEY)); } catch { return null; } };
const saveSbConfig = v => { try { localStorage.setItem(SB_CONFIG_KEY, JSON.stringify(v)); } catch {} };
let sb = null;

const S = { config: { name: "Joaquim", birth: "", settings: {} }, live: { version: 1, pauses: [] }, ev: {}, growth: {}, agenda: {},
  users: {}, since: 0, uid: null, tab: "hoje", online: true, deviceName: "", onboardingDone: false };
let editing = null, adjusting = null, editingGrowth = null, editingAgenda = null;
let pendingSave = null, pendingOverlapId = null, pendingOverlapVersion = 1;
let obStep = 0;
let outboxCache = [];
let errorMap = {};
let pendingDeletes = {};
let realtimeStatus = "connecting";
let pollTimer = null, channelRef = null, backoffStep = 0;
const BACKOFF_MS = [2000, 5000, 15000];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = ms => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const toInput = ms => new Date(ms - new Date(ms).getTimezoneOffset() * MIN).toISOString().slice(0, 16);
const fromInput = s => new Date(s).getTime();
const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dayLabel = ms => { const t = midnight(Date.now()); const d = midnight(ms);
  if (d === t) return "Hoje"; if (d === t - DAY) return "Ontem";
  return new Date(ms).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }); };
function nightWindow() { const s = S.config.settings || {}; return [Number.isFinite(s.nightStart) ? s.nightStart : 19, Number.isFinite(s.nightEnd) ? s.nightEnd : 7]; }

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}
function toastAction(html, onClick, ms) {
  const t = $("#toast");
  t.innerHTML = html; t.hidden = false;
  clearTimeout(toast._t);
  const btn = t.querySelector("[data-toast-action]");
  if (btn) btn.addEventListener("click", () => { t.hidden = true; onClick(); });
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function showAdjustBar(eventId, kind, ts) {
  const label = kind === "sleep" ? "Acordou" : "Terminou";
  toastAction(`${label} ${fmtTime(ts)} · <button class="linklike" data-toast-action>Ajustar</button>`, () => {
    const ev = S.ev[eventId]; if (ev) openEvent(ev);
  }, 5000);
}

/* ---------- age-based references ---------- */
function ageWeeks() { if (!S.config.birth) return null; const b = new Date(S.config.birth + "T12:00:00").getTime(); return Math.max(0, (Date.now() - b) / (7 * DAY)); }
function ageText(w) {
  if (w == null) return "Defina a data de nascimento";
  const days = Math.floor(w * 7);
  if (days < 14) return `${days} ${days === 1 ? "dia" : "dias"} de vida`;
  if (w < 13) return `${Math.floor(w)} semanas`;
  const months = Math.floor(days / 30.44);
  return `${months} ${months === 1 ? "mês" : "meses"} (${Math.floor(w)} semanas)`;
}
// Fonte única de verdade das referências por idade agora é schedule.js (reaproveitado
// também pelo motor de previsão) — mantém os mesmos nomes aqui para não mexer nos
// muitos call-sites já existentes.
const sleepRef = dailySleepRefHours;
const wakeRef = ageWakeWindowRef;
const feedRef = w => (w == null || w < 17) ? [8, 12] : null;

/* ---------- local-first data ---------- */
async function loadLocal() {
  await store.migrateFromLocalStorage();
  const evs = await store.getAllEvents();
  for (const e of evs) S.ev[e.id] = e;
  S.config = { ...S.config, ...((await store.getMeta("config")) || {}) };
  if (!S.config.settings) S.config.settings = {};
  S.live = { pauses: [], ...(await store.getMeta("live") || { version: 1 }) };
  S.since = (await store.getMeta("since")) || 0;
  S.uid = await store.getMeta("uid");
  S.users = (await store.getMeta("users")) || {};
  S.deviceName = (await store.getMeta("deviceName")) || "";
  S.onboardingDone = (await store.getMeta("onboardingDone")) || false;
  S.growth = (await store.getMeta("growth")) || {};
  S.agenda = (await store.getMeta("agenda")) || {};
  outboxCache = await store.getOutbox();
}
async function persistMeta() {
  await store.setMeta("config", S.config);
  await store.setMeta("live", S.live);
  await store.setMeta("since", S.since);
  await store.setMeta("uid", S.uid);
  await store.setMeta("users", S.users);
}
async function persistCollections() {
  await store.setMeta("growth", S.growth);
  await store.setMeta("agenda", S.agenda);
}

function events() {
  return Object.values(S.ev).filter(e => e && !e.deleted && e.type && e.start && !isPending(pendingDeletes, e.id)).sort((a, b) => a.start - b.start);
}
const sleeps = () => events().filter(e => e.type === "sleep" && e.end);
const feeds = () => events().filter(e => e.type === "feed");

function targetIdOf(op) { return op.row ? op.row.id : op.id; }
function statusOf(id) {
  if (errorMap[id]) return "error";
  if (outboxCache.some(op => targetIdOf(op) === id)) return "pending";
  return "ok";
}
function statusGlyph(id) {
  const s = statusOf(id);
  if (s === "pending") return `<span class="glyph pending" title="Enviando">⟳</span>`;
  if (s === "error") return `<span class="glyph error" data-review="${esc(id)}" title="Erro ao enviar · toque para revisar">⚠</span>`;
  return `<span class="glyph ok" title="Salvo">✓</span>`;
}

const rowToEvent = r => {
  const e = { id: r.id, type: r.type, start: r.start, version: r.version || 1 };
  if (r.kind) e.kind = r.kind; if (r.end) e.end = r.end; if (r.ml != null) e.ml = r.ml;
  if (r.note) e.note = r.note; if (r.by_user_id) e.by = r.by_user_id; if (r.deleted) e.deleted = true;
  if (r.last_edited_by) e.lastEditedBy = r.last_edited_by;
  if (r.device_name) e.deviceName = r.device_name;
  if (r.data && Object.keys(r.data).length) e.data = r.data;
  if (r.is_night != null) e.isNight = r.is_night;
  return e;
};
const rowToLive = r => ({ sleepStart: r.sleep_start, sleepBy: r.sleep_by, feedStart: r.feed_start, feedKind: r.feed_kind, feedBy: r.feed_by,
  pauses: Array.isArray(r.pauses) ? r.pauses : [], version: r.version || 1, lastEditedBy: r.last_edited_by || null, deviceName: r.device_name || null });
const rowToGrowth = r => ({ id: r.id, measuredAt: r.measured_at, weightG: r.weight_g, heightCm: r.height_cm, headCm: r.head_cm, note: r.note,
  by: r.by_user_id, lastEditedBy: r.last_edited_by, deviceName: r.device_name, deleted: !!r.deleted, version: r.version || 1 });
const rowToAgenda = r => ({ id: r.id, kind: r.kind, title: r.title, scheduledAt: r.scheduled_at, durationMin: r.duration_min, note: r.note,
  completed: !!r.completed, by: r.by_user_id, lastEditedBy: r.last_edited_by, deviceName: r.device_name, deleted: !!r.deleted, version: r.version || 1 });
// Mapeia o formato local (rowToEvent/rowToLive/rowToGrowth/rowToAgenda) para o que resolveEditorName espera do banco.
const nameFor = obj => resolveEditorName({ device_name: obj.deviceName, last_edited_by: obj.lastEditedBy, by_user_id: obj.by || obj.sleepBy || obj.feedBy }, S.users);

/* ---------- outbox / flush / sync ---------- */
async function flushOp(op) {
  let res;
  try {
    if (op.kind === "insert") res = await sb.from(op.table).insert(op.row).select();
    else if (op.kind === "cond-update") res = await sb.from(op.table).update({ ...op.patch, version: op.expectedVersion + 1 }).eq("id", op.id).eq("version", op.expectedVersion).select();
    else res = await sb.from(op.table).upsert(op.row).select();
  } catch { const e = new Error("offline"); e.offline = true; throw e; }
  if (res.error) { const e = new Error(res.error.message); e.pgError = res.error; throw e; }
  if (op.kind === "cond-update") {
    const r = resolveWrite(res.data);
    if (!r.ok) { const e = new Error("conflict"); e.conflict = true; throw e; }
  }
  return res;
}

const TABLE_LOCAL = {
  events: { map: S => S.ev, toLocal: rowToEvent },
  sono_growth: { map: S => S.growth, toLocal: rowToGrowth },
  sono_agenda: { map: S => S.agenda, toLocal: rowToAgenda },
};

async function handleConflict(op) {
  await store.addLog({ kind: "conflict", detail: `${op.table}:${op.id}` });
  const { data: fresh } = await sb.from(op.table).select("*").eq("id", op.id).maybeSingle();
  if (op.table === "live_state") {
    if (!fresh) return;
    S.live = rowToLive(fresh);
    await persistMeta();
    if (op.context && op.context.expectedSleepStart && !fresh.sleep_start) {
      const { data: ev } = await sb.from("events").select("*").eq("type", "sleep").eq("start", op.context.expectedSleepStart).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const who = ev ? resolveEditorName(ev, S.users) : "Alguém";
      if (ev) S.ev[ev.id] = rowToEvent(ev);
      toast(`${who} já registrou que acordou${ev ? ` às ${fmtTime(ev.end)}` : ""}.`);
    } else {
      toast(`${resolveEditorName(fresh, S.users)} alterou o cronômetro em outro aparelho. Atualizado.`);
    }
  } else if (TABLE_LOCAL[op.table]) {
    if (!fresh) return;
    const { map, toLocal } = TABLE_LOCAL[op.table];
    const who = resolveEditorName(fresh, S.users);
    map(S)[fresh.id] = toLocal(fresh);
    await store.addLog({ kind: "edit-conflict", detail: `${op.table}:${op.id} · descartado: ${JSON.stringify(op.patch)} · servidor agora na versão ${fresh.version}` });
    if (op.table === "events") {
      toastAction(
        `${who} alterou este registro antes — sua mudança não foi aplicada. <button class="linklike" data-toast-action>Reaplicar</button>`,
        () => reapplyDiscardedEdit(fresh.id, op.patch), 8000);
    } else {
      toast(`${who} alterou este registro antes — sua mudança não foi aplicada.`);
    }
  }
  render();
}
// Reabre o formulário de edição com os valores que não foram salvos, já em cima da versão
// mais recente do servidor — reenviar não gera um novo conflito.
function reapplyDiscardedEdit(id, patch) {
  const fresh = S.ev[id]; if (!fresh) return;
  openEvent({ ...fresh, ...patch, id });
}

let flushing = false;
async function flush() {
  if (flushing) return; flushing = true;
  try {
    while (outboxCache.length) {
      const op = outboxCache[0];
      try {
        await flushOp(op);
        S.online = true;
        delete errorMap[targetIdOf(op)];
      } catch (e) {
        if (e.offline) { S.online = false; break; }
        if (e.conflict) { await handleConflict(op); }
        else {
          errorMap[targetIdOf(op)] = e.pgError ? e.pgError.message : e.message;
          await store.addLog({ kind: "flush-error", detail: e.message });
        }
      }
      await store.deleteOutboxOp(op.localId);
      outboxCache = outboxCache.slice(1);
    }
  } finally { flushing = false; updateBanner(); }
}
async function enqueue(op) {
  await store.enqueueOutboxOp(op);
  outboxCache = await store.getOutbox();
  updateBanner(); render();
  flush();
}

async function sync() {
  if (!sb || !S.uid) return;
  await flush();
  if (outboxCache.length) return;
  try {
    const cutoff = Date.now() - HISTORY_DAYS * DAY;
    const [evRes, liveRes, babyRes, profRes, growthRes, agendaRes] = await Promise.all([
      sb.from("events").select("*").gt("updated_at", S.since).gte("start", cutoff).order("start"),
      sb.from("live_state").select("*").eq("id", 1).maybeSingle(),
      sb.from("baby").select("*").eq("id", 1).maybeSingle(),
      sb.from("profiles").select("id,name"),
      sb.from("sono_growth").select("*").gt("updated_at", S.since),
      sb.from("sono_agenda").select("*").gt("updated_at", S.since),
    ]);
    for (const r of [evRes, liveRes, babyRes, profRes, growthRes, agendaRes]) if (r.error) throw r.error;
    for (const r of evRes.data) { S.ev[r.id] = rowToEvent(r); await store.putEventRow(S.ev[r.id]); }
    const cut2 = Date.now() - HISTORY_DAYS * DAY;
    for (const id in S.ev) if (S.ev[id].start < cut2) { delete S.ev[id]; await store.deleteEventRow(id); }
    for (const r of growthRes.data) S.growth[r.id] = rowToGrowth(r);
    for (const r of agendaRes.data) S.agenda[r.id] = rowToAgenda(r);
    await persistCollections();
    S.users = {}; for (const p of profRes.data) S.users[p.id] = p.name;
    S.live = liveRes.data ? rowToLive(liveRes.data) : { version: 1, pauses: [] };
    if (babyRes.data) S.config = { ...S.config, name: babyRes.data.name, birth: babyRes.data.birth || "", settings: babyRes.data.settings || {} };
    S.since = Date.now() - 5000; S.online = true;
    await persistMeta();
    if (!document.querySelector("dialog[open]")) render(); else updateBanner();
  } catch (e) {
    S.online = false; updateBanner();
    await store.addLog({ kind: "sync-error", detail: String((e && e.message) || e) });
  }
}

function updateBanner() {
  const b = $("#modeBanner");
  const pending = outboxCache.length, errors = Object.keys(errorMap).length;
  if (!S.online) { b.hidden = false; b.textContent = `Sem conexão. ${pending ? pending + " alteração(ões) serão enviadas quando a internet voltar." : "Mostrando os últimos dados salvos."}`; }
  else if (errors) { b.hidden = false; b.textContent = `${errors} registro(s) com erro — toque no ⚠ na lista de Registros para revisar.`; }
  else if (pending) { b.hidden = false; b.textContent = "Enviando alterações…"; }
  else b.hidden = true;
}

/* ---------- writes: events ---------- */
function newEventRow(ev, now) {
  return { id: ev.id, type: ev.type, kind: ev.kind || null, start: ev.start, end: ev.end || null,
    ml: (ev.kind === "mamadeira" || ev.type === "pump") ? (ev.ml ?? null) : null, note: ev.note || null,
    by_user_id: ev.by || S.uid, last_edited_by: S.uid, device_name: S.deviceName || null,
    data: ev.data || {}, is_night: ev.isNight != null ? ev.isNight : null,
    deleted: false, updated_at: now, version: 1 };
}
async function putNewEvent(ev) {
  const now = Date.now();
  const row = newEventRow(ev, now);
  S.ev[ev.id] = row;
  await store.putEventRow(row);
  render();
  await enqueue({ kind: "insert", table: "events", row });
}
async function putEditedEvent(ev, expectedVersion) {
  const now = Date.now();
  const patch = { type: ev.type, kind: ev.kind || null, start: ev.start, end: ev.end || null,
    ml: (ev.kind === "mamadeira" || ev.type === "pump") ? (ev.ml ?? null) : null, note: ev.note || null,
    data: ev.data || {}, is_night: ev.isNight != null ? ev.isNight : null,
    updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
  const row = { ...S.ev[ev.id], ...patch, version: expectedVersion + 1 };
  S.ev[ev.id] = row;
  await store.putEventRow(row);
  render();
  await enqueue({ kind: "cond-update", table: "events", id: ev.id, patch, expectedVersion });
}
async function deleteEventNow(id, expectedVersion) {
  const now = Date.now();
  const patch = { deleted: true, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
  if (S.ev[id]) { S.ev[id] = { ...S.ev[id], ...patch, version: expectedVersion + 1 }; await store.putEventRow(S.ev[id]); }
  await enqueue({ kind: "cond-update", table: "events", id, patch, expectedVersion });
}
function deleteEvent(id) {
  const ev = S.ev[id]; if (!ev) return;
  const now = Date.now();
  pendingDeletes = scheduleDelete(pendingDeletes, id, now);
  render();
  toastAction(`Registro apagado. <button class="linklike" data-toast-action>Desfazer</button>`, () => undoDelete(id), UNDO_WINDOW_MS);
  setTimeout(() => {
    if (isPending(pendingDeletes, id) && isExpired(pendingDeletes, id, Date.now(), UNDO_WINDOW_MS)) {
      pendingDeletes = cancelDelete(pendingDeletes, id);
      deleteEventNow(id, ev.version || 1);
    }
  }, UNDO_WINDOW_MS + 100);
}
function undoDelete(id) {
  pendingDeletes = cancelDelete(pendingDeletes, id);
  render();
}

/* ---------- writes: crescimento ---------- */
function growthPatch(rec, now) {
  return { measured_at: rec.measuredAt, weight_g: rec.weightG ?? null, height_cm: rec.heightCm ?? null,
    head_cm: rec.headCm ?? null, note: rec.note || null, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
}
async function putNewGrowth(rec) {
  const now = Date.now();
  const row = { id: rec.id, ...growthPatch(rec, now), by_user_id: S.uid, deleted: false, version: 1 };
  S.growth[rec.id] = rowToGrowth(row); await persistCollections(); render();
  await enqueue({ kind: "insert", table: "sono_growth", row });
}
async function putEditedGrowth(rec, expectedVersion) {
  const now = Date.now();
  const patch = growthPatch(rec, now);
  S.growth[rec.id] = rowToGrowth({ ...patch, id: rec.id, version: expectedVersion + 1 }); await persistCollections(); render();
  await enqueue({ kind: "cond-update", table: "sono_growth", id: rec.id, patch, expectedVersion });
}
async function deleteGrowthNow(id, expectedVersion) {
  const now = Date.now();
  const patch = { deleted: true, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
  if (S.growth[id]) S.growth[id] = { ...S.growth[id], deleted: true };
  await persistCollections();
  await enqueue({ kind: "cond-update", table: "sono_growth", id, patch, expectedVersion });
}

/* ---------- writes: agenda ---------- */
function agendaPatch(rec, now) {
  return { kind: rec.kind, title: rec.title, scheduled_at: rec.scheduledAt, duration_min: rec.durationMin ?? null,
    note: rec.note || null, completed: !!rec.completed, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
}
async function putNewAgenda(rec) {
  const now = Date.now();
  const row = { id: rec.id, ...agendaPatch(rec, now), by_user_id: S.uid, deleted: false, version: 1 };
  S.agenda[rec.id] = rowToAgenda(row); await persistCollections(); render();
  await enqueue({ kind: "insert", table: "sono_agenda", row });
}
async function putEditedAgenda(rec, expectedVersion) {
  const now = Date.now();
  const patch = agendaPatch(rec, now);
  S.agenda[rec.id] = rowToAgenda({ ...patch, id: rec.id, version: expectedVersion + 1 }); await persistCollections(); render();
  await enqueue({ kind: "cond-update", table: "sono_agenda", id: rec.id, patch, expectedVersion });
}
async function deleteAgendaNow(id, expectedVersion) {
  const now = Date.now();
  const patch = { deleted: true, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
  if (S.agenda[id]) S.agenda[id] = { ...S.agenda[id], deleted: true };
  await persistCollections();
  await enqueue({ kind: "cond-update", table: "sono_agenda", id, patch, expectedVersion });
}

/* ---------- live_state (cronômetro + pausas) ---------- */
function setLive(fields, context) {
  const now = Date.now();
  const expectedVersion = S.live.version || 1;
  const newLive = { sleepStart: fields.sleepStart || null, sleepBy: fields.sleepBy || null,
    feedStart: fields.feedStart || null, feedKind: fields.feedKind || null, feedBy: fields.feedBy || null,
    pauses: Array.isArray(fields.pauses) ? fields.pauses : [], version: expectedVersion + 1 };
  S.live = newLive; persistMeta(); render();
  const patch = { sleep_start: newLive.sleepStart, sleep_by: newLive.sleepBy, feed_start: newLive.feedStart,
    feed_kind: newLive.feedKind, feed_by: newLive.feedBy, pauses: newLive.pauses,
    updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
  enqueue({ kind: "cond-update", table: "live_state", id: 1, patch, expectedVersion, context });
}
function togglePause() {
  const pauses = Array.isArray(S.live.pauses) ? [...S.live.pauses] : [];
  const now = Date.now();
  const openIdx = pauses.findIndex(p => p.end == null);
  if (openIdx >= 0) pauses[openIdx] = { ...pauses[openIdx], end: now };
  else pauses.push({ start: now });
  setLive({ ...S.live, pauses });
}
function setConfig(obj) {
  const now = Date.now();
  S.config = { ...S.config, ...obj }; persistMeta(); render();
  enqueue({ kind: "upsert", table: "baby", row: { id: 1, name: S.config.name, birth: S.config.birth || null, settings: S.config.settings || {}, updated_at: now } });
}
// Dia atípico (doença, viagem, visita): exclui aquele dia do cálculo das janelas pessoais
// do motor de previsão, sem apagar os registros.
function toggleAtypicalDay(dayKeyStr) {
  const current = (S.config.settings && S.config.settings.atypicalDays) || [];
  const next = current.includes(dayKeyStr) ? current.filter(k => k !== dayKeyStr) : [...current, dayKeyStr];
  setConfig({ settings: { ...S.config.settings, atypicalDays: next } });
}

/* ---------- setup (Supabase URL/key, fica só neste aparelho) ---------- */
function showSetup() { $("#setup").hidden = false; $("#login").hidden = true; $("#app").hidden = true; $("#tabs").hidden = true; }
$("#formSetup").addEventListener("submit", ev => {
  ev.preventDefault(); $("#setupError").textContent = "";
  const url = $("#setupUrl").value.trim().replace(/\/+$/, "");
  const anonKey = $("#setupKey").value.trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || anonKey.length < 20) {
    $("#setupError").textContent = "Confira a URL e a chave coladas.";
    return;
  }
  saveSbConfig({ url, anonKey });
  boot();
});
$("#btnEditSetup").addEventListener("click", () => {
  const cfg = loadSbConfig();
  if (cfg) { $("#setupUrl").value = cfg.url; $("#setupKey").value = cfg.anonKey; }
  showSetup();
});

/* ---------- login (e-mail + senha — Supabase free não deixa customizar o template de
   e-mail sem SMTP próprio, e o link mágico padrão não funciona de volta no PWA instalado) ---------- */
function showLogin() { $("#login").hidden = false; $("#setup").hidden = true; $("#app").hidden = true; $("#tabs").hidden = true;
  $("#loginPass").value = ""; }
function hideLogin() { $("#login").hidden = true; $("#setup").hidden = true; $("#app").hidden = false; $("#tabs").hidden = false; }
$("#btnTogglePass").addEventListener("click", () => {
  const inp = $("#loginPass");
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  $("#btnTogglePass").textContent = show ? "Ocultar senha" : "Mostrar senha";
});
$("#formLogin").addEventListener("submit", async ev => {
  ev.preventDefault(); $("#loginError").textContent = "";
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPass").value;
  let result;
  try { result = await sb.auth.signInWithPassword({ email, password }); }
  catch { $("#loginError").textContent = "Sem conexão. Tente de novo quando a internet voltar."; return; }
  if (result.error) { $("#loginError").textContent = "E-mail ou senha incorretos."; return; }
  $("#loginPass").value = "";
});
$("#btnLogout").addEventListener("click", async () => {
  if (outboxCache.length && !confirm("Há alterações ainda não enviadas. Sair mesmo assim?")) return;
  // scope "local": sai só deste aparelho, sem derrubar a sessão do outro iPhone
  // (conta única compartilhada entre os dois).
  try { await sb.auth.signOut({ scope: "local" }); } catch {}
  S.ev = {}; S.since = 0; S.uid = null; $("#dlgSettings").close(); showLogin();
});
$("#btnChangePassword").addEventListener("click", () => {
  $("#dlgSettings").close(); $("#newPassword").value = ""; $("#changePasswordError").textContent = "";
  $("#dlgChangePassword").showModal();
});
$("#formChangePassword").addEventListener("submit", ev => {
  const pw = $("#newPassword").value;
  if (pw.length < 10) { ev.preventDefault(); $("#changePasswordError").textContent = "Use pelo menos 10 caracteres."; return; }
  sb.auth.updateUser({ password: pw }).then(({ error }) => {
    toast(error ? "Não foi possível trocar a senha agora." : "Senha alterada.");
  });
});

/* ---------- actions ---------- */
function toggleSleep() {
  const now = Date.now();
  if (S.live.sleepStart) {
    const start = S.live.sleepStart, by = S.live.sleepBy;
    const rawPauses = (Array.isArray(S.live.pauses) ? S.live.pauses : []).map(p => p.end == null ? { ...p, end: now } : p);
    const dur = checkSleepDuration(now - start);
    if (!dur.ok) { toast("Duração acima de 16h. Ajuste o horário de início em Registros antes de parar."); return; }
    if (dur.needsConfirm && !confirm(`Dormiu por ${fmtDur((now - start) / MIN)} — confirma?`)) return;
    setLive({ ...S.live, sleepStart: null, sleepBy: null, pauses: [] }, { expectedSleepStart: start });
    if (now - start < MIN) { toast("Sono de menos de 1 minuto não foi salvo."); return; }
    const net = netSleepDuration(start, now, rawPauses);
    const newId = uidGen();
    const data = rawPauses.length ? { pauses: rawPauses } : {};
    putNewEvent({ id: newId, type: "sleep", start, end: now, by: by || S.uid || null, data });
    showAdjustBar(newId, "sleep", now);
    toast(`Dormiu ${fmtDur(net / MIN)}${rawPauses.length ? " (líquido, descontando pausas)" : ""}.`);
  } else {
    if (S.live.feedStart) stopFeed(true);
    setLive({ ...S.live, sleepStart: now, sleepBy: S.uid });
  }
}
function startFeed(kind) {
  if (kind === "mamadeira" || kind === "solido") { openEvent({ type: "feed", kind, start: Date.now() }); return; }
  if (S.live.sleepStart) toggleSleep();
  setLive({ ...S.live, feedStart: Date.now(), feedKind: kind, feedBy: S.uid });
}
function stopFeed(silent) {
  const { feedStart, feedKind, feedBy } = S.live; if (!feedStart) return;
  const now = Date.now();
  setLive({ ...S.live, feedStart: null, feedKind: null, feedBy: null });
  const newId = uidGen();
  putNewEvent({ id: newId, type: "feed", kind: feedKind, start: feedStart, end: now, by: feedBy || S.uid || null });
  if (!silent) showAdjustBar(newId, "feed", now);
}

/* ---------- atalhos configuráveis ---------- */
function getShortcuts() {
  const s = S.config.settings && S.config.settings.shortcuts;
  return (Array.isArray(s) && s.length ? s : DEFAULT_SHORTCUTS).filter(x => SHORTCUT_CATALOG[x.id]);
}
function moveShortcut(id, dir) {
  const list = getShortcuts(); const i = list.findIndex(s => s.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  S.config.settings = { ...S.config.settings, shortcuts: list };
  renderShortcutsConfig();
}
function setShortcutVisible(id, visible) {
  const list = getShortcuts().map(s => s.id === id ? { ...s, visible } : s);
  S.config.settings = { ...S.config.settings, shortcuts: list };
}
function renderShortcutsConfig() {
  const list = getShortcuts();
  $("#cfgShortcuts").innerHTML = list.map((s, i) => `
    <div class="shortcut-row">
      <input type="checkbox" data-sc-visible="${esc(s.id)}" ${s.visible ? "checked" : ""}>
      <span>${esc(SHORTCUT_CATALOG[s.id].label)}</span>
      <button type="button" data-sc-up="${esc(s.id)}" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
      <button type="button" data-sc-down="${esc(s.id)}" ${i === list.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button>
    </div>`).join("");
}
function openShortcut(id) {
  if (id === "growth") return openGrowth(lastGrowth());
  if (id === "agenda") return openAgenda(null);
  if (id === "solido") return openEvent({ type: "feed", kind: "solido", start: Date.now() });
  const seed = { type: id, start: Date.now() };
  if (id === "pump") seed.kind = "peito-e";
  if (id === "diaper") seed.kind = "xixi";
  openEvent(seed);
}

/* ---------- insights ---------- */
function stats() {
  const now = Date.now(), w = ageWeeks();
  const sl = sleeps();
  let sleep24 = 0;
  for (const s of sl) sleep24 += overlap(s.start, s.end, now - DAY, now);
  if (S.live.sleepStart) sleep24 += overlap(S.live.sleepStart, now, now - DAY, now);
  const fd = feeds().filter(f => f.start > now - DAY);
  const feedCount = fd.length + (S.live.feedStart ? 1 : 0);
  const lastFeed = S.live.feedStart ? null : feeds().slice(-1)[0];
  const lastBreast = [...feeds()].reverse().find(f => f.kind === "peito-e" || f.kind === "peito-d");

  const lastSleep = sl.slice(-1)[0];
  const atypicalDays = (S.config.settings && S.config.settings.atypicalDays) || [];
  const schedule = computeSchedule({ sleepEvents: sl, ageWeeks: w, settings: S.config.settings || {}, now, atypicalDayKeys: atypicalDays });
  return { now, w, sleep24: sleep24 / MIN, feedCount, lastFeed, lastBreast, lastSleep, schedule };
}
function lastGrowth() {
  const list = Object.values(S.growth).filter(g => g && !g.deleted).sort((a, b) => b.measuredAt - a.measuredAt);
  return list[0] || null;
}
function upcomingAgenda() {
  const now = Date.now() - HOUR;
  return Object.values(S.agenda).filter(a => a && !a.deleted && !a.completed && a.scheduledAt >= now)
    .sort((a, b) => a.scheduledAt - b.scheduledAt).slice(0, 3);
}

/* ---------- render: today ---------- */
function polar(cx, cy, r, min) { const a = (min / 1440) * 2 * Math.PI - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arc(cx, cy, r, m1, m2) { if (m2 - m1 >= 1439.9) m2 = m1 + 1439.9;
  const [x1, y1] = polar(cx, cy, r, m1), [x2, y2] = polar(cx, cy, r, m2); const large = (m2 - m1) > 720 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`; }

function dialSVG(st) {
  const cx = 170, cy = 170, r = 142, t0 = midnight(st.now), t1 = t0 + DAY;
  const toM = ms => (ms - t0) / MIN;
  let segs = "";
  const list = sleeps().map(s => ({ id: s.id, start: s.start, end: s.end }));
  if (S.live.sleepStart) list.push({ id: null, start: S.live.sleepStart, end: st.now, live: true });
  for (const s of list) { const a = Math.max(s.start, t0), b = Math.min(s.end, t1); if (b <= a) continue;
    segs += `<path d="${arc(cx, cy, r, toM(a), Math.max(toM(b), toM(a) + 3))}" stroke="var(--sleep)" stroke-width="22" fill="none" stroke-linecap="butt" ${s.live ? 'opacity=".75"' : ""} ${s.id ? `data-event-id="${esc(s.id)}" style="cursor:pointer"` : ""}/>`; }
  let dots = "";
  for (const f of feeds()) if (f.start >= t0 && f.start < t1) { const [x, y] = polar(cx, cy, r + 20, toM(f.start)); dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="transparent" data-event-id="${esc(f.id)}" style="cursor:pointer"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="var(--feed)" style="pointer-events:none"/>`; }
  let ticks = "";
  for (let h = 0; h < 24; h++) { const [x1, y1] = polar(cx, cy, r - 15, h * 60), [x2, y2] = polar(cx, cy, r - (h % 6 ? 19 : 24), h * 60);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--muted)" stroke-width="${h % 6 ? 1 : 1.6}" opacity=".6"/>`; }
  const labels = [[0, "0h"], [360, "6h"], [720, "12h"], [1080, "18h"]].map(([m, l]) => { const [x, y] = polar(cx, cy, r - 36, m); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--muted)">${l}</text>`; }).join("");
  const [hx, hy] = polar(cx, cy, r + 13, toM(st.now)), [hx2, hy2] = polar(cx, cy, r - 13, toM(st.now));
  return `<svg id="todayDial" viewBox="0 0 340 340" role="img" aria-label="Relógio de 24 horas com os sonos e mamadas de hoje. Toque num sono ou mamada para editar; toque num espaço vazio para adicionar.">
    <path d="${arc(cx, cy, r, 1140, 1440)}" stroke="var(--night)" stroke-width="22" fill="none"/>
    <path d="${arc(cx, cy, r, 0, 420)}" stroke="var(--night)" stroke-width="22" fill="none"/>
    <path d="${arc(cx, cy, r, 420, 1140)}" stroke="var(--surface)" stroke-width="22" fill="none"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 11}" fill="none" stroke="var(--line)"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 11}" fill="none" stroke="var(--line)"/>
    ${segs}${dots}${ticks}${labels}
    <line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${hx2.toFixed(1)}" y2="${hy2.toFixed(1)}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}
function svgClickToMinutes(svgEl, clientX, clientY) {
  const rect = svgEl.getBoundingClientRect();
  const vbX = (clientX - rect.left) / rect.width * 340, vbY = (clientY - rect.top) / rect.height * 340;
  let angle = Math.atan2(vbY - 170, vbX - 170) + Math.PI / 2;
  if (angle < 0) angle += 2 * Math.PI;
  return Math.round((angle / (2 * Math.PI)) * 1440);
}

function nextNapText(st) {
  if (S.live.sleepStart) return { k: "Dormindo desde", v: fmtTime(S.live.sleepStart), d: `Registrado por ${esc(nameFor({ ...S.live, by: S.live.sleepBy }))}` };
  const sch = st.schedule;
  const [lo, hi] = sch.wakeWindowRef;
  if (!sch.nextNap) return { k: "Próximo sono", v: "—", d: `Registre alguns sonos para as previsões aparecerem. Referência para a idade: acordado ${lo}–${hi} min.` };
  const { from, to, awakeMin, status } = sch.nextNap;
  let tag;
  if (status === "early") tag = `<span class="tag">acordado há ${fmtDur(awakeMin)}</span>`;
  else if (status === "good") tag = `<span class="tag ok">boa hora para tentar</span>`;
  else tag = `<span class="tag warn">acordado há ${fmtDur(awakeMin)}, observe sinais de cansaço</span>`;
  const calibLine = sch.calibration.ready ? "" :
    ` · <span style="color:var(--muted)">calibrando (faltam ${sch.calibration.daysNeeded} dia${sch.calibration.daysNeeded > 1 ? "s" : ""})</span>`;
  const newbornLine = sch.mode === "newborn"
    ? `<br><small style="color:var(--muted)">Modo recém-nascido: só a próxima janela por enquanto — rotina por sonecas costuma fazer mais sentido a partir de 8–12 semanas.</small>` : "";
  return {
    k: sch.mode === "newborn" ? "Próxima janela provável" : "Próximo sono provável",
    v: `${fmtTime(from)}–${fmtTime(to)}`,
    d: `${tag}${calibLine}${newbornLine}<br><button type="button" class="linklike" id="btnWhySchedule" style="font-size:.82rem;margin-top:2px">Por que este horário?</button>
      <p id="whyScheduleText" class="empty" style="display:none;font-size:.85rem;padding:2px 0 0;margin:0">${esc(sch.explain)}</p>`,
  };
}

function renderToday() {
  const st = stats();
  const sleeping = !!S.live.sleepStart, feeding = !!S.live.feedStart;
  const isPaused = sleeping && Array.isArray(S.live.pauses) && S.live.pauses.some(p => p.end == null);
  const ref = sleepRef(st.w);
  const h = st.sleep24 / 60;
  const scale = ref.max + 3;
  const inRange = h >= ref.min && h <= ref.max;
  const nn = nextNapText(st);
  const nextSide = st.lastBreast ? (st.lastBreast.kind === "peito-e" ? "peito-d" : "peito-e") : null;
  const fr = feedRef(st.w);

  const awakeLine = (!sleeping && st.lastSleep) ? `<p class="awake-line">Acordado há ${fmtDur((st.now - st.lastSleep.end) / MIN)}</p>` : "";

  let forgottenHTML = "";
  if (sleeping) {
    const f = isSleepForgotten(S.live.sleepStart, st.now);
    if (f.forgotten) forgottenHTML = `<div class="banner warn-banner">Esqueceu de parar? Dormindo há ${fmtDur((st.now - S.live.sleepStart) / MIN)} · <button class="linklike" data-adjust="sleep">Ajustar</button></div>`;
  }
  const suggestionHTML = st.schedule.suggestion ? `<div class="banner">${esc(st.schedule.suggestion.detail)}</div>` : "";

  let feedHTML;
  if (feeding) {
    feedHTML = `<div class="feeding"><div><div style="font-weight:700">${esc(KIND[S.live.feedKind] || "Mamando")}</div>
      <div class="clock" data-timer="${S.live.feedStart}">${fmtClock(st.now - S.live.feedStart)}</div>
      <button class="adjust" style="margin:0;padding:0" data-adjust="feed">Ajustar início</button></div>
      <button class="btn feed" id="btnStopFeed">Terminar</button></div>`;
  } else {
    feedHTML = `<div class="feedbar" role="group" aria-label="Registrar mamada">
      <button data-feed="peito-e" class="${nextSide === "peito-e" ? "hint" : ""}">Peito E</button>
      <button data-feed="peito-d" class="${nextSide === "peito-d" ? "hint" : ""}">Peito D</button>
      <button data-feed="mamadeira">Mamadeira</button></div>`;
  }

  const lastFeedLine = feeding ? "Mamando agora" :
    st.lastFeed ? `Última há ${fmtDur((st.now - st.lastFeed.start) / MIN)} (${esc(KIND[st.lastFeed.kind] || "")})${nextSide ? ` · próximo: ${KIND[nextSide].toLowerCase()}` : ""}` : "Nenhuma mamada registrada";

  const shortcutsHTML = `<div class="moreRow" role="group" aria-label="Mais registros">${getShortcuts().filter(s => s.visible).map(s => `<button data-shortcut="${esc(s.id)}">${esc(SHORTCUT_CATALOG[s.id].label)}</button>`).join("")}</div>`;

  const lg = lastGrowth();
  const growthLine = lg ? `<button class="rec" data-shortcut="growth"><span class="dot" style="background:var(--sleep)"></span><span class="t">${fmtTime(lg.measuredAt)}</span><span class="x">Última pesagem${lg.weightG ? ` · ${(lg.weightG / 1000).toFixed(2).replace(".", ",")} kg` : ""}${lg.heightCm ? ` · ${lg.heightCm} cm` : ""}</span></button>` : "";

  const upcoming = upcomingAgenda();
  const agendaHTML = upcoming.length ? `<h2>Próximos compromissos</h2>${upcoming.map(a => `<button class="agenda-item" data-agenda-edit="${esc(a.id)}"><span class="dot" style="background:var(--feed)"></span><span class="t">${fmtTime(a.scheduledAt)}</span><span class="x">${esc(AGENDA_KIND_LABEL[a.kind] || a.kind)}${a.title ? ` · ${esc(a.title)}` : ""}</span></button>`).join("")}` : "";

  $("#view-hoje").innerHTML = `
    ${forgottenHTML}
    ${suggestionHTML}
    <div class="dial-wrap">${dialSVG(st)}
      <button class="dial-center ${sleeping ? "sleeping" : ""}" id="btnSleep" aria-label="${sleeping ? "Registrar que acordou" : "Registrar que dormiu"}">
        ${sleeping ? `<span class="sub">dormindo${isPaused ? " · pausado" : ""}</span><span class="clock" data-timer="${S.live.sleepStart}">${fmtClock(st.now - S.live.sleepStart)}</span><span class="verb" style="font-size:1.05rem;margin-top:4px">Acordou</span>`
                   : `<span class="verb">Dormiu</span><span class="sub">toque para iniciar</span>`}
      </button>
    </div>
    ${awakeLine}
    ${sleeping ? `<button class="adjust" data-adjust="sleep">Adormeceu antes? Ajustar início</button>
      <button class="adjust" id="btnPauseSleep">${isPaused ? "Retomar sono" : "Pausar (acordou um pouco)"}</button>
      <p class="safe">De barriga para cima, no berço, sem objetos soltos.</p>` : ""}
    ${feedHTML}
    ${shortcutsHTML}
    <section class="stats" aria-label="Resumo">
      <div class="stat"><span class="k">${nn.k}</span><span class="v">${nn.v}</span><span class="d">${nn.d}</span></div>
      <div class="stat"><span class="k">Sono nas últimas 24 h</span><span class="v">${fmtDur(st.sleep24)}</span>
        <span class="d">${inRange ? `<span class="tag ok">dentro da faixa</span>` : `<span class="tag">referência ${ref.min}–${ref.max} h</span>`}</span>
        <div class="meter" aria-hidden="true"><div class="band" style="left:${ref.min / scale * 100}%;width:${(ref.max - ref.min) / scale * 100}%"></div><div class="fill" style="width:${Math.min(h / scale, 1) * 100}%"></div></div>
      </div>
      <div class="stat"><span class="k">Mamadas nas últimas 24 h</span><span class="v">${st.feedCount}</span>
        <span class="d">${lastFeedLine}${fr ? `<br><small style="color:var(--muted)">Referência para a idade: ${fr[0]}–${fr[1]} por dia</small>` : ""}</span></div>
    </section>
    ${growthLine}
    ${agendaHTML}
    <div class="actions"><button class="btn ghost" data-new>Adicionar registro passado</button></div>`;
}

/* ---------- render: week ---------- */
function renderWeek() {
  const now = Date.now(), t0 = midnight(now);
  const sl = sleeps(); if (S.live.sleepStart) sl.push({ start: S.live.sleepStart, end: now });
  const fd = feeds();
  let rows = "", totals = [], longest = [];
  for (let i = 0; i < 7; i++) {
    const d0 = t0 - i * DAY, d1 = d0 + DAY;
    let segs = `<div class="n" style="left:0;width:${7 / 24 * 100}%"></div><div class="n" style="left:${19 / 24 * 100}%;width:${5 / 24 * 100}%"></div>`, tot = 0, lg = 0;
    for (const s of sl) { const a = Math.max(s.start, d0), b = Math.min(s.end, d1); if (b <= a) continue;
      tot += b - a; lg = Math.max(lg, s.end - s.start);
      segs += `<div class="s" style="left:${(a - d0) / DAY * 100}%;width:${(b - a) / DAY * 100}%"></div>`; }
    for (const f of fd) if (f.start >= d0 && f.start < d1) segs += `<div class="f" style="left:${(f.start - d0) / DAY * 100}%"></div>`;
    const lbl = new Date(d0).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" });
    rows += `<div class="week-row"><span class="lbl">${i === 0 ? "Hoje" : esc(lbl)}</span><div class="bar">${segs}</div><span class="tot">${tot ? fmtDur(tot / MIN) : "—"}</span></div>`;
    if (i > 0 && tot) { totals.push(tot / MIN); longest.push(lg / MIN); }
  }
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const ref = sleepRef(ageWeeks());
  const feedsPerDay = (() => { const c = fd.filter(f => f.start >= t0 - 7 * DAY && f.start < t0).length; return c ? (c / Math.max(1, totals.length || 7)).toFixed(1) : null; })();
  $("#view-semana").innerHTML = `
    <h2>Últimos 7 dias</h2>
    <div class="legend"><span><i style="background:var(--sleep)"></i>sono</span><span><i style="background:var(--feed)"></i>mamada</span><span><i style="background:var(--night)"></i>noite (19h–7h)</span></div>
    <div class="scroll">
      <div class="axis"><span></span><div><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div><span></span></div>
      ${rows}
    </div>
    <div class="summary">
      <h2>Resumo dos dias completos</h2>
      ${avg == null ? `<p class="empty">Os resumos aparecem depois do primeiro dia completo com registros.</p>` : `
      <p>Média de sono: <strong>${fmtDur(avg)}</strong> por dia (referência ${ref.min}–${ref.max} h). Dias com registro incompleto puxam a média para baixo.</p>
      <p>Maior sono contínuo, em média: <strong>${fmtDur(longest.reduce((a, b) => a + b, 0) / longest.length)}</strong>. Nas primeiras semanas é normal ficar entre 2 e 4 h; o trecho longo tende a crescer e a se deslocar para a noite a partir de 2–3 meses.</p>
      ${feedsPerDay ? `<p>Mamadas registradas: <strong>${feedsPerDay}</strong> por dia em média.</p>` : ""}`}
    </div>`;
}

/* ---------- render: records ---------- */
function eventTitle(e) {
  const isS = e.type === "sleep";
  if (isS) {
    const night = classifySleep(e.start, e.end || Date.now(), e.isNight, ...nightWindow());
    const place = e.data && e.data.place;
    const attempt = e.data && e.data.attempt;
    let t = attempt === "failed" ? "Tentativa de soneca (não dormiu)" : `Sono ${night === "night" ? "noturno" : "(soneca)"} de ${fmtDur((e.end - e.start) / MIN)}`;
    if (attempt === "moving") t += " · em movimento";
    if (place) t += ` · ${PLACE_LABEL[place] || place}`;
    return t;
  }
  if (e.type === "feed") return `${KIND[e.kind] || "Mamada"}${e.end ? ` · ${fmtDur((e.end - e.start) / MIN)}` : ""}${e.ml ? ` · ${e.ml} ml` : ""}${e.data && e.data.milkType ? ` · ${MILK_LABEL[e.data.milkType] || e.data.milkType}` : ""}`;
  if (e.type === "pump") return `Extração${e.kind ? ` · ${KIND[e.kind] || e.kind}` : ""}${e.ml ? ` · ${e.ml} ml` : ""}`;
  if (e.type === "diaper") return `Fralda · ${DIAPER_LABEL[e.kind] || e.kind || ""}`;
  if (e.type === "medicine") return `Remédio${e.data && e.data.medicineName ? ` · ${e.data.medicineName}` : ""}${e.data && e.data.medicineDose ? ` · ${e.data.medicineDose}` : ""}`;
  if (e.type === "bath") return "Banho";
  if (e.type === "activity") return `Atividade${e.end ? ` · ${fmtDur((e.end - e.start) / MIN)}` : ""}`;
  return e.type;
}
function renderRecords() {
  const ev = events().reverse();
  const groups = {};
  for (const e of ev) { const k = dayKey(e.start); (groups[k] = groups[k] || []).push(e); }
  let html = `<div class="actions" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Registros</h2><button class="btn primary" data-new>Adicionar</button></div>`;
  const keys = Object.keys(groups);
  if (!keys.length) html += `<p class="empty">Nenhum registro ainda. Use o botão Dormiu na tela Hoje ou adicione um registro passado.</p>`;
  const atypicalDays = (S.config.settings && S.config.settings.atypicalDays) || [];
  for (const k of keys) {
    const isAtyp = atypicalDays.includes(k);
    html += `<div class="rec-day"><h3>${esc(dayLabel(groups[k][0].start))}
      <button type="button" class="linklike" data-atypical="${esc(k)}" style="font-size:.75rem;font-weight:400">${isAtyp ? "Dia atípico ✓ (tocar para desmarcar)" : "Marcar como atípico"}</button></h3>`;
    for (const e of groups[k]) {
      const isS = e.type === "sleep";
      const time = e.end ? `${fmtTime(e.start)}–${fmtTime(e.end)}` : fmtTime(e.start);
      html += `<button class="rec" data-edit="${esc(e.id)}">${statusGlyph(e.id)}<span class="dot" style="background:var(${isS ? "--sleep" : "--feed"})"></span>
        <span class="t">${time}</span><span class="x">${esc(eventTitle(e))}<small>${e.note ? esc(e.note) + " · " : ""}${e.by ? `por ${esc(nameFor(e))}` : ""}</small></span></button>`;
    }
    html += `</div>`;
  }
  html += `<p class="empty" style="font-size:.88rem">Mostrando os últimos 14 dias. <button class="linklike" id="btnTrash">Lixeira (30 dias)</button></p>`;
  $("#view-registros").innerHTML = html;
}

/* ---------- lixeira ---------- */
async function openTrash() {
  const cutoff = Date.now() - 30 * DAY;
  const { data, error } = await sb.from("events").select("*").eq("deleted", true).gte("updated_at", cutoff).order("updated_at", { ascending: false });
  if (error) { toast("Não foi possível abrir a lixeira agora."); return; }
  const rows = data || [];
  let html = rows.length ? "" : `<p class="empty">Nada na lixeira.</p>`;
  for (const r of rows) {
    const isS = r.type === "sleep";
    const title = eventTitle(rowToEvent(r));
    html += `<div class="rec" style="cursor:default"><span class="dot" style="background:var(${isS ? "--sleep" : "--feed"})"></span>
      <span class="t">${fmtTime(r.start)}</span><span class="x">${esc(title)}<small>apagado ${fmtTime(r.updated_at)}</small></span>
      <button class="btn ghost" data-restore="${esc(r.id)}" data-version="${r.version || 1}">Restaurar</button></div>`;
  }
  $("#trashBody").innerHTML = html;
  $("#dlgTrash").showModal();
}
async function restoreEvent(id, expectedVersion) {
  const patch = { deleted: false, updated_at: Date.now(), last_edited_by: S.uid, device_name: S.deviceName || null };
  if (S.ev[id]) { S.ev[id] = { ...S.ev[id], ...patch, version: expectedVersion + 1 }; await store.putEventRow(S.ev[id]); }
  await enqueue({ kind: "cond-update", table: "events", id, patch, expectedVersion });
  toast("Registro restaurado.");
  $("#dlgTrash").close();
  render();
}

/* ---------- backup ---------- */
async function exportBackup() {
  if (!sb) return;
  try {
    const [evRes, babyRes, profRes, growthRes, agendaRes] = await Promise.all([
      sb.from("events").select("*").order("start"),
      sb.from("baby").select("*").eq("id", 1).maybeSingle(),
      sb.from("profiles").select("id,name"),
      sb.from("sono_growth").select("*").order("measured_at"),
      sb.from("sono_agenda").select("*").order("scheduled_at"),
    ]);
    const payload = { exportedAt: new Date().toISOString(), events: evRes.data || [], baby: babyRes.data || null,
      profiles: profRes.data || [], growth: growthRes.data || [], agenda: agendaRes.data || [] };
    const filename = `sono-backup-${dayKey(Date.now())}.json`;
    const json = JSON.stringify(payload, null, 2);
    // No iPhone, a folha de compartilhamento é o jeito natural de salvar/mandar o arquivo;
    // download direto (<a download>) fica como alternativa noutros navegadores.
    if (navigator.canShare && window.File) {
      const file = new File([json], filename, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Backup Sono do Joaquim" });
        return;
      }
    }
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    toast("Backup baixado.");
  } catch (e) { if (e && e.name !== "AbortError") toast("Não foi possível gerar o backup agora (sem conexão?)."); }
}

/* ---------- diagnóstico ---------- */
async function openDiagnostics() {
  const log = (await store.getLog()).sort((a, b) => b.ts - a.ts);
  const lines = log.map(l => `${new Date(l.ts).toLocaleString("pt-BR")} · ${l.kind} · ${l.detail || ""}`);
  const report = [`Sono do Joaquim — ${APP_VERSION}`, `Realtime: ${realtimeStatus}`, `Pendentes: ${outboxCache.length}`, `Com erro: ${Object.keys(errorMap).length}`, "", ...lines].join("\n");
  $("#diagBody").textContent = report;
  $("#dlgDiag").showModal();
}

/* ---------- render: guide ---------- */
function renderGuide() {
  const w = ageWeeks(), ref = sleepRef(w), [lo, hi] = wakeRef(w);
  $("#view-guia").innerHTML = `
    <h2>Para a idade atual</h2>
    <p>${w == null ? "Defina a data de nascimento nas configurações para personalizar." : `Com ${esc(ageText(w))}, as referências usadas pelo app são:`}</p>
    <p>Sono total em 24 h: <strong>${ref.min} a ${ref.max} horas</strong> (${esc(ref.src)}). Tempo acordado entre sonos: <strong>${lo} a ${hi} minutos</strong>.${feedRef(w) ? ` Mamadas: <strong>8 a 12 por dia</strong>.` : ""}</p>

    <h2>Como o app calcula a previsão</h2>
    <p>A previsão do próximo sono começa pela faixa de tempo acordado típica da idade. Depois de alguns sonos registrados, ela passa a usar a mediana dos intervalos reais do bebê nos últimos 3 dias, sem sair muito da faixa da idade. É uma estimativa: os sinais do bebê (bocejar, esfregar os olhos, olhar parado, irritação) valem mais que o relógio.</p>
    <p class="src">As faixas de sono total vêm de consensos de especialistas. As janelas de tempo acordado são usadas na prática por pediatras e consultoras de sono, mas têm pouca base em estudos controlados. Por isso o app as trata como ponto de partida ajustável, e não como regra.</p>

    <h2>O que esperar de 0 a 3 meses</h2>
    <ul>
      <li>O sono é distribuído ao longo do dia e da noite, em blocos curtos, porque o ritmo circadiano ainda está se formando. Ele costuma se organizar entre 2 e 4 meses.</li>
      <li>Luz natural e movimento durante o dia; ambiente escuro, calmo e mamadas com pouca estimulação à noite ajudam o relógio biológico a amadurecer.</li>
      <li>Recém-nascidos mamam em livre demanda, geralmente 8 a 12 vezes em 24 h. Fique de olho nos sinais de fome antes do choro.</li>
      <li>Variação grande de um dia para outro é normal. Compare tendências da semana, não dias isolados.</li>
    </ul>

    <h2>Sono seguro (AAP, 2022)</h2>
    <ul>
      <li>Sempre de barriga para cima, em todos os sonos, inclusive sonecas.</li>
      <li>Superfície firme e plana, com lençol ajustado. Sem travesseiros, protetores de berço, cobertores soltos ou bichos de pelúcia.</li>
      <li>Dormir no mesmo quarto dos pais, mas em berço próprio, de preferência nos primeiros 6 meses.</li>
      <li>Evitar deixar o bebê dormir em sofá, poltrona, cadeirinha de carro fora do carro ou superfícies inclinadas.</li>
      <li>Evitar superaquecimento e exposição à fumaça de cigarro. Amamentação e chupeta na hora de dormir estão associadas a menor risco.</li>
    </ul>

    <h2>Quando falar com o pediatra</h2>
    <p>Procure orientação se o bebê estiver muito sonolento e difícil de acordar para mamar, com poucas fraldas molhadas, respirando com pausas ou esforço, com ronco constante, ou se algo simplesmente parecer diferente do normal dele. Este app é um diário, não um dispositivo médico.</p>

    <h2>Referências</h2>
    <div class="scroll"><table>
      <tr><th>Fonte</th><th>Uso no app</th></tr>
      <tr><td>Hirshkowitz et al., <em>Sleep Health</em>, 2015 (National Sleep Foundation)</td><td>14–17 h para 0–3 meses</td></tr>
      <tr><td>Paruthi et al., <em>J Clin Sleep Med</em>, 2016 (AASM, endossado pela AAP)</td><td>Faixas a partir de 4 meses</td></tr>
      <tr><td>Moon et al., <em>Pediatrics</em>, 2022 (AAP, sono seguro)</td><td>Recomendações de sono seguro</td></tr>
      <tr><td>AAP / HealthyChildren.org, orientação sobre amamentação</td><td>8–12 mamadas por dia no início</td></tr>
      <tr><td>Huckleberry, Napper, Glow Baby, BabyTime</td><td>Inspiração de uso: registro com um toque, previsão de soneca, visão de 24 h, compartilhamento</td></tr>
    </table></div>`;
}

/* ---------- render root ---------- */
function render() {
  $("#babyName").textContent = S.config.name || "Bebê";
  document.title = `Sono do ${S.config.name || "bebê"}`;
  $("#babyAge").textContent = ageText(ageWeeks());
  updateBanner();
  for (const t of ["hoje", "semana", "registros", "guia"]) {
    $("#view-" + t).hidden = S.tab !== t;
    document.querySelector(`nav [data-tab="${t}"]`).setAttribute("aria-current", S.tab === t ? "page" : "false");
  }
  if (S.tab === "hoje") renderToday();
  else if (S.tab === "semana") renderWeek();
  else if (S.tab === "registros") renderRecords();
  else renderGuide();
}
setInterval(() => { document.querySelectorAll("[data-timer]").forEach(el => el.textContent = fmtClock(Date.now() - Number(el.dataset.timer))); }, 1000);
setInterval(() => { if (S.tab === "hoje" && !document.querySelector("dialog[open]")) render(); }, 30000);

// iOS não roda nada em segundo plano (sem Background Sync): toda volta ao app
// reforça a sessão, resincroniza e reconecta o Realtime, em vez de confiar em timers de fundo.
function onForeground() {
  if (!sb) return;
  try { sb.auth.startAutoRefresh(); } catch {}
  sync();
  reconnectRealtimeIfNeeded();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (sb) { try { sb.auth.stopAutoRefresh(); } catch {} } }
  else { render(); onForeground(); }
});
window.addEventListener("pageshow", onForeground);
window.addEventListener("focus", onForeground);
window.addEventListener("online", onForeground);

/* ---------- dialogs: registro (sono/mamada/extração/fralda/remédio/banho/atividade) ---------- */
function syncEventFields() {
  const t = $("#evType").value, k = $("#evKind").value;
  $("#evFeedKindWrap").hidden = t !== "feed";
  $("#evMilkTypeWrap").hidden = !(t === "feed" && k === "mamadeira");
  $("#evPumpSideWrap").hidden = t !== "pump";
  $("#evDiaperKindWrap").hidden = t !== "diaper";
  $("#evMedicineWrap").hidden = t !== "medicine";
  $("#evPlaceWrap").hidden = t !== "sleep";
  $("#evAttemptWrap").hidden = t !== "sleep";
  $("#evNightWrap").hidden = t !== "sleep";
  $("#evEndWrap").hidden = (t === "feed" && (k === "mamadeira" || k === "solido")) || t === "diaper" || t === "medicine";
  $("#evMlWrap").hidden = !((t === "feed" && k === "mamadeira") || t === "pump");
  $('label[for="evEnd"]').textContent = t === "sleep" ? "Acordou às" : "Terminou às";
}
function openEvent(ev) {
  editing = ev && ev.id ? ev : null;
  const e = ev || { type: "sleep", start: Date.now() - HOUR, end: Date.now() };
  const data = e.data || {};
  $("#evTitle").textContent = editing ? "Editar registro" : "Novo registro";
  $("#evType").value = e.type;
  $("#evKind").value = e.type === "feed" ? (e.kind || "peito-e") : "peito-e";
  $("#evMilkType").value = data.milkType || "formula";
  $("#evPumpSide").value = e.type === "pump" ? (e.kind || "peito-e") : "peito-e";
  $("#evDiaperKind").value = e.type === "diaper" ? (e.kind || "xixi") : "xixi";
  $("#evMedName").value = data.medicineName || "";
  $("#evMedDose").value = data.medicineDose || "";
  $("#evMedInterval").value = data.medicineIntervalHours || "";
  $("#evPlace").value = data.place || "";
  $("#evAttempt").value = data.attempt || "";
  $("#evNight").value = e.isNight === true ? "night" : e.isNight === false ? "nap" : "auto";
  $("#evStart").value = toInput(e.start);
  $("#evEnd").value = e.end ? toInput(e.end) : (e.type === "sleep" ? toInput(Date.now()) : "");
  $("#evMl").value = e.ml || "";
  $("#evNote").value = e.note || "";
  $("#evDelete").hidden = !editing;
  syncEventFields();
  $("#dlgEvent").showModal();
}
$("#evType").addEventListener("change", syncEventFields);
$("#evKind").addEventListener("change", syncEventFields);
document.querySelectorAll(".qbtn").forEach(b => b.addEventListener("click", () => {
  $("#evStart").value = toInput(offsetFromNow(Date.now(), Number(b.dataset.quick)));
}));
$("#formEvent").addEventListener("submit", ev => {
  const type = $("#evType").value, kind = $("#evKind").value;
  const start = fromInput($("#evStart").value);
  const endRaw = $("#evEnd").value, end = endRaw ? fromInput(endRaw) : null;
  if (!start || isNaN(start)) { ev.preventDefault(); toast("Informe o horário de início."); return; }
  if (start > Date.now() + 5 * MIN) { ev.preventDefault(); toast("O início não pode estar no futuro."); return; }
  const needsEnd = type === "sleep" || (!$("#evEndWrap").hidden && endRaw);
  if (type === "sleep" && !end) { ev.preventDefault(); toast("Informe quando acordou."); return; }
  if (needsEnd && end <= start) { ev.preventDefault(); toast("O fim precisa ser depois do início."); return; }
  if (needsEnd) {
    const dur = checkSleepDuration(end - start);
    if (!dur.ok) { ev.preventDefault(); toast("Duração acima de 16 h. Confira as datas."); return; }
    if (dur.needsConfirm && !confirm(`Duração de ${fmtDur((end - start) / MIN)} — confirma?`)) { ev.preventDefault(); return; }
  }
  const rec = { id: editing ? editing.id : uidGen(), type, start };
  const data = {};
  if (type === "sleep") {
    rec.end = end;
    const place = $("#evPlace").value; if (place) data.place = place;
    const attempt = $("#evAttempt").value; if (attempt) data.attempt = attempt;
    const nightSel = $("#evNight").value;
    rec.isNight = nightSel === "night" ? true : nightSel === "nap" ? false : null;
    if (editing && editing.data && editing.data.pauses) data.pauses = editing.data.pauses;
  } else if (type === "feed") {
    rec.kind = kind;
    if (!$("#evEndWrap").hidden && end) rec.end = end;
    if (kind === "mamadeira") {
      if ($("#evMl").value) rec.ml = Number($("#evMl").value);
      const milk = $("#evMilkType").value; if (milk) data.milkType = milk;
    }
  } else if (type === "pump") {
    rec.kind = $("#evPumpSide").value;
    if (end) rec.end = end;
    if ($("#evMl").value) rec.ml = Number($("#evMl").value);
  } else if (type === "diaper") {
    rec.kind = $("#evDiaperKind").value;
  } else if (type === "medicine") {
    const name = $("#evMedName").value.trim(); if (name) data.medicineName = name;
    const dose = $("#evMedDose").value.trim(); if (dose) data.medicineDose = dose;
    const interval = $("#evMedInterval").value; if (interval) data.medicineIntervalHours = Number(interval);
  } else if (end) { rec.end = end; } // bath/activity
  const note = $("#evNote").value.trim(); if (note) rec.note = note;
  rec.data = data;

  if (type === "sleep" && end) {
    const hit = findSleepOverlap(events(), start, end, editing ? editing.id : null);
    if (hit) {
      ev.preventDefault();
      pendingSave = { rec, isEdit: !!editing, expectedVersion: editing ? editing.version : null };
      pendingOverlapId = hit.id; pendingOverlapVersion = hit.version || 1;
      $("#collisionText").textContent = `Já existe um sono de ${fmtTime(hit.start)}${hit.end ? `–${fmtTime(hit.end)}` : ""} registrado nesse horário.`;
      $("#dlgEvent").close();
      $("#dlgCollision").showModal();
      return;
    }
  }
  if (editing) { rec.by = editing.by || null; putEditedEvent(rec, editing.version || 1); }
  else putNewEvent(rec);
  toast(editing ? "Registro atualizado." : "Registro salvo.");
  editing = null;
});
$("#evDelete").addEventListener("click", () => {
  if (!editing) return;
  deleteEvent(editing.id);
  $("#dlgEvent").close(); editing = null;
});

/* ---------- colisão de sono ---------- */
function finalizeSleepSave(save) {
  if (!save) return;
  if (save.isEdit) putEditedEvent(save.rec, save.expectedVersion);
  else putNewEvent(save.rec);
  toast(save.isEdit ? "Registro atualizado." : "Registro salvo.");
}
$("#btnCollisionCancel").addEventListener("click", () => { $("#dlgCollision").close(); pendingSave = null; });
$("#btnCollisionEdit").addEventListener("click", () => {
  $("#dlgCollision").close();
  const ov = S.ev[pendingOverlapId]; pendingSave = null;
  if (ov) openEvent(ov);
});
$("#btnCollisionReplace").addEventListener("click", () => {
  $("#dlgCollision").close();
  if (pendingOverlapId) deleteEventNow(pendingOverlapId, pendingOverlapVersion);
  finalizeSleepSave(pendingSave);
  pendingSave = null;
});

/* ---------- dialogs: crescimento ---------- */
function openGrowth(g) {
  editingGrowth = g && g.id ? g : null;
  const row = g || { measuredAt: Date.now() };
  $("#grwTitle").textContent = editingGrowth ? "Editar crescimento" : "Crescimento";
  $("#grwWhen").value = toInput(row.measuredAt || Date.now());
  $("#grwWeight").value = row.weightG || "";
  $("#grwHeight").value = row.heightCm || "";
  $("#grwHead").value = row.headCm || "";
  $("#grwNote").value = row.note || "";
  $("#grwDelete").hidden = !editingGrowth;
  $("#dlgGrowth").showModal();
}
$("#formGrowth").addEventListener("submit", ev => {
  const when = fromInput($("#grwWhen").value);
  if (!when || isNaN(when)) { ev.preventDefault(); toast("Informe a data e hora."); return; }
  const rec = { id: editingGrowth ? editingGrowth.id : uidGen(), measuredAt: when,
    weightG: $("#grwWeight").value ? Number($("#grwWeight").value) : null,
    heightCm: $("#grwHeight").value ? Number($("#grwHeight").value) : null,
    headCm: $("#grwHead").value ? Number($("#grwHead").value) : null,
    note: $("#grwNote").value.trim() || null };
  if (editingGrowth) putEditedGrowth(rec, editingGrowth.version || 1);
  else putNewGrowth(rec);
  toast(editingGrowth ? "Atualizado." : "Registro salvo.");
  editingGrowth = null;
});
$("#grwDelete").addEventListener("click", () => {
  if (!editingGrowth) return;
  deleteGrowthNow(editingGrowth.id, editingGrowth.version || 1);
  $("#dlgGrowth").close(); editingGrowth = null; toast("Apagado.");
});

/* ---------- dialogs: agenda ---------- */
function openAgenda(a) {
  editingAgenda = a && a.id ? a : null;
  const row = a || { kind: "consulta", scheduledAt: Date.now() + HOUR };
  $("#agTitle2").textContent = editingAgenda ? "Editar agenda" : "Agenda";
  $("#agKind").value = row.kind || "consulta";
  $("#agTitleInput").value = row.title || "";
  $("#agWhen").value = toInput(row.scheduledAt);
  $("#agDuration").value = row.durationMin || "";
  $("#agNote").value = row.note || "";
  $("#agDelete").hidden = !editingAgenda;
  $("#dlgAgenda").showModal();
}
$("#formAgenda").addEventListener("submit", ev => {
  const when = fromInput($("#agWhen").value);
  const title = $("#agTitleInput").value.trim();
  if (!title) { ev.preventDefault(); toast("Dê um título ao compromisso."); return; }
  if (!when || isNaN(when)) { ev.preventDefault(); toast("Informe a data e hora."); return; }
  const rec = { id: editingAgenda ? editingAgenda.id : uidGen(), kind: $("#agKind").value, title, scheduledAt: when,
    durationMin: $("#agDuration").value ? Number($("#agDuration").value) : null,
    note: $("#agNote").value.trim() || null, completed: editingAgenda ? editingAgenda.completed : false };
  if (editingAgenda) putEditedAgenda(rec, editingAgenda.version || 1);
  else putNewAgenda(rec);
  toast(editingAgenda ? "Atualizado." : "Agenda salva.");
  editingAgenda = null;
});
$("#agDelete").addEventListener("click", () => {
  if (!editingAgenda) return;
  deleteAgendaNow(editingAgenda.id, editingAgenda.version || 1);
  $("#dlgAgenda").close(); editingAgenda = null; toast("Apagado.");
});

function openAdjust(which) {
  adjusting = which;
  $("#adjTitle").textContent = which === "sleep" ? "Quando adormeceu?" : "Quando começou a mamar?";
  $("#adjTime").value = toInput(which === "sleep" ? S.live.sleepStart : S.live.feedStart);
  $("#dlgAdjust").showModal();
}
$("#formAdjust").addEventListener("submit", ev => {
  const t = fromInput($("#adjTime").value);
  if (!t || isNaN(t) || t > Date.now()) { ev.preventDefault(); toast("Escolha um horário no passado."); return; }
  if (Date.now() - t > 16 * HOUR) { ev.preventDefault(); toast("Mais de 16 h atrás. Use Adicionar registro."); return; }
  if (adjusting === "sleep") setLive({ ...S.live, sleepStart: t });
  else setLive({ ...S.live, feedStart: t });
});

/* ---------- configurações ---------- */
function openSettingsDialog() {
  $("#cfgName").value = S.config.name || "";
  $("#cfgBirth").value = S.config.birth || "";
  $("#cfgDeviceName").value = S.deviceName || "";
  $("#cfgTheme").value = (() => { try { return localStorage.getItem("sono-theme") || "auto"; } catch { return "auto"; } })();
  const settings = S.config.settings || {};
  $("#cfgFixedNaps").value = settings.fixedNaps != null ? settings.fixedNaps : "";
  $("#cfgMinWake").value = settings.minWakeHour != null ? settings.minWakeHour : "";
  renderShortcutsConfig();
  $("#dlgSettings").showModal();
}
$("#btnSettings").addEventListener("click", openSettingsDialog);
$("#formSettings").addEventListener("submit", () => {
  const wasFirstDeviceName = !S.deviceName;
  const theme = $("#cfgTheme").value; applyTheme(theme); try { localStorage.setItem("sono-theme", theme); } catch {}
  const deviceName = $("#cfgDeviceName").value.trim();
  S.deviceName = deviceName; store.setMeta("deviceName", deviceName);
  const fixedNaps = $("#cfgFixedNaps").value ? Number($("#cfgFixedNaps").value) : null;
  const minWakeHour = $("#cfgMinWake").value ? Number($("#cfgMinWake").value) : null;
  setConfig({ name: $("#cfgName").value.trim() || "Bebê", birth: $("#cfgBirth").value,
    settings: { ...S.config.settings, fixedNaps, minWakeHour } });
  if (wasFirstDeviceName && deviceName && !S.onboardingDone) showOnboarding();
});
function applyTheme(t) { if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); }
try { applyTheme(localStorage.getItem("sono-theme") || "auto"); } catch {}
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => { b.closest("dialog").close(); editing = null; }));
$("#btnExportBackup").addEventListener("click", exportBackup);
$("#btnDiagnostics").addEventListener("click", () => { $("#dlgSettings").close(); openDiagnostics(); });
$("#btnCopyDiag").addEventListener("click", async () => {
  const text = $("#diagBody").textContent;
  try { await navigator.clipboard.writeText(text); toast("Relatório copiado."); }
  catch { toast("Não foi possível copiar automaticamente — selecione o texto e copie manualmente."); }
});

/* ---------- onboarding (3 telas, uma vez) ---------- */
function showOnboarding() {
  obStep = 0; renderOnboardingScreen(); $("#dlgOnboarding").showModal();
}
function renderOnboardingScreen() {
  const s = ONBOARDING_SCREENS[obStep];
  const dots = ONBOARDING_SCREENS.map((_, i) => `<span class="${i === obStep ? "on" : ""}"></span>`).join("");
  $("#obScreen").innerHTML = `<div class="ob-screen"><h2>${esc(s.title)}</h2><p>${s.body}</p><div class="ob-dots">${dots}</div></div>`;
  $("#btnObNext").textContent = obStep === ONBOARDING_SCREENS.length - 1 ? "Entendi" : "Próximo";
}
function finishOnboarding() {
  S.onboardingDone = true; store.setMeta("onboardingDone", true);
  $("#dlgOnboarding").close();
}
$("#btnObNext").addEventListener("click", () => {
  if (obStep >= ONBOARDING_SCREENS.length - 1) { finishOnboarding(); return; }
  obStep++; renderOnboardingScreen();
});
$("#btnObSkip").addEventListener("click", finishOnboarding);

/* ---------- delegated clicks/changes ---------- */
document.addEventListener("click", e => {
  const evEl = e.target.closest("[data-event-id]");
  if (evEl) { const found = S.ev[evEl.dataset.eventId]; if (found) openEvent(found); return; }
  const svg = e.target.closest("#todayDial");
  if (svg && S.tab === "hoje" && !document.querySelector("dialog[open]")) {
    const mins = svgClickToMinutes(svg, e.clientX, e.clientY);
    const t0 = midnight(Date.now());
    let t = t0 + mins * MIN; if (t > Date.now()) t -= DAY;
    openEvent({ type: "sleep", start: t, end: Math.min(t + HOUR, Date.now()) });
    return;
  }
  const up = e.target.closest("[data-sc-up]"); if (up) { moveShortcut(up.dataset.scUp, -1); return; }
  const down = e.target.closest("[data-sc-down]"); if (down) { moveShortcut(down.dataset.scDown, 1); return; }
  const agEdit = e.target.closest("[data-agenda-edit]");
  if (agEdit) { const a = S.agenda[agEdit.dataset.agendaEdit]; if (a) openAgenda(a); return; }

  const atyp = e.target.closest("[data-atypical]");
  if (atyp) return toggleAtypicalDay(atyp.dataset.atypical);

  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "btnSleep") return toggleSleep();
  if (t.id === "btnStopFeed") return stopFeed();
  if (t.id === "btnPauseSleep") return togglePause();
  if (t.id === "btnWhySchedule") { const p = $("#whyScheduleText"); if (p) p.style.display = p.style.display === "none" ? "block" : "none"; return; }
  if (t.dataset.feed) return startFeed(t.dataset.feed);
  if (t.dataset.shortcut) return openShortcut(t.dataset.shortcut);
  if (t.dataset.adjust) return openAdjust(t.dataset.adjust);
  if (t.hasAttribute("data-new")) return openEvent(null);
  if (t.dataset.edit) { const ev = events().find(x => x.id === t.dataset.edit); if (ev) openEvent(ev); return; }
  if (t.dataset.review) { const ev = S.ev[t.dataset.review]; if (ev) openEvent(ev); return; }
  if (t.id === "btnTrash") return openTrash();
  if (t.dataset.restore) return restoreEvent(t.dataset.restore, Number(t.dataset.version || 1));
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); }
});
document.addEventListener("change", e => {
  const cb = e.target.closest("[data-sc-visible]");
  if (cb) setShortcutVisible(cb.dataset.scVisible, cb.checked);
});

/* ---------- realtime + polling adaptativo ---------- */
function setPollInterval(ms) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden && sb) sync(); }, ms);
}
function subscribeRealtime() {
  channelRef = sb.channel("sono-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => sync())
    .on("postgres_changes", { event: "*", schema: "public", table: "live_state" }, () => sync())
    .on("postgres_changes", { event: "*", schema: "public", table: "sono_growth" }, () => sync())
    .on("postgres_changes", { event: "*", schema: "public", table: "sono_agenda" }, () => sync())
    .subscribe(status => {
      realtimeStatus = status;
      if (status === "SUBSCRIBED") {
        backoffStep = 0; setPollInterval(30000);
        store.addLog({ kind: "realtime", detail: "ok" });
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        setPollInterval(15000);
        store.addLog({ kind: "realtime", detail: status });
        const delay = BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length - 1)];
        backoffStep++;
        setTimeout(() => { if (sb) { try { channelRef.unsubscribe(); } catch {} subscribeRealtime(); } }, delay);
      }
    });
}
// iOS mata o WebSocket ao ir para segundo plano; ao voltar (visibilitychange/pageshow/focus)
// reconecta na hora em vez de esperar o backoff, já que não há Background Sync para cobrir isso.
function reconnectRealtimeIfNeeded() {
  if (!sb || realtimeStatus === "SUBSCRIBED") return;
  try { channelRef && channelRef.unsubscribe(); } catch {}
  subscribeRealtime();
}

/* ---------- service worker: atualização segura ---------- */
let swReg = null;
function showUpdateToast() {
  if (document.querySelector("dialog[open]")) { setTimeout(showUpdateToast, 4000); return; }
  toastAction(`Nova versão disponível. <button class="linklike" data-toast-action>Atualizar</button>`, () => {
    if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  }, 600000);
}
function registerSW() {
  navigator.serviceWorker.register("./sw.js").then(reg => {
    swReg = reg;
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateToast();
      });
    });
  }).catch(() => {});
}

/* ---------- gate: no iPhone, só funciona instalado (Safari tem storage separado do PWA) ---------- */
function isIOS() {
  return /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}
function showStandaloneGate() {
  $("#standaloneGate").hidden = false;
  $("#setup").hidden = true; $("#login").hidden = true; $("#app").hidden = true; $("#tabs").hidden = true;
}

/* ---------- init ---------- */
function boot() {
  const cfg = loadSbConfig();
  if (!cfg) { showSetup(); return; }
  sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) {
      S.uid = session.user.id; hideLogin(); sync();
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(granted => store.addLog({ kind: "storage-persist", detail: granted ? "granted" : "denied" }));
      }
      // Conta única compartilhada entre os dois iPhones: sem nome de aparelho definido,
      // não dá pra saber depois "quem" fez o quê — pede logo na primeira abertura.
      if (!S.deviceName) openSettingsDialog();
      else if (!S.onboardingDone) showOnboarding();
    } else { S.uid = null; showLogin(); }
  });
  subscribeRealtime();
}
async function init() {
  if (isIOS() && !isStandalone()) { showStandaloneGate(); return; }
  await loadLocal();
  render();
  boot();
  if ("serviceWorker" in navigator) registerSW();
}
init();
