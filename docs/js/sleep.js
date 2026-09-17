import { HOUR } from "./time.js";

// Duração líquida de um sono descontando as pausas (cada pausa sem `end` conta até `end` do sono).
export function netSleepDuration(start, end, pauses) {
  let paused = 0;
  for (const p of pauses || []) paused += (p.end ?? end) - p.start;
  return Math.max(0, (end - start) - paused);
}

// Uma pausa iniciada dentro da janela noturna conta como despertar noturno.
export function isPauseAtNight(pauseStartMs, nightStartHour, nightEndHour) {
  const h = new Date(pauseStartMs).getHours();
  return nightStartHour > nightEndHour
    ? (h >= nightStartHour || h < nightEndHour)
    : (h >= nightStartHour && h < nightEndHour);
}
export function countNightWakenings(pauses, nightStartHour = 19, nightEndHour = 7) {
  return (pauses || []).filter(p => isPauseAtNight(p.start, nightStartHour, nightEndHour)).length;
}

// Soneca × sono noturno: começa dentro da janela noturna E dura pelo menos 2h — evita que uma
// soneca de fim de tarde comprida seja confundida com a noite. `isNightOverride` (true/false)
// do próprio registro sempre vence; null/undefined usa a classificação automática.
export function classifySleep(start, end, isNightOverride, nightStartHour = 19, nightEndHour = 7) {
  if (isNightOverride === true) return "night";
  if (isNightOverride === false) return "nap";
  const startHour = new Date(start).getHours();
  const inWindow = nightStartHour > nightEndHour
    ? (startHour >= nightStartHour || startHour < nightEndHour)
    : (startHour >= nightStartHour && startHour < nightEndHour);
  const hours = (end - start) / HOUR;
  return inWindow && hours >= 2 ? "night" : "nap";
}

// Colisão: outro sono já registrado que se sobrepõe ao intervalo [start,end).
export function findSleepOverlap(events, start, end, excludeId) {
  return events.find(e => e.id !== excludeId && e.type === "sleep" && e.end != null &&
    Math.max(e.start, start) < Math.min(e.end, end)) || null;
}
