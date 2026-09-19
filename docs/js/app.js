import { MIN, HOUR, DAY, midnight, overlap, fmtDur, fmtClock, dayKey } from "./time.js";
import { checkSleepDuration, isSleepForgotten } from "./validation.js";
import { resolveWrite, resolveEditorName } from "./conflict.js";
import { scheduleDelete, cancelDelete, isPending, isExpired, UNDO_WINDOW_MS } from "./undo.js";
import { parseDigitsToTime, offsetFromNow } from "./timeinput.js";
import { netSleepDuration, classifySleep, findSleepOverlap } from "./sleep.js";
import { ageWakeWindowRef, dailySleepRefHours, computeSchedule } from "./schedule.js";
import {
  buildTrend, computeInsights, ageMonthsExact, growthPoint, percentileCurve, WHO_PERCENTILE_LINES, nightShiftCounts,
} from "./trends.js";
import { VACCINE_SOURCE_NOTE, generateVaccineSchedule } from "./vaccines.js";
import * as store from "./store.js";

const APP_VERSION = "2026.09.19-notif-fix";
// Chave pública VAPID — segura para ficar no código (é literalmente pra isso que ela existe;
// a privada fica só nos secrets da Edge Function, nunca aqui).
const VAPID_PUBLIC_KEY = "BGr1VlBz6C6_jQ8QM70zhjOEnDlLNF8QTUDSD9xmNc95r03q4UxXL88ztAsqAZ_I7UwvYKyYL9WKu6QdUTK6BX8";
const KIND = { "peito-e": "Peito esquerdo", "peito-d": "Peito direito", "mamadeira": "Mamadeira", "solido": "Comida" };
const DIAPER_LABEL = { "xixi": "Xixi", "coco": "Cocô", "ambos": "Xixi e cocô" };
const PLACE_LABEL = { berco: "berço", colo: "colo", carrinho: "carrinho", carro: "carro", sling: "sling" };
const MILK_LABEL = { formula: "fórmula", materno: "materno ordenhado", misto: "misto" };
const AGENDA_KIND_LABEL = { consulta: "Consulta", vacina: "Vacina", banho: "Banho", passeio: "Passeio", outro: "Compromisso" };
const MOOD_EMOJI = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };
const SEX_LABEL = { boy: "Menino", girl: "Menina" };
const TREND_PERIODS = [7, 14, 30];
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

// Tour completo do app (Guia → "Tour completo do app") — diferente do onboarding acima:
// mais longo, sob demanda, e destaca elementos de verdade na tela em vez de telas isoladas.
// Cada passo troca de aba se precisar (`tab`) e aponta pra um elemento real (`target`, seletor
// CSS); `target: null` é usado só na abertura/fechamento (sem destaque, cartão centralizado).
// Passos de Configurações apontam pra engrenagem em vez de abrir o diálogo — destacar um
// elemento dentro de um <dialog> aberto depende de como o navegador empilha o "top layer",
// e isso eu não consigo testar aqui, então preferi o caminho mais confiável.
const TOUR_STEPS = [
  { tab: "hoje", target: null, title: "Tour completo do app", body: "Vamos passar por cada função, na tela de verdade. Pode fechar quando quiser, pelo X, tocando fora do cartão ou pelo botão Pular." },
  { tab: "hoje", target: "#todayDial", title: "Relógio de 24 horas", body: "Mostra os sonos (arco azul) e os outros registros do dia, cada tipo com sua cor. Toque num registro para editar; toque num espaço vazio para adicionar um horário específico." },
  { tab: "hoje", target: "#btnSleep", title: "Dormiu / Acordou", body: "O botão central do relógio. Toque para iniciar o cronômetro de sono, toque de novo para parar. Fica azul sólido enquanto o bebê dorme." },
  { tab: "hoje", target: ".feedbar", title: "Mamadas", body: "Peito esquerdo, peito direito (com cronômetro) e mamadeira. O app destaca automaticamente qual peito é a vez." },
  { tab: "hoje", target: ".moreRow", title: "Mais registros", body: "Fralda, extração de leite, remédio, banho, atividade, crescimento e agenda. Escolha quais aparecem aqui em Configurações." },
  { tab: "hoje", target: ".stats", title: "Resumo do dia", body: "Previsão do próximo sono — que fica mais precisa depois de alguns dias de registro — e o total de sono e mamadas nas últimas 24h comparado à referência da idade." },
  { tab: "semana", target: ".chips", title: "Tendências", body: "Veja os últimos 7, 14 ou 30 dias. Toque num período para recalcular todos os gráficos abaixo." },
  { tab: "semana", target: "#view-semana .chart", title: "Gráficos", body: "Sono dia × noite, sonecas, despertares, horários de dormir/acordar, mamadas, fraldas, mapa de calor e curva de crescimento — um cartão por gráfico, com grade e datas." },
  { tab: "semana", target: ".export-row", title: "Relatório e exportação", body: "Gere um PDF resumido para levar ao pediatra, ou exporte os registros do período em XLSX/CSV pela folha de compartilhamento do iPhone." },
  { tab: "registros", target: "#view-registros h2", title: "Registros", body: "Histórico dos últimos 14 dias, agrupado por dia. Toque num registro para editar ou apagar; marque um dia como atípico (doença, viagem) para ele não pesar nas previsões." },
  { tab: "registros", target: "#btnTrash", title: "Lixeira", body: "Registros apagados ficam guardados por 30 dias — dá para restaurar se apagar por engano." },
  { tab: "vacinas", target: "#view-vacinas h2", title: "Vacinas", body: "O calendário é gerado sozinho a partir da data de nascimento. Toque numa vacina para marcar como aplicada, com data e nota." },
  { tab: "guia", target: "#view-guia h2", title: "Guia", body: "Conteúdo sobre sono, amamentação e sono seguro, baseado em AAP/AASM/NSF/OMS, organizado em capítulos que abrem e fecham — e é aqui que este tour mora." },
  { tab: "hoje", target: "#btnSettings", title: "Configurações", body: "Nome do bebê e do aparelho, data de nascimento, sexo, tema, sonecas fixas e quais atalhos aparecem na tela Hoje." },
  { tab: "hoje", target: "#btnSettings", title: "Notificações", body: "Dentro de Configurações: ative avisos de soneca chegando, tempo desde a mamada/fralda, remédio e compromissos da agenda — cada aparelho escolhe os seus." },
  { tab: "hoje", target: "#btnSettings", title: "Atalhos rápidos", body: "Também em Configurações: gere um token pessoal para usar com a Siri, Apple Watch, Toque nas Costas ou Central de Controle do iPhone." },
  { tab: "hoje", target: "#btnSettings", title: "Vocês", body: "E ainda: registre o humor do dia por aparelho, e veja um lembrete gentil de revezar a madrugada." },
  { tab: "hoje", target: null, title: "Pronto!", body: "Você já viu todas as funções. Pode voltar a qualquer momento tocando em \"Tour completo do app\", lá no Guia." },
];

/* ---------- Supabase ---------- */
const SB_CONFIG_KEY = "sono-sb-config";
const loadSbConfig = () => { try { return JSON.parse(localStorage.getItem(SB_CONFIG_KEY)); } catch { return null; } };
const saveSbConfig = v => { try { localStorage.setItem(SB_CONFIG_KEY, JSON.stringify(v)); } catch {} };
let sb = null;

const S = { config: { name: "Joaquim", birth: "", settings: {} }, live: { version: 1, pauses: [] }, ev: {}, growth: {}, agenda: {}, journal: {}, vaccines: {},
  users: {}, since: 0, uid: null, tab: "hoje", online: true, deviceName: "", onboardingDone: false, trendsDays: 7 };
let editing = null, adjusting = null, editingGrowth = null, editingAgenda = null, editingJournal = null, editingVaccine = null;
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

/* ---------- bibliotecas locais (Fase 4: PDF/XLSX), sem CDN em runtime ----------
   Ficam em docs/vendor/ (cacheadas pelo service worker) e só são carregadas quando o
   relatório/exportação é realmente usado — evita gastar tempo de boot com libs pesadas. */
const loadedScripts = {};
function loadScriptOnce(src, alreadyLoaded) {
  if (alreadyLoaded()) return Promise.resolve();
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error("Falha ao carregar " + src));
      document.head.appendChild(s);
    });
  }
  return loadedScripts[src];
}

/* ---------- curva de crescimento OMS: dados LMS locais (Fase 4) ---------- */
let whoGrowthData = null, whoGrowthPromise = null;
function loadWhoGrowthData() {
  if (whoGrowthData) return Promise.resolve(whoGrowthData);
  if (!whoGrowthPromise) whoGrowthPromise = fetch("./data/who-growth-lms.json").then(r => r.json()).then(d => { whoGrowthData = d; return d; });
  return whoGrowthPromise;
}

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
  S.journal = (await store.getMeta("journal")) || {};
  S.vaccines = (await store.getMeta("vaccines")) || {};
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
  await store.setMeta("journal", S.journal);
  await store.setMeta("vaccines", S.vaccines);
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
const rowToJournal = r => ({ id: r.id, at: r.at, mood: r.mood, note: r.note,
  by: r.by_user_id, lastEditedBy: r.last_edited_by, deviceName: r.device_name, deleted: !!r.deleted, version: r.version || 1 });
const rowToVaccine = r => ({ id: r.id, catalogId: r.catalog_id, ageLabel: r.age_label, dueAt: r.due_at, vaccine: r.vaccine,
  doseLabel: r.dose_label, category: r.category, protects: r.protects, applied: !!r.applied, appliedAt: r.applied_at, note: r.note,
  by: r.by_user_id, lastEditedBy: r.last_edited_by, deviceName: r.device_name, deleted: !!r.deleted, version: r.version || 1 });
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
  sono_journal: { map: S => S.journal, toLocal: rowToJournal },
  sono_vaccines: { map: S => S.vaccines, toLocal: rowToVaccine },
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
    const [evRes, liveRes, babyRes, profRes, growthRes, agendaRes, journalRes, vaccinesRes] = await Promise.all([
      sb.from("events").select("*").gt("updated_at", S.since).gte("start", cutoff).order("start"),
      sb.from("live_state").select("*").eq("id", 1).maybeSingle(),
      sb.from("baby").select("*").eq("id", 1).maybeSingle(),
      sb.from("profiles").select("id,name"),
      sb.from("sono_growth").select("*").gt("updated_at", S.since),
      sb.from("sono_agenda").select("*").gt("updated_at", S.since),
      sb.from("sono_journal").select("*").gt("updated_at", S.since),
      sb.from("sono_vaccines").select("*").gt("updated_at", S.since),
    ]);
    for (const r of [evRes, liveRes, babyRes, profRes, growthRes, agendaRes, journalRes, vaccinesRes]) if (r.error) throw r.error;
    for (const r of evRes.data) { S.ev[r.id] = rowToEvent(r); await store.putEventRow(S.ev[r.id]); }
    const cut2 = Date.now() - HISTORY_DAYS * DAY;
    for (const id in S.ev) if (S.ev[id].start < cut2) { delete S.ev[id]; await store.deleteEventRow(id); }
    for (const r of growthRes.data) S.growth[r.id] = rowToGrowth(r);
    for (const r of agendaRes.data) S.agenda[r.id] = rowToAgenda(r);
    for (const r of journalRes.data) S.journal[r.id] = rowToJournal(r);
    for (const r of vaccinesRes.data) S.vaccines[r.id] = rowToVaccine(r);
    await persistCollections();
    S.users = {}; for (const p of profRes.data) S.users[p.id] = p.name;
    S.live = liveRes.data ? rowToLive(liveRes.data) : { version: 1, pauses: [] };
    if (babyRes.data) S.config = { ...S.config, name: babyRes.data.name, birth: babyRes.data.birth || "", settings: babyRes.data.settings || {} };
    S.since = Date.now() - 5000; S.online = true;
    await persistMeta();
    if (!document.querySelector("dialog[open]") && tourIndex === -1) render(); else updateBanner();
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

/* ---------- writes: humor (aba Vocês) ---------- */
function journalPatch(rec, now) {
  return { at: rec.at, mood: rec.mood, note: rec.note || null, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
}
async function putNewJournal(rec) {
  const now = Date.now();
  const row = { id: rec.id, ...journalPatch(rec, now), by_user_id: S.uid, deleted: false, version: 1 };
  S.journal[rec.id] = rowToJournal(row); await persistCollections(); render();
  await enqueue({ kind: "insert", table: "sono_journal", row });
}
async function putEditedJournal(rec, expectedVersion) {
  const now = Date.now();
  const patch = journalPatch(rec, now);
  S.journal[rec.id] = rowToJournal({ ...patch, id: rec.id, version: expectedVersion + 1 }); await persistCollections(); render();
  await enqueue({ kind: "cond-update", table: "sono_journal", id: rec.id, patch, expectedVersion });
}
async function deleteJournalNow(id, expectedVersion) {
  const now = Date.now();
  const patch = { deleted: true, updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
  if (S.journal[id]) S.journal[id] = { ...S.journal[id], deleted: true };
  await persistCollections();
  await enqueue({ kind: "cond-update", table: "sono_journal", id, patch, expectedVersion });
}

/* ---------- writes: cartão de vacinas ---------- */
// Gera o calendário (a partir de baby.birth) na primeira vez que a aba é aberta, e de novo sempre que
// faltar algum item novo do catálogo — nunca duplica, porque casa por `catalogId` antes de inserir.
let generatingVaccineSchedule = false;
async function ensureVaccineSchedule() {
  if (!S.config.birth || generatingVaccineSchedule) return;
  const birthMs = new Date(S.config.birth + "T12:00:00").getTime();
  const existingIds = new Set(Object.values(S.vaccines).map(v => v.catalogId));
  const missing = generateVaccineSchedule(birthMs).filter(v => !existingIds.has(v.catalogId));
  if (!missing.length) return;
  generatingVaccineSchedule = true;
  try {
    const now = Date.now();
    for (const item of missing) {
      const row = { id: uidGen(), catalog_id: item.catalogId, age_label: item.ageLabel, due_at: item.dueAt,
        vaccine: item.vaccine, dose_label: item.doseLabel || null, category: item.category, protects: item.protects || null,
        applied: false, applied_at: null, note: null, by_user_id: S.uid, deleted: false, updated_at: now, version: 1 };
      S.vaccines[row.id] = rowToVaccine(row);
      await enqueue({ kind: "insert", table: "sono_vaccines", row });
    }
    await persistCollections(); render();
  } finally { generatingVaccineSchedule = false; }
}
function vaccinePatch(rec, now) {
  return { applied: !!rec.applied, applied_at: rec.applied ? (rec.appliedAt || now) : null, note: rec.note || null,
    updated_at: now, last_edited_by: S.uid, device_name: S.deviceName || null };
}
async function putEditedVaccine(rec, expectedVersion) {
  const now = Date.now();
  const patch = vaccinePatch(rec, now);
  S.vaccines[rec.id] = { ...S.vaccines[rec.id], applied: patch.applied, appliedAt: patch.applied_at, note: patch.note,
    lastEditedBy: S.uid, deviceName: S.deviceName || null, version: expectedVersion + 1 };
  await persistCollections(); render();
  await enqueue({ kind: "cond-update", table: "sono_vaccines", id: rec.id, patch, expectedVersion });
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
const growthAsc = () => Object.values(S.growth).filter(g => g && !g.deleted).sort((a, b) => a.measuredAt - b.measuredAt);
function upcomingAgenda() {
  const now = Date.now() - HOUR;
  return Object.values(S.agenda).filter(a => a && !a.deleted && !a.completed && a.scheduledAt >= now)
    .sort((a, b) => a.scheduledAt - b.scheduledAt).slice(0, 3);
}

/* ---------- cores e rótulos por tipo de registro ---------- */
const TYPE_COLOR = { sleep: "--sleep", feed: "--feed", pump: "--t-pump", diaper: "--t-fralda",
  medicine: "--t-med", bath: "--t-bath", activity: "--t-act" };
const TYPE_SHORT = { sleep: "Sono", feed: "Mamada", pump: "Extração", diaper: "Fralda",
  medicine: "Remédio", bath: "Banho", activity: "Atividade" };
const typeVar = t => TYPE_COLOR[t] || "--muted";

/* ---------- render: today ---------- */
function polar(cx, cy, r, min) { const a = (min / 1440) * 2 * Math.PI - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arc(cx, cy, r, m1, m2) { if (m2 - m1 >= 1439.9) m2 = m1 + 1439.9;
  const [x1, y1] = polar(cx, cy, r, m1), [x2, y2] = polar(cx, cy, r, m2); const large = (m2 - m1) > 720 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`; }

function dialSVG(st) {
  const cx = 180, cy = 180, r = 132, t0 = midnight(st.now), t1 = t0 + DAY;
  const toM = ms => (ms - t0) / MIN;
  let segs = "";
  const list = sleeps().map(s => ({ id: s.id, start: s.start, end: s.end }));
  if (S.live.sleepStart) list.push({ id: null, start: S.live.sleepStart, end: st.now, live: true });
  for (const s of list) { const a = Math.max(s.start, t0), b = Math.min(s.end, t1); if (b <= a) continue;
    segs += `<path d="${arc(cx, cy, r, toM(a), Math.max(toM(b), toM(a) + 3))}" stroke="var(--sleep)" stroke-width="21" fill="none" stroke-linecap="butt" ${s.live ? 'opacity=".78"' : ""} ${s.id ? `data-event-id="${esc(s.id)}" style="cursor:pointer"` : ""}/>`; }

  // demais registros: corte radial atravessando a faixa do dia, uma cor por tipo
  const marks = events().filter(e => e.type !== "sleep" && e.start >= t0 && e.start < t1);
  let halos = "", cuts = "", hits = "";
  for (const e of marks) {
    const [x1, y1] = polar(cx, cy, r - 13, toM(e.start)), [x2, y2] = polar(cx, cy, r + 13, toM(e.start));
    const coords = `x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"`;
    halos += `<line ${coords} stroke="var(--surface)" stroke-width="6.5" stroke-linecap="round"/>`;
    cuts += `<line ${coords} stroke="var(${typeVar(e.type)})" stroke-width="3.2" stroke-linecap="round" style="pointer-events:none"/>`;
    hits += `<line ${coords} stroke="transparent" stroke-width="16" data-event-id="${esc(e.id)}" style="cursor:pointer"/>`;
  }

  let ticks = "";
  for (let h = 0; h < 24; h++) {
    const major = h % 3 === 0;
    const [x1, y1] = polar(cx, cy, major ? r + 14 : r + 18, h * 60), [x2, y2] = polar(cx, cy, r + 24, h * 60);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--ink)" stroke-width="${major ? 2 : 1}" opacity="${major ? .5 : .28}" stroke-linecap="round"/>`;
  }
  const labels = [0, 3, 6, 9, 12, 15, 18, 21].map(h => { const [x, y] = polar(cx, cy, r + 38, h * 60);
    return `<text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-family="Questrial, sans-serif" font-size="14" fill="var(--ink)" opacity=".55">${h}</text>`; }).join("");
  const [hx, hy] = polar(cx, cy, r - 11, toM(st.now)), [hx2, hy2] = polar(cx, cy, r - 32, toM(st.now));
  const [nx, ny] = polar(cx, cy, r, toM(st.now));
  return `<svg id="todayDial" viewBox="0 0 360 360" role="img" aria-label="Relógio de 24 horas com os sonos e os demais registros de hoje. Toque num registro para editar; toque num espaço vazio para adicionar.">
    <path d="${arc(cx, cy, r, 1140, 1440)}" stroke="var(--night)" stroke-width="21" fill="none"/>
    <path d="${arc(cx, cy, r, 0, 420)}" stroke="var(--night)" stroke-width="21" fill="none"/>
    <path d="${arc(cx, cy, r, 420, 1140)}" stroke="var(--surface)" stroke-width="21" fill="none"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 10.5}" fill="none" stroke="var(--line)"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 10.5}" fill="none" stroke="var(--line)"/>
    ${segs}${halos}${cuts}${ticks}${labels}${hits}
    <line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${hx2.toFixed(1)}" y2="${hy2.toFixed(1)}" stroke="var(--ink)" stroke-width="2.2" opacity=".45" stroke-linecap="round"/>
    <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="4" fill="var(--ink)" opacity=".55"/>
  </svg>`;
}
// legenda do relógio: só os tipos realmente registrados no dia
function dialLegend(st) {
  const t0 = midnight(st.now), t1 = t0 + DAY;
  const types = [];
  const hasSleep = !!S.live.sleepStart || sleeps().some(s => s.end > t0 && s.start < t1);
  if (hasSleep) types.push("sleep");
  for (const e of events()) if (e.type !== "sleep" && e.start >= t0 && e.start < t1 && !types.includes(e.type)) types.push(e.type);
  if (!types.length) return "";
  return `<div class="dial-legend">${types.map(t => `<span><i class="${t === "sleep" ? "sleep" : ""}" style="background:var(${typeVar(t)})"></i>${esc(TYPE_SHORT[t] || t)}</span>`).join("")}</div>`;
}
function svgClickToMinutes(svgEl, clientX, clientY) {
  const rect = svgEl.getBoundingClientRect();
  const vbX = (clientX - rect.left) / rect.width * 360, vbY = (clientY - rect.top) / rect.height * 360;
  let angle = Math.atan2(vbY - 180, vbX - 180) + Math.PI / 2;
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
  const nextNap = st.schedule.nextNap;
  const agendaHTML = upcoming.length ? `<h2>Próximos compromissos</h2>${upcoming.map(a => {
    const conflict = nextNap && a.scheduledAt >= nextNap.from && a.scheduledAt <= nextNap.to;
    return `<button class="agenda-item" data-agenda-edit="${esc(a.id)}"><span class="dot" style="background:var(--feed)"></span><span class="t">${fmtTime(a.scheduledAt)}</span>
      <span class="x">${esc(AGENDA_KIND_LABEL[a.kind] || a.kind)}${a.title ? ` · ${esc(a.title)}` : ""}${conflict ? `<br><small style="color:var(--warn)">Pode coincidir com a soneca prevista (~${fmtTime(nextNap.from)}–${fmtTime(nextNap.to)})</small>` : ""}</span></button>`;
  }).join("")}` : "";

  $("#view-hoje").innerHTML = `
    ${forgottenHTML}
    ${suggestionHTML}
    <div class="dial-wrap">${dialSVG(st)}
      <button class="dial-center ${sleeping ? "sleeping" : ""}" id="btnSleep" aria-label="${sleeping ? "Registrar que acordou" : "Registrar que dormiu"}">
        ${sleeping ? `<span class="sub">Dormindo desde ${fmtTime(S.live.sleepStart)}${isPaused ? " · pausado" : ""}</span><span class="clock" data-timer="${S.live.sleepStart}">${fmtClock(st.now - S.live.sleepStart)}</span><span class="pill">Acordou</span>`
                   : `<span class="pill">Dormiu</span><span class="sub">toque para iniciar</span>`}
      </button>
    </div>
    ${dialLegend(st)}
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

/* ---------- render: week timeline (visão geral, dentro de Tendências) ---------- */
function renderWeekTimeline(days) {
  const now = Date.now(), t0 = midnight(now);
  const sl = sleeps(); if (S.live.sleepStart) sl.push({ start: S.live.sleepStart, end: now });
  const fd = feeds();
  let rows = "";
  for (let i = 0; i < days; i++) {
    const d0 = t0 - i * DAY, d1 = d0 + DAY;
    let segs = `<div class="n" style="left:0;width:${7 / 24 * 100}%"></div><div class="n" style="left:${19 / 24 * 100}%;width:${5 / 24 * 100}%"></div>`, tot = 0;
    for (const s of sl) { const a = Math.max(s.start, d0), b = Math.min(s.end, d1); if (b <= a) continue;
      tot += b - a;
      segs += `<div class="s" style="left:${(a - d0) / DAY * 100}%;width:${(b - a) / DAY * 100}%"></div>`; }
    for (const f of fd) if (f.start >= d0 && f.start < d1) segs += `<div class="f" style="left:${(f.start - d0) / DAY * 100}%"></div>`;
    const lbl = new Date(d0).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" });
    rows += `<div class="week-row"><span class="lbl">${i === 0 ? "Hoje" : esc(lbl)}</span><div class="bar">${segs}</div><span class="tot">${tot ? fmtDur(tot / MIN) : "—"}</span></div>`;
  }
  return `<div class="legend"><span><i style="background:var(--sleep)"></i>sono</span><span><i style="background:var(--feed)"></i>mamada</span><span><i style="background:var(--night)"></i>noite (19h–7h)</span></div>
    <div class="scroll">
      <div class="axis"><span></span><div><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div><span></span></div>
      ${rows}
    </div>`;
}

/* ---------- gráficos SVG genéricos (Fase 4/refino visual) ---------- */
const CHART_W = 320, CHART_H = 132;
function dayLabelShort(ms) { return new Date(ms).toLocaleDateString("pt-BR", { day: "numeric", month: "numeric" }); }
// Nuvem simples usada nos estados vazios dos gráficos (mesma família visual do fundo).
function cloudGlyphSVG() {
  return `<svg viewBox="0 0 64 40" width="46" height="29" aria-hidden="true" fill="none">
    <path d="M17 30a10 10 0 0 1-1.4-19.9A13 13 0 0 1 41.6 8 9 9 0 0 1 47.5 24.6 8 8 0 0 1 46 30H17z" fill="var(--line)"/>
  </svg>`;
}
// Cartão de gráfico: recebe o miolo (svg ou estado vazio) já pronto e só aplica a moldura do cartão.
function chartCard(innerHTML) { return `<div class="chart">${innerHTML}</div>`; }
function chartEmptyState(msg) { return `<div class="chart-empty">${cloudGlyphSVG()}<p>${esc(msg)}</p></div>`; }
// Quantos rótulos de data cabem sem sobrepor: todas as colunas até 14 dias, senão espaçados.
function labelStep(n) { return n <= 14 ? 1 : Math.ceil(n / 10); }

// Barras empilhadas por dia, com grade e rótulo do eixo Y, e data embaixo de cada coluna (ou
// espaçadas, em janelas longas). `getSegments(day)` devolve [{value,color}]; `topLabel(day)`
// texto opcional acima da barra (ex.: contagem).
function trendBarsSVG(trend, { getSegments, topLabel, maxValue, refLines, ariaLabel, valueFmt }) {
  const padL = 24, padR = 6, padT = 10, padB = 18;
  const innerW = CHART_W - padL - padR, innerH = CHART_H - padT - padB;
  const n = Math.max(1, trend.length), gap = n > 14 ? 2 : 5;
  const bw = Math.max(2, (innerW - gap * (n - 1)) / n);
  const sums = trend.map(d => getSegments(d).reduce((s, seg) => s + seg.value, 0));
  const max = Math.max(1, maxValue || 0, ...sums, ...((refLines || []).map(r => r.value)));
  const fmtV = valueFmt || (v => (Math.round(v * 10) / 10).toString().replace(".", ","));
  let grid = "";
  for (const frac of [0, 0.5, 1]) {
    const yy = padT + innerH - frac * innerH;
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${(CHART_W - padR).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${(padL - 4).toFixed(1)}" y="${(yy + 2.8).toFixed(1)}" font-size="7.5" fill="var(--muted)" text-anchor="end">${esc(fmtV(max * frac))}</text>`;
  }
  let bars = "", dateLabels = "";
  const step = labelStep(n);
  trend.forEach((d, i) => {
    const x = padL + i * (bw + gap);
    let yCursor = padT + innerH;
    for (const seg of getSegments(d)) {
      if (seg.value <= 0) continue;
      const segH = (seg.value / max) * innerH;
      yCursor -= segH;
      bars += `<rect x="${x.toFixed(1)}" y="${yCursor.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, segH).toFixed(1)}" fill="${seg.color}" rx="1"/>`;
    }
    if (topLabel) {
      const lbl = topLabel(d);
      if (lbl) bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(yCursor - 3).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(lbl)}</text>`;
    }
    if (i % step === 0 || i === n - 1) {
      dateLabels += `<text x="${(x + bw / 2).toFixed(1)}" y="${(CHART_H - 5).toFixed(1)}" text-anchor="middle" font-size="7" fill="var(--muted)">${esc(dayLabelShort(d.start))}</text>`;
    }
  });
  let refs = "";
  for (const r of (refLines || [])) {
    const yy = padT + innerH - (r.value / max) * innerH;
    refs += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${(CHART_W - padR).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${r.color}" stroke-width="1.2" stroke-dasharray="3,3"/>`;
  }
  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" class="chart-svg" role="img" aria-label="${esc(ariaLabel || "")}">${grid}${refs}${bars}${dateLabels}</svg>`;
}
// Pontos por dia (ex.: horário de dormir/acordar). `getValue(day)` devolve hora decimal ou null.
function trendDotsSVG(trend, { getValue, min, max, wrapBelow, color, ariaLabel, hourFmt }) {
  const padL = 22, padR = 6, padT = 6, padB = 16, H = 64;
  const innerW = CHART_W - padL - padR, innerH = H - padT - padB;
  const n = Math.max(1, trend.length), stepX = n > 1 ? innerW / (n - 1) : 0;
  const y = v => padT + innerH - ((v - min) / (max - min)) * innerH;
  const fmtH = hourFmt || (v => `${Math.floor(((v % 24) + 24) % 24)}h`);
  let grid = "";
  for (const v of [min, (min + max) / 2, max]) {
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${(CHART_W - padR).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${(padL - 4).toFixed(1)}" y="${(yy + 2.8).toFixed(1)}" font-size="7.5" fill="var(--muted)" text-anchor="end">${esc(fmtH(v))}</text>`;
  }
  const coords = trend.map((d, i) => {
    let v = getValue(d);
    if (v == null) return null;
    if (wrapBelow != null && v < wrapBelow) v += 24;
    v = Math.min(max, Math.max(min, v));
    return [padL + i * stepX, y(v)];
  });
  const step = labelStep(n);
  let dateLabels = "";
  trend.forEach((d, i) => { if (i % step === 0 || i === n - 1) dateLabels += `<text x="${(padL + i * stepX).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="7" fill="var(--muted)">${esc(dayLabelShort(d.start))}</text>`; });
  let line = "";
  for (let i = 1; i < coords.length; i++) if (coords[i] && coords[i - 1]) line += `M${coords[i - 1][0].toFixed(1)},${coords[i - 1][1].toFixed(1)} L${coords[i][0].toFixed(1)},${coords[i][1].toFixed(1)} `;
  const pts = coords.filter(Boolean).map(c => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="2.6" fill="${color}"/>`).join("");
  return `<svg viewBox="0 0 ${CHART_W} ${H}" class="chart-svg" role="img" aria-label="${esc(ariaLabel || "")}">${grid}<path d="${line}" stroke="${color}" stroke-width="1.2" fill="none" opacity=".5"/>${pts}${dateLabels}</svg>`;
}
function trendHeatmapSVG(trend) {
  const padL = 22, padT = 2, padB = 12;
  const cell = (CHART_W - padL) / 24;
  const H = padT + trend.length * cell + padB;
  let cells = "", labels = "";
  trend.forEach((d, r) => {
    for (let h = 0; h < 24; h++) {
      const v = Math.min(1, d.hours[h] || 0);
      cells += `<rect x="${(padL + h * cell).toFixed(1)}" y="${(padT + r * cell).toFixed(1)}" width="${(cell - 0.6).toFixed(1)}" height="${(cell - 0.6).toFixed(1)}" fill="var(--sleep)" opacity="${v.toFixed(2)}"/>`;
    }
    if (r === 0 || r === trend.length - 1 || trend.length <= 10) labels += `<text x="0" y="${(padT + r * cell + cell * 0.72).toFixed(1)}" font-size="7" fill="var(--muted)">${esc(dayLabelShort(d.start))}</text>`;
  });
  const hourTicks = [0, 6, 12, 18].map(h => `<text x="${(padL + h * cell).toFixed(1)}" y="${(padT + trend.length * cell + 9).toFixed(1)}" font-size="7" fill="var(--muted)">${h}h</text>`).join("");
  return `<svg viewBox="0 0 ${CHART_W} ${H}" class="chart-svg" role="img" aria-label="Mapa de calor de sono por hora do dia">${cells}${labels}${hourTicks}</svg>`;
}
function growthChartSVG(table, measurements, birthMs) {
  const padL = 30, padR = 6, padT = 8, padB = 16, H = 150;
  const innerW = CHART_W - padL - padR, innerH = H - padT - padB;
  const curves = WHO_PERCENTILE_LINES.map(l => ({ ...l, pts: percentileCurve(table, l.z, 1) }));
  const values = curves.flatMap(c => c.pts.map(p => p.value)).concat(measurements.map(m => m.value));
  const vMin = Math.min(...values) * 0.95, vMax = Math.max(...values) * 1.05;
  const x = m => padL + (m / 24) * innerW;
  const y = v => padT + innerH - ((v - vMin) / (vMax - vMin)) * innerH;
  let grid = "";
  for (const frac of [0, 0.5, 1]) {
    const v = vMin + frac * (vMax - vMin), yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${(CHART_W - padR).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${(padL - 4).toFixed(1)}" y="${(yy + 2.8).toFixed(1)}" font-size="7.5" fill="var(--muted)" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  const paths = curves.map(c => {
    const d = c.pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ageMonths).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const median = c.p === 50;
    return `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="${median ? 1.4 : 0.8}" opacity="${median ? .85 : .4}"/>`;
  }).join("");
  const dots = measurements.map(m => {
    const ageM = ageMonthsExact(birthMs, m.measuredAt);
    if (ageM > 24) return "";
    return `<circle cx="${x(ageM).toFixed(1)}" cy="${y(m.value).toFixed(1)}" r="3" fill="var(--sleep)"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${CHART_W} ${H}" class="chart-svg" role="img" aria-label="Curva de crescimento comparada às referências da OMS">
    ${grid}
    <text x="${padL}" y="${H - 3}" font-size="8" fill="var(--muted)">0 m</text>
    <text x="${CHART_W - padR}" y="${H - 3}" font-size="8" fill="var(--muted)" text-anchor="end">24 m</text>
    ${paths}${dots}
  </svg>`;
}

/* ---------- render: Tendências (Fase 4) ---------- */
function periodStart(days) { return midnight(Date.now()) - (days - 1) * DAY; }
function periodEvents() { const c = periodStart(S.trendsDays); return events().filter(e => e.start >= c); }
function currentTrend() {
  const sl = sleeps(); if (S.live.sleepStart) sl.push({ start: S.live.sleepStart, end: Date.now(), data: {} });
  const fd = feeds(), dp = events().filter(e => e.type === "diaper");
  return buildTrend({ sleepEvents: sl, feedEvents: fd, diaperEvents: dp, now: Date.now(), days: S.trendsDays, nightWindow: nightWindow() });
}
function growthSectionHTML() {
  const sex = S.config.settings && S.config.settings.sex;
  const list = growthAsc();
  const rowsHTML = [...list].reverse().slice(0, 20).map(g => {
    const pct = (sex && S.config.birth && whoGrowthData && g.weightG) ? growthPoint(whoGrowthData.weight[sex], ageMonthsExact(new Date(S.config.birth + "T12:00:00").getTime(), g.measuredAt), g.weightG / 1000) : null;
    return `<button class="rec" data-growth-edit="${esc(g.id)}"><span class="dot" style="background:var(--sleep)"></span>
      <span class="t">${esc(dayLabelShort(g.measuredAt))}</span>
      <span class="x">${g.weightG ? `${(g.weightG / 1000).toFixed(2).replace(".", ",")} kg` : ""}${g.heightCm ? ` · ${g.heightCm} cm` : ""}${g.headCm ? ` · PC ${g.headCm} cm` : ""}
      ${pct ? `<small>peso no percentil ~${Math.round(pct.percentile)}</small>` : ""}</span></button>`;
  }).join("");
  let body = chartEmptyState("Adicione pelo menos um registro de peso para ver o gráfico.");
  if (!S.config.birth) body = chartEmptyState("Defina a data de nascimento em Configurações para ver a curva.");
  else if (!sex) body = chartEmptyState("Defina o sexo do bebê em Configurações para comparar com a OMS.");
  else if (!whoGrowthData) { body = chartEmptyState("Carregando curva…"); loadWhoGrowthData().then(() => { if (S.tab === "semana") render(); }); }
  else {
    const weighed = list.filter(g => g.weightG).map(g => ({ measuredAt: g.measuredAt, value: g.weightG / 1000 }));
    if (weighed.length) {
      const birthMs = new Date(S.config.birth + "T12:00:00").getTime();
      body = growthChartSVG(whoGrowthData.weight[sex], weighed, birthMs);
    }
  }
  return `<h2>Crescimento</h2>
    <p class="src">Peso × referência da OMS${sex ? ` (${SEX_LABEL[sex]})` : ""}, linhas P3/P15/P50/P85/P97 (WHO/CDC).</p>
    ${chartCard(body)}
    <div class="actions" style="margin-top:6px"><button type="button" class="btn ghost" data-growth-new>Adicionar medida</button></div>
    ${rowsHTML || `<p class="empty">Nenhuma medida registrada ainda.</p>`}`;
}
// Cores por sub-tipo de fralda/mamada — distintas entre si e das cores gerais de tipo,
// reaproveitando a paleta já definida (evita repetir o mesmo verde em duas séries).
const DIAPER_COLOR = { xixi: "var(--sleep)", coco: "var(--t-fralda)", ambos: "var(--t-act)" };
const FEED_SIDE_COLOR = { "peito-e": "var(--sleep)", "peito-d": "var(--t-pump)", outros: "var(--feed)" };
function renderTrends() {
  const trend = currentTrend();
  const ref = sleepRef(ageWeeks());
  const chips = TREND_PERIODS.map(d => `<button type="button" class="chip${S.trendsDays === d ? " on" : ""}" data-trend-period="${d}">${d} dias</button>`).join("");
  const insights = computeInsights(trend);
  const daysWith = fn => trend.filter(fn).length;
  const enoughData = fn => daysWith(fn) >= 3;

  const sleepBody = enoughData(d => d.sleepDayMin + d.sleepNightMin > 0) ? trendBarsSVG(trend, {
    ariaLabel: "Sono por dia, noite e soneca, com faixa de referência para a idade",
    getSegments: d => [{ value: d.sleepNightMin / 60, color: "var(--sleep)" }, { value: d.sleepDayMin / 60, color: "var(--sleep-soft)" }],
    refLines: [{ value: ref.min, color: "var(--ok)" }, { value: ref.max, color: "var(--ok)" }],
  }) : chartEmptyState("Faltam dias de registro de sono para mostrar o gráfico.");

  const napsBody = enoughData(d => d.napCount > 0) ? trendBarsSVG(trend, {
    ariaLabel: "Duração total de sonecas por dia, com a quantidade de sonecas",
    getSegments: d => [{ value: d.sleepDayMin, color: "var(--sleep-soft)" }],
    topLabel: d => d.napCount ? String(d.napCount) : "",
  }) : chartEmptyState("Faltam dias de registro de sonecas para mostrar o gráfico.");

  const nightBody = enoughData(d => d.longestNightMin > 0) ? trendBarsSVG(trend, {
    ariaLabel: "Maior trecho contínuo de sono à noite por dia, com o número de despertares",
    getSegments: d => [{ value: d.longestNightMin / 60, color: "var(--sleep)" }],
    topLabel: d => d.wakenings ? `${d.wakenings}⤫` : "",
  }) : chartEmptyState("Faltam noites registradas para mostrar o gráfico.");

  const bedWakeBody = enoughData(d => d.bedtime != null || d.wake != null) ? `
    <div class="legend"><span><i style="background:var(--sleep)"></i>dormiu</span><span><i style="background:var(--ok)"></i>acordou</span></div>
    ${trendDotsSVG(trend, { ariaLabel: "Horário de dormir por dia", getValue: d => d.bedtime != null ? new Date(d.bedtime).getHours() + new Date(d.bedtime).getMinutes() / 60 : null, min: 15, max: 27, wrapBelow: 12, color: "var(--sleep)" })}
    ${trendDotsSVG(trend, { ariaLabel: "Horário de acordar por dia", getValue: d => d.wake != null ? new Date(d.wake).getHours() + new Date(d.wake).getMinutes() / 60 : null, min: 3, max: 11, color: "var(--ok)" })}`
    : chartEmptyState("Faltam noites completas (dormir e acordar) para mostrar o gráfico.");

  const avgMl = (() => { const days = trend.filter(d => d.feedMl > 0); return days.length ? Math.round(days.reduce((s, d) => s + d.feedMl, 0) / days.length) : null; })();
  const feedBody = enoughData(d => d.feedCount > 0) ? `
    <div class="legend"><span><i style="background:${FEED_SIDE_COLOR["peito-e"]}"></i>peito E</span><span><i style="background:${FEED_SIDE_COLOR["peito-d"]}"></i>peito D</span><span><i style="background:${FEED_SIDE_COLOR.outros}"></i>mamadeira/outros</span></div>
    ${trendBarsSVG(trend, {
      ariaLabel: "Mamadas por dia, por lado e tipo",
      getSegments: d => [
        { value: d.feedBySide["peito-e"] || 0, color: FEED_SIDE_COLOR["peito-e"] }, { value: d.feedBySide["peito-d"] || 0, color: FEED_SIDE_COLOR["peito-d"] },
        { value: Math.max(0, d.feedCount - (d.feedBySide["peito-e"] || 0) - (d.feedBySide["peito-d"] || 0)), color: FEED_SIDE_COLOR.outros },
      ],
    })}` : chartEmptyState("Faltam mamadas registradas para mostrar o gráfico.");

  const diaperBody = enoughData(d => d.diaper.xixi + d.diaper.coco + d.diaper.ambos > 0) ? `
    <div class="legend"><span><i style="background:${DIAPER_COLOR.xixi}"></i>xixi</span><span><i style="background:${DIAPER_COLOR.coco}"></i>cocô</span><span><i style="background:${DIAPER_COLOR.ambos}"></i>ambos</span></div>
    ${trendBarsSVG(trend, {
      ariaLabel: "Fraldas por dia, por tipo",
      getSegments: d => [{ value: d.diaper.xixi, color: DIAPER_COLOR.xixi }, { value: d.diaper.coco, color: DIAPER_COLOR.coco }, { value: d.diaper.ambos, color: DIAPER_COLOR.ambos }],
    })}` : chartEmptyState("Faltam fraldas registradas para mostrar o gráfico.");

  const heatmapBody = enoughData(d => d.sleepDayMin + d.sleepNightMin > 0) ? trendHeatmapSVG(trend)
    : chartEmptyState("Faltam dias de registro de sono para mostrar o mapa de calor.");

  $("#view-semana").innerHTML = `
    <h2>Tendências</h2>
    <div class="chips">${chips}</div>
    <h2>Visão geral</h2>
    ${renderWeekTimeline(Math.min(S.trendsDays, 30))}

    <h2>Sono: dia × noite</h2>
    <p class="src">Clara = soneca, escura = noite. Tracejado: referência para a idade.</p>
    ${chartCard(sleepBody)}

    <h2>Sonecas</h2>
    <p class="src">Duração total por dia; número acima é a quantidade de sonecas.</p>
    ${chartCard(napsBody)}

    <h2>Maior trecho noturno e despertares</h2>
    <p class="src">Maior sono contínuo à noite; "N⤫" é o número de despertares.</p>
    ${chartCard(nightBody)}

    <h2>Horários de dormir e acordar</h2>
    ${chartCard(bedWakeBody)}

    <h2>Mamadas</h2>
    <p class="src">${avgMl ? `Média de ${avgMl} ml/dia nos dias com mamadeira.` : "Por lado e tipo."}</p>
    ${chartCard(feedBody)}

    <h2>Fraldas por dia</h2>
    ${chartCard(diaperBody)}

    <h2>Mapa de calor (sono por hora)</h2>
    ${chartCard(heatmapBody)}

    ${growthSectionHTML()}

    <h2>Resumo</h2>
    <ul>${insights.map(i => `<li>${esc(i)}</li>`).join("")}</ul>
    <p class="src">Diário, não dispositivo médico — referências de prática clínica (AAP/AASM/NSF/OMS).</p>

    <div class="export-row">
      <button type="button" class="btn ghost" data-export="pdf">Relatório PDF</button>
      <button type="button" class="btn ghost" data-export="xlsx">XLSX</button>
      <button type="button" class="btn ghost" data-export="csv">CSV</button>
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
      html += `<button class="rec" data-edit="${esc(e.id)}">${statusGlyph(e.id)}<span class="dot" style="background:var(${typeVar(e.type)})"></span>
        <span class="t">${time}</span><span class="x">${esc(eventTitle(e))}<small>${e.note ? esc(e.note) + " · " : ""}${e.by ? `por ${esc(nameFor(e))}` : ""}</small></span></button>`;
    }
    html += `</div>`;
  }
  html += `<p class="empty" style="font-size:.88rem">Mostrando os últimos 14 dias. <button class="linklike" id="btnTrash">Lixeira (30 dias)</button></p>`;
  $("#view-registros").innerHTML = html;
}

/* ---------- render: cartão de vacinas ---------- */
// Marcador desenhado (círculo + check em SVG) em vez de emoji — verde de mamada quando aplicada,
// contorno neutro quando pendente.
function vaccineMarkerSVG(applied) {
  if (applied) return `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
    <circle cx="11" cy="11" r="11" fill="var(--feed-soft)"/>
    <path d="M6.5 11.3l3 3 6-6.2" fill="none" stroke="var(--feed)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="10.2" fill="none" stroke="var(--line)" stroke-width="1.6"/></svg>`;
}
function renderVaccines() {
  ensureVaccineSchedule();
  if (!S.config.birth) {
    $("#view-vacinas").innerHTML = `<h2>Vacinas</h2><p class="empty">Defina a data de nascimento em Configurações para gerar o calendário de vacinas.</p>`;
    return;
  }
  const list = Object.values(S.vaccines).filter(v => v && !v.deleted).sort((a, b) => a.dueAt - b.dueAt);
  const appliedCount = list.filter(v => v.applied).length;
  const pct = list.length ? Math.round((appliedCount / list.length) * 100) : 0;
  const now = Date.now();
  const order = [], groups = {};
  for (const v of list) { if (!groups[v.ageLabel]) { groups[v.ageLabel] = []; order.push(v.ageLabel); } groups[v.ageLabel].push(v); }
  let html = `<h2>Vacinas</h2>
    <p class="src">${esc(VACCINE_SOURCE_NOTE)}</p>
    <div class="chart" style="padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <span style="font-family:var(--display);font-size:1.35rem">${appliedCount} de ${list.length}</span>
        <span style="color:var(--muted);font-size:.82rem">aplicadas</span>
      </div>
      <div class="meter" aria-hidden="true"><div class="fill" style="width:${pct}%;background:var(--feed)"></div></div>
    </div>`;
  for (const ageLabel of order) {
    const items = groups[ageLabel];
    html += `<h3 style="margin:16px 0 4px">${esc(ageLabel)} <small style="color:var(--muted);font-weight:400">${esc(new Date(items[0].dueAt).toLocaleDateString("pt-BR"))}</small></h3>`;
    for (const v of items) {
      const overdue = !v.applied && v.dueAt < now - 14 * DAY;
      html += `<button type="button" class="rec" data-vaccine-edit="${esc(v.id)}">
        <span class="t" style="min-width:auto">${vaccineMarkerSVG(v.applied)}</span>
        <span class="x">${esc(v.vaccine)}${v.doseLabel ? ` · ${esc(v.doseLabel)}` : ""}
          <span class="tag">${v.category === "sus" ? "SUS" : "Particular"}</span>${overdue ? ` <span class="tag warn">atrasada</span>` : ""}
          <small>${esc(v.protects || "")}</small></span></button>`;
    }
  }
  $("#view-vacinas").innerHTML = html;
}
function openVaccine(v) {
  editingVaccine = v;
  $("#vacTitle").textContent = `${v.vaccine}${v.doseLabel ? ` · ${v.doseLabel}` : ""}`;
  $("#vacProtects").textContent = v.protects || "";
  $("#vacDue").textContent = `Prevista para ${new Date(v.dueAt).toLocaleDateString("pt-BR")} (${v.ageLabel}) · ${v.category === "sus" ? "SUS" : "Particular"}`;
  $("#vacApplied").checked = !!v.applied;
  $("#vacAppliedWhen").value = toInput(v.appliedAt || Date.now());
  $("#vacAppliedWhenWrap").hidden = !v.applied;
  $("#vacNote").value = v.note || "";
  $("#dlgVaccine").showModal();
}
$("#vacApplied").addEventListener("change", () => { $("#vacAppliedWhenWrap").hidden = !$("#vacApplied").checked; });
$("#formVaccine").addEventListener("submit", () => {
  if (!editingVaccine) return;
  const applied = $("#vacApplied").checked;
  const rec = { id: editingVaccine.id, applied, appliedAt: applied ? fromInput($("#vacAppliedWhen").value) || Date.now() : null,
    note: $("#vacNote").value.trim() || null };
  putEditedVaccine(rec, editingVaccine.version || 1);
  toast(applied ? "Marcada como aplicada." : "Atualizado.");
  editingVaccine = null;
});

/* ---------- lixeira ---------- */
async function openTrash() {
  const cutoff = Date.now() - 30 * DAY;
  const { data, error } = await sb.from("events").select("*").eq("deleted", true).gte("updated_at", cutoff).order("updated_at", { ascending: false });
  if (error) { toast("Não foi possível abrir a lixeira agora."); return; }
  const rows = data || [];
  let html = rows.length ? "" : `<p class="empty">Nada na lixeira.</p>`;
  for (const r of rows) {
    const title = eventTitle(rowToEvent(r));
    html += `<div class="rec" style="cursor:default"><span class="dot" style="background:var(${typeVar(r.type)})"></span>
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

/* ---------- Fase 4: relatório e exportação ---------- */
// Compartilha um arquivo pela folha do iOS quando possível; senão baixa (<a download>) como alternativa.
async function shareOrDownloadBlob(blob, filename, shareTitle) {
  if (navigator.canShare && window.File) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: shareTitle }); return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function eventRows(evList) {
  return evList.map(e => ({
    data: dayKey(e.start), hora_inicio: fmtTime(e.start), hora_fim: e.end ? fmtTime(e.end) : "",
    tipo: e.type, detalhe: eventTitle(e), duracao_min: e.end ? Math.round((e.end - e.start) / MIN) : "",
    ml: e.ml != null ? e.ml : "", observacao: e.note || "", registrado_por: e.by ? nameFor(e) : "",
  }));
}
function growthRows() {
  return growthAsc().map(g => ({
    data: dayKey(g.measuredAt), peso_g: g.weightG != null ? g.weightG : "", altura_cm: g.heightCm != null ? g.heightCm : "",
    perimetro_cefalico_cm: g.headCm != null ? g.headCm : "", observacao: g.note || "",
  }));
}
async function runExport(kind) {
  try {
    if (kind === "csv") return await exportCsv();
    if (kind === "xlsx") return await exportXlsx();
    if (kind === "pdf") return await exportPdfReport();
  } catch (e) { if (e && e.name !== "AbortError") toast("Não foi possível gerar o arquivo agora."); }
}
async function exportCsv() {
  const rows = eventRows(periodEvents());
  const headers = ["data", "hora_inicio", "hora_fim", "tipo", "detalhe", "duracao_min", "ml", "observacao", "registrado_por"];
  const escCsv = v => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [headers.join(";"), ...rows.map(r => headers.map(h => escCsv(r[h])).join(";"))].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  await shareOrDownloadBlob(blob, `sono-registros-${dayKey(Date.now())}.csv`, "Registros — Sono do Joaquim");
}
async function exportXlsx() {
  await loadScriptOnce("./vendor/xlsx.full.min.js", () => !!window.XLSX);
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventRows(periodEvents())), "Registros");
  const gRows = growthRows();
  if (gRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gRows), "Crescimento");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/octet-stream" });
  await shareOrDownloadBlob(blob, `sono-registros-${dayKey(Date.now())}.xlsx`, "Registros — Sono do Joaquim");
}
async function exportPdfReport() {
  await loadScriptOnce("./vendor/jspdf.umd.min.js", () => !!(window.jspdf && window.jspdf.jsPDF));
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const trend = currentTrend();
  const insights = computeInsights(trend);
  const ref = sleepRef(ageWeeks());
  let y = 18;
  const ensure = need => { if (y + need > 280) { doc.addPage(); y = 18; } };
  doc.setFontSize(16); doc.text(`Relatório de sono — ${S.config.name || "Bebê"}`, 14, y); y += 8;
  doc.setFontSize(10); doc.setTextColor(100);
  doc.text(`Período: últimos ${S.trendsDays} dias · Idade: ${ageText(ageWeeks())} · Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, y); y += 10;
  doc.setTextColor(20);
  doc.setFontSize(12); doc.text("Resumo", 14, y); y += 6;
  doc.setFontSize(10);
  for (const line of insights) { ensure(6); const wrapped = doc.splitTextToSize(`• ${line}`, 180); doc.text(wrapped, 14, y); y += 5 * wrapped.length; }
  y += 4; ensure(6);
  doc.setFontSize(12); doc.text("Sono nas últimas 24 h", 14, y); y += 6;
  doc.setFontSize(10);
  doc.text(`Referência para a idade (${ref.src}): ${ref.min}–${ref.max} h por dia.`, 14, y); y += 8;
  const lg = lastGrowth();
  if (lg) {
    ensure(24);
    doc.setFontSize(12); doc.text("Última medida de crescimento", 14, y); y += 6;
    doc.setFontSize(10);
    doc.text(`${new Date(lg.measuredAt).toLocaleDateString("pt-BR")}${lg.weightG ? ` · ${(lg.weightG / 1000).toFixed(2)} kg` : ""}${lg.heightCm ? ` · ${lg.heightCm} cm` : ""}${lg.headCm ? ` · PC ${lg.headCm} cm` : ""}`, 14, y); y += 8;
  }
  ensure(16);
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(doc.splitTextToSize("Este relatório é um diário elaborado pelos pais, não um documento médico ou diagnóstico. Referências: AAP, AASM, National Sleep Foundation e OMS (curva de crescimento).", 180), 14, y);
  const blob = doc.output("blob");
  await shareOrDownloadBlob(blob, `sono-relatorio-${dayKey(Date.now())}.pdf`, "Relatório — Sono do Joaquim");
}

/* ---------- diagnóstico ---------- */
async function openDiagnostics() {
  const log = (await store.getLog()).sort((a, b) => b.ts - a.ts);
  const lines = log.map(l => `${new Date(l.ts).toLocaleString("pt-BR")} · ${l.kind} · ${l.detail || ""}`);
  const report = [`Sono do Joaquim — ${APP_VERSION}`, `Realtime: ${realtimeStatus}`, `Pendentes: ${outboxCache.length}`, `Com erro: ${Object.keys(errorMap).length}`, "", ...lines].join("\n");
  $("#diagBody").textContent = report;
  $("#dlgDiag").showModal();
}

/* ---------- notificações (Fase 3) ---------- */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
const DEFAULT_NOTIF_PREFS = { nap_enabled: true, nap_lead_min: 30, feed_enabled: true, feed_after_hours: 3,
  diaper_enabled: false, diaper_after_hours: 3, medicine_enabled: true, agenda_enabled: true, sleep_start_notify_enabled: true };

async function openNotificationsDialog() {
  $("#dlgSettings").close();
  const supported = "Notification" in window && "PushManager" in window && swReg;
  const permission = supported ? Notification.permission : "unsupported";
  let subscribed = false;
  if (supported && permission === "granted") {
    try { subscribed = !!(await swReg.pushManager.getSubscription()); } catch {}
  }
  $("#notifPermissionBlock").hidden = subscribed;
  $("#notifPrefsBlock").hidden = !subscribed;
  $("#btnSaveNotifPrefs").hidden = !subscribed;
  $("#notifStatus").textContent = !supported ? "Este navegador não suporta notificações."
    : permission === "denied" ? "Notificações bloqueadas para este site — libere em Ajustes do iPhone."
    : subscribed ? "Ativadas neste aparelho." : "";
  if (subscribed) {
    const { data } = await sb.from("sono_notification_prefs").select("*").eq("device_name", S.deviceName).maybeSingle();
    const p = { ...DEFAULT_NOTIF_PREFS, ...(data || {}) };
    $("#prefNap").checked = p.nap_enabled; $("#prefNapLead").value = p.nap_lead_min;
    $("#prefFeed").checked = p.feed_enabled; $("#prefFeedHours").value = p.feed_after_hours;
    $("#prefDiaper").checked = p.diaper_enabled; $("#prefDiaperHours").value = p.diaper_after_hours;
    $("#prefMedicine").checked = p.medicine_enabled;
    $("#prefAgenda").checked = p.agenda_enabled;
    $("#prefSleepStart").checked = p.sleep_start_notify_enabled;
  }
  $("#dlgNotifications").showModal();
}
async function enableNotifications() {
  if (!("Notification" in window) || !("PushManager" in window) || !swReg) {
    toast("Este navegador não suporta notificações."); return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Permissão não concedida."); return; }
  try {
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    const json = sub.toJSON();
    await sb.from("sono_push_subscriptions").upsert({
      device_name: S.deviceName, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
      by_user_id: S.uid, created_at: Date.now(),
    }, { onConflict: "endpoint" });
    await sb.from("sono_notification_prefs").upsert({ device_name: S.deviceName, ...DEFAULT_NOTIF_PREFS, updated_at: Date.now() }, { onConflict: "device_name" });
    toast("Notificações ativadas.");
    openNotificationsDialog();
  } catch (e) { toast("Não foi possível ativar agora."); }
}
$("#btnEnableNotifications").addEventListener("click", enableNotifications);
$("#formNotifications").addEventListener("submit", async ev => {
  if ($("#notifPrefsBlock").hidden) return;
  const prefs = {
    device_name: S.deviceName,
    nap_enabled: $("#prefNap").checked, nap_lead_min: Number($("#prefNapLead").value) || 30,
    feed_enabled: $("#prefFeed").checked, feed_after_hours: Number($("#prefFeedHours").value) || 3,
    diaper_enabled: $("#prefDiaper").checked, diaper_after_hours: Number($("#prefDiaperHours").value) || 3,
    medicine_enabled: $("#prefMedicine").checked, agenda_enabled: $("#prefAgenda").checked,
    sleep_start_notify_enabled: $("#prefSleepStart").checked, updated_at: Date.now(),
  };
  const { error } = await sb.from("sono_notification_prefs").upsert(prefs, { onConflict: "device_name" });
  toast(error ? "Não foi possível salvar agora." : "Preferências salvas.");
});

/* ---------- atalhos rápidos (Siri, Watch, Atalhos) ---------- */
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function renderQuickTokenList() {
  const { data } = await sb.from("sono_quick_tokens").select("*").is("revoked_at", null).order("created_at", { ascending: false });
  const rows = data || [];
  $("#quickTokenList").innerHTML = rows.length ? rows.map(t => `
    <div class="shortcut-row"><span>${esc(t.device_name)} · ${new Date(t.created_at).toLocaleDateString("pt-BR")}</span>
      <button type="button" class="btn ghost" data-revoke-token="${t.id}" style="width:auto;padding:6px 10px">Revogar</button></div>`).join("")
    : `<p class="empty">Nenhum token ativo.</p>`;
}
async function openQuickActionsDialog() {
  $("#dlgSettings").close();
  $("#quickTokenNew").hidden = true;
  const cfg = loadSbConfig();
  $("#quickActionUrl").textContent = cfg ? `${cfg.url}/functions/v1/sono-quick-action` : "";
  await renderQuickTokenList();
  $("#dlgQuickActions").showModal();
}
async function generateQuickToken() {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const { error } = await sb.from("sono_quick_tokens").insert({ device_name: S.deviceName, token_hash: hash, by_user_id: S.uid, created_at: Date.now() });
  if (error) { toast("Não foi possível gerar o token agora."); return; }
  $("#quickTokenValue").value = token;
  $("#quickTokenNew").hidden = false;
  renderQuickTokenList();
}
$("#btnNewQuickToken").addEventListener("click", generateQuickToken);
$("#btnCopyQuickToken").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#quickTokenValue").value); toast("Token copiado."); }
  catch { $("#quickTokenValue").select(); toast("Selecione e copie manualmente."); }
});
async function revokeQuickToken(id) {
  if (!confirm("Revogar este token? Qualquer atalho que usa ele para de funcionar.")) return;
  await sb.from("sono_quick_tokens").update({ revoked_at: Date.now() }).eq("id", id);
  renderQuickTokenList();
}

/* ---------- render: guide ---------- */
function renderGuide() {
  const w = ageWeeks(), ref = sleepRef(w), [lo, hi] = wakeRef(w);
  const chapters = [
    { title: "Para a idade atual", body: `
      <p>${w == null ? "Defina a data de nascimento nas configurações para personalizar." : `Com ${esc(ageText(w))}, as referências usadas pelo app são:`}</p>
      <p>Sono total em 24 h: <strong>${ref.min} a ${ref.max} horas</strong> (${esc(ref.src)}). Tempo acordado entre sonos: <strong>${lo} a ${hi} minutos</strong>.${feedRef(w) ? ` Mamadas: <strong>8 a 12 por dia</strong>.` : ""}</p>` },
    { title: "Como o app calcula a previsão", body: `
      <p>A previsão do próximo sono começa pela faixa de tempo acordado típica da idade. Depois de alguns sonos registrados, ela passa a usar a mediana dos intervalos reais do bebê nos últimos 3 dias, sem sair muito da faixa da idade. É uma estimativa: os sinais do bebê (bocejar, esfregar os olhos, olhar parado, irritação) valem mais que o relógio.</p>
      <p class="src">As faixas de sono total vêm de consensos de especialistas. As janelas de tempo acordado são usadas na prática por pediatras e consultoras de sono, mas têm pouca base em estudos controlados. Por isso o app as trata como ponto de partida ajustável, e não como regra.</p>` },
    { title: "Sono do recém-nascido", body: `
      <p>Nos primeiros meses o sono é distribuído ao longo do dia e da noite, em blocos curtos: os ciclos são mais curtos que os de um adulto e têm mais sono ativo (equivalente ao REM). O ritmo circadiano — o "relógio biológico" que diferencia dia e noite — ainda está imaturo e costuma se organizar entre 2 e 4 meses. Variação grande de um dia para o outro é normal; compare tendências de vários dias, não um dia isolado.</p>
      <p class="src">National Sleep Foundation (Hirshkowitz et al., 2015); AASM (Paruthi et al., 2016).</p>` },
    { title: "Sinais de sono", body: `
      <p>Bocejar, esfregar os olhos, olhar parado ou desviar o olhar, puxar a orelha e ficar mais quieto ou irritado costumam aparecer antes do choro. Choro é um sinal tardio — agir nos sinais anteriores facilita o bebê pegar no sono.</p>` },
    { title: "Ambiente", body: `
      <p>Luz natural e atividade durante o dia, ambiente mais escuro e calmo à noite ajudam o relógio biológico a amadurecer mais rápido. Ruído branco em volume baixo e longe do berço pode ajudar a mascarar sons da casa; temperatura amena, sem cobrir demais o bebê.</p>` },
    { title: "Rotina na hora de dormir", body: `
      <p>Uma sequência curta e previsível antes do sono (banho, mamada, ambiente calmo, "boa noite") ajuda a sinalizar que a hora de dormir está chegando. Pode começar desde cedo; costuma ganhar consistência e efeito a partir de 6–8 semanas.</p>` },
    { title: "Sono seguro (AAP, 2022)", body: `
      <ul>
        <li>Sempre de barriga para cima, em todos os sonos, inclusive sonecas.</li>
        <li>Superfície firme e plana, com lençol ajustado. Sem travesseiros, protetores de berço, cobertores soltos ou bichos de pelúcia.</li>
        <li>Dormir no mesmo quarto dos pais, mas em berço próprio, de preferência nos primeiros 6 meses.</li>
        <li>Evitar deixar o bebê dormir em sofá, poltrona, cadeirinha de carro fora do carro ou superfícies inclinadas.</li>
        <li>Evitar superaquecimento e exposição à fumaça de cigarro. Amamentação e chupeta na hora de dormir estão associadas a menor risco.</li>
      </ul>
      <p class="src">Moon et al., <em>Pediatrics</em>, 2022 (AAP).</p>` },
    { title: "Regressões de sono", body: `
      <p>É comum o sono piorar por alguns dias a poucas semanas em certas fases — perto dos 4 meses (uma mudança real e permanente na forma como o sono se organiza, não só passageira), em saltos de desenvolvimento, marcos motores (virar, sentar, engatinhar) ou dentição. Manter a rotina e as mesmas respostas costuma ajudar o sono a se reorganizar sozinho.</p>
      <p class="src">Descrição amplamente usada na prática pediátrica e por consultoras de sono; não é um diagnóstico nem tem uma definição clínica única.</p>` },
    { title: "Amamentação e sinais de fome", body: `
      <p>Sinais precoces de fome: buscar o peito/mão, levar as mãos à boca, chupar os dedos, virar a cabeça procurando. Nos primeiros meses a amamentação costuma ser em livre demanda, geralmente 8 a 12 vezes em 24 h.</p>
      <p class="src">AAP / HealthyChildren.org.</p>` },
    { title: "Quando falar com o pediatra", body: `
      <p>Procure orientação se o bebê estiver muito sonolento e difícil de acordar para mamar, com poucas fraldas molhadas, respirando com pausas ou esforço, com ronco constante, com o crescimento fugindo do esperado, ou se algo simplesmente parecer diferente do normal dele. Este app é um diário, não um dispositivo médico.</p>` },
    { title: "Referências", body: `
      <div class="scroll"><table>
        <tr><th>Fonte</th><th>Uso no app</th></tr>
        <tr><td>Hirshkowitz et al., <em>Sleep Health</em>, 2015 (National Sleep Foundation)</td><td>14–17 h para 0–3 meses</td></tr>
        <tr><td>Paruthi et al., <em>J Clin Sleep Med</em>, 2016 (AASM, endossado pela AAP)</td><td>Faixas a partir de 4 meses</td></tr>
        <tr><td>Moon et al., <em>Pediatrics</em>, 2022 (AAP, sono seguro)</td><td>Recomendações de sono seguro</td></tr>
        <tr><td>AAP / HealthyChildren.org, orientação sobre amamentação</td><td>8–12 mamadas por dia no início; sinais de fome</td></tr>
        <tr><td>WHO Child Growth Standards (OMS), parâmetros LMS republicados pelo CDC/NCHS</td><td>Curva de crescimento em Tendências</td></tr>
        <tr><td>Huckleberry, Napper, Glow Baby, BabyTime</td><td>Inspiração de uso: registro com um toque, previsão de soneca, visão de 24 h, compartilhamento</td></tr>
      </table></div>` },
  ];
  const tourCardHTML = `<button type="button" class="chart tour-start-btn" id="btnStartTour">
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--sleep-text)" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-5 2 2-5 5-2z"/></svg>
    <span><strong>Tour completo do app</strong><small>Um passeio por cada função, na tela de verdade — pode fechar quando quiser</small></span>
  </button>`;
  $("#view-guia").innerHTML = `<h2>Guia</h2>${tourCardHTML}` + chapters.map((c, i) => `
    <details class="guide-chapter"${i === 0 ? " open" : ""}>
      <summary>${esc(c.title)}</summary>
      <div class="guide-chapter-body">${c.body}</div>
    </details>`).join("");
}

/* ---------- render root ---------- */
function render() {
  $("#babyName").textContent = S.config.name || "Bebê";
  document.title = `Sono do ${S.config.name || "bebê"}`;
  $("#babyAge").textContent = ageText(ageWeeks());
  document.querySelector("header.top").classList.toggle("compact", S.tab !== "hoje");
  updateBanner();
  for (const t of ["hoje", "semana", "registros", "vacinas", "guia"]) {
    $("#view-" + t).hidden = S.tab !== t;
    document.querySelector(`nav [data-tab="${t}"]`).setAttribute("aria-current", S.tab === t ? "page" : "false");
  }
  if (S.tab === "hoje") renderToday();
  else if (S.tab === "semana") renderTrends();
  else if (S.tab === "registros") renderRecords();
  else if (S.tab === "vacinas") renderVaccines();
  else renderGuide();
  // Qualquer render() (sync em segundo plano, resolução de conflito, o timer de 30s) recria o
  // conteúdo da aba — se o tour estiver de pé, o alvo antigo já era. Reaponta no elemento novo
  // em vez de deixar o destaque desalinhado ou preso num nó que não existe mais.
  if (tourIndex >= 0) requestAnimationFrame(() => { if (tourIndex >= 0) showTourOverlay(TOUR_STEPS[tourIndex]); });
}
setInterval(() => { document.querySelectorAll("[data-timer]").forEach(el => el.textContent = fmtClock(Date.now() - Number(el.dataset.timer))); }, 1000);
setInterval(() => { if (S.tab === "hoje" && tourIndex === -1 && !document.querySelector("dialog[open]")) render(); }, 30000);

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

/* ---------- dialog: Vocês (humor, Fase 6) ---------- */
const journalAsc = () => Object.values(S.journal).filter(j => j && !j.deleted).sort((a, b) => a.at - b.at);
function renderJournalBalance() {
  const counts = nightShiftCounts({ sleepEvents: sleeps(), now: Date.now(), days: 7, nightWindow: nightWindow() });
  const names = Object.keys(counts);
  const total = names.reduce((s, n) => s + counts[n], 0);
  const el = $("#jrnBalanceText");
  if (!el) return;
  if (total < 3 || names.length < 2) { el.textContent = "Ainda não há noites suficientes registradas nos dois aparelhos para comparar."; return; }
  names.sort((a, b) => counts[b] - counts[a]);
  const top = names[0], topShare = counts[top] / total;
  el.textContent = topShare >= 0.7
    ? `${top} tem cuidado da madrugada com mais frequência nos últimos 7 dias (${counts[top]} de ${total} noites). Que tal revezar hoje?`
    : `A madrugada tem ficado bem dividida nos últimos 7 dias (${names.map(n => `${n}: ${counts[n]}`).join(" · ")}).`;
}
function renderJournalList() {
  const list = [...journalAsc()].reverse().slice(0, 30);
  $("#jrnList").innerHTML = list.length ? list.map(j => `<button type="button" class="rec" data-journal-edit="${esc(j.id)}">
      <span class="dot" style="background:var(--feed)"></span><span class="t">${esc(dayLabelShort(j.at))} ${fmtTime(j.at)}</span>
      <span class="x">${MOOD_EMOJI[j.mood] || ""} ${j.mood}/5${j.note ? ` · ${esc(j.note)}` : ""}<small>${j.deviceName ? `por ${esc(j.deviceName)}` : ""}</small></span></button>`).join("")
    : `<p class="empty">Nenhum registro ainda.</p>`;
}
function openJournal(j) {
  editingJournal = j && j.id ? j : null;
  const row = j || { at: Date.now(), mood: 3 };
  $("#jrnTitle").textContent = editingJournal ? "Editar registro" : "Como você está?";
  $("#jrnWhen").value = toInput(row.at);
  $("#jrnNote").value = row.note || "";
  $("#jrnMoodPicker").dataset.value = row.mood;
  $("#jrnMoodPicker").querySelectorAll("[data-mood]").forEach(b => b.classList.toggle("on", Number(b.dataset.mood) === row.mood));
  $("#jrnDelete").hidden = !editingJournal;
  renderJournalBalance();
  renderJournalList();
  if (!$("#dlgJournal").open) $("#dlgJournal").showModal();
}
$("#btnOpenJournal").addEventListener("click", () => { $("#dlgSettings").close(); openJournal(null); });
$("#jrnMoodPicker").addEventListener("click", e => {
  const b = e.target.closest("[data-mood]"); if (!b) return;
  $("#jrnMoodPicker").dataset.value = b.dataset.mood;
  $("#jrnMoodPicker").querySelectorAll("[data-mood]").forEach(x => x.classList.toggle("on", x === b));
});
$("#formJournal").addEventListener("submit", ev => {
  const when = fromInput($("#jrnWhen").value);
  const mood = Number($("#jrnMoodPicker").dataset.value || 3);
  if (!when || isNaN(when)) { ev.preventDefault(); toast("Informe a data e hora."); return; }
  const rec = { id: editingJournal ? editingJournal.id : uidGen(), at: when, mood, note: $("#jrnNote").value.trim() || null };
  if (editingJournal) putEditedJournal(rec, editingJournal.version || 1);
  else putNewJournal(rec);
  toast(editingJournal ? "Atualizado." : "Registrado.");
  editingJournal = null;
});
$("#jrnDelete").addEventListener("click", () => {
  if (!editingJournal) return;
  deleteJournalNow(editingJournal.id, editingJournal.version || 1);
  $("#dlgJournal").close(); editingJournal = null; toast("Apagado.");
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
  $("#cfgSex").value = settings.sex || "";
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
  const sex = $("#cfgSex").value || null;
  setConfig({ name: $("#cfgName").value.trim() || "Bebê", birth: $("#cfgBirth").value,
    settings: { ...S.config.settings, fixedNaps, minWakeHour, sex } });
  if (wasFirstDeviceName && deviceName && !S.onboardingDone) showOnboarding();
});
function applyTheme(t) { if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); }
try { applyTheme(localStorage.getItem("sono-theme") || "auto"); } catch {}
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => { b.closest("dialog").close(); editing = null; }));
$("#btnExportBackup").addEventListener("click", exportBackup);
$("#btnDiagnostics").addEventListener("click", () => { $("#dlgSettings").close(); openDiagnostics(); });
$("#btnOpenNotifications").addEventListener("click", openNotificationsDialog);
$("#btnOpenQuickActions").addEventListener("click", openQuickActionsDialog);
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

/* ---------- tour completo do app (sob demanda, a partir do Guia) ---------- */
let tourIndex = -1, tourReposition = null;
function tourKeydownHandler(e) { if (e.key === "Escape") endTour(); }
function startTour() {
  tourIndex = 0;
  document.addEventListener("keydown", tourKeydownHandler);
  renderTourStep();
}
function endTour() {
  tourIndex = -1;
  removeTourOverlay();
  document.removeEventListener("keydown", tourKeydownHandler);
}
function removeTourOverlay() {
  const el = document.getElementById("tourOverlay");
  if (el) el.remove();
  if (tourReposition) {
    window.removeEventListener("resize", tourReposition);
    window.removeEventListener("scroll", tourReposition, true);
    tourReposition = null;
  }
}
function renderTourStep() {
  const step = TOUR_STEPS[tourIndex];
  if (!step) { endTour(); return; }
  // Trocar de aba já dispara render(), que por sua vez reaponta o tour (ver o fim de render()).
  // Só precisamos reapontar aqui quando a aba não muda, porque nada mais vai fazer isso.
  if (step.tab && S.tab !== step.tab) { S.tab = step.tab; render(); }
  else requestAnimationFrame(() => showTourOverlay(step));
}
function positionTourSpot(spot, targetEl) {
  if (!targetEl) { spot.style.display = "none"; return; }
  spot.style.display = "block";
  const r = targetEl.getBoundingClientRect(), pad = 8;
  spot.style.top = Math.max(0, r.top - pad) + "px";
  spot.style.left = Math.max(0, r.left - pad) + "px";
  spot.style.width = (r.width + pad * 2) + "px";
  spot.style.height = (r.height + pad * 2) + "px";
}
function positionTourTooltip(tip, targetEl) {
  if (!targetEl) { tip.style.top = "50%"; tip.style.left = "50%"; tip.style.transform = "translate(-50%,-50%)"; return; }
  tip.style.transform = "none";
  const vw = window.innerWidth, vh = window.innerHeight, margin = 14;
  const r = targetEl.getBoundingClientRect(), tipRect = tip.getBoundingClientRect();
  let top;
  if (r.bottom + margin + tipRect.height < vh - 12) top = r.bottom + margin;
  else if (r.top - margin - tipRect.height > 12) top = r.top - margin - tipRect.height;
  else top = Math.max(12, (vh - tipRect.height) / 2);
  const left = Math.min(Math.max(12, r.left + r.width / 2 - tipRect.width / 2), vw - tipRect.width - 12);
  tip.style.top = top + "px";
  tip.style.left = left + "px";
}
function showTourOverlay(step) {
  removeTourOverlay();
  const targetEl = step.target ? document.querySelector(step.target) : null;
  if (targetEl) targetEl.scrollIntoView({ block: "center" });

  const overlay = document.createElement("div");
  overlay.id = "tourOverlay";
  overlay.className = "tour-overlay" + (targetEl ? "" : " centered");

  const spot = document.createElement("div");
  spot.className = "tour-spot";
  overlay.appendChild(spot);

  const tip = document.createElement("div");
  tip.className = "tour-tooltip";
  tip.style.visibility = "hidden";
  const isLast = tourIndex === TOUR_STEPS.length - 1;
  tip.innerHTML = `
    <button type="button" class="tour-close" aria-label="Fechar tour">✕</button>
    <p class="tour-progress">${tourIndex + 1} de ${TOUR_STEPS.length}</p>
    <h3>${esc(step.title)}</h3>
    <p>${esc(step.body)}</p>
    <div class="tour-actions">
      <button type="button" class="btn ghost" id="tourSkip">Pular</button>
      <div style="display:flex;gap:8px">
        ${tourIndex > 0 ? `<button type="button" class="btn ghost" id="tourPrev">Anterior</button>` : ""}
        <button type="button" class="btn primary" id="tourNext">${isLast ? "Concluir" : "Próximo"}</button>
      </div>
    </div>`;
  overlay.appendChild(tip);
  document.body.appendChild(overlay);

  positionTourSpot(spot, targetEl);
  positionTourTooltip(tip, targetEl);
  tip.style.visibility = "visible";

  overlay.addEventListener("click", e => { if (e.target === overlay) endTour(); });
  tip.querySelector(".tour-close").addEventListener("click", endTour);
  tip.querySelector("#tourSkip").addEventListener("click", endTour);
  tip.querySelector("#tourNext").addEventListener("click", () => { tourIndex++; renderTourStep(); });
  const prevBtn = tip.querySelector("#tourPrev");
  if (prevBtn) prevBtn.addEventListener("click", () => { tourIndex--; renderTourStep(); });

  tourReposition = () => { positionTourSpot(spot, targetEl); positionTourTooltip(tip, targetEl); };
  window.addEventListener("resize", tourReposition);
  window.addEventListener("scroll", tourReposition, true);
}

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

  const revoke = e.target.closest("[data-revoke-token]");
  if (revoke) return revokeQuickToken(Number(revoke.dataset.revokeToken));

  const grwEdit = e.target.closest("[data-growth-edit]");
  if (grwEdit) { const g = S.growth[grwEdit.dataset.growthEdit]; if (g) openGrowth(g); return; }
  if (e.target.closest("[data-growth-new]")) return openGrowth(null);

  const jrnEdit = e.target.closest("[data-journal-edit]");
  if (jrnEdit) { const j = S.journal[jrnEdit.dataset.journalEdit]; if (j) openJournal(j); return; }

  const vacEdit = e.target.closest("[data-vaccine-edit]");
  if (vacEdit) { const v = S.vaccines[vacEdit.dataset.vaccineEdit]; if (v) openVaccine(v); return; }

  const period = e.target.closest("[data-trend-period]");
  if (period) { S.trendsDays = Number(period.dataset.trendPeriod); renderTrends(); return; }

  const exp = e.target.closest("[data-export]");
  if (exp) return runExport(exp.dataset.export);

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
  if (t.id === "btnStartTour") return startTour();
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
    .on("postgres_changes", { event: "*", schema: "public", table: "sono_journal" }, () => sync())
    .on("postgres_changes", { event: "*", schema: "public", table: "sono_vaccines" }, () => sync())
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
