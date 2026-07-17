const mysql = require('mysql2');

const rawURL = process.env.DATABASE_URL;
var pool;

if (rawURL) {
  const uri = rawURL.replace(/\?.+$/, '');
  const parts = uri.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.*)/);
  if (parts) {
    pool = mysql.createPool({
      host: parts[3],
      port: parseInt(parts[4]),
      user: parts[1],
      password: parts[2],
      database: parts[5],
      ssl: { rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 5
    });
  } else {
    pool = mysql.createPool({ uri: rawURL, ssl: { rejectUnauthorized: true }, connectionLimit: 5 });
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
