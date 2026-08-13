// Envia um email de teste real — usa o SMTP do .env
// Uso: node server/test-email.js <destino>
require('dotenv').config();
const nodemailer = require('nodemailer');

const to = process.argv[2] || 'abnermikael2017@gmail.com';
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('Faltam env vars: SMTP_HOST, SMTP_USER, SMTP_PASS (define no .env)');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

console.log('A enviar de ' + SMTP_USER + ' para ' + to + ' ...');

transporter.verify(function (err) {
  if (err) {
    console.error('Falha de autenticação SMTP:', err.message);
    process.exit(1);
  }
  transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to: to,
    subject: 'Ya o bisno — email de teste',
    html: '<div style="font-family:Arial,sans-serif"><h2 style="color:#FF6B00">Ya o bisno</h2><p>Funcionou! Se estás a ler isto, o SMTP está a funcionar.</p></div>'
  }).then(function (info) {
    console.log('Enviado! MessageId:', info.messageId);
    console.log('Verifica a caixa de entrada de:', to);
    process.exit(0);
  }).catch(function (e) {
    console.error('Erro ao enviar:', e.message);
    process.exit(1);
  });
});