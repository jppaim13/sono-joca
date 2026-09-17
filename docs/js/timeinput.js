import { HOUR, DAY } from "./time.js";

// Converte dígitos ("1432" ou "932") num horário HH:MM no mesmo dia de `refMs`,
// ou no dia anterior se o resultado ficasse mais de 1h no futuro (ex.: digitar
// a hora que o bebê dormiu ontem à noite, já depois da meia-noite).
export function parseDigitsToTime(digits, refMs) {
  const clean = String(digits ?? "").replace(/\D/g, "");
  if (clean.length < 3 || clean.length > 4) return null;
  const padded = clean.length === 3 ? "0" + clean : clean;
  const h = parseInt(padded.slice(0, 2), 10), m = parseInt(padded.slice(2, 4), 10);
  if (h > 23 || m > 59) return null;
  const ref = new Date(refMs);
  const candidate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), h, m, 0, 0).getTime();
  return candidate > refMs + HOUR ? candidate - DAY : candidate;
}

// Botões "agora"/"-5"/"-10"/"-15": deslocamento simples a partir de agora.
export function offsetFromNow(nowMs, minutesAgo) {
  return nowMs - minutesAgo * 60000;
}
