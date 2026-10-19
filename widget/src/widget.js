// Widget "¿Con qué pago?" para tiendas online: corre como content script (Chrome/Safari) o userscript.
import snapshot from '../../data/promos.json';
import { RUBROS } from '../../src/rubros.js';
import { recomendar, tieneMedio, loQueFalta } from '../../src/engine.js';
import { parseMonto } from '../../src/analisis.js';
import { detectarTienda, detectarMonto, esCheckout } from './detectar.js';
import CSS from './widget.css';

const PROMOS_URL = 'https://carcaa.github.io/conquepago/data/promos.json';
const APP_URL = 'https://carcaa.github.io/conquepago/';
const UN_DIA = 864e5;
const ars = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- almacenamiento: extensión, userscript o localStorage ----------
const ext = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;
const gm = typeof GM !== 'undefined' ? GM : null;
const almacen = {
  async get(k, def) {
    try {
      if (ext) { const r = await ext.get(k); return r?.[k] ?? def; }
      if (gm?.getValue) { const v = await gm.getValue(k); return v === undefined ? def : JSON.parse(v); }
      const v = localStorage.getItem('cqp.' + k); return v ? JSON.parse(v) : def;
    } catch { return def; }
  },
  async set(k, v) {
    try {
      if (ext) return await ext.set({ [k]: v });
      if (gm?.setValue) return await gm.setValue(k, JSON.stringify(v));
      localStorage.setItem('cqp.' + k, JSON.stringify(v));
    } catch {}
  },
};

async function bajarPromos() {
  if (gm?.xmlHttpRequest) {
    return new Promise((ok, mal) => gm.xmlHttpRequest({ method: 'GET', url: PROMOS_URL,
      onload: (r) => { try { ok(JSON.parse(r.responseText)); } catch (e) { mal(e); } }, onerror: mal }));
  }
  const r = await fetch(PROMOS_URL, { cache: 'no-cache' });
  return r.json();
}

// Promos: la copia guardada si es de hoy; si no, intenta bajar la última y cae al snapshot incluido.
async function cargarPromos() {
  const guardado = await almacen.get('promos', null);
  if (guardado && Date.now() - guardado.ts < UN_DIA) return guardado.datos;
  try {
    const datos = await bajarPromos();
    if (datos?.promos?.length) { almacen.set('promos', { ts: Date.now(), datos }); return datos; }
  } catch {}
  return guardado?.datos || snapshot;
}

const PERFIL_DEFAULT = { entidades: ['BBVA', 'MODO', 'BNA+', 'Cuenta DNI'], productos: ['Crédito BBVA', 'Crédito Nación'], inflacion: 0.02 };

// ---------- estado ----------
const S = {
  datos: snapshot, perfil: PERFIL_DEFAULT, tienda: detectarTienda(), monto: null, montoManual: false,
  abierto: false, ajustes: false, ocultoEn: [], ocultas: [],
};

let host, root;
function montar() {
  host = document.createElement('div');
  host.id = 'cqp-widget-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;right:16px;bottom:16px;';
  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);
  const box = document.createElement('div'); box.className = 'cqp'; root.appendChild(box);
  document.documentElement.appendChild(host);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
}

function reco() {
  const promos = S.datos.promos.map((p) => ({ ...p, oculta: S.ocultas.includes(p.id) }));
  return recomendar({ promos, perfil: S.perfil, comercio: { nombre: S.tienda.nombre, rubro: S.tienda.rubro },
    canal: 'online', monto: S.monto, inflacion: S.perfil.inflacion });
}

function etiqueta(p) {
  const x = [];
  if (p.descuento_pct) x.push(`${p.descuento_pct}%${p.tipo === 'reintegro' ? ' reintegro' : ' off'}`);
  if (p.cuotas_sin_interes) x.push(`${p.cuotas_sin_interes} cuotas s/int.`);
  if (p.tope_monto) x.push(`tope ${ars(p.tope_monto)}`);
  return x.join(' · ');
}

function render() {
  const box = root.querySelector('.cqp');
  const r = reco();
  const top = r.propias.find((e) => !e.topeAgotado);
  const resumen = top
    ? (S.monto && top.ahorro ? `Ahorrás ${ars(top.ahorro)}` : top.promo.descuento_pct ? `${top.promo.descuento_pct}% con ${top.promo.entidad}` : `${top.promo.cuotas_sin_interes} cuotas`)
    : 'Sin promos';
  if (!S.abierto) {
    box.innerHTML = `<button class="pill ${top ? 'hay' : ''}" data-a="abrir" aria-label="Abrir ¿Con qué pago?">
      <span class="logo" aria-hidden="true">%</span><span>${esc(resumen)}</span></button>`;
    return;
  }
  if (S.ajustes) { box.innerHTML = renderAjustes(); return; }
  const otras = r.propias.filter((e) => e !== top).slice(0, 3);
  const s = r.sugerenciaAfiliacion;
  box.innerHTML = `<div class="panel" role="dialog" aria-label="¿Con qué pago?">
    <div class="cab"><b>¿Con qué pago?</b>
      <span class="acc"><button class="ic" data-a="ajustes" aria-label="Ajustes">⚙</button><button class="ic" data-a="cerrar" aria-label="Minimizar">–</button></span></div>
    <div class="fila">
      <select id="rubro" aria-label="Rubro">${Object.entries(RUBROS).map(([k, v]) => `<option value="${k}" ${k === S.tienda.rubro ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input id="monto" inputmode="decimal" placeholder="Monto" aria-label="Monto" value="${S.monto ? S.monto.toLocaleString('es-AR') : ''}">
    </div>
    <div class="tienda">${esc(S.tienda.nombre)}${S.monto && !S.montoManual ? ' · total detectado' : ''}</div>
    ${top ? `<div class="top"><div class="eb">Mejor opción · ${esc(top.promo.entidad)}</div>
      <div class="how">${esc(top.promo.como_pagar || top.promo.titulo)}</div>
      <div class="ah">${S.monto ? ars(top.ahorro) + ' <small>de ahorro</small>' : esc(etiqueta(top.promo))}</div>
      ${S.monto && top.ahorroCuo ? `<div class="mt">${top.promo.cuotas_sin_interes} cuotas sin interés: equivalen a ${ars(top.ahorroCuo)} con ${(S.perfil.inflacion * 100).toLocaleString('es-AR')}% de inflación mensual${top.ahorroDesc ? ` + ${ars(top.ahorroDesc)} de descuento` : ''}</div>` : ''}
      ${top.restante != null ? `<div class="mt">Tope restante ${ars(top.restante)}${top.promo.confianza === 'baja' ? ' · verificá vigencia' : ''}</div>` : ''}
      ${top.promo.requisitos ? `<div class="mt">${esc(top.promo.requisitos)}</div>` : ''}
      ${top.promo.fuente_url ? `<a href="${esc(top.promo.fuente_url)}" target="_blank" rel="noopener">Ver bases</a>` : ''}</div>`
    : `<div class="top"><div class="how">Pagá con crédito en 1 pago</div><div class="mt">No hay promos de tus medios para ${esc(RUBROS[S.tienda.rubro] || 'esta tienda')} hoy.</div></div>`}
    ${otras.length ? '<div class="otras">' + otras.map((e) => `<div class="o"><span>${esc(e.promo.entidad)}: ${esc(e.promo.titulo)}</span><b>${e.ahorro ? ars(e.ahorro) : esc(etiqueta(e.promo))}</b></div>`).join('') + '</div>' : ''}
    ${s ? `<div class="afil">Si tuvieras <b>${esc(loQueFalta(S.perfil, s.promo))}</b>: ${S.monto ? ars(s.ahorro) : esc(etiqueta(s.promo))}</div>` : ''}
    <div class="pie"><a href="${APP_URL}" target="_blank" rel="noopener">Abrir la app</a><button class="lnk" data-a="ocultar">No mostrar en este sitio</button></div>
  </div>`;
}

function renderAjustes() {
  const ents = [...new Set(S.datos.promos.map((p) => p.entidad))];
  const prods = [...new Set(S.datos.promos.map((p) => p.requiere).filter(Boolean))];
  const chk = (grupo, v, on) => `<label><input type="checkbox" data-g="${grupo}" value="${esc(v)}" ${on ? 'checked' : ''}> ${esc(v)}</label>`;
  return `<div class="panel" role="dialog" aria-label="Ajustes">
    <div class="cab"><b>Mis medios</b><span class="acc"><button class="ic" data-a="volver" aria-label="Volver">✓</button></span></div>
    <div class="chips">${ents.map((e) => chk('entidades', e, S.perfil.entidades.includes(e))).join('')}</div>
    <div class="sub">Tarjetas y paquetes</div>
    <div class="chips">${prods.map((e) => chk('productos', e, S.perfil.productos.includes(e))).join('')}</div>
    ${S.ocultoEn.length ? `<div class="sub">Oculto en</div><div class="chips">${S.ocultoEn.map((h) => `<button class="lnk" data-a="mostrar-en" data-h="${esc(h)}">${esc(h)} ✕</button>`).join('')}</div>` : ''}
    <div class="mt">Promos relevadas el ${esc(S.datos.relevado || '—')}</div>
  </div>`;
}

function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'abrir') { S.abierto = true; refrescarMonto(); }
  if (a === 'cerrar') S.abierto = false;
  if (a === 'ajustes') S.ajustes = true;
  if (a === 'volver') S.ajustes = false;
  if (a === 'ocultar') { S.ocultoEn.push(location.hostname); almacen.set('ocultoEn', S.ocultoEn); host.remove(); return; }
  if (a === 'mostrar-en') { S.ocultoEn = S.ocultoEn.filter((h) => h !== b.dataset.h); almacen.set('ocultoEn', S.ocultoEn); }
  render();
}
function onInput(e) {
  if (e.target.id !== 'monto') return;
  S.monto = parseMonto(e.target.value) || null; S.montoManual = true;
  const pos = e.target.selectionStart; render();
  const m = root.querySelector('#monto'); m.focus(); try { m.setSelectionRange(pos, pos); } catch {}
}
function onChange(e) {
  if (e.target.id === 'rubro') { S.tienda = { ...S.tienda, rubro: e.target.value }; render(); return; }
  const g = e.target.dataset.g;
  if (g) {
    S.perfil[g] = [...root.querySelectorAll(`input[data-g="${g}"]:checked`)].map((x) => x.value);
    almacen.set('perfil', S.perfil);
  }
}

function refrescarMonto() {
  if (S.montoManual) return;
  const m = detectarMonto();
  if (m && m !== S.monto) { S.monto = m; return true; }
}

// Las tiendas son SPA: re-detectar al cambiar de URL y cuando cambia el carrito.
let ultimaUrl = location.href, t = 0;
function vigilar() {
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (location.href !== ultimaUrl) {
        ultimaUrl = location.href; S.montoManual = false;
        if (esCheckout() && !S.abierto) S.abierto = true;
      }
      const activa = root.activeElement || root.querySelector(':focus');
      if (refrescarMonto() && !activa) render();
    }, 600);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function iniciar() {
  if (window.top !== window.self) return; // no correr en iframes (pasarelas de pago, banners)
  S.ocultoEn = await almacen.get('ocultoEn', []);
  if (S.ocultoEn.includes(location.hostname)) return;
  const checkout = esCheckout();
  if (!S.tienda.conocida && !checkout) return; // en sitios desconocidos, solo en páginas de pago
  S.perfil = { ...PERFIL_DEFAULT, ...(await almacen.get('perfil', {})) };
  S.datos = await cargarPromos();
  S.ocultas = S.datos.promos.filter((p) => p.solo_invitados).map((p) => p.id);
  S.abierto = checkout;
  refrescarMonto();
  montar(); render(); vigilar();
}

if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
