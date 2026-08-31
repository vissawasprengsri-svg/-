# บทบาท
คุณคือ Senior Full-Stack Engineer ที่เชี่ยวชาญแอปการเงินส่วนบุคคล (fintech)
งานของคุณคือ refactor และขยายระบบบันทึกรายรับ-รายจ่ายที่แนบมา ให้กลายเป็น
production-grade app ที่ใช้ได้ในระดับสากล

# บริบทระบบเดิม
ระบบมีอยู่แล้ว:
- ประเภทรายการ: personal_expense, income, pending_claim, investment,
  debt_payment, loan_given
- ระบบเบิกเงิน 4 สถานะ: awaiting_bill → pending → claimed → received
- หมวดหมู่ตั้งสถานะได้ (รอเบิก/รอบิล) แล้วนับเป็นเงินรอเบิกอัตโนมัติ
- ช่องทางจ่าย: เงินสด/โอน, บัญชีธนาคาร, บัตรเครดิต (คำนวณยอดคงเหลืออัตโนมัติ)
- AI จัดหมวดหมู่จากข้อความผ่าน Anthropic API

# สิ่งที่ต้องทำ (เรียงตามลำดับความสำคัญ)

## PHASE 1 — ความปลอดภัยของข้อมูล (ทำก่อน ห้ามข้าม)

1. **Soft Delete + Undo**
   - เพิ่มฟิลด์ `deleted_at`, `deleted_by` แทนการ DELETE จริง
   - ทุก query ต้องกรอง `deleted_at IS NULL` โดยอัตโนมัติ
   - แสดง Snackbar/Toast "ลบแล้ว — [เลิกทำ]" ค้างไว้ 7 วินาที
   - เมื่อกดเลิกทำ ต้อง rollback ยอดบัตรเครดิต/ยอดคงเหลือกลับไปด้วย
   - มีหน้า "ถังขยะ" ให้กู้คืนย้อนหลังได้ 30 วัน

2. **Undo/Redo Stack ระดับแอป**
   - เก็บ command history แบบ Command Pattern (undo ได้อย่างน้อย 20 ขั้น)
   - รองรับทั้ง สร้าง / แก้ไข / ลบ / เปลี่ยนสถานะการเบิก
   - ผูกคีย์ลัด Ctrl+Z / Cmd+Z บนเว็บ และ shake-to-undo บนมือถือ

3. **Audit Log**
   - ตาราง `audit_logs`: entity_type, entity_id, action, before_json,
     after_json, actor_id, created_at
   - บันทึกทุกการเปลี่ยนแปลงที่กระทบยอดเงิน
   - มีหน้าดูประวัติรายรายการ ("รายการนี้ถูกแก้ไข 3 ครั้ง")

4. **Idempotency**
   - ทุก mutation รับ `idempotency_key` (UUID จาก client)
   - กันรายการซ้ำจากการกดรัวหรือ retry

## PHASE 2 — ระบบแจ้งเตือน

5. **Notification Engine**
   ต้องรองรับ trigger เหล่านี้เป็นอย่างน้อย:
   - เงินรอเบิกค้างเกิน X วัน (ตั้งค่าได้ ค่าเริ่มต้น 14 วัน)
   - บิลบัตรเครดิตใกล้ครบกำหนดชำระ (เตือนล่วงหน้า 7/3/1 วัน)
   - ใช้จ่ายเกินงบหมวดหมู่ (แจ้งที่ 80% และ 100%)
   - ยอดบัตรเครดิตใกล้เต็มวงเงิน (85%)
   - รายการที่ให้ยืม (loan_given) ยังไม่ได้คืนเกินกำหนด
   - เตือนบันทึกรายจ่ายประจำวัน (ตั้งเวลาได้)

6. **โครงสร้าง Notification**
   - ตาราง `notifications`: type, severity, title, body, deep_link,
     read_at, dismissed_at, scheduled_at
   - ช่องทาง: In-app center (มี badge), Push (FCM/APNs), Email (สรุปรายสัปดาห์)
   - หน้าตั้งค่า: เปิด/ปิดรายชนิด + Quiet hours + ความถี่
   - รวมกลุ่มแจ้งเตือน (digest) กันสแปม

## PHASE 3 — ทำให้เป็นสากล

7. **Multi-currency**
   - เก็บเงินเป็น integer หน่วยย่อยที่สุด (minor units) ห้ามใช้ float เด็ดขาด
   - ทุกรายการมี `currency_code` (ISO 4217) + `exchange_rate` + `base_amount`
   - ล็อกอัตราแลกเปลี่ยน ณ วันที่ทำรายการ ไม่คำนวณใหม่ย้อนหลัง
   - รองรับสกุลเงินที่มีทศนิยม 0 ตำแหน่ง (JPY) และ 3 ตำแหน่ง (KWD)

8. **i18n / l10n**
   - แยกข้อความทั้งหมดออกเป็นไฟล์แปล (i18n keys) เริ่มที่ th + en
   - ฟอร์แมตวันที่/ตัวเลข/สกุลเงินตาม locale (ใช้ Intl API)
   - รองรับ timezone ต่อผู้ใช้ เก็บ timestamp เป็น UTC เสมอ
   - เตรียมโครงสร้างรองรับ RTL

## PHASE 4 — ฟีเจอร์ที่แอปการเงินระดับสากลต้องมี

9. **งบประมาณ (Budget)** — ตั้งงบรายหมวด/รายเดือน + progress bar + rollover
10. **รายการประจำ (Recurring)** — สร้างอัตโนมัติตามรอบ รายวัน/สัปดาห์/เดือน/ปี
11. **แนบไฟล์ใบเสร็จ** — อัปโหลดรูป + OCR ดึงยอดเงินและวันที่อัตโนมัติ
12. **รายงาน & กราฟ** — สรุปรายเดือน, เทรนด์, breakdown ตามหมวด, cash flow
13. **Export / Import** — CSV, Excel, PDF และ import จาก statement ธนาคาร
14. **ค้นหา & กรอง** — full-text search + filter ผสม (ช่วงวันที่, หมวด, จำนวนเงิน, สถานะ)
15. **Offline-first** — เขียนลง local DB ก่อน แล้ว sync ทีหลัง พร้อม conflict resolution
16. **Security** — เข้ารหัสข้อมูลที่เก็บ, ล็อกด้วย PIN/Biometric, auto-lock เมื่อพักหน้าจอ
17. **Backup & Restore** — สำรองอัตโนมัติ + กู้คืนจากไฟล์
18. **Accessibility** — รองรับ screen reader, contrast ratio ≥ 4.5:1, touch target ≥ 44px

## PHASE 5 — ปรับปรุงส่วน AI

19. **AI Fallback Chain**
    - ถ้า Anthropic API ล้มเหลว → ใช้ rule-based keyword matching
    - ถ้ายังไม่ได้ → ใช้หมวดหมู่ที่ผู้ใช้เคยเลือกกับ merchant เดิม
    - Cache ผลลัพธ์ต่อ merchant กัน API call ซ้ำ
    - ห้ามให้ AI ล่มแล้วบันทึกรายการไม่ได้ — ต้องบันทึกได้เสมอ

20. **AI เพิ่มเติม**
    - ตรวจจับรายการผิดปกติ (anomaly detection)
    - แนะนำงบประมาณจากพฤติกรรมย้อนหลัง
    - สรุปการใช้จ่ายรายเดือนเป็นภาษาธรรมชาติ

# ข้อกำหนดทางเทคนิค

- **ห้ามใช้ float กับจำนวนเงินเด็ดขาด** ใช้ integer minor units หรือ Decimal
- ทุกการเปลี่ยนแปลงที่กระทบยอดเงินต้องอยู่ใน database transaction
- แยก business logic ออกจาก UI ให้ชัดเจน (service layer)
- เขียน unit test ครอบคลุมส่วนคำนวณยอดเงินทุกเคส
- ทุก API ต้องมี error handling ที่คืน error code ชัดเจน ไม่ใช่ throw ดิบ
- Migration script ต้องรองรับข้อมูลเดิมที่มีอยู่แล้ว ห้ามทำข้อมูลหาย

# รูปแบบผลลัพธ์ที่ต้องการ

ตอบเป็นลำดับดังนี้:
1. **สรุปสถาปัตยกรรมใหม่** — diagram แบบข้อความ + layer แต่ละชั้นทำอะไร
2. **Database schema ฉบับเต็ม** — ทุกตาราง ทุกฟิลด์ พร้อม index และ constraint
3. **Migration plan** — ขั้นตอนย้ายจาก schema เดิมไปใหม่ทีละ step
4. **โค้ดจริง** — เขียนทีละโมดูล แยกไฟล์ชัดเจน พร้อมคอมเมนต์ภาษาไทย
5. **Test cases** — เคสสำคัญที่ต้องผ่านโดยเฉพาะส่วนคำนวณเงิน
6. **Checklist ก่อน deploy**

เริ่มจาก PHASE 1 ก่อน ทำให้เสร็จสมบูรณ์แล้วค่อยถามฉันว่าจะไปต่อ PHASE ถัดไปไหม
ห้ามเขียนโค้ดทุก phase รวดเดียวจนยาวเกินไป