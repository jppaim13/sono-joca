// Chamada pelo app Atalhos (Siri, Watch, Toque nas Costas, botão de Ação, Central/tela
// bloqueada no iOS 18) com um token pessoal por aparelho — nunca uma sessão de usuário.
// O token nunca é gravado no banco, só o hash (SHA-256); comparação é sempre por hash.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const KIND = { "peito-e": "Peito esquerdo", "peito-d": "Peito direito" };

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function uidGen(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function accountUserId(): Promise<string | null> {
  const { data } = await sb.from("profiles").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

// Escrita condicional simples com uma tentativa de retry se a versão mudou entre a
// leitura e a escrita — mesmo espírito do outbox do app, sem a fila offline (aqui é
// sempre online, chamado por fora).
async function condUpdateSingleton(table: string, patch: Record<string, unknown>, deviceName: string, byUserId: string | null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: current } = await sb.from(table).select("version").eq("id", 1).maybeSingle();
    const expectedVersion = current?.version ?? 1;
    const { data, error } = await sb.from(table)
      .update({ ...patch, version: expectedVersion + 1, updated_at: Date.now(), last_edited_by: byUserId, device_name: deviceName })
      .eq("id", 1).eq("version", expectedVersion).select();
    if (error) throw error;
    if (data && data.length) return data[0];
  }
  throw new Error("conflito ao atualizar, tente de novo");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const { token, command } = body || {};
  if (!token || !command) return json({ error: "faltou token ou command" }, 400);

  const tokenHash = await sha256Hex(token);
  const { data: tokenRow, error: tokenErr } = await sb.from("sono_quick_tokens")
    .select("*").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle();
  if (tokenErr) return json({ error: tokenErr.message }, 500);
  if (!tokenRow) return json({ error: "token inválido ou revogado" }, 401);
  const deviceName = tokenRow.device_name;
  const byUserId = tokenRow.by_user_id ?? (await accountUserId());
  const now = Date.now();

  try {
    if (command === "status") {
      const { data: live } = await sb.from("live_state").select("*").eq("id", 1).maybeSingle();
      if (live?.sleep_start) {
        const mins = Math.round((now - live.sleep_start) / 60000);
        return json({ text: `Dormindo há ${mins < 60 ? mins + " min" : Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0")}.` });
      }
      const { data: lastSleep } = await sb.from("events").select("*").eq("type", "sleep").eq("deleted", false)
        .order("start", { ascending: false }).limit(1).maybeSingle();
      if (!lastSleep?.end) return json({ text: "Sem registros de sono ainda." });
      const awakeMin = Math.round((now - lastSleep.end) / 60000);
      const h = Math.floor(awakeMin / 60), m = awakeMin % 60;
      return json({ text: `Acordado há ${h ? h + "h" + String(m).padStart(2, "0") : m + " min"}.` });
    }

    if (command === "sleep_start") {
      await condUpdateSingleton("live_state", { sleep_start: now, sleep_by: byUserId }, deviceName, byUserId);
      return json({ ok: true, text: "Sono iniciado." });
    }
    if (command === "sleep_stop") {
      const { data: live } = await sb.from("live_state").select("*").eq("id", 1).maybeSingle();
      if (!live?.sleep_start) return json({ ok: false, text: "Não havia sono em andamento." });
      const start = live.sleep_start;
      await condUpdateSingleton("live_state", { sleep_start: null, sleep_by: null, pauses: [] }, deviceName, byUserId);
      if (now - start >= 60000) {
        await sb.from("events").insert({ id: uidGen(), type: "sleep", start, end: now, by_user_id: byUserId,
          last_edited_by: byUserId, device_name: deviceName, data: {}, deleted: false, updated_at: now, version: 1 });
      }
      return json({ ok: true, text: "Sono encerrado." });
    }
    if (command === "feed_start") {
      const side = body.side === "peito-d" ? "peito-d" : "peito-e";
      await condUpdateSingleton("live_state", { feed_start: now, feed_kind: side, feed_by: byUserId }, deviceName, byUserId);
      return json({ ok: true, text: `Mamada (${KIND[side]}) iniciada.` });
    }
    if (command === "feed_stop") {
      const { data: live } = await sb.from("live_state").select("*").eq("id", 1).maybeSingle();
      if (!live?.feed_start) return json({ ok: false, text: "Não havia mamada em andamento." });
      const start = live.feed_start, kind = live.feed_kind;
      await condUpdateSingleton("live_state", { feed_start: null, feed_kind: null, feed_by: null }, deviceName, byUserId);
      await sb.from("events").insert({ id: uidGen(), type: "feed", kind, start, end: now, by_user_id: byUserId,
        last_edited_by: byUserId, device_name: deviceName, data: {}, deleted: false, updated_at: now, version: 1 });
      return json({ ok: true, text: "Mamada encerrada." });
    }
    if (command === "diaper") {
      const kind = ["xixi", "coco", "ambos"].includes(body.kind) ? body.kind : "xixi";
      await sb.from("events").insert({ id: uidGen(), type: "diaper", kind, start: now, by_user_id: byUserId,
        last_edited_by: byUserId, device_name: deviceName, data: {}, deleted: false, updated_at: now, version: 1 });
      return json({ ok: true, text: "Fralda registrada." });
    }
    if (command === "bottle") {
      const ml = Number.isFinite(body.ml) ? Math.max(0, Math.min(1000, body.ml)) : null;
      await sb.from("events").insert({ id: uidGen(), type: "feed", kind: "mamadeira", start: now, ml, by_user_id: byUserId,
        last_edited_by: byUserId, device_name: deviceName, data: {}, deleted: false, updated_at: now, version: 1 });
      return json({ ok: true, text: ml ? `Mamadeira de ${ml} ml registrada.` : "Mamadeira registrada." });
    }
    return json({ error: `command desconhecido: ${command}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
