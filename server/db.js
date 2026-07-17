const mysql = require('mysql2');

const rawURL = process.env.DATABASE_URL;
var pool;

if (rawURL) {
  var host, port, user, pass, db = 'test';
  try {
    const u = new URL(rawURL);
    host = u.hostname; port = parseInt(u.port) || 3306;
    user = decodeURIComponent(u.username); pass = decodeURIComponent(u.password);
    db = u.pathname.replace(/^\//, '').split('?')[0] || 'test';
  } catch (_) {
    const m = rawURL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?\s]+)/);
    if (m) { user = m[1]; pass = m[2]; host = m[3]; port = parseInt(m[4]); db = m[5]; }
  }
  pool = mysql.createPool({ host, port, user, password: pass, database: db,
    ssl: { rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 5 });
} else {
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ya_2',
    waitForConnections: true,
    connectionLimit: 10
  });
}

module.exports = pool.promise();
