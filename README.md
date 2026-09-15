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
FOOD_CART_WEBHOOK_SECRET=ข้อความลับสำหรับตรวจสอบ Webhook จากแอปหลัก
```

`DATABASE_URL` ใช้เฉพาะฝั่งเซิร์ฟเวอร์ ไม่ถูกส่งไปยังเบราว์เซอร์

## ตรวจสอบการทำงาน

เปิด `/api/health` ต้องได้ JSON ที่มี `success: true` และ `database: true`

เว็บจะสร้างตารางตามฟังก์ชัน Admin อัตโนมัติเมื่อเริ่มทำงาน ได้แก่ `admin_roles`, `app_users`, `app_orders`, `reports`, `notifications`, `admin_actions` และ `integration_events`

ตาราง `admin_workspaces` ยังเก็บไว้เป็นข้อมูลเข้ากันได้กับรุ่นเดิม และจะย้ายข้อมูลตัวอย่างเดิมไปยังตารางแยกเมื่อเริ่มระบบครั้งแรก

ฟังก์ชันการชำระเงิน Payment Gateway และการคืนเงินถูกปิดไว้ชั่วคราว จึงไม่มีตาราง `transactions` หรือ `refunds`

ข้อมูลตัวอย่างจะถูกสร้างเมื่อฐานข้อมูลยังว่าง และการแก้ไขจะถูกบันทึกใน Supabase

## Webhook จากแอปหลัก

ส่ง `POST /api/integration/events` จากเซิร์ฟเวอร์ของแอปหลัก พร้อม Header `x-foodcart-signature` ซึ่งเป็น HMAC-SHA256 ของ body ด้วย `FOOD_CART_WEBHOOK_SECRET`

ประเภทที่รองรับในระยะนี้: `user.upsert`, `order.upsert`, `report.created`, `report.updated`, `notification.created`
