# Phase 2 — Slice 1: protocolo (detalle)

Complemento de `PHASE_2_SLICE_1_DESIGN.md` (§2.4 lo referencia para el protocolo
HTTP/SSE; §2.6 para la vista física). Dos partes: la vista física (`vista` dentro del
`Snapshot`, el plan de pintado — la dejó el writer de `opencode/vista-fisica/**`) y,
ahora, el protocolo HTTP+SSE en sí (`opencode/servidor/servidor-proyecto.ts`, writer
W3, tarea 2/3).

## Servidor HTTP+SSE — `opencode/servidor/servidor-proyecto.ts`

`iniciarServidor({ servicio, host?, puerto? }) => Promise<{ url, puerto, cerrar()
}>`. `servicio` viene YA construido por `opencode/servidor/servicio-con-vista.ts`
(`obtenerServicioDeProyectoConVista`, el único call site de producción autorizado a
`obtenerServicioDeProyecto` — ver más abajo, "Único punto de producción..."): el
servidor nunca decide de dónde sale el servicio, sólo lo sirve. `host` default
`"127.0.0.1"`, `puerto` default `0` (efímero — el SO elige uno libre, sin colisión
entre dos instancias corriendo a la vez). `node:http` puro, sin dependencias nuevas —
funciona igual en Node (tests) y en Bun (proceso real de OpenCode). Precedente probado
en este mismo repo: `opencode/skills/archify/bin/preview.mjs`.

### Rutas

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET/HEAD | `/` | Sirve `opencode/vista-fisica/web/index.html` |
| GET/HEAD | `/favicon.ico` | 204 sin cuerpo (revisión post red-team — sin esto, ruido de 404 en la consola del navegador) |
| GET/HEAD | `/assets/<nombre>` | Sirve un asset de la lista blanca (ver abajo), o 404 |
| GET/HEAD | `/api/proyecto` | Devuelve el `Snapshot` autoritativo, JSON completo |
| POST | `/api/operaciones` | Aplica un `SobreOperacion` (ver abajo) |
| GET | `/api/eventos` | SSE — evento `revision` en cada commit real |
| cualquiera | cualquier otra ruta | 404 |
| método no soportado en una ruta conocida | — | 405, con `Allow` |

### Lista blanca de `/assets/<nombre>`

Fija, calculada una sola vez al arrancar (`Map<nombre, Buffer>`, los archivos se leen
UNA vez a memoria):

| `nombre` | Archivo real |
| --- | --- |
| `wokwi-bundle.js` | `opencode/tecniabot-web/wokwi-bundle.js` (el mismo bundle de `circuito.ts`) |
| `componentes-extra.js` | `opencode/tecniabot-web/componentes-extra.js` — en la lista blanca, servible, pero `index.html` de este slice NO lo carga (ESP32+LED no necesita ninguna pieza custom) |
| `app.js` | `opencode/vista-fisica/web/app.js` |
| `pintar.js` | `opencode/vista-fisica/web/pintar.js` |
| `plan-de-pintado.js` | `opencode/vista-fisica/web/plan-de-pintado.js` |

**Path traversal cerrado por construcción, no por sanitización**: `nombre` (el texto
crudo después de `/assets/`) NUNCA se usa para construir una ruta de archivo — es
sólo la clave de un `Map` ya fijo. Un `nombre` como `"../../package.json"` no matchea
ninguna clave del mapa → 404, sin que el valor del atacante toque el filesystem en
ningún momento (`tests/phase2-transporte-http.test.mjs`, "GET
/assets/../../package.json"). Además, `new URL(req.url, ...)` ya normaliza los
segmentos `..` en la práctica (Node/WHATWG), así que ese ejemplo ni siquiera llega a
matchear `/assets/` — pero la lista blanca es la defensa real, no esa normalización
incidental.

### `GET /api/proyecto`

200, body = el `Snapshot` completo tal cual `servicio.snapshot()`
(`opencode/nucleo/composicion-raiz.ts::Snapshot`) — incluida la clave `vista`, porque
`servicio` siempre sale de `servicio-con-vista.ts`. Nunca envuelto en otro objeto (a
diferencia del bosquejo preliminar de ARCH-B, que proponía `{proyecto, revision}`: ese
bosquejo es anterior a que `composicion-raiz.ts`/W1 fijaran la forma final de
`Snapshot`; este documento sigue la forma real y congelada, no el bosquejo).

### `POST /api/operaciones`

**Request**: body = un `SobreOperacion` de Phase 1 (`opencode/nucleo/operaciones.ts`),
sin envoltorio nuevo — `{idOperacion, idTransaccion?, actor, baseRevision, tipo,
payload}`. Límite: **256 KiB** (un sobre real es un objeto chico; el límite es
generoso pero acota memoria — un cuerpo más grande da 400 antes de intentar
`JSON.parse`, sin acumular sin límite).

**`actor` — decisión registrada**: el servidor **FUERZA** `actor: "navegador"`
siempre, pisando lo que mande el cliente (si el body es un objeto plano) — no sólo lo
valida y rechaza si viene distinto. Este endpoint es EXCLUSIVAMENTE el canal del
navegador (la tool de OpenCode, W4, es un actor `"agente"` y usa el servicio en
proceso, nunca este POST); `actor` es metadata descriptiva que
`operaciones.ts::analizarSobreOperacion` sólo valida contra dos valores posibles, sin
cambiar ninguna regla de negocio según cuál sea — confiar en que el navegador siempre
lo mande bien sería un requisito extra sin beneficio real (un bug de `app.js`, o un
POST armado a mano en DevTools, provocaría un 400/rechazo por un campo que el
servidor YA sabe cuál tiene que ser, dado que llegó por ESTE endpoint). Si el body no
es un objeto plano (array, string, número, `null`), no hay nada que forzar — se deja
pasar tal cual y el motor lo rechaza con `SOBRE_OPERACION_INVALIDO`, estructurado.

**Response**: 200 (si el body era JSON válido, sin importar si el Engine aceptó o
rechazó la operación) con:
```json
{ "resultado": { /* ResultadoTransaccion tal cual devuelve motor.ts */ }, "snapshot": { /* Snapshot tal cual GET /api/proyecto */ } }
```
`resultado.ok:false` con un motivo en `resultado.motivos[]` (ej.
`BASE_REVISION_DESACTUALIZADA`, `datos:{baseRevision,revisionActual}`) es un
RECHAZO DE DOMINIO, no un error de transporte — el Engine PROCESÓ la operación
(la evaluó y la rechazó), que es distinto de "la request en sí es inválida". `snapshot`
en la respuesta es SIEMPRE el estado autoritativo actual (post-commit si se aceptó;
sin cambios si se rechazó) — el cliente nunca necesita adivinar ni hacer un GET
aparte para saber qué pasó.

**Códigos de TRANSPORTE (nunca de dominio)**:

| Código | Cuándo |
| --- | --- |
| 400 | JSON inválido, o cuerpo mayor a 256 KiB |
| 403 | Header `Host` no matchea `127.0.0.1:<puerto>` ni `localhost:<puerto>`; o (sólo en `POST /api/operaciones`) `Origin` ausente o distinto del origen propio |
| 404 | Ruta desconocida (incluida cualquier `/assets/<nombre>` fuera de la lista blanca) |
| 405 | Método no soportado en esa ruta (con header `Allow`) |
| 415 | (sólo en `POST /api/operaciones`) `Content-Type` distinto de `application/json` (con o sin `;charset=...` detrás) |

**Revisión post red-team (Hallazgo H3, MAJOR — `DECISIONS.md` para el detalle
completo)**: el chequeo de `Host` de arriba sólo protege contra
DNS-rebinding, nunca contra un POST cross-origin directo (el navegador manda
el `Host` real del destino sin importar qué página disparó el `fetch`). Por
eso `POST /api/operaciones` exige, ADEMÁS, en este orden: (1) `Content-Type:
application/json` (415 si no) y (2) un header `Origin` presente e IGUAL al
origen propio, `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`
(403 si no) — antes de leer el cuerpo. `app.js` ya mandaba el primero; el
segundo lo manda el navegador solo en cualquier POST same-origin (no es un
header que una página pueda omitir o falsificar), así que la demo real no
necesitó ningún cambio.

### `GET /api/eventos` (SSE)

200, `Content-Type: text/event-stream`, un preámbulo `retry: 1000` (no es un evento:
sin `data:`, un cliente que parsee bloques SSE no debe contarlo como notificación).
Por cada commit real (`servicio.suscribir`, dispara sólo cuando `ok:true` Y la
revisión efectivamente cambió — nunca en un rechazo ni en un lote vacío), el servidor
escribe:
```
event: revision
data: {"revision": 8}

```
Un rechazo (`BASE_REVISION_DESACTUALIZADA` o cualquier otro) **nunca** produce un
evento — probado en `tests/phase2-transporte-http.test.mjs` por diferencia: un
rechazo intercalado entre dos operaciones aceptadas no debe insertar un evento
espurio antes del segundo evento real (sin `sleep`: el test espera el próximo evento
por promesa, nunca por timeout). Al cerrarse la conexión (`req` `close`), el servidor
desuscribe del servicio — nunca deja un listener fantasma.

### Seguridad

- Bind exclusivo a `127.0.0.1` (nunca `0.0.0.0`), puerto efímero por defecto.
- Header `Host` validado contra `127.0.0.1:<puerto>` **o** `localhost:<puerto>`
  exacto — 403 si no matchea (anti DNS-rebinding, mismo mecanismo que
  `preview.mjs`).
- Sin CORS: todo sale del mismo origen (página, assets, API, SSE) — no hay
  cabecera `Access-Control-Allow-Origin` en ninguna respuesta.
- CSP restrictiva en TODAS las respuestas: `default-src 'none'; script-src 'self';
  style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri
  'none'; form-action 'none'`. Nunca `unsafe-eval`; `app.js`/`pintar.js`/
  `plan-de-pintado.js` son ES modules externos (`<script type="module" src=...>`),
  nunca inline.
- Otras cabeceras en todas las respuestas: `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.

### Comportamiento ante fallas

- **Cierre del servidor** (`cerrar()`): termina TODAS las conexiones SSE abiertas
  (`res.end()` + desuscripción de `servicio.suscribir`) y fuerza el cierre de
  conexiones keep-alive ociosas (`server.closeIdleConnections?.()`, mismo mecanismo
  que `preview.mjs` — si no, `server.close()` puede quedar esperando para siempre a
  que un cliente cierre su lado primero) antes de resolver.
- **Conflicto stale**: el navegador recibe `BASE_REVISION_DESACTUALIZADA` en
  `resultado.motivos`, con el `snapshot` (ya autoritativo, sin cambios) en la misma
  respuesta; `app.js` igual hace un refetch explícito de `/api/proyecto` (documentado
  en el diseño como la conducta esperada, aunque el `snapshot` de la respuesta ya sea
  autoritativo — no hay condición de carrera posible entre el rechazo y esa lectura,
  porque el servidor es de un solo hilo y no hay ningún `await` entre `aplicar()` y
  `snapshot()` dentro del handler).
- **Rechazo de dominio (Path B)**: la vista se queda en el `snapshot` que ya trae la
  respuesta (sin cambios) — nunca aplica el cambio pedido de forma optimista.
- **Aceptado con estado blocking representable (Path A)**: `resultado.ok:true`, el
  `snapshot.vista.motivos` (y por lo tanto el panel de motivos que pinta `app.js`) ya
  refleja el motivo — no hace falta ningún caso especial en el cliente.
- **SSE cortado**: `EventSource` reconecta solo (protocolo nativo); mientras está
  desconectado, la vista simplemente no recibe push nuevo, pero sigue mostrando el
  último snapshot válido.
- **Reinicio del servidor**: el puerto efímero cambia — una pestaña vieja apuntando
  al puerto muerto necesita reabrirse (mismo comportamiento aceptado que hoy con
  `file://`, informe ARCH-B).

### Único punto de producción con vista — `opencode/servidor/servicio-con-vista.ts`

`obtenerServicioDeProyectoConVista(opciones)` es el ÚNICO módulo de producción
autorizado a llamar `obtenerServicioDeProyecto` (`composicion-raiz.ts`) — siempre con
`calcularVista: vistaDeProyectoConCatalogoReal` inyectado, para que el snapshot traiga
`vista` desde la PRIMERA construcción del singleton por (directorio, idProyecto), sin
importar si quien llega primero es el servidor HTTP o (después) la tool de OpenCode
(W4). Guardia estructural nueva, mismo mecanismo fs+regex que
`scripts/guardia-composicion-raiz.mjs`: `scripts/guardia-servicio-con-vista.mjs` +
`tests/phase2-servicio-con-vista.test.mjs` — ningún archivo de producción fuera de
este módulo (y de `composicion-raiz.ts`, que lo define) referencia
`obtenerServicioDeProyecto` directo.

**Revisión post red-team (H1/H5, `DECISIONS.md` para el detalle completo)**: este
módulo, además, ahora:
- **Canonicaliza** `directorio` (`fs.mkdirSync` + `fs.realpathSync`) ANTES de llamar
  a la raíz — "dir", "dir//", una ruta relativa y un symlink al mismo directorio real
  dan el MISMO servicio. `composicion-raiz.ts` complementa esto rechazando
  cualquier `directorio` que no sea ya una ruta absoluta.
- **Toma un candado de propiedad por proyecto, a nivel proceso**
  (`<directorio>/<idProyecto>.lock`, `fs.openSync(..., "wx")`, atómico a nivel de
  sistema operativo) — si otro proceso de sistema operativo ya tiene ese
  directorio+idProyecto abierto, la llamada FALLA con un error claro
  (`"...ya está abierto en otro proceso (pid N)..."`) en vez de construir un
  segundo motor que compita en el CAS de disco de `almacen.ts`. Se libera en
  `cerrar()` y al salir del proceso. La tool y el launcher de demo atrapan este
  error y devuelven/imprimen un mensaje claro, sin colgarse.

## Vista física — `vista` dentro del `Snapshot`

`opencode/nucleo/composicion-raiz.ts::Snapshot` puede incluir una clave `vista`, con la
forma `ModeloDeVista` (`opencode/vista-fisica/modelo-vista.ts`). Sólo aparece si el
consumidor inyectó el hook `calcularVista` al llamar `obtenerServicioDeProyecto(...)` —
sin el hook, `snapshot()` NO incluye la clave (`tests/phase2-snapshot.test.mjs`, "El
campo `vista`... todavía NO existe en este slice").

### Cómo se calcula

- `opencode/vista-fisica/snapshot-a-vista.ts::proyectarVista(proyecto, catalogo)` — PURO,
  sin DOM, sin `node:`, sin I/O. Recibe la IR (`Proyecto`, copia plana del snapshot) y
  el `Catalogo` de Phase 1, y devuelve `ModeloDeVista`.
- `opencode/vista-fisica/vista-real.ts::vistaDeProyectoConCatalogoReal(proyecto)` —
  conveniencia que resuelve `proyectarVista` con el catálogo de PRODUCCIÓN
  (`construirCatalogoMinimoReal`, el MISMO que usa
  `composicion-raiz.ts::CATALOGO_REAL`). Vive en un archivo separado de
  `snapshot-a-vista.ts` porque, transitivamente, importa `node:crypto`
  (`nucleo/adaptadores/hash-catalogo.node.ts`) — mantiene `snapshot-a-vista.ts` puro
  de verdad, sin ningún import impuro, ni siquiera indirecto.

### Integración con la raíz de composición — decisión registrada

`composicion-raiz.ts` YA expone el hook `OpcionesServicioDeProyecto.calcularVista?:
(proyecto, catalogo) => unknown` (dejado por W1, sin tipo de retorno propio a
propósito: "esta raíz no inventa la forma de la vista"). Dos formas de conectar la
vista real eran posibles:

1. **La raíz usa `vistaDeProyectoConCatalogoReal` por defecto**, para que el snapshot
   siempre traiga `vista`, venga del navegador o de la tool.
2. **Cada consumidor inyecta el hook explícitamente** al construir su servicio
   (`obtenerServicioDeProyecto({ ..., calcularVista: vistaDeProyectoConCatalogoReal })`),
   y `composicion-raiz.ts` queda sin ningún default ni import de `vista-fisica/`.

Se eligió **la opción 2**, con el criterio explícito del encargo: **el núcleo
(`opencode/nucleo/**`) no depende de las vistas.** La opción 1 exige que
`composicion-raiz.ts` (que vive DENTRO de `opencode/nucleo/`) importe algo de
`opencode/vista-fisica/` — eso invierte la dirección de dependencia que el diseño
fija (`vista-fisica` depende del núcleo, nunca al revés) y además contradice la
guardia 29b (`tests/nucleo-adversarial.test.mjs`): `vista-real.ts` importa
transitivamente `node:crypto` vía `hash-catalogo.node.ts`, y ese import sólo está
autorizado en dos archivos exactos dentro de `opencode/nucleo/`, ninguno de los
cuales podría volverse "todo archivo que importe `vista-fisica/`" sin reabrir esa
guardia.

Por eso `composicion-raiz.ts` **no se modificó** en este slice. Cada consumidor real
(la tool de OpenCode, el servidor HTTP, los tests de integración) es responsable de
pasar `calcularVista: vistaDeProyectoConCatalogoReal` la PRIMERA vez que llama
`obtenerServicioDeProyecto(...)` para un (directorio, idProyecto) dado — el hook sólo
se fija en la construcción del servicio (`composicion-raiz.ts`, docstring de
`calcularVista`), nunca en llamadas posteriores que reusan el singleton. Verificado
por `tests/phase2-vista-fisica.test.mjs`, sección 7 ("Integración: el hook
`calcularVista`..."): el snapshot con el hook inyectado trae la MISMA vista que
`proyectarVista` calculada por fuera con el mismo catálogo real.

**Nota para el writer siguiente (servidor HTTP / tool):** al construir el servicio del
proyecto activo, pasar siempre `calcularVista: vistaDeProyectoConCatalogoReal` (importado
de `opencode/vista-fisica/vista-real.ts`) — así el snapshot que sirve el servidor y el
que usa la tool traen `vista` desde el primer momento, sin duplicar catálogos ni volver
a tocar `composicion-raiz.ts`.

### Forma de `ModeloDeVista` (`opencode/vista-fisica/modelo-vista.ts`)

```ts
interface ModeloDeVista {
  placa: { id: string; elementoWokwi: string; escala: number } | null
  componentes: Array<{
    id: string
    tipo: string
    elementoWokwi: string | null // null = tipo sin tabla de render (gap documentado)
    atributos: Record<string, string> // presentación pura (ej. {color:"red"})
    terminales: Record<string, TerminalVista>
  }>
  cables: Array<{ id: string; desde: ExtremoCableVista; hasta: ExtremoCableVista }>
  gpiosDisponibles: Record<string, Record<string, Array<{ pinSemantico: string; nombreWokwi: string }>>>
  // componente.id -> terminal.id -> candidatos (sólo terminales NO riel-fijo)
  motivos: Motivo[] // tal cual validarProyecto() — nunca reclasificado
  readiness: { incompleto: boolean; invalido: boolean; listo: boolean } // tal cual derivarReadiness()
}
```

`TerminalVista` tiene 4 variantes (`estado`): `asignado` (pin de placa asignado),
`sinAsignar` (terminal no riel-fijo, sin pin todavía), `rielFijo` (terminal riel-fijo
CON `destinoFijo` declarado, ej. el cátodo del LED → GND) y `puente` (terminal
riel-fijo SIN `destinoFijo`, ej. los dos terminales de la resistencia — su cableado
sale sólo de `Proyecto.conexiones`, nunca de un destino inventado).

`ExtremoCableVista` tiene 3 variantes (`tipo`): `pinPlaca` (pin semántico + nombre
Wokwi de la PLACA), `terminal` (componente + terminal + nombre Wokwi de la PIEZA, si
`wokwi-render-datos.ts` lo declara) y `rielFijo` (destino, ej. `"GND"`).

### Límite conocido, heredado — no lo cierra este módulo

`gpiosDisponibles` sale de `asignarPin()` (`nucleo/catalogo.ts`), pin por pin. Esa
función filtra por `RegistroPin.capacidades` (salidaDigital/entradaDigital/pwm/adc)
— eso SÍ excluye los pines `soloEntrada` del ESP32 (GPIO34/35/36/39). Pero
`asignarPin()` NUNCA mira `RegistroPin.restricciones` (`flashReservado`/`strapping`/
`uartUsb`): ningún validador de Fase 1 consume ese campo hoy (verificado: `rg
restriccion -i` sobre `validar-tecnico.ts`/`catalogo.ts` da cero resultados). La vista
NO cierra ese gap por su cuenta — GPIO2 (strapping), por ejemplo, sigue "disponible"
si el catálogo lo acepta hoy. Cerrarlo es una decisión de producto sobre
`nucleo/catalogo.ts`, documentada pero no resuelta acá (ver
`tests/phase2-vista-fisica.test.mjs`, sección 2, para la evidencia ejecutable de qué
SÍ filtra y qué no).

**Revisión post red-team (Hallazgo B1, MAJOR — `DECISIONS.md` para el detalle
completo)**: ADEMÁS del filtro de `asignarPin()` de arriba, `gpiosDisponibles` ahora
exige que el GPIO tenga un nombre Wokwi REAL confirmado contra el bundle
(`wokwi-render-datos.ts::nombreWokwiDePin`, nunca un `` `D${numero}` `` inventado) —
una restricción de PRESENTACIÓN (no se puede dibujar un cable a un pin que no existe
en la pieza), nunca una regla eléctrica nueva. Por eso GPIO0/6-11/37/38 (9 números
que el catálogo acepta pero que el `<wokwi-esp32-devkit-v1>` real no representa) ya
NO aparecen ofrecidos, mientras que GPIO2 (strapping, el ejemplo del gap de arriba)
SÍ sigue ofrecido, porque tiene pin físico real (`D2`) — los dos gaps son
independientes: uno es del catálogo (Fase 1, backlog), el otro era de la tabla de
render (B1, cerrado en esta ronda).

## Plan de pintado — `opencode/vista-fisica/web/plan-de-pintado.js`

JS plano (ES module, sin build step, se sirve tal cual al navegador — mismo criterio
que `opencode/tecniabot-web/*.js`), PURO: ni DOM ni red. `planDePintado(modeloDeVista)`
recibe el campo `vista` del snapshot y devuelve una lista DETERMINISTA de
instrucciones, en este orden:

1. `{ tipo: "crearElemento", entidad: {tipo:"placa", id}, tag, atributos }` — una vez,
   si hay placa.
2. `{ tipo: "crearElemento", entidad: {tipo:"componente", id}, tag, atributos }` — una
   por componente CON tabla de render (`elementoWokwi !== null`); un componente sin
   tabla se omite, nunca se dibuja con un tag inventado.
3. `{ tipo: "filaCable", id, desde, hasta }` — una por cable de `modeloDeVista.cables`,
   con `desde`/`hasta` ya resueltos a una etiqueta de texto (nombre Wokwi del pin, o el
   destino del riel fijo).
4. `{ tipo: "selectorGpio", componenteId, terminalId, opciones: [{valor, etiqueta}],
   valorActual }` — uno por (componente, terminal) que `gpiosDisponibles` ofrezca;
   `valorActual` es el `pinSemantico` asignado hoy, o `null` si el terminal está sin
   asignar.
5. `{ tipo: "panelMotivo", codigo, severidad, clasificacion, entidad }` — uno por
   motivo de `modeloDeVista.motivos`, en el mismo orden estable que ya certifica
   `nucleo/motivos.ts::compararMotivos`.

El consumidor de este plan (`pintar.js`, DOM real — writer siguiente) es
deliberadamente "tonto": aplica estas instrucciones tal cual, sin ninguna decisión
propia. `plan-de-pintado.js` nunca referencia una URL externa en ninguna instrucción
(`tests/phase2-vista-fisica.test.mjs` lo verifica con un escaneo de texto) — offline
por diseño (§2.9 del diseño congelado).

## `pintar.js` — aplica el plan al DOM, "tonto"

`pintar(doc, instrucciones, manejadores?) => {circuito, cables, controles, motivos}`
(cuatro raíces NUEVAS por llamada — nunca reusa/muta un DOM anterior). Recibe `doc`
como parámetro (nunca el global `document`), así que es testeable con un "document"
mínimo fabricado a mano (`tests/phase2-pintar.test.mjs`) — sólo usa
`createElement`/`setAttribute`/`appendChild`, más `addEventListener` en el `<select>`
del selector de GPIO (detrás de un chequeo de tipo, para no romper con un fake que no
lo implemente). `manejadores.onCambioGpio({componenteId, terminalId, valor})` es la
única integración con el llamador — `valor` es `null` cuando el usuario elige "sin
asignar" (AsignarPin con `pin:null` es una forma válida,
`nucleo/operaciones.ts::validarFormaPayload`).

## `app.js` — único módulo que habla con el transporte

`fetch('/api/proyecto')` al cargar y repinta; `new EventSource('/api/eventos')`, y en
cada evento `revision` vuelve a pedir el snapshot y repinta (nunca aplica el
`{revision}` del evento de forma optimista). El selector de GPIO arma un
`AsignarPin` con `baseRevision` del ÚLTIMO snapshot autoritativo (`ultimoSnapshot.
revision`, nunca un contador local) y hace `POST /api/operaciones`; con la respuesta
repinta SIEMPRE desde `cuerpo.snapshot` (nunca desde el estado que el `<select>`
mostraba antes del POST). Si el motivo es `BASE_REVISION_DESACTUALIZADA`, muestra "otro
cambio llegó primero" y hace un refetch explícito; con cualquier otro rechazo (Path
B), muestra el código del motivo y se queda en el snapshot que ya trajo la respuesta;
con un `ok:true` sobre un estado blocking representable (Path A), el motivo ya
aparece en el panel de motivos vía el propio plan de pintado — no hay caso especial.
Los mensajes salen literal de `motivo.codigo` — nunca una causa inventada.
