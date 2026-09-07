# ระบบลงทะเบียนหน้างาน + เช็คอินด้วย QR

แอปเดียวจบ (`public/index.html`) — นำเข้ารายชื่อจาก Google Form/Sheet (CSV), ออกบัตร QR ต่อคน, เช็คอินหน้างานด้วยกล้อง/ค้นหาด้วยมือ/สแกนจากไฟล์รูป

เดิมรันอยู่ใน Claude Artifacts (มีข้อจำกัดเรื่องกล้องเพราะ iframe sandbox ไม่ได้รับสิทธิ์ camera) ตอนนี้ย้ายมา deploy เป็นเว็บจริงบน Cloudflare แล้ว — พอไม่ได้รันใน iframe ของ Claude แล้ว กล้องสแกน QR สดใช้งานได้ปกติทันที

## โครงสร้างโปรเจกต์

```
public/index.html     หน้าเว็บทั้งหมด (static, ไม่มี build step)
src/worker.js          Cloudflare Worker entry point — เสิร์ฟ static assets + route /api/storage และ /api/send-email
src/storage-api.js     ตัวจัดการ REST /api/storage ครอบ Cloudflare KV
src/email-api.js       ตัวจัดการ REST /api/send-email ส่งอีเมล QR ผ่าน Resend
src/http-helpers.js    ฟังก์ชันช่วยที่ใช้ร่วมกัน (json response, ตรวจ STORAGE_TOKEN)
wrangler.toml          config ผูก assets directory + KV binding
```

> หมายเหตุ: บัญชี Cloudflare ของโปรเจกต์นี้ deploy ผ่านคำสั่ง `wrangler deploy` (รูปแบบ Workers + Static Assets ตัวใหม่ ไม่ใช่ Pages Functions รุ่นเก่าที่ใช้โฟลเดอร์ `functions/`) จึงรวม static hosting กับ API ไว้ในโปรเจกต์ Worker เดียวตามโครงสร้างด้านบน

## ✅ สถานะ storage layer — สลับมาเป็น Cloudflare Workers + KV แล้ว

โค้ดเดิมเก็บข้อมูลผ่าน `window.storage` ซึ่งเป็น API เฉพาะของ Claude Artifacts เท่านั้น ตอนนี้แก้แล้วเป็น:

1. **`src/storage-api.js`** — REST endpoint บางๆ ครอบ Cloudflare KV binding (`STORAGE_KV`) เรียกใช้จาก `src/worker.js` เมื่อ path ตรงกับ `/api/storage`
   - `GET /api/storage?key=<key>` → `{ value }`
   - `GET /api/storage?prefix=<prefix>` → `{ keys: [...] }`
   - `PUT /api/storage` (body `{key, value}`) → `{ ok: true }`
   - `DELETE /api/storage?key=<key>` → `{ ok: true }`
2. **`public/index.html`** — ฟังก์ชัน `storeGet/storeSet/storeDelete/storeList` เปลี่ยนไปยิง `fetch()` ไปที่ `/api/storage` แทน `window.storage.*` โค้ดส่วนอื่นทั้งหมด (import, ออกบัตร QR, เช็คอิน, กล้อง) ไม่ได้ถูกแตะเลย
3. **`wrangler.toml`** — bind KV namespace `STORAGE_KV` แล้ว (namespace ที่สร้างไว้จริง: `ofas-meeting-checkin-storage`, id `437af7e4878a43de854931c99f435aac`) และผูก assets directory `./public` เข้ากับ Worker

รูปแบบข้อมูลยังเหมือนเดิม:
- คีย์ `roster` → เก็บ JSON array ของผู้ลงทะเบียนทั้งหมด
- คีย์ `checkin:<id>` → เก็บ timestamp ISO string ของแต่ละคนที่เช็คอินแล้ว
- คีย์ `event-name` → ชื่องาน

## Deploy บน Cloudflare

โปรเจกต์นี้ deploy ผ่าน Git integration ของ Cloudflare อยู่แล้ว (deploy command: `npx wrangler deploy`) ทุกครั้งที่ push เข้า branch ที่ผูกไว้ Cloudflare จะ build ใหม่อัตโนมัติ ไม่ต้องตั้งค่าเพิ่มสำหรับ KV binding เพราะกำหนดไว้ใน `wrangler.toml` แล้ว (`STORAGE_KV`)

ถ้าต้อง deploy มือจากเครื่อง (มี Wrangler login แล้ว):
```
npx wrangler deploy
```

**✅ ตั้งค่า token กันข้อมูลรั่วแล้ว** — `public/index.html` ฝัง `window.STORAGE_CLIENT_TOKEN` ไว้แล้ว ต้องตั้ง Secret ฝั่ง Cloudflare ให้ตรงกันด้วย (ทำครั้งเดียว ไม่ได้ทำอัตโนมัติจากโค้ด):

1. ไปที่ Worker `ofas-checkin` ใน Cloudflare dashboard > **Settings > Variables and Secrets**
2. Add > ชื่อ `STORAGE_TOKEN` ประเภท **Secret** > ใส่ค่าเดียวกับที่ฝังใน `public/index.html` (`window.STORAGE_CLIENT_TOKEN`)
3. Save และ deploy ใหม่ (หรือรอ deployment ถัดไปจาก Git)

ถ้าต้องเปลี่ยน token ในอนาคต ต้องแก้ทั้ง 2 ที่ให้ตรงกันเสมอ (Secret ฝั่ง Cloudflare + ค่าใน `public/index.html`) ไม่งั้น `/api/storage` จะตอบ 401 ทุก request ดูรายละเอียดข้อจำกัดของวิธีนี้ในหัวข้อ "ความปลอดภัยของข้อมูล" ด้านล่าง

## เลือกบางรายการในแท็บ "ออกบัตร QR"

แต่ละใบบัตรมี checkbox ให้ติ๊กเลือก และมีแถบเครื่องมือด้านบนแยกเป็น 3 กลุ่ม แต่ละกลุ่มมีตัวเลือก "เฉพาะที่เลือก" กับ "ทั้งหมด":

- **พิมพ์บัตร** — พิมพ์เฉพาะที่ติ๊กไว้ หรือพิมพ์ทั้งหมด
- **ส่งอีเมล QR** — ส่งอีเมลแนบรูป QR ให้เฉพาะรายการที่ติ๊กไว้และมีอีเมล (ข้ามคนที่ไม่มีอีเมลอัตโนมัติ)
- **ลบข้อมูล** — ลบเฉพาะรายการที่ติ๊กไว้ (รวมสถานะเช็คอินของคนนั้น) หรือลบทั้งหมด

### ตั้งค่าการส่งอีเมล QR (Resend)

Cloudflare Workers เองส่งอีเมลไม่ได้ ฟีเจอร์นี้พึ่งบริการภายนอก [Resend](https://resend.com) (มี free tier) ผ่าน `src/email-api.js`:

1. สมัครบัญชีที่ resend.com แล้วสร้าง **API key**
2. Worker `ofas-checkin` → **Settings > Variables and Secrets** → Add secret ชื่อ `RESEND_API_KEY` = ค่า API key ที่ได้

⚠️ **ข้อจำกัดตอนยังไม่ verify โดเมน:** ถ้ายังไม่ได้เพิ่ม/verify โดเมนของหน่วยงาน (เช่น `ofas.go.th`) กับ Resend ระบบจะส่งจาก sender ทดสอบ `onboarding@resend.dev` ได้ และ **ส่งถึงได้แค่อีเมลที่ใช้สมัครบัญชี Resend เท่านั้น** — ส่งหาอีเมลผู้ลงทะเบียนคนอื่นจะ error ("You can only send testing emails to your own email address") จนกว่าจะ verify โดเมนตัวเอง

เมื่อพร้อมใช้งานจริง (verify โดเมนแล้ว):
1. Resend dashboard → Domains → Add Domain → เพิ่ม DNS record (TXT/MX) ตามที่ Resend กำหนดในโดเมนของหน่วยงาน แล้วรอ verify
2. ตั้ง Secret เพิ่มอีกตัวชื่อ `EMAIL_FROM` เป็นอีเมลที่ verify แล้ว เช่น `checkin@ofas.go.th` (ถ้าไม่ตั้งไว้ ระบบจะ fallback ไปใช้ `onboarding@resend.dev` เสมอ)

`/api/send-email` ใช้ token ยืนยันตัวตนตัวเดียวกับ `/api/storage` (`STORAGE_TOKEN`) อยู่แล้ว ไม่ต้องตั้งเพิ่ม

## ความปลอดภัยของข้อมูล

ข้อมูลผู้ลงทะเบียนมีชื่อ/อีเมล/เบอร์โทร/ตำแหน่ง เป็นข้อมูลส่วนตัวจริง `src/storage-api.js` รองรับการยืนยันตัวตนแบบง่ายด้วย static token:

- ถ้าตั้งค่า environment variable `STORAGE_TOKEN` ไว้ที่โปรเจกต์ ทุก request ไปยัง `/api/storage` ต้องแนบ header `X-Storage-Token` ให้ตรงกัน ไม่งั้นได้ 401
- ถ้าไม่ตั้งค่าไว้เลย endpoint จะเปิดสาธารณะ (**ใช้ได้เฉพาะตอนพัฒนา/ทดสอบเท่านั้น**)

⚠️ ข้อควรระวัง: token แบบนี้จะถูกฝังอยู่ในโค้ดฝั่งไคลเอนต์ (`window.STORAGE_CLIENT_TOKEN`) ใครก็เปิด view-source ดูได้ จึงเป็นเพียงตัวกันการเข้าถึงแบบสุ่ม/บอทสแกนเบื้องต้น ไม่ใช่ระบบ auth ที่ปลอดภัยจริง ถ้าต้องการความปลอดภัยที่มากขึ้นสำหรับข้อมูลจริง แนะนำเพิ่ม Cloudflare Access (Zero Trust) หน้าโดเมนทั้งหมด หรือทำระบบ login ผู้ดูแลงานจริงในอนาคต

## สิ่งที่ทำงานสมบูรณ์แล้ว ไม่ต้องแตะ

- นำเข้า CSV + จับคู่คอลัมน์อัตโนมัติ + กันข้อมูลซ้ำด้วยอีเมล
- ออกบัตร QR แบบพิมพ์ได้ (คำนำหน้าชื่อ, ชื่อ-นามสกุล, ตำแหน่ง, สังกัด/หน่วยงาน, รหัส QR) พร้อมปุ่มแชร์/ดาวน์โหลดรูป QR ต่อคน
- เช็คอิน: กล้อง (ใช้งานได้เต็มรูปแบบหลัง deploy จริง), ค้นหาด้วยมือ, สแกนจากไฟล์รูป
- สถิติทั้งหมด/เช็คอินแล้ว/คงเหลือ, log เช็คอินล่าสุด, ส่งออกรายงานเช็คอินเป็น CSV, รีเซ็ตข้อมูล
