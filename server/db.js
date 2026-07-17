const mysql = require('mysql2');

const rawURL = process.env.DATABASE_URL;
var pool;

if (rawURL) {
  var dbName = 'test';
  var opts = {};
  try {
    const u = new URL(rawURL);
    dbName = u.pathname.replace(/^\//, '').split('?')[0] || 'test';
    opts = {
      host: u.hostname,
      port: parseInt(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch (_) {
    const m = rawURL.match(/\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
    if (m) {
      dbName = m[5];
      opts = { host: m[3], port: parseInt(m[4]), user: m[1], password: m[2] };
    }
  }
  pool = mysql.createPool(Object.assign(opts, {
    database: dbName,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 5
  }));
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
