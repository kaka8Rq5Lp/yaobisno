const mysql = require('mysql2');

const rawURL = process.env.DATABASE_URL;
var pool;

if (rawURL) {
  var dbName = 'test';
  try {
    const u = new URL(rawURL);
    dbName = u.pathname.replace(/^\//, '').split('?')[0] || 'test';
  } catch (_) {
    const re = /\/([a-zA-Z_][\w-]*)(?:\?|$)/g;
    let match, last;
    while ((match = re.exec(rawURL)) !== null) last = match[1];
    if (last) dbName = last;
  }
  pool = mysql.createPool({
    uri: rawURL,
    database: dbName,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 5
  });
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
