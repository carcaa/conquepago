// Rubros, su jerarquía y cómo deducirlos desde MCC, nombre de comercio o tags de OpenStreetMap.

export const RUBROS = {
  supermercado: 'Supermercado', almacen: 'Almacén', carniceria: 'Carnicería', verduleria: 'Verdulería',
  comercio_barrio: 'Comercio de barrio', farmacia: 'Farmacia', perfumeria: 'Perfumería', combustible: 'Combustible',
  gastronomia: 'Gastronomía', cafe: 'Café', delivery: 'Delivery', indumentaria: 'Indumentaria', calzado: 'Calzado',
  electro: 'Electro / tecno', hogar: 'Hogar / construcción', libreria: 'Librería', jugueteria: 'Juguetería',
  transporte: 'Transporte', viajes: 'Viajes', turismo: 'Turismo', entretenimiento: 'Entretenimiento', cine: 'Cine',
  servicios: 'Servicios', salud: 'Salud', mascotas: 'Mascotas', deporte: 'Deporte', ecommerce: 'Compra online',
  marketplace: 'Marketplace', educacion: 'Educación', otros: 'Otros',
};

// Un rubro hijo también matchea promos de su padre.
const PADRE = {
  almacen: 'comercio_barrio', carniceria: 'comercio_barrio', verduleria: 'comercio_barrio',
  cafe: 'gastronomia', cine: 'entretenimiento', turismo: 'viajes', marketplace: 'ecommerce', calzado: 'indumentaria',
};

export function rubrosQueAplican(rubro) {
  const out = new Set([rubro]);
  let r = rubro;
  while (PADRE[r]) { r = PADRE[r]; out.add(r); }
  if (rubro === 'viajes') out.add('turismo');
  return out;
}

const MCC = {
  5411: 'supermercado', 5310: 'supermercado', 5499: 'almacen', 5441: 'almacen', 5451: 'almacen', 5462: 'almacen',
  5422: 'carniceria', 5912: 'farmacia', 5977: 'perfumeria', 5541: 'combustible', 5542: 'combustible', 5983: 'combustible',
  5812: 'gastronomia', 5813: 'gastronomia', 5814: 'gastronomia', 5611: 'indumentaria', 5621: 'indumentaria',
  5631: 'indumentaria', 5641: 'indumentaria', 5651: 'indumentaria', 5691: 'indumentaria', 5699: 'indumentaria',
  5661: 'calzado', 5732: 'electro', 5722: 'electro', 5734: 'electro', 5045: 'electro', 5946: 'electro',
  5200: 'hogar', 5211: 'hogar', 5251: 'hogar', 5712: 'hogar', 5719: 'hogar', 5714: 'hogar',
  5942: 'libreria', 5943: 'libreria', 5945: 'jugueteria', 4111: 'transporte', 4121: 'transporte', 4131: 'transporte',
  4511: 'viajes', 4722: 'viajes', 7011: 'turismo', 7832: 'cine', 7922: 'entretenimiento', 7996: 'entretenimiento',
  7999: 'entretenimiento', 4900: 'servicios', 4814: 'servicios', 4899: 'servicios', 8011: 'salud', 8021: 'salud',
  8062: 'salud', 8099: 'salud', 8043: 'salud', 5995: 'mascotas', 742: 'mascotas', 5941: 'deporte', 7997: 'deporte',
  8220: 'educacion', 8299: 'educacion', 5964: 'ecommerce', 5969: 'ecommerce', 5262: 'marketplace',
};

export function rubroDesdeMcc(mcc) {
  return mcc ? MCC[Number(mcc)] || null : null;
}

// Cadenas y comercios frecuentes. El orden importa: lo más específico primero.
export const COMERCIOS = [
  [/carrefour|coto|jumbo|disco|\bvea\b|changomas|chango mas|la anonima|walmart|\bdia\b|supermercado|hiper|vital|maxiconsumo|makro|diarco|yaguar/i, 'supermercado'],
  [/farmacity|farmacia|dr\.? ahorro|farmaonline|simplicity/i, 'farmacia'],
  [/ypf|shell|axion|\bpuma\b|gulf|estacion de servicio|serviclub/i, 'combustible'],
  [/pedidos ?ya|rappi|didi food/i, 'delivery'],
  [/mercado ?libre|meli|tiendamia|amazon|aliexpress|shein|temu/i, 'marketplace'],
  [/starbucks|havanna|cafe martinez|bonafide|cafe|coffee/i, 'cafe'],
  [/mc ?donald|burger king|mostaza|kfc|subway|resto|parrilla|pizzer|bar\b|cerveceria/i, 'gastronomia'],
  [/fravega|fr[aá]vega|garbarino|musimundo|cetrogar|on ?city|compumundo|megatone|naldo|samsung|apple/i, 'electro'],
  [/easy|sodimac|blaisten|corralon|ferreteria|pinturer/i, 'hogar'],
  [/despegar|aerolineas|flybondi|jetsmart|almundo|booking|airbnb|turismo/i, 'viajes'],
  [/netflix|spotify|disney|hbo|max\.com|youtube|steam|playstation|cinemark|hoyts|showcase/i, 'entretenimiento'],
  [/edenor|edesur|metrogas|aysa|personal|movistar|claro|telecentro|fibertel|abl|arba/i, 'servicios'],
  [/sube|uber|cabify|didi|subte/i, 'transporte'],
  [/carniceria|frigorifico/i, 'carniceria'],
  [/verduleria|fruteria/i, 'verduleria'],
  [/almacen|kiosco|autoservicio|panaderia|dietetica/i, 'almacen'],
  [/zara|h&m|adidas|nike|puma store|dexter|grimoldi|kevingston|equus|indumentaria/i, 'indumentaria'],
  [/libreria|cuspide|yenny|el ateneo/i, 'libreria'],
  [/jugueteria|cebra|mundo magico/i, 'jugueteria'],
  [/puppis|veterinaria|pet/i, 'mascotas'],
  [/sporting|dexter|gimnasio|megatlon|smartfit/i, 'deporte'],
];

export function rubroDesdeNombre(nombre) {
  if (!nombre) return null;
  const n = normalizar(nombre);
  for (const [re, rubro] of COMERCIOS) if (re.test(n)) return rubro;
  return null;
}

export function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function rubroDesdeOSM(tags) {
  const s = tags.shop, a = tags.amenity;
  const SHOP = {
    supermarket: 'supermercado', convenience: 'almacen', butcher: 'carniceria', greengrocer: 'verduleria',
    bakery: 'almacen', deli: 'almacen', chemist: 'farmacia', cosmetics: 'perfumeria', perfumery: 'perfumeria',
    clothes: 'indumentaria', shoes: 'calzado', electronics: 'electro', mobile_phone: 'electro', computer: 'electro',
    appliance: 'electro', hardware: 'hogar', doityourself: 'hogar', furniture: 'hogar', books: 'libreria',
    stationery: 'libreria', toys: 'jugueteria', pet: 'mascotas', sports: 'deporte', kiosk: 'almacen',
    department_store: 'indumentaria', mall: 'otros', optician: 'salud',
  };
  const AMENITY = {
    pharmacy: 'farmacia', fuel: 'combustible', restaurant: 'gastronomia', fast_food: 'gastronomia', cafe: 'cafe',
    bar: 'gastronomia', pub: 'gastronomia', ice_cream: 'gastronomia', cinema: 'cine', theatre: 'entretenimiento',
    veterinary: 'mascotas', clinic: 'salud', dentist: 'salud', doctors: 'salud',
  };
  return rubroDesdeNombre(tags.brand || tags.name) || SHOP[s] || AMENITY[a] || (s ? 'otros' : null);
}

// Para compras web: dominio/nombre de tienda -> rubro
export function rubroDesdeTienda(texto) {
  let host = texto;
  try { host = new URL(texto.includes('://') ? texto : 'https://' + texto).hostname; } catch {}
  return rubroDesdeNombre(host.replace(/^www\./, '').replace(/\.(com|net)(\.ar)?$/, '')) || rubroDesdeNombre(texto);
}
