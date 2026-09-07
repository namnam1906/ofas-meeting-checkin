// Cloudflare Pages Function: บาง REST endpoint ครอบ Cloudflare KV binding
// แทนที่ window.storage ของ Claude Artifacts เดิม (ดู index.html: storeGet/storeSet/storeDelete/storeList)
//
// Route: /api/storage
//   GET    /api/storage?key=<key>            -> { value: string|null }
//   GET    /api/storage?prefix=<prefix>       -> { keys: string[] }
//   PUT    /api/storage   body {key, value}   -> { ok: true }
//   DELETE /api/storage?key=<key>             -> { ok: true }
//
// ต้อง bind KV namespace ชื่อ STORAGE_KV ใน wrangler.toml (ดูไฟล์ wrangler.toml ใน repo นี้)
//
// การยืนยันตัวตน: ถ้าตั้งค่า environment variable STORAGE_TOKEN ไว้ใน Cloudflare Pages
// (Settings > Environment variables, ตั้งเป็น Secret) ทุก request ต้องแนบ header
// `X-Storage-Token: <ค่าเดียวกัน>` ไม่งั้นจะได้ 401 — ถ้าไม่ตั้งค่าไว้เลย endpoint จะเปิดสาธารณะ
// (ใช้ได้เฉพาะตอนพัฒนา/ทดสอบเท่านั้น ไม่ควรปล่อยแบบนี้ตอนใช้งานจริงกับข้อมูลส่วนบุคคล)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

function authOk(request, env) {
  if (!env.STORAGE_TOKEN) return true; // ไม่ได้ตั้งค่า token ไว้ -> เปิดสาธารณะ (ใช้ตอน dev เท่านั้น)
  return request.headers.get('X-Storage-Token') === env.STORAGE_TOKEN;
}

export async function onRequestGet({ request, env }) {
  if (!authOk(request, env)) return unauthorized();
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix');

  if (prefix !== null) {
    const keys = [];
    let cursor;
    do {
      const page = await env.STORAGE_KV.list({ prefix, cursor });
      keys.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return json({ keys });
  }

  const key = url.searchParams.get('key');
  if (!key) return json({ error: 'missing key or prefix' }, 400);
  const value = await env.STORAGE_KV.get(key);
  return json({ value });
}

export async function onRequestPut({ request, env }) {
  if (!authOk(request, env)) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json body' }, 400);
  }
  const { key, value } = body || {};
  if (!key) return json({ error: 'missing key' }, 400);
  await env.STORAGE_KV.put(key, value == null ? '' : String(value));
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!authOk(request, env)) return unauthorized();
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return json({ error: 'missing key' }, 400);
  await env.STORAGE_KV.delete(key);
  return json({ ok: true });
}
