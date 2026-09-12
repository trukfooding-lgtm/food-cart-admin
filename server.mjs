import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {createInitialState} from './public/sample-data.js';
import {applyAction} from './public/operations.js';

const {Pool} = pg;
const app = express();
const port = Number(process.env.PORT || 10000);
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const sessionSecret = String(process.env.SESSION_SECRET || '');
const userId = 'standalone-admin';
const pool = process.env.DATABASE_URL ? new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}}) : null;
let memory = {payload: createInitialState(), revision: 0};

app.use(express.json({limit: '32kb'}));
app.use(cookieParser());
app.use(express.static('public', {extensions: ['html']}));

const json = (res, value, status = 200) => res.status(status).json(value);
const sign = (value) => crypto.createHmac('sha256', sessionSecret || 'development-only-secret').update(value).digest('base64url');
const issueSession = () => {
  const exp = Date.now() + 8 * 60 * 60 * 1000;
  const body = `${email}|${exp}`;
  return `${body}.${sign(body)}`;
};
function validSession(req) {
  const token = req.cookies.admin_session || '';
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  const [tokenEmail, expiry] = body.split('|');
  return tokenEmail === email && Number(expiry) > Date.now();
}
function requireAdmin(req, res, next) {
  if (!email || (!password && !process.env.ADMIN_PASSWORD_HASH) || !sessionSecret) return json(res, {error: 'ยังไม่ได้ตั้งค่าบัญชีผู้ดูแลใน Render'}, 503);
  if (!validSession(req)) return json(res, {error: 'กรุณาเข้าสู่ระบบ'}, 401);
  next();
}

async function ensureDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_workspaces (
    user_id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}
async function readWorkspace() {
  if (!pool) return memory;
  const result = await pool.query('SELECT payload, revision FROM admin_workspaces WHERE user_id = $1', [userId]);
  if (!result.rows.length) {
    const payload = createInitialState();
    await pool.query('INSERT INTO admin_workspaces (user_id, payload, revision) VALUES ($1, $2::jsonb, 0)', [userId, JSON.stringify(payload)]);
    return {payload, revision: 0};
  }
  return {payload: result.rows[0].payload, revision: Number(result.rows[0].revision)};
}
async function writeWorkspace(next, revision) {
  if (!pool) {
    memory = {payload: next, revision: revision + 1};
    return memory;
  }
  const result = await pool.query(`UPDATE admin_workspaces SET payload = $1::jsonb, revision = revision + 1, updated_at = now() WHERE user_id = $2 AND revision = $3 RETURNING revision`, [JSON.stringify(next), userId, revision]);
  if (!result.rows.length) return null;
  return {payload: next, revision: Number(result.rows[0].revision)};
}

app.get('/api/health', async (_req, res) => json(res, {success: true, database: Boolean(pool)}));
app.post('/api/auth/login', async (req, res) => {
  const identity = String(req.body?.identity || '').trim().toLowerCase();
  const submitted = String(req.body?.password || '');
  const configuredHash = String(process.env.ADMIN_PASSWORD_HASH || '');
  const valid = identity === email && (configuredHash ? await bcrypt.compare(submitted, configuredHash) : submitted === password);
  if (!valid) return json(res, {error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'}, 401);
  res.cookie('admin_session', issueSession(), {httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000});
  return json(res, {success: true, account: {name: process.env.ADMIN_NAME || 'ผู้ดูแลระบบ', email}});
});
app.all('/api/auth/logout', (_req, res) => { res.clearCookie('admin_session'); return res.redirect('/'); });
app.get('/api/admin', requireAdmin, async (_req, res) => {
  try {
    const workspace = await readWorkspace();
    return json(res, {data: workspace.payload, revision: workspace.revision, account: {name: process.env.ADMIN_NAME || 'ผู้ดูแลระบบ', email}});
  } catch (error) {
    console.error(error);
    return json(res, {error: 'ไม่สามารถโหลดข้อมูลได้'}, 503);
  }
});
app.post('/api/admin', requireAdmin, async (req, res) => {
  const revision = Number(req.body?.revision);
  if (!Number.isInteger(revision) || !req.body?.action) return json(res, {error: 'ข้อมูลไม่ถูกต้อง'}, 400);
  try {
    const workspace = await readWorkspace();
    if (workspace.revision !== revision) return json(res, {error: 'ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่'}, 409);
    const next = applyAction(workspace.payload, req.body.action);
    const saved = await writeWorkspace(next, revision);
    if (!saved) return json(res, {error: 'ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่'}, 409);
    return json(res, {data: saved.payload, revision: saved.revision});
  } catch (error) {
    return json(res, {error: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'}, 400);
  }
});

app.get('*', (_req, res) => res.sendFile('admin.html', {root: 'public'}));
ensureDb().then(() => app.listen(port, () => console.log(`Foot cart Admin listening on ${port}`))).catch((error) => {
  console.error('Database initialization failed:', error.message);
  app.listen(port, () => console.log(`Foot cart Admin listening on ${port} without database`));
});
