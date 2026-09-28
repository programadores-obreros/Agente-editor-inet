# Phase 2 — Vertical Slice 1: diseño ("quiero ver el LED")

Estado: diseño congelado para implementar. Base: `main` = `8b43c59` (Phase 1 mergeada por fast-forward, auditada, gate final READY). Rama: `feature/programacion-intencion-phase2`.

Fuentes: los 4 informes de recon de solo lectura (ARCH-A runtime/composition root, ARCH-B transporte, ARCH-C adaptador físico, ARCH-D plan de tests), guardados como evidencia fuera del repo. Los 4 coinciden y no hubo desacuerdo material, así que no se usó adjudicador.

## 1. Qué demuestra el slice

```
IR del proyecto → vista física (navegador) → el usuario cambia el GPIO del LED
→ operación semántica (AsignarPin) → Project Engine (única autoridad)
→ revisión N+1 → persistencia → notificación → la vista se re-proyecta
→ recarga (proceso/composición nuevos) → mismo resultado físico
```

Escenario: un ESP32 (`esp32-devkit-v1`) y un LED. Nada más.

## 2. Decisiones

### 2.1 Composition root: in-process (ARCH-A)
- El Project Engine vive dentro del proceso que aloja las tools de Tecnia Bot (el proceso Bun de OpenCode). Las tools se cargan con `import()` dinámico en ese mismo proceso y pueden conservar estado de módulo; el precedente es `opencode/tool/platformio.ts`, que mantiene cache de módulo.
- Se descartó un sidecar: en ningún eje evaluado era mejor, y sumaba un segundo proceso, más empaquetado y más superficie de crash. La durabilidad no depende de qué proceso aloja el motor, porque `almacen.ts` persiste antes del swap.
- Módulo nuevo `opencode/nucleo/composicion-raiz.ts`. Es el ÚNICO lugar de producción autorizado a construir un `Almacen`. Expone `obtenerServicioDeProyecto(...)`: una factory idempotente que devuelve un singleton por (directorio de proyectos, id de proyecto). Garantiza UN solo Engine vivo por proyecto en el proceso: así se responde al límite REA-N5 del CAS de E3-07, sin relajar el CAS.
- El "servicio de proyecto" que expone la raíz tiene esta superficie:
  - `snapshot()`, que devuelve el DTO plano;
  - `aplicar(sobre)` / `aplicarTransaccion(sobres)`, que delegan en el motor;
  - `suscribir(listener)`, para cambios de revisión;
  - `cerrar()`, que cierra el servicio.
  NO expone el Almacen, `guardar`, `cargar` ni el motor crudo con referencias mutables.

### 2.2 E3-04b (condición de entrada): se cierra en este slice
- La raíz de composición crea el Almacen internamente y nunca lo devuelve.
- Tests guardia, primero en RED:
  - (a) la superficie exportada de `composicion-raiz.ts` es exactamente la factory más los tipos;
  - (b) el servicio devuelto no tiene `guardar`, `cargar`, `existe` ni ninguna referencia al Almacen (se verifica recorriendo claves y prototipos);
  - (c) guardia estructural en JS puro: ningún archivo de producción fuera de `opencode/nucleo/almacen.ts` y `opencode/nucleo/composicion-raiz.ts` importa `almacen.ts` ni referencia `crearAlmacen`. Los tests quedan exceptuados.
- Sin DI, sin proxies y sin frameworks, como decidió `DECISIONS.md`. `crearAlmacen` sigue siendo un export de `almacen.ts`, porque los tests de Phase 1 lo usan y no se tocan. La frontera la hacen cumplir la raíz única y el guardia (c), que falla si aparece otro llamador.

### 2.3 Transporte: HTTP + SSE, un solo origen, loopback (ARCH-B)
- Módulo `opencode/servidor/servidor-proyecto.ts`, con `node:http`. Funciona igual en Node (tests) y en Bun (OpenCode), sin dependencias nuevas.
- Escucha en `127.0.0.1`, puerto efímero (`listen(0)`). Valida el header `Host` (anti DNS-rebinding), sin CORS y con CSP restrictiva. Mismo patrón que el precedente `opencode/skills/archify/bin/preview.mjs`.
- Todo sale del MISMO origen: la página, los assets locales (`wokwi-bundle.js`), el snapshot, las operaciones y los eventos. No hay `file://` para la vista interactiva. `file://` no era el bug de arquitectura; lo que faltaba era el canal de estado y autoridad.
- Se descartó WebSocket: el slice no necesita un canal bidireccional, porque las operaciones van por POST. También se descartó el polling: SSE es igual de simple y evita latencia y ruido.

### 2.4 Protocolo (detalle en PHASE_2_SLICE_1_PROTOCOL.md)
- `GET /api/proyecto` devuelve el snapshot autoritativo (JSON plano, sin referencias).
- `POST /api/operaciones`:
  - El cuerpo es un `SobreOperacion` de Phase 1 tal cual (`idOperacion`, `actor: "navegador"`, `tipo`, `payload`, `baseRevision`).
  - La respuesta es el `ResultadoTransaccion` serializado más el snapshot resultante.
  - HTTP 200 si el Engine procesó la operación. Los rechazos de dominio van en `motivos[]` (por ejemplo `BASE_REVISION_DESACTUALIZADA`, con `datos.revisionActual`).
  - 4xx sólo para errores de transporte (JSON inválido, Host inválido, método no permitido).
- `GET /api/eventos` (SSE) emite `revision` con `{ revision }` cada vez que el Engine commitea (por cualquier cliente: navegador o tool). El navegador vuelve a pedir el snapshot al recibirlo.
- No se inventa ninguna operación nueva. Cambiar el GPIO del LED es `AsignarPin({ componente, terminal: "anodo", pin })`, que ya existe en Phase 1 (ARCH-C).

### 2.5 Snapshot (DTO)
Contiene lo que la vista necesita, en datos planos y serializables:
- `idProyecto`, `revision`, `catalogoVersion`, `catalogoHash`;
- `proyecto`: la IR canónica, como copia plana;
- `validacion`: `motivos` de `validarProyecto` y `readiness` derivada;
- `vista`: el modelo de vista física (§2.6), calculado del lado del servidor con el módulo puro.
Mutar el snapshot no afecta al canónico, porque cada snapshot es una copia nueva.

### 2.6 Adaptador IR → vista física (ARCH-C)
- Módulo nuevo `opencode/vista-fisica/`:
  - `snapshot-a-vista.ts`: PURO, sin DOM, testeable en node. Recibe (Proyecto, Catalogo) y devuelve un `ModeloDeVista`: la placa y su elemento Wokwi, los componentes con su elemento Wokwi, las asignaciones pin semántico → pin físico, los cables, los GPIO ofrecidos para editar y los motivos por entidad.
  - `wokwi-render-datos.ts`: datos presentacionales (semántico → renderer, GPIO → nombre del pin Wokwi) COPIADOS de `circuito.ts`, citando la línea de origen. No se importa `circuito.ts`.
- GPIO ofrecidos: salen del catálogo, pin por pin, con la regla ya existente (`asignarPin`) del catálogo de Phase 1. El navegador no decide nada.
  - Límite conocido: el dato `RegistroPin.restricciones` (flash/strapping) no lo consume ningún validador de Phase 1, y el slice NO inventa esa regla. Queda anotado para después, sin reabrir Phase 1.
- Navegador: `opencode/vista-fisica/web/`, JS plano servido por el servidor.
  - `plan-de-pintado.js`: PURO, recibe el `ModeloDeVista` y produce la lista de elementos y atributos a crear. Se testea en node.
  - `pintar.js`: aplica ese plan al DOM y es "tonto".
  - `app.js`: fetch del snapshot, SSE y el selector de GPIO que arma y envía el sobre con `baseRevision`.
- Cables: esquemáticos (placa → LED por nombre de pin), sin geometría real de `pinInfo`. El dibujo geométrico queda fuera del slice.
- `circuito.ts` NO se modifica. `pinouts.json` NO se usa como fuente del selector: no es canónico universal (BOARD-CONTRACT §5).

### 2.7 Integración con OpenCode
- Tool nueva `opencode/tool/vista-fisica.ts`, que usa SOLO `composicion-raiz` y `servidor-proyecto`:
  - obtiene el servicio del proyecto activo;
  - asegura que el servidor esté levantado (singleton por proceso);
  - devuelve la URL y abre el navegador (mismo mecanismo que usa hoy `circuito.ts` para abrir el visor).
- La tool y el navegador comparten el MISMO servicio: una sola autoridad.
- Launcher de demo para desarrollo, `scripts/vista-fisica-demo.mjs` en node. Levanta la misma raíz y el mismo servidor sobre un proyecto de ejemplo y deja visible la URL. No es un segundo motor: es el mismo código en otro proceso de desarrollo.

### 2.8 Ciclo de vida y fallas
- El servidor vive mientras vive el proceso que lo aloja, y se cierra con `cerrar()` o al salir del proceso.
- Si el proceso muere, lo persistido sigue siendo la verdad (persistencia antes del swap). Al reabrir, una raíz nueva carga del disco.
- Si el SSE se corta, el navegador reintenta (EventSource ya lo hace) y vuelve a pedir el snapshot al reconectar. Nunca queda en un estado optimista: la vista se re-pinta SOLO desde un snapshot autoritativo.
- Conflicto stale: el navegador recibe `BASE_REVISION_DESACTUALIZADA`, pide el snapshot de nuevo y muestra la revisión vigente.
- Path A: el Engine acepta el estado blocking representable (por ejemplo, el LED sin resistencia, `REQUISITO_INSATISFECHO`). La vista se sigue pintando y muestra el motivo.
- Path B: si hay rechazo, la vista se queda en el snapshot previo.

### 2.9 Offline y Windows
- Cero CDN y cero recursos remotos. Hay un test que escanea la página y los assets servidos.
- Para Windows: rutas con `node:path`, bind explícito a `127.0.0.1`, puerto efímero y apertura del navegador con el mecanismo existente.
- Estado: `WINDOWS_UNVERIFIED`, porque no hubo prueba en Windows real. Lo mismo vale para el aviso del firewall en el primer bind (Phase 0: `REQUIRES_CONTROLLED_RUNTIME_TEST`).

### 2.10 Límite conocido: instalador
Los instaladores (`install/install.sh`, `install/install.ps1`) hoy NO copian `opencode/nucleo/` (ARCH-A). Así, en una máquina instalada, las tools que importen el núcleo fallarían. El slice 1 se demuestra desde el repo y NO modifica los instaladores, porque el método establecido exige verificar los cambios de instalador en la VM Windows con el `.exe` real. Esto queda como tarea siguiente, explícita.

## 3. Tests (plan de ARCH-D, adaptado)
Archivos `tests/phase2-*.test.mjs` y `tests/phase2-helpers.mjs`:
- **composicion-raiz:** E3-04b (a/b/c) y singleton.
- **snapshot:** serialización determinista, sin aliasing y round-trip por JSON.
- **gpio:** N → N+1, canónico Y, persistido Y, snapshot Y.
- **conflicto:** stale, sin sobrescritura y re-fetch.
- **paths:** A (renderizable y editable, con motivo) y B (sin cambios en disco ni revisión).
- **reload:** raíz nueva sobre el mismo directorio da el mismo GPIO, la misma revisión y la misma vista.
- **invariante visual:** diff semántico, donde sólo cambia la asignación del pin.
- **vista-fisica:** proyección pura y plan de pintado.
- **transporte-http:** puerto efímero y cierre siempre, con snapshot, operación, SSE y validación de Host.
- **assets-offline.**

Los 983 tests de Phase 1 NO se modifican. El test `dos-motores-mismo-almacen-real` (E3-07) es intocable.

## 4. No-objetivos
Blockly, codegen, PlatformIO, IA, paleta completa, drag&drop, ruteo, simulación, colaboración, CRDT/OT, nube, catálogo en el navegador, UI móvil, UX final, cables geométricos y cambios al instalador.
