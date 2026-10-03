# Phase 3 — Vertical semántico #2: Blockly semántico mínimo (contrato)

**Estado: APPROVED_FROM_HUMAN_DECISIONS** (`DECISIONS.md` § "Phase 3 — Vertical semántico #2": D1–D4, HD-P3-4 = A).

**Base:** `main` `4535545`, rama `feature/programacion-intencion-phase3-blockly-minimo`.

**Referencias:**
- `PHASE_3_MINIMUM_VERTICAL_DESIGN.md` §14 (adaptador Blockly);
- `PHASE_3_DISCOVERY.md` §G;
- `PHASE_3_VERTICAL_1_CONTRACT.md` (semántica, operaciones, whitelists).

Blockly es una **vista y editor semántico**, no la fuente del programa.

## 1. Alcance
- Una sección **"Vista lógica"** junto a la frase editable (que se mantiene). Tiene un workspace Blockly **fijo** que muestra **una** regla de nivel: "mientras [entrada] esté [estado] → [salida] está [acción]".
- Edita esa regla (crear desde vacío, completar, cambiar, quitar) con campos semánticos.
- Fuera de alcance:
  - toolbox general, programación libre, drag-and-drop como objetivo;
  - más de una regla;
  - generadores de código;
  - EVENTO, toggle;
  - C++, PlatformIO, Modo Vivo;
  - cambios de IR o del Engine.

## 2. Fuente de verdad
- La IR, a través del snapshot del servidor (`vista.reglas`, `vista.opcionesRegla`).
- El workspace Blockly es descartable. **Nada** de Blockly se persiste: ni XML, JSON, block IDs, posiciones, conexiones, layout, ni estado del toolbox.
- Prueba exigida: destruir el workspace y recrearlo sólo desde el snapshot da la misma semántica, y no hay ningún archivo de Blockly en el proyecto persistido.

## 3. IR → Blockly
- Una **proyección pura y testeable sin navegador**: `{reglas, opcionesRegla}` → modelo de vista lógico.
  - Por cada slot (en el orden del servidor): `slot`, `prefijo`, `valor` actual o vacío, `opciones [{valor, etiqueta}]`, `reglaId`, `completa`, `faltan`, `avanzada` y textos de motivos.
- Etiquetas y opciones vienen **sólo** del servidor: la misma `opcionesRegla.slots` y `reglas[i].frase` que usa la frase editable. No hay un segundo mapeo de vocabulario: "presionado" y "encendido" salen del mismo lugar.
- Un **adaptador Blockly** delgado recibe la API de Blockly inyectada y convierte ese modelo en bloques.
  - Un bloque contenedor "mientras", con el bloque de acción encastrado.
  - Campos dropdown por slot.
  - Bloques **no** borrables, movibles ni desconectables por el alumno.
- El adaptador no conoce nombres de slot, clases ni capacidades.

## 4. Blockly → Engine
- Un cambio de un campo = **una** operación `SetComportamiento`, construida con `construirOperacionRegla` (el mismo constructor de la frase: la regla entera más el `parche` de la opción) y la `baseRevision` del último snapshot.
- "Quitar" en la vista lógica → `QuitarComportamiento {comportamiento: reglaId}`.
- La regla nace con el primer campo elegido (sin id), igual que en la frase. Antes de eso no existe nada en la IR.
- Solo hay operaciones existentes, y pasan por la whitelist del navegador (`AsignarPin` / `SetComportamiento` / `QuitarComportamiento`). No se agrega ninguna operación de UI (mover, conectar ni guardar workspace).
- El valor centinela "— elegí —" **nunca** se envía (`valorEsOpcion`).

## 5. Snapshot y repintado
- **Gana el snapshot del Engine.** Después de cada respuesta (aceptada o rechazada) y de cada evento SSE `revision`, el workspace se reconstruye o actualiza desde el snapshot.
- No hay estado optimista.
- Mientras se pinta desde el snapshot, los eventos de Blockly **no** emiten operaciones (guarda contra el bucle de realimentación).
- El contenedor de Blockly se inyecta una vez y queda excluido del `replaceChildren` general de `repintar()`.

## 6. Semántica de los bloques
- Nivel (HD-P3-2 = A): "mientras", nunca "cuando" ni evento.
- El reposo apagado es derivado: no hay rama "si no" en los bloques. Se explica en el trazado ya existente de la frase.
- La forma visual se fija en implementación, pero el alumno tiene que leer **MIENTRAS … HACER/está …**.

## 7. IR incompleta
- Una regla parcial se muestra con los campos faltantes en "— elegí —", sin crash, sin borrado y sin autocompletar.
- Se completa con operaciones normales.
- Una "condición avanzada" se muestra como tal: el campo de estado indica "condición avanzada" y elegir "presionado" la reemplaza, igual que en la frase.

## 8. IR inválida
- Motivos semánticos (`ACTUADOR_INVALIDO`, etc.) se muestran con el texto llano del servidor, junto al bloque.
- Los dropdowns sólo ofrecen opciones válidas: el pulsador **no** aparece como salida. El Engine valida igual (defensa en profundidad).

## 9. Conflicto de revisión
- Una operación con `baseRevision` vieja recibe `BASE_REVISION_DESACTUALIZADA`: no muta.
- Se recarga el snapshot y se repinta, igual que la frase. No hay last-write-wins.

## 10. Operación pendiente
- Hay un solo controlador compartido con la frase (`crearControladorReglas` o su extensión), con como mucho una operación en vuelo entre GPIO, frase y vista lógica.
- Mientras hay una pendiente, los campos de la vista lógica quedan deshabilitados.

## 11. Offline y dependencia
- Blockly 13.3.0, vendorizado en `opencode/tecniabot-web/`:
  - `blockly_compressed.js` y `msg/es.js` del tarball oficial verificado (sha512 en DECISIONS);
  - los medios estrictamente necesarios;
  - `LICENSE-blockly` (Apache-2.0) y una nota de versión con origen y hashes por archivo.
- Configuración: `sounds: false` y `media` apuntando a la ruta local. No hay CDN, ni carga dinámica remota, ni generadores.
- El escáner offline del repo debe dar 0 cargas remotas reales.
- El servidor sirve cada archivo nuevo desde su allowlist explícita, con un MIME correcto por extensión.
- **CSP sin cambios** (`script-src 'self'`; `img-src 'self'`; sin `unsafe-eval`).

## 12. Accesibilidad mínima
- La frase editable con `<select>` nativos sigue siendo la alternativa textual completa.
- La vista lógica tiene un encabezado y una etiqueta visibles, y no depende sólo del color para el estado incompleto o inválido (hay texto).
- Si algo del canvas no es operable por teclado, se documenta como limitación.

## 13. Tests
Organizados por capa:
- **Sin navegador:**
  - proyección (A);
  - adaptador con una API de Blockly falsa e inyectada (C);
  - controlador y transporte (B);
  - integración con Engine y servidor reales (D).
- **Navegador real** con Chromium headless (E).

RED genuino antes de cada GREEN, reproducido por el orquestador en su árbol exacto.

**Convergencia obligatoria:** con el mismo proyecto, los caminos agente, frase y Blockly producen la misma regla en la IR (salvo el id).

**Ida y vuelta obligatoria:** IR → Blockly → edición → operación → Engine → IR' → recarga → Blockly', con la semántica idéntica.

**Guardas:**
- ningún texto visible muestra `estadoBooleano`, `>=`, `umbral`, ids internos, JSON, `baseRevision` ni `schemaVersion`;
- el código propio en `web/*.js` respeta las guardas existentes (`phase3-web-guard`, `phase2-s2-rol` §3.3, `sin-logica`);
- el archivo vendorizado vive fuera de `vista-fisica/web/`.

## 14. Navegador real
Escenario completo contra servidor, Engine y assets reales:
1. regla existente → Vista lógica correcta;
2. edición desde Blockly → una operación, +1 revisión, IR esperada;
3. recarga → reconstrucción;
4. edición desde la frase → Blockly se actualiza;
5. cambio externo (agente o servicio) → Blockly se actualiza por SSE;
6. quitar desde Blockly → ausencia, también después de recargar;
7. regla incompleta (si es visual).

Va con capturas BRW-01..06 y **0 violaciones de CSP** en la consola.

## 15. Fuera de alcance
Ver §1, más las limitaciones heredadas del vertical #1, que no se tocan salvo que bloqueen:
- el espacio antes de la coma;
- el cuerpo HTTP sin tipo;
- `reglas[].forma`;
- varias reglas;
- el LLM real;
- la comprensión humana de la vista física.

El REAL HUMAN TEST #2 viene después del freeze, no en este ciclo.
