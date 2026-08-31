-- ตัวอย่างขั้นตอนแปลงจำนวนเงินให้ปลอดภัย
-- 1) เพิ่มคอลัมน์ใหม่ก่อน ยังไม่ลบของเดิม
ALTER TABLE transactions_old ADD COLUMN amount_minor BIGINT;
-- 2) แปลงด้วย ROUND กัน floating point error
UPDATE transactions_old SET amount_minor = ROUND(amount * 100)::BIGINT;
-- 3) ตรวจสอบว่าไม่มีข้อมูลเพี้ยน
SELECT COUNT(*) FROM transactions_old
WHERE ABS(amount_minor / 100.0 - amount) > 0.001;   -- ต้องได้ 0
-- 4) ผ่านแล้วค่อย migrate เข้าตารางใหม่