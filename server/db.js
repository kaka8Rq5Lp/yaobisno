const mysql = require('mysql2');

const pool = mysql.createPool(process.env.DATABASE_URL || {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'ya_2',
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool.promise();
