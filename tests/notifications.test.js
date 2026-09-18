import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUR, MIN } from "../docs/js/time.js";
import { dueNotifications } from "../docs/js/notifications.js";

const basePrefs = { nap_enabled: true, nap_lead_min: 30, feed_enabled: true, feed_after_hours: 3,
  diaper_enabled: true, diaper_after_hours: 3, medicine_enabled: true, agenda_enabled: true, sleep_start_notify_enabled: true };

test("nap: avisa quando faltam menos minutos que o lead configurado", () => {
  const now = Date.now();
  const schedule = { nextNap: { from: now + 20 * MIN } };
  const due = dueNotifications({ now, schedule, liveState: {}, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "nap");
});
test("nap: não avisa se já passou do horário previsto (deixa pra outro aviso, não repete infinito)", () => {
  const now = Date.now();
  const schedule = { nextNap: { from: now - 20 * MIN } };
  const due = dueNotifications({ now, schedule, liveState: {}, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.length, 0);
});
test("nap: não avisa se já está dormindo", () => {
  const now = Date.now();
  const schedule = { nextNap: { from: now + 10 * MIN } };
  const due = dueNotifications({ now, schedule, liveState: { sleepStart: now - HOUR }, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.filter(d => d.kind === "nap").length, 0);
});
test("nap: respeita aparelho com a preferência desligada", () => {
  const now = Date.now();
  const schedule = { nextNap: { from: now + 10 * MIN } };
  const prefs = { ...basePrefs, nap_enabled: false };
  const due = dueNotifications({ now, schedule, liveState: {}, prefsByDevice: { d1: prefs }, alreadySent: [] });
  assert.equal(due.length, 0);
});
test("nap: não duplica se a chave já foi enviada", () => {
  const now = Date.now();
  const schedule = { nextNap: { from: now + 10 * MIN } };
  const key = `nap:d1:${Math.floor((now + 10 * MIN) / (5 * MIN))}`;
  const due = dueNotifications({ now, schedule, liveState: {}, prefsByDevice: { d1: basePrefs }, alreadySent: [key] });
  assert.equal(due.length, 0);
});

test("feed: avisa depois do intervalo configurado", () => {
  const now = Date.now();
  const due = dueNotifications({ now, schedule: null, liveState: {}, lastFeedEnd: now - 4 * HOUR, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "feed"), true);
});
test("feed: não avisa antes do intervalo", () => {
  const now = Date.now();
  const due = dueNotifications({ now, schedule: null, liveState: {}, lastFeedEnd: now - HOUR, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "feed"), false);
});

test("diaper: avisa depois do intervalo configurado", () => {
  const now = Date.now();
  const due = dueNotifications({ now, schedule: null, liveState: {}, lastDiaperEnd: now - 4 * HOUR, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "diaper"), true);
});

test("medicine: avisa perto da próxima dose", () => {
  const now = Date.now();
  const lastMedicine = { start: now - 4 * HOUR, intervalHours: 4, name: "Vitamina D" };
  const due = dueNotifications({ now, schedule: null, liveState: {}, lastMedicine, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "medicine"), true);
  assert.match(due.find(d => d.kind === "medicine").body, /Vitamina D/);
});
test("medicine: não avisa muito antes da hora", () => {
  const now = Date.now();
  const lastMedicine = { start: now - HOUR, intervalHours: 8 };
  const due = dueNotifications({ now, schedule: null, liveState: {}, lastMedicine, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "medicine"), false);
});

test("agenda: avisa na véspera (janela de 23-24h antes)", () => {
  const now = Date.now();
  const agendaItems = [{ id: "a1", title: "Consulta", scheduledAt: now + 23.5 * HOUR }];
  const due = dueNotifications({ now, schedule: null, liveState: {}, agendaItems, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "agenda" && d.title === "Amanhã"), true);
});
test("agenda: avisa 1h antes", () => {
  const now = Date.now();
  const agendaItems = [{ id: "a1", title: "Vacina", scheduledAt: now + 55 * MIN }];
  const due = dueNotifications({ now, schedule: null, liveState: {}, agendaItems, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "agenda" && d.title === "Em 1 hora"), true);
});

test("sleep_start: avisa logo que o cronômetro começa", () => {
  const now = Date.now();
  const due = dueNotifications({ now, schedule: null, liveState: { sleepStart: now - MIN }, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "sleep_start"), true);
});
test("sleep_start: não avisa de novo se o cronômetro já está rodando há muito tempo", () => {
  const now = Date.now();
  const due = dueNotifications({ now, schedule: null, liveState: { sleepStart: now - HOUR }, prefsByDevice: { d1: basePrefs }, alreadySent: [] });
  assert.equal(due.some(d => d.kind === "sleep_start"), false);
});

test("cada aparelho recebe seu próprio conjunto de avisos, conforme suas preferências", () => {
  const now = Date.now();
  const due = dueNotifications({
    now, schedule: null, liveState: {}, lastFeedEnd: now - 4 * HOUR,
    prefsByDevice: { d1: basePrefs, d2: { ...basePrefs, feed_enabled: false } },
    alreadySent: [],
  });
  const feedDevices = due.filter(d => d.kind === "feed").map(d => d.deviceName);
  assert.deepEqual(feedDevices, ["d1"]);
});
