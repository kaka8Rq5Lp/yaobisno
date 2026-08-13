const mysql = require('mysql2');
require('dotenv').config();

const rawURL = process.env.DATABASE_URL;
const DB_SSL = String(process.env.DB_SSL || '').toLowerCase() === 'true';
var pool;

if (rawURL) {
  var host, port, user, pass, dbName = 'test';
  try {
    const u = new URL(rawURL);
    host = u.hostname; port = parseInt(u.port) || 3306;
    user = decodeURIComponent(u.username); pass = decodeURIComponent(u.password);
    if (u.pathname && u.pathname.length > 1) dbName = decodeURIComponent(u.pathname.slice(1));
  } catch (_) {
    const m = rawURL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
    if (m) { user = m[1]; pass = m[2]; host = m[3]; port = parseInt(m[4]); dbName = m[5]; }
  }
  pool = mysql.createPool({
    host, port, user, password: pass, database: dbName,
    ssl: { rejectUnauthorized: DB_SSL ? true : false },
    waitForConnections: true, connectionLimit: 5
  });
  console.log(`[DB] ligado via DATABASE_URL a ${host}:${port}/${dbName} (ssl=${DB_SSL ? 'on' : 'off'})`);
} else {
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ya_2',
    waitForConnections: true,
    connectionLimit: 10,
    ...(DB_SSL ? { ssl: { rejectUnauthorized: true } } : {})
  });
  console.log(`[DB] ligado via env a ${process.env.DB_HOST || '127.0.0.1'}/${process.env.DB_NAME || 'ya_2'} (ssl=${DB_SSL ? 'on' : 'off'})`);
}

// Teste rápido da ligação no arranque
pool.promise().query('SELECT 1').then(() => console.log('[DB] ligação OK ✓')).catch((e) => {
  console.error('[DB] FALHA na ligação:', e.code || e.message);
  console.error('[DB] Verifica DB_HOST/DB_USER/DB_PASS/DB_NAME ou DATABASE_URL no ambiente.');
});

module.exports = pool.promise();
