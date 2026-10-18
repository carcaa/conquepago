// Análisis de consumos: importación de movimientos, gasto por rubro y simulación de afiliaciones.
import { rubroDesdeNombre, normalizar } from './rubros.js';
import { recomendar, inicioPeriodo, loQueFalta } from './engine.js';

const ONLINE = /mercado ?libre|merpago|mercadopago\*|pedidos ?ya|rappi|netflix|spotify|amazon|aliexpress|steam|google|apple\.com|www\.|\.com|tiendanube|despegar|disney|hbo|uber/i;

// Monto en formato argentino (1.234,56) o internacional (1,234.56 / 1234.56).
export function parseMonto(s) {
  let t = s.replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && t.length - lastDot === 4 && lastComma === -1) t = t.replace(/\./g, '');
  else t = t.replace(/,/g, '');
  const n = Math.abs(parseFloat(t));
  return Number.isFinite(n) ? n : null;
}

function parseFecha(s, anioDefault) {
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (m) {
    let y = m[3] ? Number(m[3]) : anioDefault;
    if (y < 100) y += 2000;
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : null;
}

// Acepta texto pegado del home banking o CSV: una línea por movimiento con fecha, descripción y monto.
export function importarMovimientos(texto) {
  const anio = new Date().getFullYear();
  const out = [];
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const fecha = parseFecha(l, anio);
    const sinFecha = l.replace(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?|\d{4}-\d{2}-\d{2}/, ' ');
    const montos = sinFecha.match(/-?\$?\s?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g);
    if (!fecha || !montos) continue;
    const monto = parseMonto(montos[montos.length - 1]);
    if (!monto || monto < 1) continue;
    const desc = sinFecha
      .replace(montos[montos.length - 1], '')
      .replace(/[;,\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/pago (de )?tarjeta|su pago|transferencia recibida|acreditaci|sueldo|haberes|devoluci/i.test(desc)) continue;
    out.push({
      id: 'imp-' + Math.random().toString(36).slice(2, 9),
      fecha: fecha.toISOString(),
      comercio: desc.slice(0, 60),
      rubro: rubroDesdeNombre(desc) || 'otros',
      canal: ONLINE.test(desc) ? 'online' : 'presencial',
      monto,
      importado: true,
    });
  }
  return out;
}

export function resumenPorRubro(consumos) {
  if (!consumos.length) return { meses: 0, rubros: [] };
  const ts = consumos.map((c) => new Date(c.fecha).getTime());
  const dias = Math.max(30, (Math.max(...ts) - Math.min(...ts)) / 864e5 + 1);
  const meses = dias / 30;
  const acc = {};
  for (const c of consumos) {
    const k = `${c.rubro}|${c.canal}`;
    acc[k] ??= { rubro: c.rubro, canal: c.canal, total: 0, n: 0 };
    acc[k].total += c.monto; acc[k].n++;
  }
  const rubros = Object.values(acc)
    .map((r) => ({ ...r, mensual: r.total / meses, ticket: r.total / r.n }))
    .sort((a, b) => b.mensual - a.mensual);
  return { meses, rubros };
}

// Simula cada consumo con todas las promos y respeta los topes por período.
// Devuelve el ahorro con lo que ya tenés y el ahorro incremental de sumar cada entidad.
export function simular({ consumos, promos, perfil, inflacion = 0.02 }) {
  if (!consumos.length) return { meses: 0, actual: 0, potencialPropio: 0, entidades: [] };
  const { meses } = resumenPorRubro(consumos);
  // Candidatos: cada entidad o tarjeta que te falta para alguna promo.
  const faltantes = [...new Set(promos.map((p) => loQueFalta(perfil, p)))]
    .filter((k) => !perfil.entidades.includes(k) && !(perfil.productos || []).includes(k));
  const productos = new Set(promos.map((p) => p.requiere).filter(Boolean));
  const correr = (pf) => {
    const usados = []; // consumos simulados para descontar topes
    let total = 0;
    for (const c of [...consumos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha))) {
      const fecha = new Date(c.fecha);
      const r = recomendar({ promos, perfil: pf, comercio: { nombre: c.comercio, rubro: c.rubro },
        canal: c.canal, monto: c.monto, fecha, consumos: usados, inflacion });
      const top = r.propias.find((e) => !e.dudas.length);
      if (top && top.ahorro > 0) {
        total += top.ahorro;
        usados.push({ promoId: top.promo.id, fecha: c.fecha, ahorro: top.ahorroDesc });
      }
    }
    return total;
  };
  const base = correr(perfil);
  const con = (k) => productos.has(k)
    ? { ...perfil, productos: [...(perfil.productos || []), k] }
    : { ...perfil, entidades: [...perfil.entidades, k] };
  const res = faltantes
    .map((e) => ({ entidad: e, extraMensual: (correr(con(e)) - base) / meses }))
    .filter((r) => r.extraMensual > 0)
    .sort((a, b) => b.extraMensual - a.extraMensual);
  const actual = consumos.reduce((s, c) => s + (c.ahorro || 0), 0) / meses;
  return { meses, actual, potencialPropio: base / meses, entidades: res };
}

export { normalizar, inicioPeriodo };
