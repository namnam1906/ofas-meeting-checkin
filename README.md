# ระบบลงทะเบียนหน้างาน + เช็คอินด้วย QR

แอปเดียวจบ (`index.html`) — นำเข้ารายชื่อจาก Google Form/Sheet (CSV), ออกบัตร QR ต่อคน, เช็คอินหน้างานด้วยกล้อง/ค้นหาด้วยมือ/สแกนจากไฟล์รูป

เดิมรันอยู่ใน Claude Artifacts (มีข้อจำกัดเรื่องกล้องเพราะ iframe sandbox ไม่ได้รับสิทธิ์ camera) ตอนนี้ย้ายมา deploy เป็นเว็บจริงบน Cloudflare Pages แล้ว — พอไม่ได้รันใน iframe ของ Claude แล้ว กล้องสแกน QR สดใช้งานได้ปกติทันที

## ✅ สถานะ storage layer — สลับมาเป็น Cloudflare Pages Functions + KV แล้ว

โค้ดเดิมเก็บข้อมูลผ่าน `window.storage` ซึ่งเป็น API เฉพาะของ Claude Artifacts เท่านั้น ตอนนี้แก้แล้วเป็น:

1. **`functions/api/storage.js`** — Cloudflare Pages Function ที่เป็น REST endpoint บางๆ ครอบ Cloudflare KV binding (`STORAGE_KV`)
   - `GET /api/storage?key=<key>` → `{ value }`
   - `GET /api/storage?prefix=<prefix>` → `{ keys: [...] }`
   - `PUT /api/storage` (body `{key, value}`) → `{ ok: true }`
   - `DELETE /api/storage?key=<key>` → `{ ok: true }`
2. **`index.html`** — ฟังก์ชัน `storeGet/storeSet/storeDelete/storeList` เปลี่ยนไปยิง `fetch()` ไปที่ `/api/storage` แทน `window.storage.*` โค้ดส่วนอื่นทั้งหมด (import, ออกบัตร QR, เช็คอิน, กล้อง) ไม่ได้ถูกแตะเลย
3. **`wrangler.toml`** — bind KV namespace `STORAGE_KV` แล้ว (namespace ที่สร้างไว้จริง: `ofas-meeting-checkin-storage`, id `437af7e4878a43de854931c99f435aac`)

รูปแบบข้อมูลยังเหมือนเดิม:
- คีย์ `roster` → เก็บ JSON array ของผู้ลงทะเบียนทั้งหมด
- คีย์ `checkin:<id>` → เก็บ timestamp ISO string ของแต่ละคนที่เช็คอินแล้ว
- คีย์ `event-name` → ชื่องาน

## Deploy บน Cloudflare Pages

ไม่มี build step (เป็น static HTML/JS ล้วน ใช้ CDN สำหรับ PapaParse / qrcodejs / html5-qrcode) ตั้งค่าใน Cloudflare Pages dashboard ดังนี้:

1. **Pages > Create a project > Connect to Git** แล้วเลือก repo นี้ (`namnam1906/ofas-meeting-checkin`) branch ที่ต้องการ deploy
2. **Build settings**
   - Build command: ว่างไว้ (ไม่ต้อง build)
   - Build output directory: `/` (root ของ repo)
3. **Bind KV namespace** — ไปที่ Settings > Functions > KV namespace bindings ของ Pages project แล้วเพิ่ม:
   - Variable name: `STORAGE_KV`
   - KV namespace: `ofas-meeting-checkin-storage` (id `437af7e4878a43de854931c99f435aac` — สร้างไว้แล้วในบัญชี Cloudflare นี้)

   > `wrangler.toml` ในโปรเจกต์นี้ผูก binding เดียวกันไว้แล้ว ถ้า deploy ผ่าน Wrangler CLI (`wrangler pages deploy .`) แทน Git integration ก็จะได้ binding นี้อัตโนมัติโดยไม่ต้องตั้งในหน้าเว็บ
4. **(แนะนำ) ตั้งค่า token กันข้อมูลรั่ว** — ไปที่ Settings > Environment variables เพิ่ม secret ชื่อ `STORAGE_TOKEN` เป็นค่าสุ่มยาวๆ ที่ตั้งเอง แล้วเปิด `index.html` เพิ่มบรรทัด (ก่อน `<script>` ปิดใน `<head>` หรือก่อนสคริปต์หลัก):
   ```html
   <script>window.STORAGE_CLIENT_TOKEN = 'ค่าเดียวกับ STORAGE_TOKEN';</script>
   ```
   ดูรายละเอียดข้อจำกัดของวิธีนี้ในหัวข้อ "ความปลอดภัยของข้อมูล" ด้านล่าง

หลัง deploy ครั้งแรก Cloudflare Pages จะ build ใหม่อัตโนมัติทุกครั้งที่ push เข้า branch ที่ผูกไว้

## ความปลอดภัยของข้อมูล

ข้อมูลผู้ลงทะเบียนมีชื่อ/อีเมล/เบอร์โทร/ตำแหน่ง เป็นข้อมูลส่วนตัวจริง `functions/api/storage.js` รองรับการยืนยันตัวตนแบบง่ายด้วย static token:

- ถ้าตั้งค่า environment variable `STORAGE_TOKEN` ไว้ที่ Pages project ทุก request ไปยัง `/api/storage` ต้องแนบ header `X-Storage-Token` ให้ตรงกัน ไม่งั้นได้ 401
- ถ้าไม่ตั้งค่าไว้เลย endpoint จะเปิดสาธารณะ (**ใช้ได้เฉพาะตอนพัฒนา/ทดสอบเท่านั้น**)

⚠️ ข้อควรระวัง: token แบบนี้จะถูกฝังอยู่ในโค้ดฝั่งไคลเอนต์ (`window.STORAGE_CLIENT_TOKEN`) ใครก็เปิด view-source ดูได้ จึงเป็นเพียงตัวกันการเข้าถึงแบบสุ่ม/บอทสแกนเบื้องต้น ไม่ใช่ระบบ auth ที่ปลอดภัยจริง ถ้าต้องการความปลอดภัยที่มากขึ้นสำหรับข้อมูลจริง แนะนำเพิ่ม Cloudflare Access (Zero Trust) หน้าโดเมนทั้งหมด หรือทำระบบ login ผู้ดูแลงานจริงในอนาคต

## สิ่งที่ทำงานสมบูรณ์แล้ว ไม่ต้องแตะ

- นำเข้า CSV + จับคู่คอลัมน์อัตโนมัติ + กันข้อมูลซ้ำด้วยอีเมล
- ออกบัตร QR แบบพิมพ์ได้ (คำนำหน้าชื่อ, ชื่อ-นามสกุล, ตำแหน่ง, สังกัด/หน่วยงาน, รหัส QR) พร้อมปุ่มแชร์/ดาวน์โหลดรูป QR ต่อคน
- เช็คอิน: กล้อง (ใช้งานได้เต็มรูปแบบหลัง deploy จริง), ค้นหาด้วยมือ, สแกนจากไฟล์รูป
- สถิติทั้งหมด/เช็คอินแล้ว/คงเหลือ, log เช็คอินล่าสุด, ส่งออกรายงานเช็คอินเป็น CSV, รีเซ็ตข้อมูล
