// Decide QUAIS lembretes estão devidos agora — puro, sem rede/envio. A Edge Function
// (Fase 3) usa isso só para decidir; quem manda o push é código à parte. Testável com
// node:test e reaproveitável no Deno da Edge Function (mesmo import relativo de sempre).
import { MIN, HOUR, fmtHoursRounded30 } from "./time.js";

const FIVE_MIN = 5 * MIN;

export function dueNotifications({ now, schedule, liveState, lastFeedEnd, lastDiaperEnd, lastMedicine, agendaItems, prefsByDevice, alreadySent }) {
  const sent = new Set(alreadySent || []);
  const already = key => sent.has(key);
  const due = [];
  const devices = Object.entries(prefsByDevice || {});

  // soneca chegando
  if (schedule && schedule.nextNap && !liveState.sleepStart) {
    const minsToNap = (schedule.nextNap.from - now) / MIN;
    for (const [deviceName, prefs] of devices) {
      if (!prefs.nap_enabled) continue;
      const lead = prefs.nap_lead_min ?? 30;
      if (minsToNap > 0 && minsToNap <= lead) {
        const key = `nap:${deviceName}:${Math.floor(schedule.nextNap.from / FIVE_MIN)}`;
        if (!already(key)) due.push({ deviceName, kind: "nap", title: "Soneca chegando", body: `Provável em ~${Math.round(minsToNap)} min`, dedupeKey: key });
      }
    }
  }
  // tempo desde a última mamada
  if (lastFeedEnd != null) {
    const hoursSince = (now - lastFeedEnd) / HOUR;
    for (const [deviceName, prefs] of devices) {
      if (!prefs.feed_enabled) continue;
      const after = prefs.feed_after_hours ?? 3;
      if (hoursSince >= after) {
        const key = `feed:${deviceName}:${Math.floor(now / HOUR)}`;
        if (!already(key)) due.push({ deviceName, kind: "feed", title: "Hora de mamar?", body: `${fmtHoursRounded30(hoursSince)} desde a última mamada`, dedupeKey: key });
      }
    }
  }
  // tempo desde a última fralda
  if (lastDiaperEnd != null) {
    const hoursSince = (now - lastDiaperEnd) / HOUR;
    for (const [deviceName, prefs] of devices) {
      if (!prefs.diaper_enabled) continue;
      const after = prefs.diaper_after_hours ?? 3;
      if (hoursSince >= after) {
        const key = `diaper:${deviceName}:${Math.floor(now / HOUR)}`;
        if (!already(key)) due.push({ deviceName, kind: "diaper", title: "Conferir fralda?", body: `${fmtHoursRounded30(hoursSince)} desde a última troca`, dedupeKey: key });
      }
    }
  }
  // próxima dose de remédio
  if (lastMedicine && lastMedicine.intervalHours) {
    const nextDose = lastMedicine.start + lastMedicine.intervalHours * HOUR;
    const minsToDose = (nextDose - now) / MIN;
    for (const [deviceName, prefs] of devices) {
      if (!prefs.medicine_enabled) continue;
      if (minsToDose <= 15 && minsToDose > -60) {
        const key = `medicine:${deviceName}:${Math.floor(nextDose / FIVE_MIN)}`;
        const when = nextDose <= now ? "agora" : `em ~${Math.round(minsToDose)} min`;
        if (!already(key)) due.push({ deviceName, kind: "medicine", title: "Próxima dose", body: lastMedicine.name ? `${lastMedicine.name} — ${when}` : `Remédio — ${when}`, dedupeKey: key });
      }
    }
  }
  // agenda: véspera e 1h antes
  for (const item of agendaItems || []) {
    const hoursTo = (item.scheduledAt - now) / HOUR;
    for (const [deviceName, prefs] of devices) {
      if (!prefs.agenda_enabled) continue;
      if (hoursTo <= 24 && hoursTo > 23) {
        const key = `agenda-eve:${deviceName}:${item.id}`;
        if (!already(key)) due.push({ deviceName, kind: "agenda", title: "Amanhã", body: item.title, dedupeKey: key });
      }
      if (hoursTo <= 1 && hoursTo > 0.83) {
        const key = `agenda-1h:${deviceName}:${item.id}`;
        if (!already(key)) due.push({ deviceName, kind: "agenda", title: "Em 1 hora", body: item.title, dedupeKey: key });
      }
    }
  }
  // dormindo desde (reativo — chamado pelo trigger ao vivo, ou pego pelo próximo ciclo do agendador)
  if (liveState.sleepStart && (now - liveState.sleepStart) < 4 * MIN) {
    for (const [deviceName, prefs] of devices) {
      if (!prefs.sleep_start_notify_enabled) continue;
      const key = `sleepstart:${deviceName}:${liveState.sleepStart}`;
      if (!already(key)) due.push({ deviceName, kind: "sleep_start", title: "Dormindo", body: "Cronômetro de sono iniciado", dedupeKey: key });
    }
  }
  return due;
}
