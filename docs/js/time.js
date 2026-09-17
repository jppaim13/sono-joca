// Constantes e funções puras de tempo. Sem dependências — importável no navegador e no Node.
export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function midnight(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

// Divide um intervalo [start,end) em pedaços por dia civil (fuso local), para
// que sono cruzando a meia-noite conte certo nos dois dias.
export function splitByDay(start, end) {
  const pieces = [];
  let cursor = start;
  while (cursor < end) {
    const dayStart = midnight(cursor);
    const dayEnd = dayStart + DAY;
    const pieceEnd = Math.min(end, dayEnd);
    pieces.push({ day: dayStart, start: cursor, end: pieceEnd });
    cursor = pieceEnd;
  }
  return pieces;
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function fmtDur(min) {
  min = Math.max(0, Math.round(min));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
}

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
