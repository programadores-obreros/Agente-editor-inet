# Phase 2 — Slice 1: protocolo (detalle)

Complemento de `PHASE_2_SLICE_1_DESIGN.md` (§2.4 lo referencia para el protocolo
HTTP/SSE; este documento agrega, por ahora, sólo la parte de la vista física — §2.6 del
diseño — y el plan de pintado, tal como los dejó el writer de
`opencode/vista-fisica/**`). El protocolo HTTP (`GET /api/proyecto`,
`POST /api/operaciones`, `GET /api/eventos`) NO se documenta acá todavía: lo agrega el
writer del servidor.

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

`gpiosDisponibles` sale ÚNICAMENTE de `asignarPin()` (`nucleo/catalogo.ts`), pin por
pin. Esa función filtra por `RegistroPin.capacidades` (salidaDigital/entradaDigital/
pwm/adc) — eso SÍ excluye los pines `soloEntrada` del ESP32 (GPIO34/35/36/39). Pero
`asignarPin()` NUNCA mira `RegistroPin.restricciones` (`flashReservado`/`strapping`/
`uartUsb`): ningún validador de Fase 1 consume ese campo hoy (verificado: `rg
restriccion -i` sobre `validar-tecnico.ts`/`catalogo.ts` da cero resultados). La vista
NO cierra ese gap por su cuenta — mostrará como "disponible" un GPIO reservado a flash
(6-11) o de arranque (strapping: 0/2/12/15) si el catálogo lo acepta hoy. Cerrarlo es
una decisión de producto sobre `nucleo/catalogo.ts`, documentada pero no resuelta acá
(ver `tests/phase2-vista-fisica.test.mjs`, sección 2, para la evidencia ejecutable de
qué SÍ filtra y qué no).

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
