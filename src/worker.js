// จุดเข้า Cloudflare Worker เดียวสำหรับทั้งเว็บนี้:
// - เสิร์ฟไฟล์ static ใน public/ (index.html และไฟล์อื่นๆ) ผ่าน env.ASSETS
// - ยกเว้น path /api/storage ที่ส่งต่อให้ src/storage-api.js จัดการ (ครอบ Cloudflare KV)
//
// บัญชี Cloudflare นี้ deploy โปรเจกต์ผ่าน `wrangler deploy` (รูปแบบ Workers + assets ใหม่)
// ไม่ใช่ Pages Functions รุ่นเก่า จึงรวม static hosting กับ API ไว้ในไฟล์เดียวนี้แทน
import { handleStorageRequest } from './storage-api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/storage') {
      return handleStorageRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
