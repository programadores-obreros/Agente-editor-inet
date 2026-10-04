# Wokwi Elements — bundle vendorizado

Esta nota registra **sólo hechos medibles** sobre `wokwi-bundle.js`. A diferencia de
`BLOCKLY-VERSION.md`, no hay registro de qué versión upstream ni qué build lo generó.

- **Versión upstream:** UNKNOWN (no hay tarball, tag ni script de build registrados)
- **Licencia:** MIT (`LICENSE-wokwi-elements`)
- **Entró al repo:** commit `262ac04` (2026-05-31, "circuitos visuales HTML con piezas reales Wokwi Elements")

## Archivo

| Archivo | Bytes | sha256 |
|---|---|---|
| `wokwi-bundle.js` | 439754 | `4f860e9035b680c6f1fc73acf24be7f22877662d29558fd8fafb1f5347b1a06d` |

## Contenido observable

- **Elementos `wokwi-*` distintos nombrados en el bundle:** 50
- **Lit embebido** (marcas de versión que el propio Lit registra en `globalThis`):
  `lit-html` 3.3.3, `lit-element` 4.2.2, `@lit/reactive-element` 2.1.2.
  Lit es BSD-3-Clause; dentro del bundle quedan 5 cabeceras `SPDX-License-Identifier: BSD-3-Clause`
  y no hay archivo LICENSE propio de Lit en el repo.

## Cómo se midió

```bash
sha256sum wokwi-bundle.js
wc -c < wokwi-bundle.js
rg -a -o '"wokwi-[a-z0-9-]+"' wokwi-bundle.js | sort -u | wc -l
rg -a -o '(reactiveElement|litHtml|litElement)Versions\?\?=\[\]\)\.push\("[0-9.]+"\)' wokwi-bundle.js
rg -a -c 'SPDX-License-Identifier: BSD-3-Clause' wokwi-bundle.js
```

Si el bundle cambia, estos valores dejan de coincidir: actualizá esta nota en el mismo commit.
