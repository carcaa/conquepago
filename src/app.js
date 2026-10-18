import { interpretarQR } from './emv.js';
import { RUBROS, rubroDesdeNombre, rubroDesdeOSM, rubroDesdeTienda } from './rubros.js';
import { recomendar, mejorDiaPorRubro, loQueFalta, tieneMedio } from './engine.js';
import { importarMovimientos, resumenPorRubro, simular, parseMonto } from './analisis.js';

const $ = (s) => document.querySelector(s);
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_PL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const ars = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- estado persistido ----------
const store = {
  get(k, def) { try { const v = localStorage.getItem('cqp.' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('cqp.' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  datos: { promos: [], alternativas: [], relevado: null },
  perfil: { productos: ['Crédito BBVA', 'Crédito Nación'], ...store.get('perfil', { entidades: ['BBVA', 'MODO', 'BNA+', 'Cuenta DNI'], inflacion: 0.02 }) },
  consumos: store.get('consumos', []),
  ocultas: new Set(store.get('ocultas', [])),
  ocultasGuardadas: store.get('ocultas', null) !== null,
  modo: 'qr',
  comercio: { nombre: '', rubro: null },
  ultimaReco: null,
};
const guardar = () => { store.set('perfil', S.perfil); store.set('consumos', S.consumos); store.set('ocultas', [...S.ocultas]); };
const promos = () => S.datos.promos.map((p) => ({ ...p, oculta: S.ocultas.has(p.id) }));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- navegación ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.tab)));
function irA(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.vista').forEach((v) => (v.hidden = v.id !== 'v-' + tab));
  if (tab === 'consumos') renderConsumos();
  if (tab === 'promos') renderPromos();
  if (tab === 'perfil') renderPerfil();
  if (tab !== 'pagar') cerrarCamara();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setModo(b.dataset.modo)));
function setModo(m) {
  S.modo = m;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.modo === m));
  $('#p-qr').hidden = m !== 'qr'; $('#p-local').hidden = m !== 'local'; $('#p-online').hidden = m !== 'online';
  if (m !== 'qr') cerrarCamara();
  $('#c-nombre').placeholder = m === 'online' ? 'mercadolibre.com.ar, PedidosYa…' : 'Ej. Coto, Farmacity, YPF';
  recalcular();
}
const canal = () => (S.modo === 'online' ? 'online' : 'presencial');

// ---------- formulario de comercio ----------
const selRubro = $('#c-rubro');
selRubro.innerHTML = '<option value="">¿Qué rubro?</option>' +
  Object.entries(RUBROS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

function setComercio(c, { meta = '' } = {}) {
  S.comercio = { ...S.comercio, ...c };
  $('#c-nombre').value = S.comercio.nombre || '';
  selRubro.value = S.comercio.rubro || '';
  if (c.monto) $('#c-monto').value = c.monto.toLocaleString('es-AR');
  $('#c-meta').textContent = meta;
  recalcular();
}

$('#c-nombre').addEventListener('input', (e) => {
  const v = e.target.value;
  const r = S.modo === 'online' ? rubroDesdeTienda(v) : rubroDesdeNombre(v);
  S.comercio = { nombre: v, rubro: r || (S.comercio.rubroManual ? S.comercio.rubro : null), rubroManual: S.comercio.rubroManual && !r };
  if (r) selRubro.value = r; else if (!S.comercio.rubroManual) selRubro.value = '';
  $('#c-meta').textContent = '';
  recalcular();
});
selRubro.addEventListener('change', () => { S.comercio.rubro = selRubro.value || null; S.comercio.rubroManual = true; recalcular(); });
$('#c-monto').addEventListener('input', recalcular);
$('#f-comercio').addEventListener('submit', (e) => e.preventDefault());
const monto = () => parseMonto($('#c-monto').value || '') || null;

// ---------- QR ----------
let stream = null, raf = 0;
$('#btn-cam').addEventListener('click', abrirCamara);
$('#cam-cerrar').addEventListener('click', cerrarCamara);
async function abrirCamara() {
  if (!navigator.mediaDevices?.getUserMedia) return toast('Este navegador no permite usar la cámara. Probá con “Foto del QR”.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    return toast('No hay permiso de cámara. Habilitalo en Ajustes › Safari › Cámara.');
  }
  const v = $('#video'); v.srcObject = stream; await v.play();
  $('#cam').hidden = false;
  const c = document.createElement('canvas'); const ctx = c.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!stream) return;
    if (v.readyState >= 2 && window.jsQR) {
      const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w) || 480;
      c.width = w; c.height = h; ctx.drawImage(v, 0, 0, w, h);
      const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) { cerrarCamara(); return leerQR(code.data); }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
}
function cerrarCamara() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  $('#cam').hidden = true;
}
$('#qr-foto').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const img = await createImageBitmap(f);
  const escala = Math.min(1, 1200 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = img.width * escala; c.height = img.height * escala;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  const code = window.jsQR?.(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  e.target.value = '';
  code?.data ? leerQR(code.data) : toast('No encontré un QR en la foto. Probá más cerca y con luz.');
});
function leerQR(raw) {
  if (navigator.vibrate) navigator.vibrate(40);
  const q = interpretarQR(raw);
  if (!q) return toast('Leí un QR, pero no es de pago.');
  const partes = [q.redes.length ? 'QR de ' + q.redes.join(' / ') : 'QR interoperable', q.ciudad, q.mcc ? 'MCC ' + q.mcc : '', q.dinamico ? 'monto fijo' : ''].filter(Boolean);
  setComercio({ nombre: q.nombre, rubro: q.rubro, monto: q.monto, rubroManual: false }, { meta: partes.join(' · ') });
  if (!q.rubro) toast('No reconocí el rubro: elegilo para afinar la recomendación.');
}

// ---------- ubicación (OpenStreetMap / Overpass) ----------
$('#btn-cerca').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Este navegador no da la ubicación.');
  $('#cerca').innerHTML = '<li class="meta">Buscando comercios a tu alrededor…</li>';
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try { renderCerca(await buscarCerca(coords.latitude, coords.longitude)); }
    catch { $('#cerca').innerHTML = '<li class="meta">No pude consultar el mapa. Escribí el nombre del comercio abajo.</li>'; }
  }, () => { $('#cerca').innerHTML = '<li class="meta">Sin permiso de ubicación. Escribí el nombre del comercio abajo.</li>'; },
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
});
async function buscarCerca(lat, lon) {
  const r = 90;
  const q = `[out:json][timeout:10];(nwr(around:${r},${lat},${lon})[shop][name];nwr(around:${r},${lat},${lon})[amenity~"^(pharmacy|fuel|restaurant|fast_food|cafe|bar|pub|ice_cream|cinema|veterinary)$"][name];);out center 40;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
  const j = await res.json();
  const dist = (a, b) => { const R = 6371e3, t = Math.PI / 180; const x = (b.lon - lon) * t * Math.cos(lat * t), y = (b.lat - lat) * t; return Math.sqrt(x * x + y * y) * R; };
  return j.elements.map((e) => {
    const p = e.center || e;
    return { nombre: e.tags.name, rubro: rubroDesdeOSM(e.tags), d: dist(null, { lat: p.lat, lon: p.lon }) };
  }).sort((a, b) => a.d - b.d).slice(0, 8);
}
function renderCerca(lista) {
  if (!lista.length) { $('#cerca').innerHTML = '<li class="meta">No encontré comercios cargados en el mapa acá. Escribí el nombre abajo.</li>'; return; }
  $('#cerca').innerHTML = lista.map((c, i) =>
    `<li><button data-i="${i}">${esc(c.nombre)} <small>${esc(RUBROS[c.rubro] || '')} · ${Math.round(c.d)} m</small></button></li>`).join('');
  $('#cerca').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const c = lista[b.dataset.i];
    setComercio({ nombre: c.nombre, rubro: c.rubro, rubroManual: false }, { meta: `A ${Math.round(c.d)} m · desde OpenStreetMap` });
    $('#cerca').innerHTML = '';
  }));
}

// ---------- recomendación ----------
function recalcular() {
  const out = $('#resultado');
  const c = { nombre: $('#c-nombre').value.trim(), rubro: selRubro.value || null };
  if (!c.nombre && !c.rubro) { out.innerHTML = S.datos.promos.length ? hoyResumen() : ''; S.ultimaReco = null; return; }
  const m = monto();
  const r = recomendar({ promos: promos(), perfil: S.perfil, comercio: c, canal: canal(), monto: m, consumos: S.consumos, inflacion: S.perfil.inflacion });
  S.ultimaReco = { r, c, m };
  out.innerHTML = renderReco(r, c, m);
  out.querySelector('#reg')?.addEventListener('click', registrar);
}

function etiquetaPromo(p) {
  const partes = [];
  if (p.descuento_pct) partes.push(`${p.descuento_pct}%${p.tipo === 'reintegro' ? ' de reintegro' : ' off'}`);
  if (p.cuotas_sin_interes) partes.push(`${p.cuotas_sin_interes} cuotas s/int.`);
  if (p.tope_monto) partes.push(`tope ${ars(p.tope_monto)}${p.tope_periodo && p.tope_periodo !== 'transaccion' ? '/' + p.tope_periodo : ''}`);
  return partes.join(' · ');
}

function renderReco(r, c, m) {
  const top = r.propias.find((e) => !e.topeAgotado);
  let h = '';
  if (!top) {
    h += `<div class="reco"><div class="reco-top"><span class="eyebrow">Sin promos hoy</span>
      <div class="reco-how">Pagá con tarjeta de crédito en 1 pago</div>
      <span class="ayuda">No encontré beneficios de tus medios para ${esc(RUBROS[c.rubro] || 'este comercio')} hoy. Con crédito diferís el pago al resumen.</span></div></div>`;
  } else {
    const p = top.promo;
    h += `<div class="reco"><div class="reco-top"><span class="eyebrow">Mejor opción · ${esc(p.entidad)}</span>
      <div class="reco-how">${esc(p.como_pagar || p.titulo)}</div>
      ${m ? `<div class="ahorro">${ars(top.ahorro)} <small>de ahorro (${top.pctEfectivo.toFixed(1)}%)</small></div>`
          : `<div class="ahorro">${p.descuento_pct ? p.descuento_pct + '%' : (p.cuotas_sin_interes || '') + ' cuotas'} <small>cargá el monto para calcular</small></div>`}
      </div><div class="reco-body">
      <div class="pills">${pills(top)}</div>
      <dl class="kv">
        <dt>Beneficio</dt><dd>${esc(etiquetaPromo(p))}</dd>
        ${top.restante != null ? `<dt>Tope que te queda</dt><dd>${ars(top.restante)}</dd>` : ''}
        ${top.ahorroCuo ? `<dt>Valor de las cuotas</dt><dd>${ars(top.ahorroCuo)}</dd>` : ''}
        ${p.minimo_compra ? `<dt>Compra mínima</dt><dd>${ars(p.minimo_compra)}</dd>` : ''}
      </dl>
      ${p.requisitos ? `<p class="ayuda">${esc(p.requisitos)}</p>` : ''}
      <div class="fila">
        ${m ? '<button id="reg" class="prim">Ya pagué así: registrar</button>' : ''}
        ${p.fuente_url ? `<a class="btn ghost" href="${esc(p.fuente_url)}" target="_blank" rel="noopener">Ver bases</a>` : ''}
      </div></div></div>`;
  }
  const resto = r.propias.filter((e) => e !== top).slice(0, 5);
  if (resto.length) {
    h += '<div class="seccion-t">Otras opciones con lo que tenés</div><div class="alt">' + resto.map(fila).join('') + '</div>';
  }
  if (r.sugerenciaAfiliacion) {
    const s = r.sugerenciaAfiliacion, falta = loQueFalta(S.perfil, s.promo), alt = S.datos.alternativas.find((a) => a.entidad === falta);
    h += `<div class="afil"><span><b>Si tuvieras ${esc(falta)}</b> ${m ? `ahorrarías ${ars(s.ahorro)}` : `tendrías ${esc(etiquetaPromo(s.promo))}`} acá.</span>
      <span class="ayuda">${esc(s.promo.titulo)}${alt?.costo ? ' · Costo: ' + esc(alt.costo) : ''}</span></div>`;
  }
  return h;
}
function pills(e) {
  const out = [];
  if (e.dudas.includes('rubro_desconocido')) out.push('<span class="pill warn">Confirmá el rubro</span>');
  if (e.promo.comercios?.length) out.push('<span class="pill ok">Comercio adherido</span>');
  if (e.promo.confianza === 'baja') out.push('<span class="pill warn">Verificá vigencia</span>');
  if (e.promo.dias?.length) out.push(`<span class="pill">Solo ${e.promo.dias.map((d) => DIAS[d]).join(', ')}</span>`);
  return out.join('');
}
function fila(e) {
  const p = e.promo;
  return `<div class="alt-row ${e.topeAgotado ? 'tope' : ''}"><span class="t">${esc(p.entidad)}: ${esc(p.titulo)}</span>
    <span class="s">${e.topeAgotado ? 'Tope agotado este período' : esc(etiquetaPromo(p))}</span>
    <span class="n">${e.ahorro ? ars(e.ahorro) : (p.descuento_pct ? p.descuento_pct + '%' : '')}</span></div>`;
}

function hoyResumen() {
  const hoy = new Date();
  const lista = promos().filter((p) => !p.oculta && tieneMedio(S.perfil, p) && p.dias?.includes(hoy.getDay()) && p.descuento_pct)
    .sort((a, b) => b.descuento_pct - a.descuento_pct).slice(0, 6);
  if (!lista.length) return '';
  return `<div class="seccion-t">Lo mejor de hoy, ${DIAS[hoy.getDay()]}</div><div class="alt">` +
    lista.map((p) => `<div class="alt-row"><span class="t">${esc(p.entidad)}: ${esc(p.titulo)}</span><span class="s">${esc((p.rubros || []).map((r) => RUBROS[r] || r).join(', ') || 'Varios rubros')}</span><span class="n">${p.descuento_pct}%</span></div>`).join('') + '</div>';
}

function registrar() {
  const { r, c, m } = S.ultimaReco || {};
  const top = r?.propias.find((e) => !e.topeAgotado);
  if (!m) return;
  S.consumos.push({ id: 'c-' + Date.now(), fecha: new Date().toISOString(), comercio: c.nombre || RUBROS[c.rubro], rubro: c.rubro || 'otros',
    canal: canal(), monto: m, promoId: top?.promo.id || null, entidad: top?.promo.entidad || null, ahorro: top ? top.ahorroDesc : 0 });
  guardar();
  toast(top ? `Registrado: ${ars(top.ahorroDesc)} contra el tope de ${top.promo.entidad}` : 'Pago registrado');
  recalcular();
}

// ---------- consumos ----------
$('#imp-btn').addEventListener('click', () => importarTexto($('#imp-texto').value));
$('#imp-file').addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (f) importarTexto(await f.text()); e.target.value = ''; });
function importarTexto(t) {
  const movs = importarMovimientos(t);
  const claves = new Set(S.consumos.map((c) => c.fecha.slice(0, 10) + c.monto + c.comercio));
  const nuevos = movs.filter((m) => !claves.has(m.fecha.slice(0, 10) + m.monto + m.comercio));
  S.consumos.push(...nuevos); guardar();
  $('#imp-msg').textContent = nuevos.length ? `Importé ${nuevos.length} movimientos${movs.length - nuevos.length ? ` (${movs.length - nuevos.length} repetidos)` : ''}.` : 'No encontré movimientos nuevos con fecha y monto.';
  if (nuevos.length) $('#imp-texto').value = '';
  renderConsumos();
}

function renderConsumos() {
  const cs = S.consumos;
  const mes = new Date(); const ini = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const delMes = cs.filter((c) => new Date(c.fecha) >= ini);
  const ahorroMes = delMes.reduce((s, c) => s + (c.ahorro || 0), 0);
  const gastoMes = delMes.reduce((s, c) => s + c.monto, 0);
  $('#cons-resumen').innerHTML = `<div class="stats">
    <div class="stat"><div class="v">${ars(ahorroMes)}</div><div class="l">Ahorro registrado este mes</div></div>
    <div class="stat"><div class="v">${ars(gastoMes)}</div><div class="l">Gasto del mes (${delMes.length} pagos)</div></div></div>`;

  if (!cs.length) {
    $('#cons-analisis').innerHTML = '<div class="tarjeta vacio">Todavía no hay consumos. Importá movimientos del banco o registrá pagos desde “Pagar” y acá vas a ver en qué gastás, qué día te conviene cada rubro y si te conviene sumar otro banco o billetera.</div>';
    $('#cons-lista').innerHTML = ''; return;
  }
  const { rubros, meses } = resumenPorRubro(cs);
  const max = rubros[0]?.mensual || 1;
  const sim = simular({ consumos: cs, promos: promos(), perfil: S.perfil, inflacion: S.perfil.inflacion });
  let h = `<div class="tarjeta"><h2>En qué gastás por mes</h2><p class="meta">Promedio sobre ${meses.toFixed(1)} meses de datos</p>` +
    rubros.slice(0, 8).map((r) => `<div><div class="fila" style="justify-content:space-between"><span>${esc(RUBROS[r.rubro] || r.rubro)}${r.canal === 'online' ? ' · online' : ''}</span><span style="font-family:var(--f-num)">${ars(r.mensual)}</span></div><div class="barra"><i style="width:${(r.mensual / max) * 100}%"></i></div></div>`).join('') + '</div>';

  const plan = rubros.filter((r) => r.rubro !== 'otros').slice(0, 5).map((r) => {
    const dias = mejorDiaPorRubro({ promos: promos(), perfil: S.perfil, rubro: r.rubro, canal: r.canal, montoTipico: r.ticket, inflacion: S.perfil.inflacion });
    const d = dias[0];
    return d && d.top.ahorro > 0 ? `<div class="alt-row"><span class="t">${esc(RUBROS[r.rubro])}: los ${DIAS_PL[d.dia]}</span><span class="s">${esc(d.top.promo.como_pagar || d.top.promo.titulo)}</span><span class="n">${ars(d.top.ahorro)}<br><small class="meta">por compra</small></span></div>` : '';
  }).filter(Boolean);
  if (plan.length) h += '<div class="seccion-t">Tu plan semanal</div><div class="alt">' + plan.join('') + '</div>';

  h += `<div class="stats"><div class="stat"><div class="v">${ars(sim.potencialPropio)}</div><div class="l">Ahorro posible por mes con lo que ya tenés</div></div>
    <div class="stat"><div class="v">${ars(sim.actual)}</div><div class="l">Ahorro registrado por mes</div></div></div>`;
  if (sim.entidades.length) {
    h += '<div class="seccion-t">¿Conviene sumar otro medio?</div><div class="alt">' + sim.entidades.slice(0, 4).map((e) => {
      const a = S.datos.alternativas.find((x) => x.entidad === e.entidad);
      const noConviene = a?.costo_mensual && a.costo_mensual > e.extraMensual;
      return `<div class="alt-row" style="${noConviene ? 'opacity:.6' : ''}"><span class="t">${esc(e.entidad)}${noConviene ? ' · no compensa el costo' : ''}</span><span class="s">${esc(a?.como_afiliarse || '')}${a?.costo ? ' · ' + esc(a.costo) : ''}</span><span class="n">+${ars(e.extraMensual)}<br><small class="meta">por mes</small></span></div>`;
    }).join('') + '</div><p class="meta">Estimado con tus consumos y las promos relevadas; descontá el costo de mantenimiento antes de decidir.</p>';
  } else {
    h += '<p class="meta">Con tus consumos actuales, ningún otro banco o billetera relevado te suma ahorro.</p>';
  }
  $('#cons-analisis').innerHTML = h;

  const ult = [...cs].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 30);
  $('#cons-lista').innerHTML = '<div class="seccion-t">Últimos movimientos</div><div class="alt">' + ult.map((c) =>
    `<div class="alt-row"><span class="t">${esc(c.comercio)}</span><span class="s">${new Date(c.fecha).toLocaleDateString('es-AR')} · ${esc(RUBROS[c.rubro] || c.rubro)}${c.entidad ? ' · ' + esc(c.entidad) : ''}</span><span class="n">${ars(c.monto)}${c.ahorro ? `<br><small class="meta">−${ars(c.ahorro)}</small>` : ''}</span></div>`).join('') + '</div>';
}

// ---------- promos ----------
$('#pr-filtro').addEventListener('change', renderPromos);
$('#pr-hoy').addEventListener('change', renderPromos);
function renderPromos() {
  const ents = [...new Set(S.datos.promos.map((p) => p.entidad))];
  const f = $('#pr-filtro');
  if (f.options.length !== ents.length + 2) {
    const v = f.value || 'mias';
    f.innerHTML = '<option value="mias">Mis medios</option><option value="todas">Todas</option>' + ents.map((e) => `<option>${esc(e)}</option>`).join('');
    f.value = v;
  }
  const hoy = new Date().getDay();
  const lista = promos().filter((p) => f.value === 'todas' || (f.value === 'mias' ? S.perfil.entidades.includes(p.entidad) : p.entidad === f.value))
    .filter((p) => !$('#pr-hoy').checked || !p.dias?.length || p.dias.includes(hoy));
  $('#pr-meta').textContent = `${lista.length} promos · relevadas el ${S.datos.relevado ? new Date(S.datos.relevado + 'T12:00').toLocaleDateString('es-AR') : '—'}. Verificá las bases antes de pagar.`;
  $('#pr-lista').innerHTML = '<div class="alt">' + lista.map((p) => `<div class="alt-row" style="${p.oculta ? 'opacity:.5' : ''}">
    <span class="t">${esc(p.entidad)}: ${esc(p.titulo)}</span>
    <span class="s">${esc(etiquetaPromo(p))}${p.dias?.length ? ' · ' + p.dias.map((d) => DIAS[d].slice(0, 3)).join('/') : ' · todos los días'}${p.rubros?.length ? ' · ' + p.rubros.map((r) => RUBROS[r] || r).join(', ') : ''}${p.canal?.length === 1 ? ' · ' + p.canal[0] : ''}${p.confianza === 'baja' ? ' · ⚠ verificar' : ''}${p.solo_invitados ? ' · solo si te invitaron' : ''}${p.requiere ? ' · requiere ' + esc(p.requiere) : ''}</span>
    <span class="n"><button class="ghost" data-oc="${esc(p.id)}">${p.oculta ? 'Mostrar' : 'Ocultar'}</button></span></div>`).join('') + '</div>';
  $('#pr-lista').querySelectorAll('[data-oc]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.oc; S.ocultas.has(id) ? S.ocultas.delete(id) : S.ocultas.add(id); guardar(); renderPromos();
  }));
}

// ---------- perfil ----------
function renderPerfil() {
  const ents = [...new Set([...S.datos.promos.map((p) => p.entidad), ...S.datos.alternativas.map((a) => a.entidad), ...S.perfil.entidades])];
  $('#pf-entidades').innerHTML = ents.map((e, i) => `<label for="ent-${i}"><input type="checkbox" id="ent-${i}" value="${esc(e)}" ${S.perfil.entidades.includes(e) ? 'checked' : ''}>${esc(e)}</label>`).join('');
  $('#pf-entidades').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
    S.perfil.entidades = [...$('#pf-entidades').querySelectorAll('input:checked')].map((x) => x.value); guardar(); recalcular();
  }));
  const prods = [...new Set(S.datos.promos.map((p) => p.requiere).filter(Boolean))];
  $('#pf-productos').innerHTML = prods.map((e, i) => `<label for="prod-${i}"><input type="checkbox" id="prod-${i}" value="${esc(e)}" ${S.perfil.productos.includes(e) ? 'checked' : ''}>${esc(e)}</label>`).join('');
  $('#pf-productos').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
    S.perfil.productos = [...$('#pf-productos').querySelectorAll('input:checked')].map((x) => x.value); guardar(); recalcular();
  }));
  $('#pf-infl').value = (S.perfil.inflacion * 100).toLocaleString('es-AR') + ' %';
}
$('#pf-infl').addEventListener('change', (e) => {
  const v = parseMonto(e.target.value); if (v != null && v < 50) { S.perfil.inflacion = v / 100; guardar(); toast('Inflación actualizada'); }
  renderPerfil();
});
const btnBorrar = $('#pf-borrar-cons');
btnBorrar.addEventListener('click', () => {
  if (btnBorrar.dataset.confirmar) { S.consumos = []; guardar(); delete btnBorrar.dataset.confirmar; btnBorrar.textContent = 'Borrar consumos'; $('#pf-msg').textContent = 'Consumos borrados.'; return; }
  btnBorrar.dataset.confirmar = '1'; btnBorrar.textContent = 'Tocá de nuevo para confirmar';
});

// ---------- arranque ----------
$('#hoy').textContent = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
fetch('data/promos.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => {
  S.datos = { promos: d.promos || [], alternativas: d.alternativas || [], relevado: d.relevado };
  // Las promos solo para clientes invitados arrancan ocultas hasta que el usuario las active.
  if (!S.ocultasGuardadas) S.ocultas = new Set(S.datos.promos.filter((p) => p.solo_invitados).map((p) => p.id));
  // Entradas desde Atajos de iOS: ?tienda=<url de Safari> o ?qr=<texto escaneado>
  const q = new URLSearchParams(location.search);
  if (q.get('tienda')) {
    const t = q.get('tienda');
    let nombre = t; try { nombre = new URL(t).hostname.replace(/^www\./, ''); } catch {}
    setModo('online');
    setComercio({ nombre, rubro: rubroDesdeTienda(t), rubroManual: false }, { meta: 'Desde Safari' });
  } else if (q.get('qr')) {
    setModo('qr'); leerQR(q.get('qr'));
  } else recalcular();
  if (q.size) history.replaceState(null, '', location.pathname);
}).catch(() => toast('No pude cargar las promos.'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
