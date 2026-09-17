import { HOUR } from "./time.js";

export const SLEEP_SOFT_CONFIRM_HOURS = 12;
export const SLEEP_HARD_CAP_HOURS = 16;

// Duração de sono: aceita até 16h; entre 12h e 16h pede confirmação; acima de 16h rejeita.
export function checkSleepDuration(durationMs) {
  const hours = durationMs / HOUR;
  if (hours > SLEEP_HARD_CAP_HOURS) return { ok: false, reason: "too-long", hours };
  if (hours > SLEEP_SOFT_CONFIRM_HOURS) return { ok: true, needsConfirm: true, hours };
  return { ok: true, needsConfirm: false, hours };
}

const FORGOTTEN_DAY_HOURS = 5;
const FORGOTTEN_NIGHT_HOURS = 14;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 19;

// Cronômetro de sono aberto há tempo demais: limiar diferente de dia (7h-19h) e de noite.
export function isSleepForgotten(sleepStartMs, nowMs) {
  const localHour = new Date(sleepStartMs).getHours();
  const isDay = localHour >= DAY_START_HOUR && localHour < DAY_END_HOUR;
  const thresholdHours = isDay ? FORGOTTEN_DAY_HOURS : FORGOTTEN_NIGHT_HOURS;
  const elapsedHours = (nowMs - sleepStartMs) / HOUR;
  if (elapsedHours > thresholdHours) return { forgotten: true, thresholdHours, elapsedHours };
  return { forgotten: false, thresholdHours, elapsedHours };
}
