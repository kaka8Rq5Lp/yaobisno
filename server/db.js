const mysql = require('mysql2');

const rawURL = process.env.DATABASE_URL;
var pool;

if (rawURL) {
  try {
    const url = new URL(rawURL);
    const dbName = url.pathname.replace(/^\//, '').split('?')[0] || 'test';
    pool = mysql.createPool({
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: dbName,
      ssl: { rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 5
    });
  } catch (e) {
    console.error('Erro ao parsear DATABASE_URL, a usar uri diretamente:', e.message);
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
