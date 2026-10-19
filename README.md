# ¿Con qué pago?

PWA para iPhone que, antes de pagar, identifica el comercio y te dice con qué billetera/tarjeta conviene terminar el checkout según tus medios (BBVA, MODO, BNA+, Cuenta DNI), el día, el rubro y el tope que te queda.

## Cómo identifica el comercio

| Situación | Cómo |
|---|---|
| QR en la caja | Lee el QR interoperable (EMVCo): nombre, ciudad, MCC (rubro), red (Mercado Pago, MODO…) y monto si es dinámico. |
| Tarjeta / acercar el celular | iOS no deja leer el posnet. Usa tu ubicación y OpenStreetMap para listar los comercios a menos de 90 m. |
| Compra web | Link o nombre de la tienda → rubro (Mercado Libre, PedidosYa, Fravega…). |

## Estructura

- `src/emv.js`: parser EMVCo + CRC16.
- `src/rubros.js`: rubros, MCC, cadenas conocidas y tags de OSM.
- `src/engine.js`: motor de recomendación (días, rubro, comercio adherido, mínimo, tope restante por período y valor presente de las cuotas).
- `src/analisis.js`: importación de movimientos, gasto por rubro y simulación de "¿conviene sumar otro banco?".
- `data/promos.json`: promos relevadas. Para actualizar, se edita este archivo y se vuelve a publicar.
- Los datos personales (perfil y consumos) quedan en `localStorage` del teléfono.

## Correr local

```bash
cd ~/Claude/Code/ConQuePago && python3 -m http.server 8095
```

La cámara y la ubicación en el iPhone necesitan HTTPS, así que para usarla en el teléfono hay que publicarla (Vercel, Netlify o GitHub Pages).

## Atajos de iOS (opcionales)

**Comprar online desde Safari:** en Atajos, crear un atajo nuevo, activar "Mostrar en hoja para compartir" (tipo: URL) y agregar la acción *Abrir URL* con
`https://<tu-dominio>/?tienda=` + *Entrada del atajo* (codificada con "Codificar URL").

**Escanear con la cámara nativa:** acción *Escanear código QR* → *Codificar URL* → *Abrir URL* `https://<tu-dominio>/?qr=` + resultado. Se puede asignar a Ajustes › Accesibilidad › Tocar › Tocar atrás (doble toque en la espalda del iPhone).

## Widget para compras online

Un panel flotante que aparece en las tiendas online (Mercado Libre, Frávega, PedidosYa, supermercados, etc.) y en cualquier página de checkout. Detecta la tienda y el total del carrito, y te dice con qué medio pagar. El código está en `widget/src/` y reutiliza el motor de la app.

```bash
./widget/build.sh
```

Genera `widget/extension/` (extensión Chrome/Safari, Manifest V3) y `widget/conquepago.user.js` (userscript).

### Chrome (Mac/PC)
`chrome://extensions` → activar *Modo desarrollador* → *Cargar descomprimida* → elegir `widget/extension`.

### Safari en iPhone, opción A: app Userscripts (sin Xcode)
1. Instalar **Userscripts** (gratis, App Store) y en Ajustes › Safari › Extensiones activarla para "Todos los sitios web".
2. Abrir en Safari `https://carcaa.github.io/conquepago/widget/conquepago.user.js` → tocar el ícono de Userscripts → *Instalar*.

### Safari en iPhone y Mac, opción B: extensión nativa (Xcode)
```bash
xcrun safari-web-extension-converter widget/extension --project-location widget/safari --app-name "Con que pago" --bundle-identifier ar.carcaa.conquepago --swift --no-open
```
Abrir el proyecto en Xcode, elegir tu Apple ID en *Signing & Capabilities*, conectar el iPhone y correr. Con una cuenta gratuita la firma dura 7 días; para que quede fija hace falta Apple Developer (USD 99/año).

Chrome en iPhone no admite extensiones.
