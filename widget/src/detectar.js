// Detección de tienda, etapa de compra y monto en la página donde corre el widget.
import { rubroDesdeTienda } from '../../src/rubros.js';
import { parseMonto } from '../../src/analisis.js';

// Tiendas conocidas: nombre legible y rubro, por dominio.
const TIENDAS = [
  [/mercadolibre\.com\.ar|mercadolibre\.com/, 'Mercado Libre', 'marketplace'],
  [/pedidosya\./, 'PedidosYa', 'delivery'],
  [/rappi\./, 'Rappi', 'delivery'],
  [/fravega\./, 'Frávega', 'electro'],
  [/garbarino\./, 'Garbarino', 'electro'],
  [/musimundo\./, 'Musimundo', 'electro'],
  [/oncity\./, 'On City', 'electro'],
  [/megatone\./, 'Megatone', 'electro'],
  [/cetrogar\./, 'Cetrogar', 'electro'],
  [/coto(digital)?\.com\.ar|cotodigital/, 'Coto Digital', 'supermercado'],
  [/carrefour\.com\.ar/, 'Carrefour', 'supermercado'],
  [/jumbo\.com\.ar/, 'Jumbo', 'supermercado'],
  [/disco\.com\.ar/, 'Disco', 'supermercado'],
  [/vea\.com\.ar/, 'Vea', 'supermercado'],
  [/diaonline|supermercadosdia/, 'Día', 'supermercado'],
  [/changomas|masonline/, 'ChangoMás', 'supermercado'],
  [/farmacity\./, 'Farmacity', 'farmacia'],
  [/farmaonline\./, 'Farmaonline', 'farmacia'],
  [/easy\.com\.ar/, 'Easy', 'hogar'],
  [/sodimac\./, 'Sodimac', 'hogar'],
  [/despegar\./, 'Despegar', 'viajes'],
  [/aerolineas\.com\.ar/, 'Aerolíneas Argentinas', 'viajes'],
  [/flybondi\./, 'Flybondi', 'viajes'],
  [/jetsmart\./, 'JetSMART', 'viajes'],
  [/booking\./, 'Booking', 'turismo'],
  [/airbnb\./, 'Airbnb', 'turismo'],
  [/cinemark|hoyts|showcase/, 'Cine', 'cine'],
  [/ticketek|allaccess|entradauno|tuentrada/, 'Entradas', 'entretenimiento'],
  [/dexter\.|sporting\.|netshoes|solodeportes/, 'Deportes', 'deporte'],
  [/nike\.com\.ar/, 'Nike', 'deporte'],
  [/adidas\.com\.ar/, 'adidas', 'deporte'],
  [/topper\.com\.ar/, 'Topper', 'deporte'],
  [/zara\.com|hm\.com|grimoldi|kevingston|equus|rapsodia/, 'Indumentaria', 'indumentaria'],
  [/puppis\./, 'Puppis', 'mascotas'],
  [/cuspide|yenny|tematika/, 'Librería', 'libreria'],
  [/juleriaque|parfumerie/, 'Perfumería', 'perfumeria'],
  [/samsung\.com|apple\.com/, 'Tecnología', 'electro'],
  [/tiendamia|amazon\.|aliexpress|shein|temu/, 'Marketplace', 'marketplace'],
];

export function detectarTienda(host = globalThis.__cqpHost || location.hostname) {
  const h = host.replace(/^www\./, '');
  for (const [re, nombre, rubro] of TIENDAS) if (re.test(h)) return { nombre, rubro, conocida: true };
  return { nombre: h, rubro: rubroDesdeTienda(h), conocida: false };
}

const RE_CHECKOUT = /checkout|carrito|cart|basket|bag|pago|payment|pagar|compra|order|finalizar|shipping|envio/i;
export function esCheckout(url = location.href, doc = document) {
  if (RE_CHECKOUT.test(new URL(url).pathname + new URL(url).search)) return true;
  const t = doc.title || '';
  return /carrito|checkout|finaliz|pagar|medio de pago/i.test(t);
}

// Busca el total de la compra: un rótulo "Total" con un importe cerca. Se queda con el más destacado.
export function detectarMonto(doc = document) {
  const candidatos = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const RE_ROTULO = /^\s*(total( a pagar| final| de la compra)?|pagás|pagas|importe total|subtotal)\s*:?\s*$/i;
  const RE_IMPORTE = /\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\$\s?\d+(?:,\d{1,2})?/;
  let n;
  while ((n = walker.nextNode())) {
    const txt = n.nodeValue;
    if (!txt || txt.length > 40 || !RE_ROTULO.test(txt)) continue;
    const el = n.parentElement;
    if (!el || el.closest('#cqp-widget-host')) continue;
    // Subir hasta 4 niveles buscando el importe en el mismo bloque.
    let bloque = el;
    for (let i = 0; i < 4 && bloque; i++, bloque = bloque.parentElement) {
      const m = (bloque.innerText || '').match(RE_IMPORTE);
      if (m) {
        const monto = parseMonto(m[0]);
        if (monto && monto >= 100) {
          const subtotal = /subtotal/i.test(txt);
          const fs = parseFloat(getComputedStyle(el).fontSize) || 14;
          candidatos.push({ monto, puntaje: fs + (subtotal ? -10 : 0) + (/total/i.test(txt) ? 5 : 0) });
        }
        break;
      }
    }
  }
  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  return candidatos[0]?.monto || null;
}
