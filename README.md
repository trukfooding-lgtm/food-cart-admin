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
```

`DATABASE_URL` ใช้เฉพาะฝั่งเซิร์ฟเวอร์ ไม่ถูกส่งไปยังเบราว์เซอร์

## ตรวจสอบการทำงาน

เปิด `/api/health` ต้องได้ JSON ที่มี `success: true` และ `database: true`

เว็บจะสร้างตาราง `admin_workspaces` อัตโนมัติเมื่อเริ่มทำงาน ตารางนี้เก็บข้อมูลตามขอบเขต Admin ได้แก่ ผู้ใช้งาน รายงาน คำสั่งซื้อ ธุรกรรม การคืนเงิน การแจ้งเตือน และประวัติการดำเนินการ

ข้อมูลตัวอย่างจะถูกสร้างเมื่อเข้าสู่ระบบครั้งแรก และการแก้ไขจะถูกบันทึกใน Supabase
