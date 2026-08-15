const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./db');
const pay = require('./pay');const app = express();
const PORT = process.env.PORT || 3000;
const DEV_SECRET = 'yaobisno_secret_dev';
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('JWT_SECRET é obrigatório em produção'); })()
  : DEV_SECRET);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Bloqueia ficheiros sensíveis ficando inacessíveis via static (sem afetar a app)
const SENSITIVE = [
  '/server/',
  '/package.json',
  '/package-lock.json',
  '/render.yaml',
  '/README.md',
  '/README',
  '/.gitignore',
  '/.env',
  '/.env.example'
];
app.use((req, res, next) => {
  const p = req.path;
  if (p.startsWith('/server/') || p.startsWith('/.')) return res.status(404).end();
  if (SENSITIVE.indexOf(p) !== -1) return res.status(404).end();
  next();
});
app.use(express.static(path.join(__dirname, '..')));

// ─── Rate limit em memória (por instância) ──────────────────────────
const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset <= now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, count: 1 };
  }
  bucket.count += 1;
  if (bucket.count > max) return { allowed: false, count: bucket.count };
  return { allowed: true, count: bucket.count };
}

// ─── Mailer ─────────────────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || SMTP_USER || 'noreply@yaobisno.com';

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function mailHtml(code) {
  return '<div style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px"><div style="max-width:420px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #eee">'
    + '<div style="font-size:20px;font-weight:800;color:#FF6B00">ya <span style="color:#aaa;font-weight:500">o bisno</span></div>'
    + '<p style="color:#333;font-size:14px;margin:18px 0 6px">O teu código de verificação:</p>'
    + '<div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#111317;background:#f6f7f9;border-radius:12px;text-align:center;padding:14px">' + code + '</div>'
    + '<p style="color:#888;font-size:12px;margin:14px 0 0">Válido por 10 minutos. Se não pediste isto, ignora este email.</p></div></div>';
}

async function sendBrevoApi(email, code) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await withTimeout(fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: SMTP_FROM, name: 'ya o bisno' },
        to: [{ email }],
        subject: 'Ya o bisno — Código de verificação',
        htmlContent: mailHtml(code)
      })
    }), 30000);
    if (!res.ok) {
      const t = await res.text();
      console.error('[BREVO API] ' + res.status + ' ' + t);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[BREVO API] Erro: ' + e.message);
    return false;
  }
}

async function sendCode(email, code) {
  const dev = process.env.NODE_ENV !== 'production';
  if (dev) console.log('[EMAIL] Código de verificação para ' + email + ': ' + code);
  const viaApi = await sendBrevoApi(email, code);
  if (viaApi) return true;
  if (!transporter) {
    console.warn('[EMAIL] Sem serviço de email configurado — código NÃO enviado para ' + email + '. Define BREVO_API_KEY ou SMTP_HOST/USER/PASS no Render.');
    if (dev) console.log('[SMTP OFF] Código de verificação para ' + email + ': ' + code);
    return false;
  }
  try {
    await withTimeout(transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: 'Ya o bisno — Código de verificação',
      html: mailHtml(code)
    }), 30000);
    return true;
  } catch (e) {
    console.error('Erro ou timeout a enviar email:', e.message);
    if (dev) console.log('[SMTP FAIL] Código de verificação para ' + email + ': ' + code);
    return false;
  }
}

// Garante que uma promessa nunca fique pendente além de ms (evita o botão "não responder")
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout (' + ms + 'ms)')), ms))
  ]);
}

// ─── Auth middlewares ────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  try {
    const tok = jwt.verify(h.slice(7), JWT_SECRET);
    req.auth = tok;
    next();
  } catch (e) { res.status(401).json({ ok: false, error: 'Sessão inválida' }); }
}

function authAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  try {
    const tok = jwt.verify(h.slice(7), JWT_SECRET);
    if (tok.role !== 'admin') return res.status(403).json({ ok: false, error: 'Acesso negado' });
    req.auth = tok;
    next();
  } catch (e) { res.status(401).json({ ok: false, error: 'Sessão inválida' }); }
}

// ─── Users ────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!rateLimit('login:' + ip + ':' + String(email || '').toLowerCase(), 10, 15 * 60 * 1000).allowed)
      return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tenta de novo dentro de 15 minutos.' });
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return res.json({ ok: false, error: 'Email ou password incorretos' });
    const u = rows[0];
    let ok = false;
    if (u.password && u.password.indexOf('$2') === 0) {
      ok = await bcrypt.compare(password, u.password);
    } else {
      // migração: password antiga em texto plano
      ok = (password === u.password);
      if (ok) {
        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password = ? WHERE email = ?', [hash, email]);
      }
    }
    if (!ok) return res.json({ ok: false, error: 'Email ou password incorretos' });
    const user = { name: u.name, email: u.email, phone: u.phone, role: u.role, verified: !!u.verified };
    res.json({ ok: true, user, token: signToken(u) });
  } catch (e) { console.error('[login] erro:', e.message); res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

// ─── Admin separado (painel) ─────────────────────────────────────────
// Login do painel admin: NÃO usa users.password, usa a tabela admins.
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!rateLimit('adminlogin:' + ip, 10, 15 * 60 * 1000).allowed)
      return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tenta de novo dentro de 15 minutos.' });
    const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [String(email || '').toLowerCase()]);
    if (rows.length === 0) return res.json({ ok: false, error: 'Email ou password incorretos' });
    const a = rows[0];
    let ok = false;
    if (a.password && a.password.indexOf('$2') === 0) ok = await bcrypt.compare(password, a.password);
    else ok = (password === a.password);
    if (!ok) return res.json({ ok: false, error: 'Email ou password incorretos' });
    const user = { name: a.name, email: a.email, role: 'admin' };
    res.json({ ok: true, user, token: signToken(user) });
  } catch (e) { console.error('[admin login] erro:', e.message); res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

// Quem sou eu (valida sessão do painel)
app.get('/api/admin/me', authAdmin, (req, res) => {
  res.json({ ok: true, user: { name: req.auth.name, email: req.auth.email, role: 'admin' } });
});

// Listar admins do painel
app.get('/api/admin/admins', authAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id,name,email,created_at FROM admins ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

// Criar novo admin
app.post('/api/admin/admins', authAdmin, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ ok: false, error: 'Preenche nome, email e password' });
    if (String(password).length < 6) return res.json({ ok: false, error: 'A password tem de ter pelo menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO admins (name,email,password) VALUES (?,?,?)', [name, String(email).toLowerCase(), hash]);
    res.json({ ok: true });
  } catch (e) {
    const dup = String(e.message).toLowerCase().includes('duplicate');
    res.status(dup ? 400 : 500).json({ ok: false, error: dup ? 'Email já é admin do painel' : 'Erro no servidor' });
  }
});

// Mudar password do admin autenticado
app.put('/api/admin/password', authAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.json({ ok: false, error: 'Preenche a password atual e a nova' });
    if (String(newPassword).length < 6) return res.json({ ok: false, error: 'A nova password tem de ter pelo menos 6 caracteres' });
    const [rows] = await db.query('SELECT * FROM admins WHERE email = ?', [req.auth.email]);
    if (rows.length === 0) return res.status(403).json({ ok: false, error: 'Conta não encontrada' });
    const a = rows[0];
    let ok = false;
    if (a.password && a.password.indexOf('$2') === 0) ok = await bcrypt.compare(currentPassword, a.password);
    else ok = (currentPassword === a.password);
    if (!ok) return res.json({ ok: false, error: 'Password atual incorreta' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE admins SET password=? WHERE email=?', [hash, req.auth.email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

// Eliminar admin (não pode eliminar-se a si mesmo)
app.delete('/api/admin/admins/:email', authAdmin, async (req, res) => {
  try {
    const email = String(req.params.email).toLowerCase();
    if (email === String(req.auth.email).toLowerCase())
      return res.json({ ok: false, error: 'Não podes eliminar a tua própria conta de admin' });
    const [r] = await db.query('DELETE FROM admins WHERE email=?', [email]);
    res.json({ ok: true, changed: r.affectedRows > 0 });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!rateLimit('register:' + ip, 5, 15 * 60 * 1000).allowed)
      return res.status(429).json({ ok: false, error: 'Muitas contas criadas a partir deste dispositivo. Tenta de novo mais tarde.' });
    if (!name || !email || !password) return res.json({ ok: false, error: 'Preenche todos os campos' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, error: 'Email inválido' });
    if (String(password).length < 6) return res.json({ ok: false, error: 'A password tem de ter pelo menos 6 caracteres' });
    const [exist] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exist.length > 0) return res.json({ ok: false, error: 'Email já registado' });
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)',
      [name, email, phone, hash, 'comprador']);
    const [us] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    const u = us[0];
    res.json({ ok: true, user: { name: u.name, email: u.email, phone: u.phone, role: u.role }, token: signToken(u) });
  } catch (e) { console.error('[register] erro:', e.message); res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rl = rateLimit('forgot:' + ip + ':' + String(email || '').toLowerCase(), 6, 15 * 60 * 1000);
    if (!rl.allowed) {
      console.log('[RATE LIMIT] forgot-password bloqueado para ' + email + ' (ip ' + ip + ')');
      return res.json({ ok: true, throttled: true });
    }
    const [exist] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    // resposta sempre igual -> evita enumeração de contas
    if (exist.length === 0) return res.json({ ok: true });
    const code = String(crypto.randomInt(100000, 1000000));
    await db.query('DELETE FROM verifications WHERE email=? AND used=0', [email]);
    await db.query('INSERT INTO verifications (email,code,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [email, code]);
    sendCode(email, code);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code) return res.json({ ok: false, error: 'Falta email ou código' });
    if (!password || String(password).length < 6) return res.json({ ok: false, error: 'A nova password tem de ter pelo menos 6 caracteres' });
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!rateLimit('reset:' + ip, 20, 10 * 60 * 1000).allowed)
      return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tenta de novo dentro de 10 minutos.' });
    const [latest] = await db.query('SELECT * FROM verifications WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1', [email]);
    if (latest.length === 0) return res.json({ ok: false, error: 'Código inválido ou expirado' });
    const v = latest[0];
    const now = new Date();
    const expires = v.expires_at instanceof Date ? v.expires_at : new Date(v.expires_at);
    const valid = expires > now && v.code === String(code).trim() && Number(v.attempts) < 5;
    if (!valid) {
      await db.query('UPDATE verifications SET attempts = attempts + 1 WHERE id = ? AND used = 0', [v.id]);
      return res.json({ ok: false, error: 'Código inválido ou expirado' });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password = ? WHERE email = ?', [hash, email]);
    await db.query('UPDATE verifications SET used = 1 WHERE id = ?', [v.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/test-email', authAdmin, async (req, res) => {
  try {
    const to = req.body.email || (req.auth && req.auth.email);
    if (!transporter) return res.json({ ok: false, error: 'SMTP não configurado (define SMTP_HOST/USER/PASS)' });
    if (!to) return res.json({ ok: false, error: 'Falta email de destino' });
    await transporter.sendMail({
      from: SMTP_FROM,
      to: to,
      subject: 'Ya o bisno — email de teste',
      text: 'Funcionou! Este email foi enviado do teu servidor Ya o bisno.'
    });
    res.json({ ok: true, to });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.get('/api/user/:email', authRequired, async (req, res) => {
  try {
    if (req.params.email !== req.auth.email) return res.status(403).json({ ok: false, error: 'Acesso negado' });
    const [rows] = await db.query('SELECT name,email,phone,role,avatar,province,municipality,neighborhood,street,reference,verified FROM users WHERE email = ?', [req.params.email]);
    if (rows.length === 0) return res.json({ ok: false });
    res.json({ ok: true, user: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.get('/api/profile/:email', async (req, res) => {
  try {
    const email = String(req.params.email).toLowerCase();
    const [users] = await db.query('SELECT name,email,avatar,verified FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.json({ ok: false, error: 'Perfil não encontrado' });
    const [prods] = await db.query('SELECT * FROM products WHERE owner_email = ? AND status = "active" ORDER BY created_at DESC', [email]);
    res.json({ ok: true, profile: users[0], products: prods.map(normalizeProduct) });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.put('/api/user/address', authRequired, async (req, res) => {
  try {
    const { email, province, municipality, neighborhood, street, reference } = req.body;
    if (email !== req.auth.email) return res.status(403).json({ ok: false, error: 'Acesso negado' });
    await db.query('UPDATE users SET province=?,municipality=?,neighborhood=?,street=?,reference=? WHERE email=?',
      [province || '', municipality || '', neighborhood || '', street || '', reference || '', email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/avatar', authRequired, async (req, res) => {
  try {
    const { email, avatar } = req.body;
    if (email !== req.auth.email) return res.status(403).json({ ok: false, error: 'Acesso negado' });
    await db.query('UPDATE users SET avatar = ? WHERE email = ?', [avatar, email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/change-password', authRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.json({ ok: false, error: 'Falta a password atual ou a nova' });
    if (newPassword.length < 6) return res.json({ ok: false, error: 'A nova password tem de ter pelo menos 6 caracteres' });
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [req.auth.email]);
    if (rows.length === 0) return res.json({ ok: false, error: 'Utilizador não encontrado' });
    const u = rows[0];
    let ok = false;
    if (u.password && u.password.indexOf('$2') === 0) ok = await bcrypt.compare(currentPassword, u.password);
    else ok = (currentPassword === u.password);
    if (!ok) return res.json({ ok: false, error: 'Password atual incorreta' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = ? WHERE email = ?', [hash, req.auth.email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

// ─── Products ─────────────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(rows.map(normalizeProduct));
  } catch (e) { res.status(500).json([]); }
});

function strLoc(v){
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return ''; } }
  return '';
}

app.post('/api/products', authRequired, async (req, res) => {
  try {
    const { name, price, location, category, images, isNew, negotiable, ownerEmail, owner_name } = req.body;
    if (ownerEmail && String(ownerEmail).toLowerCase() !== req.auth.email.toLowerCase())
      return res.status(403).json({ ok: false, error: 'Acesso negado' });
    const [r] = await db.query(
      'INSERT INTO products (name,price,location,category,images,is_new,negotiable,owner_email,owner_name) VALUES (?,?,?,?,?,?,?,?,?)',
      [name, price, strLoc(location), category || 'Outros', JSON.stringify(images || []), isNew ? 1 : 0, negotiable ? 1 : 0, req.auth.email, owner_name || req.auth.name]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/products/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    const p = rows[0];
    if (req.auth.role !== 'admin' && String(p.owner_email).toLowerCase() !== req.auth.email.toLowerCase())
      return res.status(403).json({ ok: false, error: 'Acesso negado' });
    const { name, price, location, category, images, isNew, negotiable, boost, status } = req.body;
    const sets = [];
    const vals = [];
    if (name !== undefined) { sets.push('name=?'); vals.push(name); }
    if (price !== undefined) { sets.push('price=?'); vals.push(price); }
    if (location !== undefined) { sets.push('location=?'); vals.push(strLoc(location)); }
    if (category !== undefined) { sets.push('category=?'); vals.push(category); }
    if (images !== undefined) { sets.push('images=?'); vals.push(JSON.stringify(images || [])); }
    if (isNew !== undefined) { sets.push('is_new=?'); vals.push(isNew ? 1 : 0); }
    if (negotiable !== undefined) { sets.push('negotiable=?'); vals.push(negotiable ? 1 : 0); }
    if (boost !== undefined) { sets.push('boost=?'); vals.push(boost ? 1 : 0); }
    if (status !== undefined) { sets.push('status=?'); vals.push(status); }
    if (sets.length === 0) return res.json({ ok: true });
    await db.query('UPDATE products SET ' + sets.join(',') + ' WHERE id=?', vals.concat(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/products/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ ok: false });
    const p = rows[0];
    if (req.auth.role !== 'admin' && String(p.owner_email).toLowerCase() !== req.auth.email.toLowerCase())
      return res.status(403).json({ ok: false, error: 'Acesso negado' });
    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ─── Chats ────────────────────────────────────────────────────────

app.get('/api/chats', authRequired, async (req, res) => {
  try {
    const email = req.auth.email;
    const [ownedProducts] = await db.query('SELECT id FROM products WHERE owner_email = ?', [email]);
    const ownIds = ownedProducts.map(p => p.id);
    let rows;
    if (ownIds.length > 0) {
      const placeholders = ownIds.map(() => '?').join(',');
      const [r] = await db.query(`SELECT * FROM chats WHERE user_email = ? OR (product_id IN (${placeholders}) AND user_email != '')`, [email, ...ownIds]);
      rows = r;
    } else {
      const [r] = await db.query('SELECT * FROM chats WHERE user_email = ?', [email]);
      rows = r;
    }
    const grouped = {};
    for (const r of rows) {
      const key = r.product_id + '_' + r.user_email;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ from: r.from_email, text: r.text, timestamp: Number(r.timestamp), read: !!r.read_flag });
    }
    res.json(grouped);
  } catch (e) { res.status(500).json({}); }
});

app.post('/api/chats', authRequired, async (req, res) => {
  try {
    const { product_id, user_email, from, text, timestamp } = req.body;
    if (req.auth.email.toLowerCase() !== String(from).toLowerCase())
      return res.status(403).json({ ok: false, error: 'Não autorizado' });
    await db.query('INSERT INTO chats (product_id,user_email,from_email,text,timestamp) VALUES (?,?,?,?,?)',
      [product_id, user_email || '', from, text, timestamp || Date.now()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/chats/read', authRequired, async (req, res) => {
  try {
    const { product_id, user_email, reader_email } = req.body;
    const reader = reader_email || user_email || '';
    if (reader.toLowerCase() !== req.auth.email.toLowerCase())
      return res.status(403).json({ ok: false, error: 'Acesso negado' });
    await db.query('UPDATE chats SET read_flag=1 WHERE product_id=? AND user_email=? AND from_email!=? AND read_flag=0',
      [product_id, user_email || '', reader]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ─── Cart ─────────────────────────────────────────────────────────

app.get('/api/cart/:email', authRequired, async (req, res) => {
  try {
    if (req.params.email !== req.auth.email) return res.status(403).json({ ok: false });
    const [rows] = await db.query(
      'SELECT c.id, c.product_id AS pid, c.qty, p.name, p.price FROM cart_items c JOIN products p ON c.product_id=p.id WHERE c.user_email=?',
      [req.params.email]
    );
    res.json(rows.map(r => ({ id: r.pid, name: r.name, price: Number(r.price), qty: r.qty })));
  } catch (e) { res.status(500).json([]); }
});

app.post('/api/cart', authRequired, async (req, res) => {
  try {
    const { user_email, product_id } = req.body;
    if (user_email !== req.auth.email) return res.status(403).json({ ok: false });
    const [exist] = await db.query('SELECT id,qty FROM cart_items WHERE user_email=? AND product_id=?', [user_email, product_id]);
    if (exist.length > 0)
      await db.query('UPDATE cart_items SET qty=qty+1 WHERE id=?', [exist[0].id]);
    else
      await db.query('INSERT INTO cart_items (user_email,product_id,qty) VALUES (?,?,1)', [user_email, product_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/cart/qty', authRequired, async (req, res) => {
  try {
    const { user_email, product_id, delta } = req.body;
    if (user_email !== req.auth.email) return res.status(403).json({ ok: false });
    const [exist] = await db.query('SELECT id,qty FROM cart_items WHERE user_email=? AND product_id=?', [user_email, product_id]);
    if (exist.length === 0) return res.json({ ok: false });
    const newQty = exist[0].qty + delta;
    if (newQty <= 0) await db.query('DELETE FROM cart_items WHERE id=?', [exist[0].id]);
    else await db.query('UPDATE cart_items SET qty=? WHERE id=?', [newQty, exist[0].id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/cart', authRequired, async (req, res) => {
  try {
    const { user_email, product_id } = req.body;
    if (user_email !== req.auth.email) return res.status(403).json({ ok: false });
    await db.query('DELETE FROM cart_items WHERE user_email=? AND product_id=?', [user_email, product_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/cart/all/:email', authRequired, async (req, res) => {
  try {
    if (req.params.email !== req.auth.email) return res.status(403).json({ ok: false });
    await db.query('DELETE FROM cart_items WHERE user_email=?', [req.params.email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ─── Payments (Multicaixa Express via ProxyPay OPG) ──────────────

app.post('/api/payment/create', authRequired, async (req, res) => {
  try {
    const { mobile, amount, items } = req.body;
    const digits = String(mobile || '').replace(/[^\d]/g, '');
    if (!/^9\d{8}$/.test(digits))
      return res.json({ ok: false, error: 'Nº de telemóvel inválido (9 dígitos, começa por 9)' });
    const val = Number(amount);
    if (!val || val <= 0) return res.json({ ok: false, error: 'Montante inválido' });
    if (!pay.configured()) return res.json({ ok: false, error: 'Pagamento ainda não configurado no servidor' });
    const base = process.env.PAY_CALLBACK_BASE || (req.protocol + '://' + req.get('host'));
    const r = await pay.createPayment({
      mobile: digits,
      amount: val.toFixed(2),
      callbackUrl: base + '/api/payments/webhook'
    });
    if (!r.ok) return res.json(r);
    const ref = 'YA' + Date.now().toString(36).toUpperCase() + crypto.randomInt(100, 999);
    await db.query('INSERT INTO payments (ref,provider_id,buyer_email,mobile,amount,items,status) VALUES (?,?,?,?,?,?,?)',
      [ref, r.providerId, req.auth.email, r.mobile || digits, val, JSON.stringify(items || []), 'pending']);
    res.json({ ok: true, ref, providerId: r.providerId });
  } catch (e) { console.error('[payment create] erro:', e.message); res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.get('/api/payment/:ref', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT ref,provider_id,buyer_email,mobile,amount,status,status_reason,created_at FROM payments WHERE ref=?', [req.params.ref]);
    if (rows.length === 0) return res.json({ ok: false, error: 'Pagamento não encontrado' });
    const p = rows[0];
    if (String(p.buyer_email).toLowerCase() !== String(req.auth.email).toLowerCase())
      return res.status(403).json({ ok: false, error: 'Acesso negado' });
    res.json({ ok: true, ref: p.ref, mobile: p.mobile, amount: Number(p.amount), status: p.status, status_reason: p.status_reason, created_at: p.created_at });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.get('/api/payment/:ref/refresh', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM payments WHERE ref=?', [req.params.ref]);
    if (rows.length === 0) return res.json({ ok: false, error: 'Pagamento não encontrado' });
    const p = rows[0];
    if (String(p.buyer_email).toLowerCase() !== String(req.auth.email).toLowerCase())
      return res.status(403).json({ ok: false, error: 'Acesso negado' });
    if (p.status === 'accepted' || p.status === 'rejected')
      return res.json({ ok: true, status: p.status, status_reason: p.status_reason || null });
    if (!p.provider_id) return res.json({ ok: true, status: p.status });
    const r = await pay.getTransaction(p.provider_id);
    if (r.ok && r.transaction && r.transaction.status) {
      await db.query('UPDATE payments SET status=?, status_reason=? WHERE id=?',
        [r.transaction.status, r.transaction.status_reason || null, p.id]);
      return res.json({ ok: true, status: r.transaction.status, status_reason: r.transaction.status_reason || null });
    }
    res.json({ ok: true, status: p.status });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

// Webhook chamado pelo fornecedor quando a transação é aceite/recusada
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const t = req.body || {};
    if (!t.id || !t.status) return res.status(400).json({ ok: false });
    await db.query('UPDATE payments SET status=?, status_reason=? WHERE provider_id=?',
      [t.status, t.status_reason || null, t.id]);
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Venda fechada por WhatsApp (sem gateway) — entra como pendente até confirmação no admin
app.post('/api/sales/whatsapp', authRequired, async (req, res) => {
  try {
    const { mobile, amount, items, delivery } = req.body;
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return res.json({ ok: false, error: 'Cesto vazio' });
    const val = Number(amount);
    if (!val || val <= 0) return res.json({ ok: false, error: 'Montante inválido' });
    const ref = 'YAWA' + Date.now().toString(36).toUpperCase() + crypto.randomInt(100, 999);
    await db.query('INSERT INTO payments (ref,buyer_email,mobile,amount,items,status,status_reason,method,delivery) VALUES (?,?,?,?,?,?,?,?,?)',
      [ref, req.auth.email, String(mobile || ''), val, JSON.stringify(list), 'pendente', 'aguarda confirmacao', 'whatsapp', JSON.stringify(delivery || {})]);
    res.json({ ok: true, ref });
  } catch (e) { console.error('[whatsapp sale] erro:', e.message); res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

// ─── Admin ─────────────────────────────────────────────────────────

app.delete('/api/admin/user/:email', authAdmin, async (req, res) => {
  try {
    const email = req.params.email;
    if (String(email).toLowerCase() === String(req.auth.email).toLowerCase())
      return res.json({ ok: false, error: 'Não podes eliminar a tua própria conta' });
    if (process.env.ADMIN_EMAIL && String(email).toLowerCase() === String(process.env.ADMIN_EMAIL).toLowerCase())
      return res.json({ ok: false, error: 'Não podes eliminar a conta do dono do site' });
    await db.query('DELETE FROM cart_items WHERE user_email=?', [email]);
    await db.query('DELETE FROM chats WHERE user_email=? OR from_email=?', [email, email]);
    await db.query('DELETE FROM products WHERE owner_email=?', [email]);
    await db.query('DELETE FROM users WHERE email=?', [email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/admin/product/:id', authAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM cart_items WHERE product_id=?', [req.params.id]);
    await db.query('DELETE FROM chats WHERE product_id=?', [req.params.id]);
    await db.query('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/admin/user/:email', authAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    await db.query('UPDATE users SET role=? WHERE email=?', [role || 'admin', req.params.email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.get('/api/admin/products', authAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id,name,price,location,category,images,is_new,negotiable,boost,status,views,owner_email,owner_name,created_at FROM products ORDER BY id DESC');
    res.json(rows.map(r => {
      let imgs = r.images || [];
      if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (_) { imgs = []; } }
      return { ...r, images: imgs || [], price: Number(r.price), is_new: !!r.is_new, negotiable: !!r.negotiable, boost: !!r.boost };
    }));
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/users', authAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id,name,email,phone,role,verified,province,municipality,neighborhood FROM users ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/chats', authAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM chats ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/cart', authAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT c.id,c.user_email,c.product_id,c.qty,p.name AS product_name,p.price FROM cart_items c LEFT JOIN products p ON c.product_id=p.id ORDER BY c.id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/sales', authAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM payments WHERE status IN ('accepted','finalizado','vendido','concluido','pendente') ORDER BY id DESC");
    const out = [];
    for (const p of rows) {
      let items = [];
      try { items = JSON.parse(p.items || '[]'); } catch (_) { items = []; }
      let delivery = {};
      try { delivery = JSON.parse(p.delivery || '{}'); } catch (_) { delivery = {}; }
      const first = items[0] || {};
      let seller = null;
      if (first.id) {
        const [pr] = await db.query('SELECT owner_email, owner_name FROM products WHERE id=?', [first.id]);
        if (pr.length) seller = { name: pr[0].owner_name, email: pr[0].owner_email };
      }
      out.push({
        id: p.id,
        ref: p.ref,
        buyer_email: p.buyer_email,
        mobile: p.mobile,
        amount: Number(p.amount),
        items: items,
        product_name: first.name || null,
        qty: first.qty || 1,
        seller: seller ? seller.name : null,
        seller_email: seller ? seller.email : null,
        status: p.status,
        method: p.method || 'mcx',
        delivery: delivery,
        created_at: p.created_at
      });
    }
    res.json({ ok: true, sales: out });
  } catch (e) { res.status(500).json({ ok: false, sales: [] }); }
});

app.post('/api/admin/sales/:ref/confirm', authAdmin, async (req, res) => {
  try {
    const [r] = await db.query("UPDATE payments SET status='finalizado', status_reason='confirmado no admin' WHERE ref=? AND method='whatsapp'", [req.params.ref]);
    res.json({ ok: true, changed: r.affectedRows > 0 });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.get('/api/admin/stats', authAdmin, async (req, res) => {
  try {
    const [u] = await db.query('SELECT COUNT(*) AS c FROM users');
    const [p] = await db.query('SELECT COUNT(*) AS c FROM products');
    const [ch] = await db.query('SELECT COUNT(*) AS c FROM chats');
    const [c] = await db.query('SELECT COUNT(*) AS c FROM cart_items');
    res.json({ users: u[0].c, products: p[0].c, chats: ch[0].c, cart: c[0].c });
  } catch (e) { res.status(500).json({}); }
});

function normalizeProduct(r) {
  let imgs = r.images || [];
  if (typeof imgs === 'string') {
    try { imgs = JSON.parse(imgs); } catch (_) { imgs = []; }
  }
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price),
    location: r.location,
    category: r.category,
    images: imgs || [],
    isNew: !!r.is_new,
    negotiable: !!r.negotiable,
    boost: !!r.boost,
    status: r.status || 'active',
    views: r.views || 0,
    ownerEmail: r.owner_email,
    owner_name: r.owner_name,
    created_at: r.created_at
  };
}

// ─── Auto-init Database ──────────────────────────────────────────

async function initDB() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(50),
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'comprador',
      avatar TEXT,
      verified TINYINT(1) DEFAULT 1,
      province VARCHAR(255) DEFAULT '',
      municipality VARCHAR(255) DEFAULT '',
      neighborhood VARCHAR(255) DEFAULT '',
      street VARCHAR(255) DEFAULT '',
      reference VARCHAR(255) DEFAULT ''
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      location VARCHAR(255),
      category VARCHAR(100) DEFAULT 'Outros',
      images LONGTEXT,
      is_new TINYINT(1) DEFAULT 0,
      negotiable TINYINT(1) DEFAULT 0,
      boost TINYINT(1) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'active',
      views INT DEFAULT 0,
      owner_email VARCHAR(255),
      owner_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      user_email VARCHAR(255) NOT NULL,
      from_email VARCHAR(255) NOT NULL,
      text TEXT,
      timestamp BIGINT,
      read_flag TINYINT(1) DEFAULT 0
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS cart_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      product_id INT NOT NULL,
      qty INT DEFAULT 1
    )`);
    // tabela nova
    await db.query(`CREATE TABLE IF NOT EXISTS verifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(10) NOT NULL,
      used TINYINT(1) DEFAULT 0,
      attempts INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref VARCHAR(64) NOT NULL UNIQUE,
      provider_id VARCHAR(64),
      buyer_email VARCHAR(255) NOT NULL,
      mobile VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      items LONGTEXT,
      status VARCHAR(20) DEFAULT 'pending',
      status_reason VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    // colunas novas em tabelas existentes (idempotente)
    const cols = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`);
    const userCols = cols[0].map(c => c.COLUMN_NAME);
    if (!userCols.includes('verified')) {
      await db.query(`ALTER TABLE users ADD COLUMN verified TINYINT(1) DEFAULT 1 AFTER role`);
    }
    const pCols = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'`);
    const prodCols = pCols[0].map(c => c.COLUMN_NAME);
    if (!prodCols.includes('boost')) {
      await db.query(`ALTER TABLE products ADD COLUMN boost TINYINT(1) DEFAULT 0 AFTER negotiable`);
    }
    if (!prodCols.includes('status')) {
      await db.query(`ALTER TABLE products ADD COLUMN status VARCHAR(20) DEFAULT 'active' AFTER boost`);
    }
    if (!prodCols.includes('views')) {
      await db.query(`ALTER TABLE products ADD COLUMN views INT DEFAULT 0 AFTER status`);
    }
    const colVerify = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'verifications'`);
    const vCols = colVerify[0].map(c => c.COLUMN_NAME);
    if (!vCols.includes('attempts')) {
      await db.query(`ALTER TABLE verifications ADD COLUMN attempts INT DEFAULT 0`);
    }
    const colPay = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'`);
    const payCols = colPay[0].map(c => c.COLUMN_NAME);
    if (!payCols.includes('method')) {
      await db.query(`ALTER TABLE payments ADD COLUMN method VARCHAR(20) DEFAULT 'mcx'`);
    }
    if (!payCols.includes('delivery')) {
      await db.query(`ALTER TABLE payments ADD COLUMN delivery TEXT`);
    }
    // admin auto: promoção via env
    if (process.env.ADMIN_EMAIL) {
      const [r] = await db.query('UPDATE users SET role=? WHERE email=? AND (role IS NULL OR role != ?)', ['admin', process.env.ADMIN_EMAIL, 'admin']);
      console.log('ADMIN_EMAIL: ' + process.env.ADMIN_EMAIL + ' verificado' + (r.affectedRows ? ' (promovido)' : ''));
    }
    // admin separado (painel): seed inicial a partir do env ADMIN_EMAIL + ADMIN_PASSWORD
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const [cnt] = await db.query('SELECT COUNT(*) AS c FROM admins');
      if (Number(cnt[0].c) === 0) {
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        await db.query('INSERT INTO admins (name,email,password) VALUES (?,?,?)', ['Admin', String(process.env.ADMIN_EMAIL).toLowerCase(), hash]);
        console.log('Admin do painel criado a partir do env ADMIN_EMAIL/ADMIN_PASSWORD');
      }
    }
    console.log('Base de dados inicializada');
  } catch (e) {
    if (!e.message.includes('command denied'))
      console.error('Erro ao inicializar BD:', e.message);
  }
}

initDB().then(() => {
  if (!JWT_SECRET || JWT_SECRET === 'yaobisno_secret_dev')
    console.warn('⚠ Aviso: JWT_SECRET a usar o valor de desenvolvimento (define env JWT_SECRET em produção)');
  if (!transporter)
    console.warn('⚠ Aviso: SMTP não configurado — os códigos vão aparecer no console (define SMTP_HOST/USER/PASS para enviar emails reais)');
  if (process.env.BREVO_API_KEY)
    console.log('[MAIL] Brevo API configurado para envio de códigos.');
  if (!process.env.BREVO_API_KEY && !transporter)
    console.warn('🚨 NENHUM serviço de email configurado (BREVO_API_KEY ou SMTP_HOST/USER/PASS). Os códigos de recuperação de password NÃO serão entregues aos utilizadores.');
  app.listen(PORT, () => {
    console.log('Servidor a correr em http://localhost:' + PORT);
  });
});