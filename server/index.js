const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..')));

// ─── Users ────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0 || rows[0].password !== password)
      return res.json({ ok: false, error: 'Email ou password incorretos' });
    const u = rows[0];
    res.json({ ok: true, user: { name: u.name, email: u.email, phone: u.phone, role: u.role } });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const [exist] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exist.length > 0) return res.json({ ok: false, error: 'Email já registado' });
    await db.query('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)',
      [name, email, phone, password, 'comprador']);
    res.json({ ok: true, user: { name, email, phone, role: 'comprador' } });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [r] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (r.length === 0) return res.json({ ok: false, error: 'Email não encontrado' });
    await db.query('UPDATE users SET password = ? WHERE email = ?', [password, email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erro no servidor' }); }
});

app.get('/api/user/:email', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT name,email,phone,role,avatar,province,municipality,neighborhood,street,reference FROM users WHERE email = ?', [req.params.email]);
    if (rows.length === 0) return res.json({ ok: false });
    res.json({ ok: true, user: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/user/address', async (req, res) => {
  try {
    const { email, province, municipality, neighborhood, street, reference } = req.body;
    await db.query('UPDATE users SET province=?,municipality=?,neighborhood=?,street=?,reference=? WHERE email=?',
      [province || '', municipality || '', neighborhood || '', street || '', reference || '', email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/avatar', async (req, res) => {
  try {
    const { email, avatar } = req.body;
    await db.query('UPDATE users SET avatar = ? WHERE email = ?', [avatar, email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Products ─────────────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(rows.map(normalizeProduct));
  } catch (e) { res.status(500).json([]); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, price, location, category, images, isNew, negotiable, ownerEmail, owner_name } = req.body;
    const [r] = await db.query(
      'INSERT INTO products (name,price,location,category,images,is_new,negotiable,owner_email,owner_name) VALUES (?,?,?,?,?,?,?,?,?)',
      [name, price, location, category || 'Outros', JSON.stringify(images || []), isNew ? 1 : 0, negotiable ? 1 : 0, ownerEmail, owner_name]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, price, location, category, images, isNew, negotiable } = req.body;
    await db.query(
      'UPDATE products SET name=?,price=?,location=?,category=?,images=?,is_new=?,negotiable=? WHERE id=?',
      [name, price, location, category, JSON.stringify(images || []), isNew ? 1 : 0, negotiable ? 1 : 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ─── Chats ────────────────────────────────────────────────────────

app.get('/api/chats', async (req, res) => {
  try {
    const email = req.query.email || '';
    let rows;
    if (email) {
      const [ownedProducts] = await db.query('SELECT id FROM products WHERE owner_email = ?', [email]);
      const ownIds = ownedProducts.map(p => p.id);
      if (ownIds.length > 0) {
        const placeholders = ownIds.map(() => '?').join(',');
        const [r] = await db.query(`SELECT * FROM chats WHERE user_email = ? OR (product_id IN (${placeholders}) AND user_email != '')`, [email, ...ownIds]);
        rows = r;
      } else {
        const [r] = await db.query('SELECT * FROM chats WHERE user_email = ?', [email]);
        rows = r;
      }
    } else {
      const [r] = await db.query('SELECT * FROM chats ORDER BY timestamp ASC');
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

app.post('/api/chats', async (req, res) => {
  try {
    const { product_id, user_email, from, text, timestamp } = req.body;
    await db.query('INSERT INTO chats (product_id,user_email,from_email,text,timestamp) VALUES (?,?,?,?,?)',
      [product_id, user_email || '', from, text, timestamp || Date.now()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/chats/read', async (req, res) => {
  try {
    const { product_id, user_email, reader_email } = req.body;
    const reader = reader_email || user_email || '';
    await db.query('UPDATE chats SET read_flag=1 WHERE product_id=? AND user_email=? AND from_email!=? AND read_flag=0',
      [product_id, user_email || '', reader]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ─── Cart ─────────────────────────────────────────────────────────

app.get('/api/cart/:email', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT c.id, c.product_id AS pid, c.qty, p.name, p.price FROM cart_items c JOIN products p ON c.product_id=p.id WHERE c.user_email=?',
      [req.params.email]
    );
    res.json(rows.map(r => ({ id: r.pid, name: r.name, price: Number(r.price), qty: r.qty })));
  } catch (e) { res.status(500).json([]); }
});

app.post('/api/cart', async (req, res) => {
  try {
    const { user_email, product_id } = req.body;
    const [exist] = await db.query('SELECT id,qty FROM cart_items WHERE user_email=? AND product_id=?', [user_email, product_id]);
    if (exist.length > 0)
      await db.query('UPDATE cart_items SET qty=qty+1 WHERE id=?', [exist[0].id]);
    else
      await db.query('INSERT INTO cart_items (user_email,product_id,qty) VALUES (?,?,1)', [user_email, product_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.put('/api/cart/qty', async (req, res) => {
  try {
    const { user_email, product_id, delta } = req.body;
    const [exist] = await db.query('SELECT id,qty FROM cart_items WHERE user_email=? AND product_id=?', [user_email, product_id]);
    if (exist.length === 0) return res.json({ ok: false });
    const newQty = exist[0].qty + delta;
    if (newQty <= 0) await db.query('DELETE FROM cart_items WHERE id=?', [exist[0].id]);
    else await db.query('UPDATE cart_items SET qty=? WHERE id=?', [newQty, exist[0].id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/cart', async (req, res) => {
  try {
    const { user_email, product_id } = req.body;
    await db.query('DELETE FROM cart_items WHERE user_email=? AND product_id=?', [user_email, product_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete('/api/cart/all/:email', async (req, res) => {
  try {
    await db.query('DELETE FROM cart_items WHERE user_email=?', [req.params.email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ─── Admin ─────────────────────────────────────────────────────────

app.get('/api/admin/users', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id,name,email,phone,role,province,municipality,neighborhood FROM users ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/chats', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM chats ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

app.get('/api/admin/cart', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT c.id,c.user_email,c.product_id,c.qty,p.name AS product_name,p.price FROM cart_items c LEFT JOIN products p ON c.product_id=p.id ORDER BY c.id');
    res.json(rows);
  } catch (e) { res.status(500).json([]); }
});

function normalizeProduct(r) {
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price),
    location: r.location,
    category: r.category,
    images: (typeof r.images === 'string' ? JSON.parse(r.images) : r.images) || [],
    isNew: !!r.is_new,
    negotiable: !!r.negotiable,
    ownerEmail: r.owner_email,
    owner_name: r.owner_name
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
      province VARCHAR(255) DEFAULT '',
      municipality VARCHAR(255) DEFAULT '',
      neighborhood VARCHAR(255) DEFAULT '',
      street VARCHAR(255) DEFAULT '',
      reference VARCHAR(255) DEFAULT ''
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      location VARCHAR(255),
      category VARCHAR(100) DEFAULT 'Outros',
      images TEXT,
      is_new TINYINT(1) DEFAULT 0,
      negotiable TINYINT(1) DEFAULT 0,
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
    console.log('Base de dados inicializada');
  } catch (e) {
    if (!e.message.includes('command denied'))
      console.error('Erro ao inicializar BD:', e.message);
  }
}

initDB().then(() => {
  app.listen(PORT, () => {
    console.log('Servidor a correr em http://localhost:' + PORT);
  });
});
