# Deploy Guide: Backend บน Render + Frontend บน Vercel

โปรเจกต์นี้เป็น monorepo (`apps/api` + `apps/web` + `packages/shared`) — แยก deploy backend กับ frontend คนละที่ได้ เพราะสื่อสารกันผ่าน HTTP/CORS ล้วนๆ (ไม่มีการฝัง hardcoded URL ระหว่างกัน)

## ภาพรวม

| ส่วน | ที่ไป | เหตุผล |
|---|---|---|
| Backend (Express + Postgres) | [Render](https://render.com) | มี Managed Postgres ฟรี + รัน long-running Node process ได้ (Vercel ทำไม่ได้ดีนักสำหรับ Express app ที่ต้องคง DB connection pool ไว้) |
| Frontend (Vite static build) | [Vercel](https://vercel.com) | เก่งเรื่อง static site + CDN ฟรี, deploy จาก Git อัตโนมัติ |

---

## ส่วนที่ 1: Backend บน Render

### 1.1 สร้าง Postgres Database

1. Render Dashboard → **New** → **PostgreSQL**
2. ตั้งชื่อ ปล่อย region/plan ตามต้องการ (Free tier ใช้ได้ แต่จะถูกลบข้อมูลถ้าไม่ได้ใช้งาน 90 วัน — เหมาะกับทดลองใช้ ไม่เหมาะกับข้อมูลจริงระยะยาว)
3. หลังสร้างเสร็จ คัดลอกค่า **Internal Database URL** ไว้ (จะเอาไปใส่เป็น `DATABASE_URL` ของ Web Service ในขั้นถัดไป — ใช้ Internal URL ไม่ใช่ External เพราะเร็วกว่าและไม่เสียค่า bandwidth ถ้า Web Service อยู่ region เดียวกัน)

### 1.2 สร้าง Web Service

1. Render Dashboard → **New** → **Web Service** → เชื่อม Git repo นี้
2. ตั้งค่า:
   - **Root Directory**: เว้นว่าง (repo เป็น monorepo ใช้ npm workspaces ต้อง build จาก root)
   - **Build Command**: `npm install && npm run build --workspace=packages/shared && npm run build --workspace=apps/api`
     (ทดสอบแล้วว่า **ต้องสั่ง build `packages/shared` เป็นขั้นแยกก่อนเสมอ** — `apps/api`/`apps/web` ใช้ shared ผ่านไฟล์ที่ build แล้วใน `packages/shared/dist`, ไม่ได้ compile จาก source ให้เองตอน build ของตัวเอง)
   - **Start Command**: `npm run start --workspace=apps/api`
3. **Environment Variables** (Render → service → Environment):

   ```
   NODE_ENV=production
   DATABASE_URL=<Internal Database URL จากขั้น 1.1>
   PORT=10000
   JWT_SECRET=<สุ่มด้วยคำสั่งด้านล่าง>
   COOKIE_SECURE=true
   CROSS_ORIGIN_COOKIES=true
   WEB_ORIGIN=https://your-app.vercel.app
   ```

   สุ่ม `JWT_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   **ห้ามตั้ง `ENABLE_DEV_AUTH_BYPASS` เด็ดขาด** — ถ้าตั้งเป็น `true` พร้อม `NODE_ENV=production` ตัวแอปจะปฏิเสธการ start ทันที (ป้องกันไว้แล้วใน `server.ts`) นี่คือพฤติกรรมที่ถูกต้อง ไม่ใช่บั๊ก

   `CROSS_ORIGIN_COOKIES=true` **จำเป็น** เพราะ frontend (Vercel) กับ backend (Render) อยู่คนละโดเมน — ถ้าลืมตั้งตัวนี้ ผู้ใช้จะ login ไม่ติดโดยไม่มี error ชัดเจน (คุกกี้เซสชันจะไม่ถูกส่งมาเพราะ browser บล็อกคุกกี้ `SameSite=Lax` บน cross-site request)

4. หลัง deploy สำเร็จ Render จะรัน migration อัตโนมัติตอน start (`runMigrations` ทำงานทุกครั้งที่ server บูต ข้ามรายการที่ apply ไปแล้ว) ไม่ต้องรันแยก
5. ทดสอบ: เปิด `https://your-api.onrender.com/health` ต้องเห็น `{"ok":true}`

### หมายเหตุ Free Tier

Render free tier จะ "หลับ" (spin down) หลังไม่มี request 15 นาที แล้ว request แรกถัดไปจะช้า (cold start ~30-60 วินาที) — ถ้ารับได้กับความหน่วงนี้ก็ใช้ต่อได้ฟรี ถ้าไม่รับได้ต้องอัปเป็น paid plan ($7/เดือนขึ้นไป)

---

## ส่วนที่ 2: Frontend บน Vercel

1. Vercel Dashboard → **Add New** → **Project** → เชื่อม Git repo เดียวกัน
2. ตั้งค่า (**อย่าตั้ง Root Directory เป็น `apps/web`** — ต้องปล่อยเป็น repo root เพราะ `npm install` ต้องเห็น workspaces ทั้งหมดถึงจะ link `@finance/shared` ให้ `apps/web` ได้ถูกต้อง):
   - **Root Directory**: เว้นว่าง (repo root)
   - **Framework Preset**: Other (ไม่ใช่ Vite — เพราะ build command ไม่ได้รันจากใน `apps/web` ตรงๆ)
   - **Build Command**: `npm run build --workspace=packages/shared && npm run build --workspace=apps/web`
   - **Output Directory**: `apps/web/dist`
   - **Install Command**: `npm install` (ค่า default — รันที่ root ติดตั้งทุก workspace)
3. **Environment Variables**:
   ```
   VITE_API_URL=https://your-api.onrender.com
   ```
   (ไม่ใส่ `/api` ต่อท้าย — โค้ดฝั่ง client เติมให้เองแล้ว)

4. Deploy แล้วเปิดเว็บ ลองล็อกอิน — ถ้าล็อกอินไม่ติดแบบเงียบๆ (ไม่มี error โชว์) ให้เช็คก่อนว่าตั้ง `CROSS_ORIGIN_COOKIES=true` ที่ฝั่ง Render แล้วหรือยัง (เป็นสาเหตุอันดับ 1 ของปัญหานี้ในการ deploy แบบแยกโดเมน)

### อัปเดต `WEB_ORIGIN` หลังรู้ URL จริงของ Vercel

Vercel จะให้ URL หลัง deploy ครั้งแรก (เช่น `my-app-abc123.vercel.app`) — กลับไปอัปเดต `WEB_ORIGIN` (หรือ `FRONTEND_URL`, ใช้ชื่อไหนก็ได้ — โค้ดรองรับทั้งคู่) ที่ Render ให้ตรงกับ URL จริง แล้ว restart service ฝั่ง Render

---

## ส่วนที่ 3: PWA icons (ทำก่อน deploy frontend)

`apps/web/public/` ต้องมีไฟล์ 2 อัน (ดู `apps/web/public/README.md` สำหรับรายละเอียด):
- `pwa-192x192.png`
- `pwa-512x512.png`

ถ้ายังไม่มี Vite build จะไม่ error แต่ manifest จะชี้ไปไฟล์ที่ไม่มีจริง — ไอคอนตอนติดตั้งแอปจะว่างเปล่า

---

## Checklist ก่อน deploy จริง

- [ ] `JWT_SECRET` สุ่มใหม่ ไม่ใช่ค่าใน `.env` เครื่อง dev
- [ ] `NODE_ENV=production` ตั้งไว้ที่ Render
- [ ] `ENABLE_DEV_AUTH_BYPASS` **ไม่ได้ตั้งค่าใดๆ เลย** ที่ Render (ไม่ใช่แค่ตั้งเป็น false — ไม่ตั้งเลยชัวร์สุด)
- [ ] `COOKIE_SECURE=true` และ `CROSS_ORIGIN_COOKIES=true` ที่ Render
- [ ] `WEB_ORIGIN` ที่ Render ตรงกับ URL จริงของ Vercel (ไม่มี trailing slash)
- [ ] `VITE_API_URL` ที่ Vercel ตรงกับ URL จริงของ Render (ไม่มี trailing slash, ไม่มี `/api`)
- [ ] มีไฟล์ไอคอน PWA 2 อันใน `apps/web/public/`
- [ ] ทดสอบ login จริงบน URL ที่ deploy แล้ว ไม่ใช่แค่ localhost
