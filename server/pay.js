// Integração ProxyPay OPG — Multicaixa Express (EMIS GPO)
// Docs: https://developer.proxypay.co.ao/opg/v1
require('dotenv').config();
const crypto = require('crypto');

const BASE = (process.env.PAY_URL || 'https://api.sandbox.proxypay.co.ao/').replace(/\/+$/, '') + '/opg/v1';
const BEARER = process.env.PAY_BEARER_TOKEN || '';
const POS_ID = parseInt(process.env.PAY_POS_ID || '123', 10);

function configured() {
  return !!BEARER;
}

async function apiCall(method, path, body, idemKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (BEARER) headers['Authorization'] = 'Bearer ' + BEARER;
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: res.status, data };
}

// Cria um pedido de pagamento (o cliente autoriza no app Multicaixa Express)
async function createPayment({ mobile, amount, callbackUrl }) {
  if (!configured()) return { ok: false, error: 'Pagamento ainda não configurado' };
  const { status, data } = await apiCall('POST', '/transactions', {
    type: 'payment',
    pos_id: POS_ID,
    mobile,
    amount: Number(amount).toFixed(2),
    callback_url: callbackUrl
  }, crypto.randomUUID());
  if (status >= 200 && status < 300 && data && data.id) {
    return { ok: true, providerId: data.id, mobile: data.mobile || mobile, amount: data.amount || Number(amount).toFixed(2) };
  }
  const detail = data && (data.detail || data.message || data.error);
  return { ok: false, error: 'Falha ao criar pagamento (' + status + ')' + (detail ? ': ' + detail : '') };
}

// Consulta o estado de uma transação no fornecedor
async function getTransaction(id) {
  if (!configured()) return { ok: false, error: 'Pagamento ainda não configurado' };
  const { status, data } = await apiCall('GET', '/transactions/' + encodeURIComponent(id));
  if (status >= 200 && status < 300 && data) return { ok: true, transaction: data };
  return { ok: false, error: 'Falha ao consultar (' + status + ')' };
}

module.exports = { configured, createPayment, getTransaction, BASE };
