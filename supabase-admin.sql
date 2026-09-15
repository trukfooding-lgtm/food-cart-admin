-- โครงสร้างฐานข้อมูล Admin สำหรับฟังก์ชันผู้ใช้งาน รายงาน และการแจ้งเตือน
-- ไม่เก็บรหัสผ่าน และไม่สร้างตาราง Payment Gateway / transactions / refunds

create table if not exists public.admin_workspaces (
  user_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  admin_id text primary key,
  email text not null unique,
  display_name text not null default 'ผู้ดูแลระบบ',
  role text not null default 'viewer' check (role in ('viewer', 'reviewer', 'user_manager', 'super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  user_id text primary key,
  display_name text not null,
  email text,
  role text not null check (role in ('Customer', 'Shop')),
  status text not null default 'ใช้งานปกติ' check (status in ('ใช้งานปกติ', 'ระงับบัญชี')),
  status_reason text,
  status_changed_by text,
  status_changed_at timestamptz,
  shop_name text,
  phone text,
  category text,
  line_id text,
  facebook_url text,
  latitude numeric,
  longitude numeric,
  joined_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_orders (
  order_id text primary key,
  customer_id text,
  merchant_id text,
  total_amount numeric(12,2),
  status text,
  created_at timestamptz,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  report_id text primary key,
  title text not null,
  reporter_id text,
  reporter_type text not null check (reporter_type in ('Customer', 'Shop')),
  reporter_name text,
  shop_name text,
  issue_type text not null,
  order_id text,
  status text not null default 'รอตรวจสอบ' check (status in ('รอตรวจสอบ', 'กำลังตรวจสอบ', 'ดำเนินการแล้ว', 'ปิดเรื่อง')),
  priority text not null default 'ปกติ' check (priority in ('สูงสุด', 'สูง', 'ปกติ', 'ต่ำ')),
  note text not null default '',
  evidence_count integer not null default 0 check (evidence_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  notification_id text primary key,
  recipient_id text,
  source_type text,
  source_id text,
  title text not null,
  body text not null,
  priority text not null default 'ปกติ' check (priority in ('สูงสุด', 'สูง', 'ปกติ', 'ต่ำ')),
  is_read boolean not null default false,
  delivery_status text not null default 'รอส่ง',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_actions (
  action_id text primary key,
  admin_id text not null,
  action_type text not null,
  target_type text not null,
  target_id text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists admin_workspaces_updated_at_idx on public.admin_workspaces (updated_at desc);
create index if not exists app_users_role_status_idx on public.app_users (role, status);
create index if not exists app_orders_customer_idx on public.app_orders (customer_id);
create index if not exists app_orders_merchant_idx on public.app_orders (merchant_id);
create index if not exists reports_status_priority_idx on public.reports (status, priority, created_at desc);
create index if not exists reports_order_idx on public.reports (order_id);
create index if not exists notifications_unread_idx on public.notifications (is_read, created_at desc);
create index if not exists admin_actions_target_idx on public.admin_actions (target_type, target_id, created_at desc);
create index if not exists integration_events_received_idx on public.integration_events (received_at desc);

-- หน้าเว็บไม่ต่อ Supabase โดยตรง จึงเปิด RLS และไม่มีนโยบายสำหรับ anon
-- เฉพาะเซิร์ฟเวอร์ Admin ที่เชื่อมต่อด้วย DATABASE_URL จึงอ่าน/เขียนได้
alter table public.admin_workspaces enable row level security;
alter table public.admin_roles enable row level security;
alter table public.app_users enable row level security;
alter table public.app_orders enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_actions enable row level security;
alter table public.integration_events enable row level security;
