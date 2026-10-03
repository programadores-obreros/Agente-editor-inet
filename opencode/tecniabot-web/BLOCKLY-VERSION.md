# Blockly — versión vendorizada

- **Paquete:** `blockly` **13.3.0**
- **Origen:** tarball oficial del registro npm, https://registry.npmjs.org/blockly/-/blockly-13.3.0.tgz
- **Tarball sha512:** `qAHFGMGTSF67Lupr3pjZz9LQu4JCFdN76CMZxegBKiveZreK08yXhaCz0g9q9/xe5GEdoeFT3POAlQavPIRPEw==`
- **Tarball shasum (sha1):** `18947fe0f4992bbf1ee5051e2d18dabee7ee9581`
- **Licencia:** Apache-2.0 (`LICENSE-blockly`, copia del `LICENSE` del paquete)

## Archivos (byte-idénticos a los del tarball; no se modifican)

| Archivo aquí | Origen en el tarball | Bytes | sha256 |
|---|---|---|---|
| `blockly_compressed.js` | `blockly_compressed.js` | 640346 | `d3f46af56951a7aed27f09f872dca66ed70a932ca8be9aade3d9df06ceacd078` |
| `blockly-es.js` | `msg/es.js` | 56482 | `432e126da36a91203029c418a0d399c3dadbb9811730e22b9ee9930ce62c60a1` |

## Alcance

- Infraestructura de **presentación** únicamente: no es modelo de dominio, ni persistencia, ni backend de
  código. No se vendorizan generadores (no generators): ni JavaScript, ni Python, ni otros.
- Se cargan como `<script>` clásicos (UMD): primero el núcleo, después los mensajes en español.
- Sin medios (`media/`): con `sounds: false` y sin papelera, zoom ni arrastre, Blockly no pide ninguno
  (la flecha del dropdown es SVG en línea). Si una prueba en navegador real demostrara que hace falta uno,
  sería un cambio aparte y declarado.

## Estrategia offline

- Todo se sirve desde el propio servidor local (`/assets/blockly_compressed.js`, `/assets/blockly-es.js`) por la
  lista blanca explícita de `opencode/servidor/servidor-proyecto.ts`. Sin CDN, sin carga dinámica remota.
- La CSP no cambia (`script-src 'self'`, sin `unsafe-eval`).
- `scripts/escaneo-assets-offline.mjs` reporta 0 cargas reales para ambos archivos.
- El instalador copia `tecniabot-web/` entero (`install.sh`, `install.ps1`), así que no hay lista que editar.

## Cómo actualizar

Bajar el tarball de la versión nueva, verificar su sha512 contra el registro, reemplazar los dos archivos
y la licencia, y actualizar esta nota y las constantes de `tests/phase3-blockly-vendor.test.mjs`.
