// Parser de QR EMVCo (Merchant Presented Mode), estándar del QR interoperable argentino.
import { rubroDesdeMcc, rubroDesdeNombre } from './rubros.js';

export function parseTLV(str) {
  const out = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const id = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (!/^\d{2}$/.test(id) || Number.isNaN(len)) throw new Error('TLV inválido');
    out[id] = str.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

// CRC16-CCITT (poly 0x1021, init 0xFFFF) sobre todo el payload hasta "6304" inclusive.
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const REDES = [
  [/mercadopago|mercadolibre|mpago/i, 'Mercado Pago'],
  [/modo/i, 'MODO'],
  [/naranja/i, 'Naranja X'],
  [/uala/i, 'Ualá'],
  [/payway|prisma/i, 'Payway'],
  [/getnet/i, 'Getnet'],
  [/fiserv|firstdata|posnet/i, 'Fiserv'],
  [/cuentadni|bapro|provincia/i, 'Cuenta DNI'],
  [/personalpay/i, 'Personal Pay'],
  [/coelsa|interop/i, 'QR interoperable'],
];

export function parseEMV(raw) {
  const s = raw.trim();
  if (!s.startsWith('000201')) return null;
  const t = parseTLV(s);
  const redes = new Set();
  const cuentas = [];
  for (let n = 26; n <= 51; n++) {
    const v = t[String(n)];
    if (!v) continue;
    let sub = {};
    try { sub = parseTLV(v); } catch { /* algunos adquirentes no anidan */ }
    const gui = sub['00'] || v;
    cuentas.push({ tag: n, gui, datos: sub });
    for (const [re, nombre] of REDES) if (re.test(gui)) redes.add(nombre);
  }
  const nombre = (t['59'] || '').trim();
  const mcc = t['52'];
  const crcOk = t['63'] ? crc16(s.slice(0, s.length - 4)) === t['63'].toUpperCase() : null;
  return {
    origen: 'qr',
    nombre,
    ciudad: (t['60'] || '').trim(),
    mcc,
    rubro: rubroDesdeNombre(nombre) || rubroDesdeMcc(mcc) || null,
    monto: t['54'] ? Number(t['54']) : null,
    dinamico: t['01'] === '12',
    moneda: t['53'],
    redes: [...redes],
    cuentas,
    crcOk,
  };
}

// Algunos QR (ej. links de Mercado Pago o MODO) no son EMV sino URLs.
export function interpretarQR(raw) {
  const emv = parseEMV(raw);
  if (emv) return emv;
  if (/^https?:\/\//i.test(raw)) {
    let host = '';
    try { host = new URL(raw).hostname; } catch {}
    const red = REDES.find(([re]) => re.test(host));
    return { origen: 'qr', nombre: '', ciudad: '', mcc: null, rubro: rubroDesdeNombre(host), monto: null,
      dinamico: false, redes: red ? [red[1]] : [], cuentas: [], url: raw, crcOk: null };
  }
  return null;
}
