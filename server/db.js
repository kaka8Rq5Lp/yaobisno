const mysql = require('mysql2');

const rawURL = process.env.DATABASE_URL;
var pool;

if (rawURL) {
  const match = rawURL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/.+/);
  if (match) {
    pool = mysql.createPool({
      host: match[3],
      port: parseInt(match[4]),
      user: match[1],
      password: match[2],
      database: 'test',
      ssl: { rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 5
    });
  } else {
    pool = mysql.createPool({ uri: rawURL.replace(/\/[^/]+$/, '/test'), ssl: { rejectUnauthorized: true } });
  }
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
