import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {applyAction} from './public/operations.js';

const {Pool} = pg;
const app = express();
const port = Number(process.env.PORT || 10000);
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const sessionSecret = String(process.env.SESSION_SECRET || '');
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabasePublishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '');
const webhookSecret = String(process.env.FOOD_CART_WEBHOOK_SECRET || '');
const foodCartBackendUrl = String(process.env.FOOD_CART_BACKEND_URL || '').replace(/\/$/, '');
const foodCartAdminSecret = String(process.env.FOOD_CART_ADMIN_SECRET || '');
const adminId = `env:${email || 'administrator'}`;
const workspaceId = 'standalone-admin';
const pool = process.env.DATABASE_URL ? new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}}) : null;
let memory = {payload: normalizeSnapshot({}), revision: 0};

app.use(express.json({limit: '256kb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); }}));
app.use(cookieParser());
app.use(express.static('public', {extensions: ['html']}));

const json = (res, value, status = 200) => res.status(status).json(value);
const now = () => new Date().toISOString();
const text = (value, fallback = '') => String(value ?? fallback).trim();
const validText = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const safeDate = (value) => value ? new Date(value) : new Date();
const displayTime = (value) => safeDate(value).toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'});
const displayDate = (value) => safeDate(value).toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'});
const normalizeEvidenceUrls = (value) => {
  let values = value;
  if (typeof values === 'string') {
    const raw = values.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      values = [raw];
    }
  }
  if (!Array.isArray(values)) values = values == null ? [] : [values];
  return values
    .map((item) => text(item))
    .filter((url) => /^(https?:\/\/|\/)/i.test(url));
};
const sign = (value, secret = sessionSecret || 'development-only-secret') => crypto.createHmac('sha256', secret).update(value).digest('base64url');
const issueSession = (loginEmail = email) => {
  const exp = Date.now() + 8 * 60 * 60 * 1000;
  const body = `${loginEmail}|${exp}`;
  return `${body}.${sign(body)}`;
};

async function syncAccountStatus(action, admin, eventId) {
  if (!foodCartBackendUrl || !foodCartAdminSecret) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ Backend สำหรับสถานะบัญชี');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${foodCartBackendUrl}/api/internal/account-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-foodcart-admin-secret': foodCartAdminSecret
      },
      body: JSON.stringify({
        event_id: eventId,
        user_id: action.id,
        role: action.role,
        status: action.status,
        reason: action.reason.trim(),
        changed_by: admin.name
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true) throw new Error(payload.message || 'Backend ไม่สามารถบันทึกสถานะบัญชีได้');
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Backend ไม่ตอบสนองภายในเวลาที่กำหนด');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function findAdmin(loginEmail) {
  const normalized = text(loginEmail).toLowerCase();
  if (!normalized) return null;
  if (pool) {
    const result = await pool.query(`SELECT admin_id,email,display_name,role,status
      FROM public.admin_roles WHERE lower(email)=lower($1) AND status='active' LIMIT 1`, [normalized]);
    if (result.rows[0]) return result.rows[0];
  }
  if (normalized === email) return {admin_id: adminId, email, display_name: process.env.ADMIN_NAME || 'ผู้ดูแลระบบ', role: 'super_admin', status: 'active'};
  return null;
}

async function validSession(req) {
  const token = req.cookies.admin_session || '';
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const [tokenEmail, expiry] = body.split('|');
  if (!tokenEmail || Number(expiry) <= Date.now()) return null;
  return findAdmin(tokenEmail);
}

async function requireAdmin(req, res, next) {
  if (!sessionSecret || (!email && !(supabaseUrl && supabasePublishableKey))) return json(res, {error: 'ยังไม่ได้ตั้งค่าบัญชีผู้ดูแลใน Render'}, 503);
  try {
    const admin = await validSession(req);
    if (!admin) return json(res, {error: 'กรุณาเข้าสู่ระบบ'}, 401);
    req.admin = {id: admin.admin_id, email: admin.email, name: admin.display_name || 'ผู้ดูแลระบบ', role: admin.role || 'viewer'};
    next();
  } catch {
    return json(res, {error: 'ไม่สามารถตรวจสอบสิทธิ์ได้'}, 503);
  }
}

const can = (admin, permission) => admin?.role === 'super_admin' || (permission === 'reports' && admin?.role === 'reviewer') || (permission === 'users' && admin?.role === 'user_manager');

function requireWebhook(req, res, next) {
  if (!webhookSecret) return json(res, {error: 'ยังไม่ได้ตั้งค่า FOOD_CART_WEBHOOK_SECRET'}, 503);
  const directSecret = String(req.get('x-foodcart-webhook-secret') || '').trim();
  if (directSecret && directSecret === webhookSecret) return next();
  const received = String(req.get('x-foodcart-signature') || '');
  const expected = sign(req.rawBody || Buffer.from(''), webhookSecret);
  if (!received || received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return json(res, {error: 'ลายเซ็น Webhook ไม่ถูกต้อง'}, 401);
  next();
}

function normalizeSupabaseWebhook(payload) {
  const table = text(payload?.table).toLowerCase();
  const operation = text(payload?.type).toUpperCase();
  const row = payload?.record && typeof payload.record === 'object' ? payload.record : {};
  const id = text(row.id || row.customer_id || row.user_id || row.order_id || row.notification_id);
  if (text(payload?.schema, 'public') !== 'public' || !id) return null;
  const updatedAt = text(row.updated_at || row.created_at || new Date().toISOString());
  const eventId = `supabase:${table}:${operation}:${id}:${updatedAt}`;
  if (table === 'customer') {
    const userId = `customer:${row.customer_id || id}`;
    if (operation === 'DELETE') return {event_id: eventId, event_type: 'user.delete', data: {user_id: userId, role: 'Customer', source_updated_at: updatedAt}};
    return {event_id: eventId, event_type: 'user.upsert', data: {
      user_id: userId, display_name: row.name_surname, email: row.email,
      role: 'Customer', phone: row.phone, source_updated_at: updatedAt
    }};
  }
  if (table === 'merchant') {
    const userId = `merchant:${row.id || id}`;
    if (operation === 'DELETE') return {event_id: eventId, event_type: 'user.delete', data: {user_id: userId, role: 'Shop', source_updated_at: updatedAt}};
    return {event_id: eventId, event_type: 'user.upsert', data: {
      user_id: userId, display_name: row.name, email: row.email, role: 'Shop',
      shop_name: row.name, phone: row.store_phone, category: row.type, line_id: row.line_id,
      facebook_url: row.facebook_url, source_updated_at: updatedAt
    }};
  }
  if (table === 'orders') return {event_id: eventId, event_type: 'order.upsert', data: {
    order_id: row.id || id, customer_id: row.customer_id, merchant_id: row.merchant_id,
    total_amount: row.total_price, status: row.status, created_at: row.created_at,
    source_updated_at: updatedAt
  }};
  if (table === 'merchant_issue_reports') return {event_id: eventId, event_type: operation === 'INSERT' ? 'report.created' : 'report.updated', data: {
    report_id: row.id || id, title: row.issue_type, reporter_id: row.merchant_id == null ? null : `merchant:${row.merchant_id}`,
    reporter_name: row.reporter_name || row.merchant_name || row.shop_name,
    shop_name: row.shop_name || row.merchant_name,
    reporter_type: 'Shop', issue_type: row.issue_type, order_id: row.order_reference,
    note: row.details, status: row.status, created_at: row.created_at, source_updated_at: updatedAt,
    evidence_urls: normalizeEvidenceUrls(row.image_url),
    evidence_count: normalizeEvidenceUrls(row.image_url).length
  }};
  if (table === 'app_issue_reports') return {event_id: eventId, event_type: operation === 'INSERT' ? 'report.created' : 'report.updated', data: {
    report_id: row.id || id,
    title: row.issue_type,
    reporter_id: row.sender_type === 'MERCHANT'
      ? (row.merchant_id == null ? null : `merchant:${row.merchant_id}`)
      : (row.customer_id == null ? null : `customer:${row.customer_id}`),
    reporter_name: row.reporter_name || row.customer_name || row.merchant_name,
    shop_name: row.shop_name || row.merchant_name,
    reporter_type: String(row.sender_type || '').toUpperCase() === 'MERCHANT' ? 'Shop' : 'Customer',
    issue_type: row.issue_type, order_id: row.order_reference,
    note: row.details, status: row.status, created_at: row.created_at, source_updated_at: updatedAt,
    evidence_urls: normalizeEvidenceUrls(row.image_url),
    evidence_count: normalizeEvidenceUrls(row.image_url).length
  }};
  if (table === 'notifications' || table === 'merchant_notifications') return {event_id: eventId, event_type: 'notification.created', data: {
    notification_id: row.id || id, recipient_id: row.user_id || row.customer_id || row.merchant_id,
    source_type: row.source_type || 'order', source_id: row.source_id || row.order_id,
    title: row.title, body: row.body || row.message, created_at: row.created_at
  }};
  return null;
}

function normalizeSnapshot(input) {
  return {
    users: Array.isArray(input?.users) ? input.users : [],
    reports: Array.isArray(input?.reports) ? input.reports : [],
    notifications: (Array.isArray(input?.notifications) ? input.notifications : []).filter((notification) => !/(refund|payment gateway|ธุรกรรม|คืนเงิน)/i.test(`${notification?.title || ''} ${notification?.body || ''}`)),
    history: Array.isArray(input?.history) ? input.history : [],
    // Payment Gateway / transaction / refund UI ถูกปิดไว้ชั่วคราวตามขอบเขตที่อนุมัติ
    transactions: []
  };
}

function mapUser(row) {
  return {
    id: row.user_id,
    name: row.display_name,
    email: row.email || '',
    role: row.role,
    status: row.status,
    reason: row.status_reason || '',
    joined: row.joined_at ? displayDate(row.joined_at) : '',
    shop: row.shop_name || '—',
    phone: row.phone || '',
    category: row.category || '',
    lineId: row.line_id || '',
    facebook: row.facebook_url || '',
    lat: row.latitude == null ? '' : String(row.latitude),
    lng: row.longitude == null ? '' : String(row.longitude)
  };
}

function mapReport(row) {
  return {
    id: row.report_id,
    name: row.title,
    person: row.reporter_name || '',
    shop: row.shop_name || '',
    reporterType: row.reporter_type,
    type: row.issue_type,
    orderId: row.order_id || '',
    status: row.status,
    priority: row.priority,
    time: displayTime(row.created_at),
    userId: row.reporter_id || '',
    note: row.note || '',
    evidenceCount: Number(row.evidence_count || 0),
    evidenceUrls: normalizeEvidenceUrls(row.evidence_urls),
    updatedAt: row.updated_at
  };
}

function mapNotification(row) {
  return {
    id: row.notification_id,
    title: row.title,
    body: row.body,
    time: row.created_at,
    priority: row.priority,
    read: Boolean(row.is_read),
    recipient: row.recipient_id || '',
    delivery: row.delivery_status
  };
}

function mapHistory(row) {
  return {id: row.action_id, action: row.action_type, target: row.target_id, time: row.created_at};
}

async function readSchema() {
  return readFile(new URL('./supabase-admin.sql', import.meta.url), 'utf8');
}

async function ensureWorkspace(client) {
  await client.query(`INSERT INTO public.admin_workspaces (user_id, payload, revision)
    VALUES ($1, '{}'::jsonb, 0) ON CONFLICT (user_id) DO NOTHING`, [workspaceId]);
}

async function ensureDb() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query(await readSchema());
    await client.query('BEGIN');
    await ensureWorkspace(client);
    if (email) await client.query(`INSERT INTO public.admin_roles (admin_id, email, display_name, role) VALUES ($1,$2,$3,'super_admin') ON CONFLICT (admin_id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, updated_at=now()`, [adminId, email, process.env.ADMIN_NAME || 'ผู้ดูแลระบบ']);
    const current = await snapshotFrom(client);
    await client.query('UPDATE public.admin_workspaces SET payload=$1::jsonb, updated_at=now() WHERE user_id=$2', [JSON.stringify(current.data), workspaceId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function snapshotFrom(client) {
  const [users, reports, notifications, history, workspace] = await Promise.all([
    client.query('SELECT * FROM public.app_users ORDER BY created_at, user_id'),
    client.query('SELECT * FROM public.reports ORDER BY created_at DESC, report_id'),
    client.query('SELECT * FROM public.notifications ORDER BY created_at DESC, notification_id'),
    client.query('SELECT action_id, action_type, target_id, created_at FROM public.admin_actions ORDER BY created_at DESC LIMIT 200'),
    client.query('SELECT revision FROM public.admin_workspaces WHERE user_id = $1', [workspaceId])
  ]);
  return {
    data: {users: users.rows.map(mapUser), reports: reports.rows.map(mapReport), notifications: notifications.rows.map(mapNotification), history: history.rows.map(mapHistory), transactions: []},
    revision: Number(workspace.rows[0]?.revision || 0)
  };
}

async function readWorkspace() {
  if (!pool) return memory;
  const client = await pool.connect();
  try { return await snapshotFrom(client); } finally { client.release(); }
}

async function recordAction(client, admin, actionType, targetType, targetId, reason, metadata = {}) {
  await client.query(`INSERT INTO public.admin_actions (action_id, admin_id, action_type, target_type, target_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [crypto.randomUUID(), admin.id, actionType, targetType, targetId, reason || null, JSON.stringify(metadata)]);
}

async function writeRelationalAction(action, revision, admin) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT revision FROM public.admin_workspaces WHERE user_id = $1 FOR UPDATE', [workspaceId]);
    if (Number(current.rows[0]?.revision || 0) !== revision) throw Object.assign(new Error('ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่'), {code: 'CONFLICT'});

    if (action?.type === 'report.update') {
      if (!can(admin, 'reports')) throw Object.assign(new Error('ไม่มีสิทธิ์แก้ไขรายงาน'), {code: 'FORBIDDEN'});
      if (!['รอตรวจสอบ', 'กำลังตรวจสอบ', 'ดำเนินการแล้ว', 'ปิดเรื่อง'].includes(action.status) || !validText(action.note, 5, 2000)) throw new Error('ข้อมูลรายงานไม่ถูกต้อง');
      const result = await client.query(`UPDATE public.reports SET status=$1, note=$2, updated_at=now() WHERE report_id=$3 RETURNING reporter_id, priority`, [action.status, action.note.trim(), action.id]);
      if (!result.rows.length) throw new Error('ไม่พบรายงาน');
      if (action.notify === true) await client.query(`INSERT INTO public.notifications (notification_id, recipient_id, source_type, source_id, title, body, priority, delivery_status) VALUES ($1,$2,'report',$3,$4,$5,$6,'รอส่ง')`, [crypto.randomUUID(), result.rows[0].reporter_id || null, action.id, `รายงาน #${action.id} อัปเดตแล้ว`, action.note.trim(), result.rows[0].priority || 'ปกติ']);
      await recordAction(client, admin, `อัปเดต Report เป็น ${action.status}`, 'report', action.id, action.note);
    } else if (action?.type === 'user.status') {
      if (!can(admin, 'users')) throw Object.assign(new Error('ไม่มีสิทธิ์จัดการบัญชีผู้ใช้'), {code: 'FORBIDDEN'});
      if (!['ระงับบัญชี', 'ใช้งานปกติ'].includes(action.status) || !validText(action.reason, 5, 1000)) throw new Error('ข้อมูลสถานะบัญชีไม่ถูกต้อง');
      const user = await client.query(`SELECT user_id, role FROM public.app_users WHERE user_id=$1 FOR UPDATE`, [action.id]);
      if (!user.rows.length) throw new Error('ไม่พบบัญชี');
      const eventId = crypto.randomUUID();
      await syncAccountStatus({...action, role: user.rows[0].role}, admin, eventId);
      const result = await client.query(`UPDATE public.app_users SET status=$1, status_reason=$2, status_changed_by=$3, status_changed_at=now(), updated_at=now() WHERE user_id=$4 RETURNING user_id`, [action.status, action.reason.trim(), adminId, action.id]);
      if (!result.rows.length) throw new Error('ไม่พบบัญชี');
      await recordAction(client, admin, action.status, 'user', action.id, action.reason.trim(), {event_id: eventId, backend_synced: true});
    } else if (action?.type === 'notification.read') {
      await client.query(`UPDATE public.notifications SET is_read=true, read_at=COALESCE(read_at, now()), updated_at=now() WHERE is_read=false`);
      await recordAction(client, admin, 'อ่านการแจ้งเตือนทั้งหมด', 'notification', 'all', 'ผู้ดูแลอ่านการแจ้งเตือน');
    } else if (String(action?.type || '').startsWith('refund') || String(action?.type || '').startsWith('payment')) {
      throw new Error('ฟังก์ชันการชำระเงินและคืนเงินถูกปิดไว้ชั่วคราว');
    } else {
      throw new Error('ไม่รองรับการดำเนินการนี้');
    }

    const next = await snapshotFrom(client);
    const saved = await client.query(`UPDATE public.admin_workspaces SET payload=$1::jsonb, revision=revision+1, updated_at=now() WHERE user_id=$2 AND revision=$3 RETURNING revision`, [JSON.stringify(next.data), workspaceId, revision]);
    if (!saved.rows.length) throw Object.assign(new Error('ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่'), {code: 'CONFLICT'});
    await client.query('COMMIT');
    return {data: next.data, revision: Number(saved.rows[0].revision)};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function handleIntegrationEvent(event) {
  const eventId = text(event?.event_id || event?.eventId);
  const eventType = text(event?.event_type || event?.eventType);
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const supported = new Set(['user.upsert', 'user.delete', 'order.upsert', 'report.created', 'report.updated', 'notification.created']);
  if (!eventId || !supported.has(eventType)) throw new Error('event ไม่รองรับหรือไม่มี event_id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO public.integration_events (event_id, event_type, payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, [eventId, eventType, JSON.stringify(event)]);
    if (!inserted.rows.length) { await client.query('COMMIT'); return {duplicate: true}; }
    if (eventType === 'user.upsert') {
      await client.query(`INSERT INTO public.app_users (user_id, display_name, email, role, status, shop_name, phone, category, line_id, facebook_url, latitude, longitude, source_updated_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) ON CONFLICT (user_id) DO UPDATE SET display_name=excluded.display_name,email=excluded.email,role=excluded.role,shop_name=excluded.shop_name,phone=excluded.phone,category=excluded.category,line_id=excluded.line_id,facebook_url=excluded.facebook_url,latitude=excluded.latitude,longitude=excluded.longitude,source_updated_at=excluded.source_updated_at,updated_at=now()`, [text(data.user_id || data.id), text(data.display_name || data.name, 'ไม่ระบุชื่อ'), text(data.email) || null, data.role === 'Shop' ? 'Shop' : 'Customer', data.status === 'ระงับบัญชี' ? 'ระงับบัญชี' : 'ใช้งานปกติ', text(data.shop_name || data.shop), text(data.phone) || null, text(data.category) || null, text(data.line_id || data.lineId) || null, text(data.facebook_url || data.facebook) || null, data.latitude == null ? null : Number(data.latitude), data.longitude == null ? null : Number(data.longitude), data.source_updated_at ? safeDate(data.source_updated_at) : null]);
    } else if (eventType === 'user.delete') {
      await client.query('DELETE FROM public.app_users WHERE user_id=$1', [text(data.user_id || data.id)]);
    } else if (eventType === 'order.upsert') {
      await client.query(`INSERT INTO public.app_orders (order_id, customer_id, merchant_id, total_amount, status, created_at, source_updated_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (order_id) DO UPDATE SET customer_id=excluded.customer_id,merchant_id=excluded.merchant_id,total_amount=excluded.total_amount,status=excluded.status,source_updated_at=excluded.source_updated_at,updated_at=now()`, [text(data.order_id || data.id), text(data.customer_id) || null, text(data.merchant_id) || null, data.total_amount == null ? null : Number(data.total_amount), text(data.status) || null, data.created_at ? safeDate(data.created_at) : null, data.source_updated_at ? safeDate(data.source_updated_at) : null]);
    } else if (eventType === 'report.created' || eventType === 'report.updated') {
      const evidenceUrls = normalizeEvidenceUrls(data.evidence_urls || data.evidenceUrls);
      await client.query(`INSERT INTO public.reports (report_id,title,reporter_id,reporter_type,reporter_name,shop_name,issue_type,order_id,status,priority,note,evidence_count,evidence_urls,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,now()) ON CONFLICT (report_id) DO UPDATE SET title=excluded.title,reporter_id=excluded.reporter_id,reporter_type=excluded.reporter_type,reporter_name=excluded.reporter_name,shop_name=excluded.shop_name,issue_type=excluded.issue_type,order_id=excluded.order_id,status=excluded.status,priority=excluded.priority,note=excluded.note,evidence_count=excluded.evidence_count,evidence_urls=excluded.evidence_urls,updated_at=now()`, [text(data.report_id || data.id), text(data.title || data.name, 'รายงานปัญหา'), text(data.reporter_id || data.user_id) || null, data.reporter_type === 'Shop' ? 'Shop' : 'Customer', text(data.reporter_name || data.person) || null, text(data.shop_name || data.shop) || null, text(data.issue_type || data.type, 'Other'), text(data.order_id || data.orderId) || null, ['รอตรวจสอบ', 'กำลังตรวจสอบ', 'ดำเนินการแล้ว', 'ปิดเรื่อง'].includes(data.status) ? data.status : 'รอตรวจสอบ', ['สูงสุด', 'สูง', 'ปกติ', 'ต่ำ'].includes(data.priority) ? data.priority : 'ปกติ', text(data.note), Number(data.evidence_count || data.evidenceCount || evidenceUrls.length), JSON.stringify(evidenceUrls), data.created_at ? safeDate(data.created_at) : new Date()]);
      if (eventType === 'report.created') await client.query(`INSERT INTO public.notifications (notification_id, source_type, source_id, title, body, priority, delivery_status) VALUES ($1,'report',$2,$3,$4,$5,'รอส่ง')`, [crypto.randomUUID(), text(data.report_id || data.id), 'มีรายงานใหม่', text(data.title || data.name, 'มีรายงานใหม่'), ['สูงสุด', 'สูง', 'ปกติ', 'ต่ำ'].includes(data.priority) ? data.priority : 'ปกติ']);
    } else if (eventType === 'notification.created') {
      await client.query(`INSERT INTO public.notifications (notification_id,recipient_id,source_type,source_id,title,body,priority,delivery_status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (notification_id) DO NOTHING`, [text(data.notification_id || data.id, crypto.randomUUID()), text(data.recipient_id) || null, text(data.source_type) || null, text(data.source_id) || null, text(data.title, 'การแจ้งเตือน'), text(data.body), ['สูงสุด', 'สูง', 'ปกติ', 'ต่ำ'].includes(data.priority) ? data.priority : 'ปกติ', text(data.delivery_status, 'รอส่ง'), data.created_at ? safeDate(data.created_at) : new Date()]);
    }
    await client.query('COMMIT');
    return {duplicate: false};
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}

app.get('/api/health', async (_req, res) => json(res, {success: true, database: Boolean(pool)}));
app.post('/api/auth/login', async (req, res) => {
  const identity = text(req.body?.identity).toLowerCase();
  const submitted = String(req.body?.password || '');
  const configuredHash = String(process.env.ADMIN_PASSWORD_HASH || '');
  let valid = identity === email && (configuredHash ? await bcrypt.compare(submitted, configuredHash) : submitted === password);
  if (!valid && supabaseUrl && supabasePublishableKey) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', apikey: supabasePublishableKey},
        body: JSON.stringify({email: identity, password: submitted})
      });
      valid = response.ok;
    } catch { valid = false; }
  }
  if (!valid) return json(res, {error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'}, 401);
  const admin = await findAdmin(identity);
  if (!admin) return json(res, {error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์แอดมิน'}, 403);
  res.cookie('admin_session', issueSession(identity), {httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000});
  return json(res, {success: true, account: {name: admin.display_name || 'ผู้ดูแลระบบ', email: admin.email}});
});
app.all('/api/auth/logout', (_req, res) => { res.clearCookie('admin_session'); return res.redirect('/'); });

app.post('/api/integration/events', requireWebhook, async (req, res) => {
  try { return json(res, {success: true, ...(await handleIntegrationEvent(req.body))}); }
  catch (error) { return json(res, {error: error instanceof Error ? error.message : 'รับข้อมูลไม่สำเร็จ'}, 400); }
});

// รับ Supabase Database Webhooks โดยตรง ไม่ต้องแก้ Backend ของแอปหลัก
app.post('/api/integration/supabase-webhook', requireWebhook, async (req, res) => {
  try {
    const event = normalizeSupabaseWebhook(req.body);
    if (!event) return json(res, {success: true, ignored: true});
    return json(res, {success: true, ...(await handleIntegrationEvent(event))});
  } catch (error) { return json(res, {error: error instanceof Error ? error.message : 'รับข้อมูลไม่สำเร็จ'}, 400); }
});

app.get('/api/admin', requireAdmin, async (_req, res) => {
  try { const workspace = await readWorkspace(); return json(res, {data: workspace.data || workspace.payload, revision: workspace.revision, account: {name: process.env.ADMIN_NAME || 'ผู้ดูแลระบบ', email}}); }
  catch (error) { console.error(error); return json(res, {error: 'ไม่สามารถโหลดข้อมูลได้'}, 503); }
});

app.post('/api/admin', requireAdmin, async (req, res) => {
  const revision = Number(req.body?.revision);
  if (!Number.isInteger(revision) || !req.body?.action) return json(res, {error: 'ข้อมูลไม่ถูกต้อง'}, 400);
  try {
    if (pool) {
      const saved = await writeRelationalAction(req.body.action, revision, req.admin);
      return json(res, saved);
    }
    if (memory.revision !== revision) return json(res, {error: 'ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่'}, 409);
    if (String(req.body.action.type || '').startsWith('refund') || String(req.body.action.type || '').startsWith('payment')) throw new Error('ฟังก์ชันการชำระเงินและคืนเงินถูกปิดไว้ชั่วคราว');
    memory = {payload: normalizeSnapshot(applyAction(memory.payload, req.body.action)), revision: revision + 1};
    return json(res, {data: memory.payload, revision: memory.revision});
  } catch (error) {
    if (error?.code === 'CONFLICT') return json(res, {error: error.message}, 409);
    if (error?.code === 'FORBIDDEN') return json(res, {error: error.message}, 403);
    return json(res, {error: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'}, 400);
  }
});

app.get('*', (_req, res) => res.sendFile('admin.html', {root: 'public'}));
ensureDb().then(() => app.listen(port, () => console.log(`Foot cart Admin listening on ${port}`))).catch((error) => {
  console.error('Database initialization failed:', error.message);
  app.listen(port, () => console.log(`Foot cart Admin listening on ${port} without database`));
});
