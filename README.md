# Foot cart Admin (standalone)

เว็บ Admin แบบอิสระสำหรับนำไปโฮสต์บน Render โดยใช้ Supabase PostgreSQL เป็นพื้นที่เก็บข้อมูลของ Admin เอง

## ตั้งค่าใน Render

สร้าง Web Service จากโฟลเดอร์นี้ แล้วตั้งค่า:

- Build Command: `npm install`
- Start Command: `npm start`
- Auto-Deploy: `On Commit`

เพิ่ม Environment Variables ใน Render (อย่าใส่ในโค้ดหรือแชต):

```text
DATABASE_URL=ลิงก์เชื่อมต่อ PostgreSQL ของ Supabase
ADMIN_EMAIL=อีเมลผู้ดูแล
ADMIN_PASSWORD=รหัสผ่านผู้ดูแล
SESSION_SECRET=ข้อความสุ่มยาวอย่างน้อย 32 ตัวอักษร
ADMIN_NAME=ผู้ดูแลระบบ
ADMIN_PASSWORD_HASH=แฮชรหัสผ่าน (ใช้แทน ADMIN_PASSWORD ได้)
SUPABASE_URL=URL ของโปรเจกต์ Supabase Admin
SUPABASE_PUBLISHABLE_KEY=Publishable key ของโปรเจกต์ Supabase Admin
FOOD_CART_WEBHOOK_SECRET=ข้อความลับสำหรับตรวจสอบ Webhook จากแอปหลัก
FOOD_CART_APP_DATABASE_URL=ลิงก์เชื่อมต่อ PostgreSQL ของฐานข้อมูลแอปหลัก
```

`DATABASE_URL` ใช้เฉพาะฝั่งเซิร์ฟเวอร์ ไม่ถูกส่งไปยังเบราว์เซอร์
`FOOD_CART_APP_DATABASE_URL` ใช้เฉพาะตอนบันทึกสถานะรายงาน เพื่ออัปเดตสถานะต้นทางและเพิ่มแจ้งเตือนในฐานข้อมูลแอปหลัก โดยควรใช้ค่าเดียวกับ `DATABASE_URL` ของ Backend แอปหลัก

## ตรวจสอบการทำงาน

เปิด `/api/health` ต้องได้ JSON ที่มี `success: true` และ `database: true`

เว็บจะสร้างตารางตามฟังก์ชัน Admin อัตโนมัติเมื่อเริ่มทำงาน ได้แก่ `admin_roles`, `app_users`, `app_orders`, `reports`, `notifications`, `admin_actions` และ `integration_events`

ตาราง `admin_workspaces` ยังเก็บไว้เป็นข้อมูลเข้ากันได้กับรุ่นเดิม และจะย้ายข้อมูลตัวอย่างเดิมไปยังตารางแยกเมื่อเริ่มระบบครั้งแรก

ฟังก์ชันการชำระเงิน Payment Gateway และการคืนเงินถูกปิดไว้ชั่วคราว จึงไม่มีตาราง `transactions` หรือ `refunds`

ข้อมูลตัวอย่างจะถูกสร้างเมื่อฐานข้อมูลยังว่าง และการแก้ไขจะถูกบันทึกใน Supabase

ตาราง `admin_roles` ไม่เก็บรหัสผ่าน รองรับแอดมินที่ใช้งานได้ไม่เกิน 3 คน โดยผู้ดูแลเพิ่มเติมต้องสร้างบัญชีใน Supabase Auth แล้วเพิ่มอีเมลและสิทธิ์ใน `admin_roles`

## Webhook จากแอปหลัก

ส่ง `POST /api/integration/events` จากเซิร์ฟเวอร์ของแอปหลัก พร้อม Header `x-foodcart-signature` ซึ่งเป็น HMAC-SHA256 ของ body ด้วย `FOOD_CART_WEBHOOK_SECRET`

ถ้าไม่แก้ Backend แอปหลัก ให้ใช้ Supabase Database Webhook ส่งมายัง `POST /api/integration/supabase-webhook` พร้อม Header `x-foodcart-webhook-secret` ที่มีค่าเดียวกับ `FOOD_CART_WEBHOOK_SECRET` ใน Render ของ Admin โดยตรง รองรับตาราง `customer`, `merchant`, `orders`, `merchant_issue_reports`, `notifications` และ `merchant_notifications` รูปแบบข้อมูลมาตรฐานของ Supabase

ประเภทที่รองรับในระยะนี้: `user.upsert`, `order.upsert`, `report.created`, `report.updated`, `notification.created`
