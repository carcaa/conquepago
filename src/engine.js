// Motor de recomendación: dado un comercio, monto y fecha, rankea las promos aplicables.
import { rubrosQueAplican, normalizar } from './rubros.js';

const ISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Inicio del período de tope que contiene la fecha.
export function inicioPeriodo(periodo, fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  if (periodo === 'semana') { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; }
  if (periodo === 'mes') return new Date(d.getFullYear(), d.getMonth(), 1);
  return d; // 'dia'
}

export function topeUsado(promo, consumos, fecha) {
  if (!promo.tope_monto || !promo.tope_periodo || promo.tope_periodo === 'transaccion') return 0;
  const desde = inicioPeriodo(promo.tope_periodo, fecha).getTime();
  const hasta = fecha.getTime();
  return consumos
    .filter((c) => c.promoId === promo.id)
    .filter((c) => { const t = new Date(c.fecha).getTime(); return t >= desde && t <= hasta + 864e5; })
    .reduce((s, c) => s + (c.ahorro || 0), 0);
}

// Valor presente del beneficio de pagar en n cuotas sin interés con inflación mensual i.
export function ahorroCuotas(monto, n, i) {
  if (!n || n < 2 || !monto) return 0;
  let vp = 0;
  for (let k = 1; k <= n; k++) vp += monto / n / Math.pow(1 + i, k);
  return Math.max(0, monto - vp);
}

function comercioMatchea(promo, comercio) {
  if (!promo.comercios?.length) return true;
  const n = normalizar(comercio.nombre);
  if (!n) return false;
  return promo.comercios.some((c) => { const p = normalizar(c); return n.includes(p) || p.includes(n); });
}

export function promoAplica(promo, { comercio, canal, fecha, monto }) {
  const motivos = [];
  if (promo.oculta) return { ok: false, motivos: ['oculta'] };
  if (promo.vigencia_hasta && promo.vigencia_hasta < ISO(fecha)) return { ok: false, motivos: ['vencida'] };
  if (promo.canal?.length && !promo.canal.includes(canal)) return { ok: false, motivos: ['canal'] };
  if (promo.dias?.length && !promo.dias.includes(fecha.getDay())) return { ok: false, motivos: ['dia'] };
  if (promo.rubros?.length) {
    if (!comercio.rubro) motivos.push('rubro_desconocido');
    else {
      const aplicables = rubrosQueAplican(comercio.rubro);
      if (!promo.rubros.some((r) => aplicables.has(r))) return { ok: false, motivos: ['rubro'] };
    }
  }
  if (!comercioMatchea(promo, comercio)) return { ok: false, motivos: ['comercio'] };
  if (promo.minimo_compra && monto && monto < promo.minimo_compra) return { ok: false, motivos: ['minimo'] };
  return { ok: true, motivos };
}

export function evaluar(promo, ctx) {
  const { monto, consumos, fecha, inflacion } = ctx;
  const usado = topeUsado(promo, consumos, fecha);
  const restante = promo.tope_monto ? Math.max(0, promo.tope_monto - usado) : null;
  const pct = promo.descuento_pct || 0;
  let ahorroDesc = 0;
  if (monto && pct) ahorroDesc = Math.min((monto * pct) / 100, restante ?? Infinity);
  const ahorroCuo = ahorroCuotas(monto, promo.cuotas_sin_interes, inflacion);
  const ahorro = ahorroDesc + ahorroCuo;
  // Sin monto: puntaje por % efectivo y amplitud del tope.
  const topeAgotado = restante === 0 && pct > 0;
  // Las promos con datos dudosos pesan menos: ante ahorros parecidos gana la confirmada.
  const factor = promo.confianza === 'baja' ? 0.8 : 1;
  const puntaje = factor * (monto ? ahorro : (topeAgotado ? 0 : pct * 1000 + (restante ?? 1e6) / 1e3 + (promo.cuotas_sin_interes || 0) * 50));
  return { promo, ahorro, ahorroDesc, ahorroCuo, restante, usado, topeAgotado, puntaje,
    pctEfectivo: monto ? (ahorro / monto) * 100 : null };
}

export function recomendar({ promos, perfil, comercio, canal, monto, fecha = new Date(), consumos = [], inflacion = 0.02 }) {
  const ctx = { comercio, canal, fecha, monto, consumos, inflacion };
  const evaluadas = promos
    .map((p) => ({ p, a: promoAplica(p, ctx) }))
    .filter(({ a }) => a.ok)
    .map(({ p, a }) => ({ ...evaluar(p, ctx), propia: tieneMedio(perfil, p), dudas: a.motivos }))
    .filter((e) => e.puntaje > 0 || e.promo.cuotas_sin_interes);
  const orden = (a, b) => (b.puntaje - a.puntaje) || ((a.dudas.length) - (b.dudas.length)) || confianzaN(b) - confianzaN(a);
  const propias = evaluadas.filter((e) => e.propia).sort(orden);
  const ajenas = evaluadas.filter((e) => !e.propia).sort(orden);
  const mejorPropia = propias[0]?.puntaje || 0;
  const sugerenciaAfiliacion = ajenas.find((e) => e.puntaje > mejorPropia * 1.25 && e.puntaje > 0) || null;
  return { propias, ajenas, sugerenciaAfiliacion };
}

// Una promo es usable si tenés la entidad y, cuando pide una tarjeta o paquete puntual, ese producto.
export function tieneMedio(perfil, p) {
  return perfil.entidades.includes(p.entidad) && (!p.requiere || (perfil.productos || []).includes(p.requiere));
}
// Lo que te falta para usar la promo: el producto si ya tenés la entidad, si no la entidad.
export const loQueFalta = (perfil, p) => (perfil.entidades.includes(p.entidad) && p.requiere ? p.requiere : p.entidad);

const confianzaN = (e) => ({ alta: 2, media: 1, baja: 0 })[e.promo.confianza] ?? 1;

// Mejor día de la semana para un rubro con los medios propios (para el "plan semanal").
export function mejorDiaPorRubro({ promos, perfil, rubro, canal, montoTipico, inflacion = 0.02 }) {
  const dias = [];
  const hoy = new Date();
  for (let k = 0; k < 7; k++) {
    const f = new Date(hoy); f.setDate(hoy.getDate() + k);
    const r = recomendar({ promos, perfil, comercio: { nombre: '', rubro }, canal, monto: montoTipico, fecha: f, inflacion });
    if (r.propias[0]) dias.push({ dia: f.getDay(), top: r.propias[0] });
  }
  return dias.sort((a, b) => b.top.puntaje - a.top.puntaje);
}
