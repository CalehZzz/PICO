# PICO — Estructura multipágina

Tu `tienda.html` era un único archivo que simulaba varias "páginas" mostrando y
ocultando `<div>` con JavaScript. Ahora está dividido en **páginas HTML reales**
con el CSS y el JS separados, para que cada parte se mantenga ordenada por su
cuenta.

## Páginas

| Archivo            | Página            | `data-page`  |
|--------------------|-------------------|--------------|
| `index.html`       | Catálogo (inicio) | `catalog`    |
| `mis-pedidos.html` | Mis pedidos       | `myOrders`   |
| `admin.html`       | Panel admin       | `adminPanel` |
| `perfil.html`      | Perfil            | `profile`    |

La navegación del menú sigue funcionando igual: `showPage('catalog')`,
`showPage('myOrders')`, etc., pero ahora **redirige al archivo HTML** correspondiente
(mapa en `js/utils.js` → `PAGE_URLS`).

## Carpetas

```
index.html
mis-pedidos.html
admin.html
perfil.html
css/
  styles.css          ← todo el CSS (antes estaba dentro del <style>)
js/
  config.js           ← Firebase + estado global (se carga 1°)
  components.js       ← inyecta el "chrome" común: nav, carrito, modales, toast
  products.js         ← carga de productos desde Firestore
  auth.js             ← sesión (login/logout, Google) y barra de navegación
  discounts.js        ← descuentos (listeners y asignación admin)
  admin.js            ← panel de administración
  cart.js             ← carrito y checkout
  orders.js           ← mis pedidos / seguimiento por código
  catalog.js          ← render del catálogo (paginación)
  profile.js          ← perfil
  utils.js            ← utilidades + gate de sucursal + navegación
  init.js             ← arranque (se carga al final)
```

### El "chrome" compartido

El nav, el panel del carrito, los modales (checkout, QR, éxito, sucursal) y el
toast son **iguales en todas las páginas**. Para no repetirlos en cada archivo,
viven una sola vez en `js/components.js` y se inyectan al cargar. Si quieres
cambiar el menú o un modal, lo editas **una vez** ahí.

## Orden de carga (importante)

Los `<script>` van al final del `<body>` en este orden: `config` → `components`
→ módulos de lógica → `init`. No cambies ese orden: `config.js` inicializa Firebase,
`components.js` inserta la interfaz común y `init.js` arranca todo cuando el resto
ya está definido.

## Notas

- El **carrito** y la **sucursal** se guardan en `localStorage`, y la sesión la
  mantiene Firebase, así que el estado se conserva al cambiar de página.
- Los productos se cargan en todas las páginas (no solo el catálogo) para que el
  carrito muestre nombres, precios y stock correctos en cualquier lado.
- **QR de pedidos:** un enlace con `?pedido=ID` abierto por un admin ahora
  redirige automáticamente a `admin.html?pedido=ID` y resalta ese pedido.
- Debe servirse desde un servidor / hosting (p. ej. GitHub Pages). Abrir los
  `.html` con doble clic (`file://`) puede bloquear la carga de los `js/` en
  algunos navegadores.
