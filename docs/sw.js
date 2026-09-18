// Guarda a interface para abrir sem internet. Chamadas ao Supabase nunca são guardadas em cache.
// Não pula a espera sozinho — só ativa quando o app pedir (ver "Nova versão disponível" no index.html),
// pra não trocar de versão no meio de um registro.
const CACHE = "sono-shell-v15";
const SHELL = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./js/app.js", "./js/time.js", "./js/validation.js", "./js/outbox.js", "./js/conflict.js", "./js/undo.js",
  "./js/store.js", "./js/timeinput.js", "./js/sleep.js", "./js/schedule.js", "./js/notifications.js", "./js/trends.js",
  "./js/vaccines.js", "./data/who-growth-lms.json", "./vendor/jspdf.umd.min.js", "./vendor/xlsx.full.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
// Web Push (Fase 3) — sem botões de ação na notificação (iOS não suporta); tocar abre o app.
self.addEventListener("push", e => {
  let data = { title: "Sono do Joaquim", body: "" };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", tag: data.kind || "sono",
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow("./");
  }));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (e.request.mode === "navigate") {
    // Rede primeiro para receber atualizações; cache se estiver offline.
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put("./", copy)); return r;
    }).catch(() => caches.match("./")));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
