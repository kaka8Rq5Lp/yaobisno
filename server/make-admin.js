const db = require('./db');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.log('Uso: node server/make-admin.js <email>');
    process.exit(1);
  }
  try {
    const [r] = await db.query('UPDATE users SET role=? WHERE email=?', ['admin', email.toLowerCase()]);
    if (r.affectedRows === 0) {
      console.log('User não encontrado: ' + email);
      process.exit(1);
    }
    console.log(email + ' agora é admin.');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
