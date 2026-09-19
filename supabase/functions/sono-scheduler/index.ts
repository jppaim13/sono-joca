// Roda a cada 5 min via pg_cron+pg_net, e também na hora (via gatilho em live_state,
// migração 005) quando um sono começa. Casca fina: busca os dados, delega a decisão de
// "o que avisar" para docs/js/notifications.js (puro, testado com node:test) e
// docs/js/schedule.js (o mesmo motor de previsão do app), e manda os pushes.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { computeSchedule } from "../../../docs/js/schedule.js";
import { dueNotifications } from "../../../docs/js/notifications.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

Deno.serve(async (_req) => {
  try {
    const now = Date.now();
    const [babyRes, eventsRes, liveRes, subsRes, prefsRes, agendaRes, logRes] = await Promise.all([
      sb.from("baby").select("*").eq("id", 1).maybeSingle(),
      sb.from("events").select("*").gte("start", now - 14 * DAY).eq("deleted", false),
      sb.from("live_state").select("*").eq("id", 1).maybeSingle(),
      sb.from("sono_push_subscriptions").select("*"),
      sb.from("sono_notification_prefs").select("*"),
      sb.from("sono_agenda").select("*").eq("completed", false).eq("deleted", false)
        .gte("scheduled_at", now - DAY).lte("scheduled_at", now + 2 * DAY),
      sb.from("sono_notification_log").select("payload").gte("sent_at", now - 25 * HOUR),
    ]);
    for (const r of [babyRes, eventsRes, liveRes, subsRes, prefsRes, agendaRes, logRes]) {
      if (r.error) throw r.error;
    }

    const allEvents = eventsRes.data || [];
    const sleepEvents = allEvents.filter(e => e.type === "sleep")
      .map(r => ({ id: r.id, start: r.start, end: r.end, isNight: r.is_night, data: r.data }));
    // Mamadeira/sólido são registrados sem "end" (evento instantâneo, só peito tem cronômetro) —
    // usar "end ?? start" pra não ignorar a mamadeira mais recente e achar que já faz tempo desde
    // a última mamada quando na verdade ela foi de mamadeira.
    const feeds = allEvents.filter(e => e.type === "feed").sort((a, b) => (b.end ?? b.start) - (a.end ?? a.start));
    const diapers = allEvents.filter(e => e.type === "diaper").sort((a, b) => b.start - a.start);
    const medicines = allEvents.filter(e => e.type === "medicine" && e.data?.medicineIntervalHours).sort((a, b) => b.start - a.start);

    const baby = babyRes.data;
    const settings = baby?.settings || {};
    const ageWeeks = baby?.birth ? (now - new Date(baby.birth + "T12:00:00").getTime()) / (7 * DAY) : null;
    const schedule = computeSchedule({ sleepEvents, ageWeeks, settings, now, atypicalDayKeys: settings.atypicalDays || [] });

    const prefsByDevice: Record<string, any> = {};
    for (const p of prefsRes.data || []) prefsByDevice[p.device_name] = p;

    const liveState = liveRes.data
      ? { sleepStart: liveRes.data.sleep_start, feedStart: liveRes.data.feed_start }
      : {};

    const agendaItems = (agendaRes.data || []).map(a => ({ id: a.id, title: a.title, scheduledAt: a.scheduled_at }));
    const lastMedicine = medicines[0]
      ? { start: medicines[0].start, intervalHours: medicines[0].data.medicineIntervalHours, name: medicines[0].data.medicineName }
      : null;

    const alreadySent = (logRes.data || []).map(l => l.payload?.dedupeKey).filter(Boolean);

    const due = dueNotifications({
      now, schedule, liveState,
      lastFeedEnd: feeds[0] ? (feeds[0].end ?? feeds[0].start) : null,
      lastDiaperEnd: diapers[0]?.start ?? null,
      lastMedicine, agendaItems, prefsByDevice, alreadySent,
    });

    let sent = 0;
    for (const notif of due) {
      const subs = (subsRes.data || []).filter(s => s.device_name === notif.deviceName);
      let delivered = false;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: notif.title, body: notif.body, kind: notif.kind }),
          );
          delivered = true;
        } catch (err) {
          // inscrição expirada/revogada no navegador — remove para não tentar de novo
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await sb.from("sono_push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }
      await sb.from("sono_notification_log").insert({
        kind: notif.kind, device_name: notif.deviceName, sent_at: now,
        payload: { title: notif.title, body: notif.body, dedupeKey: notif.dedupeKey },
        delivered,
      });
      if (delivered) sent++;
    }

    return new Response(JSON.stringify({ ok: true, due: due.length, sent }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
