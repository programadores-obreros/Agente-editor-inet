// Vocabulario mínimo de "Motivo" para Gate 1 (identidad de placa).
//
// Esta es la porción MÍNIMA del tipo que describe T_diseno_consolidado.md §5.1: sólo el
// tipo, sin builders, sin el orden estable (categoría → entidad.id → código) y sin la
// tabla de clasificación completa — esas piezas pertenecen a los gates que las ejercitan
// de verdad (validar.ts / operaciones.ts, G4/G5). Ampliar este archivo en un gate
// posterior es válido; lo que no vale es que placas.ts (u otro módulo de Gate 1) invente
// su propio tipo de error en paralelo.
//
// Todos los identificadores en español rioplatense, siguiendo la decisión de nomenclatura
// de §0 del diseño consolidado (`docs/programacion-intencion/DECISIONS.md`, entrada OD-01).
//
// Phase 1.1 (remediación de hallazgos externos, PHASE_1_EXTERNAL_FINDINGS.md) agrega un
// código nuevo al vocabulario ya existente (`ID_DUPLICADO` se reusa, ver `id.ts`):
// `CONTADOR_ID_INCONSISTENTE` — categoria "estructural", clasificacion "rechazo" siempre
// — cuando `Proyecto.siguienteIdLocal` no es estrictamente mayor que el número más alto
// entre los ids locales (`cmp-`/`conn-`/`beh-`) ya presentes. Ver `id.ts`
// (`validarIdsYContador`) y `docs/programacion-intencion/IR-SPEC.md` §6.1.
//
// Phase 1.1 (hallazgo externo E1-03, CRÍTICO) agrega, todos con `entidad.tipo:
// "comportamiento"`, ver `docs/programacion-intencion/IR-SPEC.md` §6.2:
// - `UMBRAL_NO_FINITO_AL_CARGAR` — categoria "estructural", clasificacion "rechazo"
//   siempre — `cargador.ts` (Gate 2), momento de carga: `ComportamientoRegla.cuando.
//   umbral.valor` no es `Number.isFinite` (NaN/±Infinity pasan `typeof === "number"`
//   pero no son representables en JSON, ver `canonico.ts`).
// - `UMBRAL_NO_FINITO` — categoria "estructural", clasificacion "rechazo" siempre —
//   MISMO chequeo que el anterior pero corrido por `validar-estructural.ts` (Gate 4,
//   SIN catálogo): cubre cualquier `Proyecto` sin importar la puerta de entrada
//   (`proyectoInicial` que bypasea el loader, post-operación, revalidación). También
//   emitido por `operaciones.ts` (`aplicarSetComportamiento`, categoria "operacion")
//   como rechazo de la OPERACIÓN, antes de construir ningún estado nuevo — doble
//   defensa, mismo código, dos categorías distintas según quién lo emite.
// - `CAPACIDAD_INEXISTENTE_EN_CATALOGO` — categoria "tecnica", severidad "blocking",
//   clasificacion "representable" — `validar-tecnico.ts` (Gate 4, CON catálogo):
//   `cuando.capacidad` no está entre las capacidades que el catálogo VIGENTE declara
//   para el `tipo` del sensor. Representable (categoría A, brief §8.1/§9.1): el
//   comportamiento NUNCA se borra ni se reescribe, sólo se diagnostica — mismo
//   criterio que `PIN_OCUPADO`.
// - `MAGNITUD_INCOMPATIBLE` — código YA existente (`catalogo.ts`, `propagarMagnitud`,
//   categoria "semantica", representable) — Phase 1.1 lo REUSA desde
//   `validar-tecnico.ts` para diagnosticar, de forma continua (no sólo "al
//   reemplazar" un sensor), que `umbral.magnitud`/`unidad` no coinciden con la
//   capacidad real del sensor vigente. Ver `validar-tecnico.ts` para el detalle.
//
// Phase 1.1 (hallazgo externo E2-01, CRÍTICO) centraliza en `conexion.ts`
// (`analizarConexionesInvalidas`) el invariante "sin auto-conexión (self-loop) / sin
// conexión duplicada", todos con `entidad.tipo: "conexion"` cuando corresponde, ver
// `docs/programacion-intencion/IR-SPEC.md` §6.3:
// - `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA` — códigos YA existentes
//   (`operaciones.ts`, categoria "operacion", rechazo) — Phase 1.1 los REUSA desde
//   `validar-estructural.ts` (Gate 4, SIN catálogo, categoria "estructural") para que
//   el invariante corra en TODA puerta que produzca un `Proyecto` (post-carga,
//   `proyectoInicial`/construcción del motor, post-commit, `validarProyecto` directo)
//   y no sólo dentro de la operación `Conectar`. Mismo código, dos categorías según
//   quién lo emite — mismo criterio que `UMBRAL_NO_FINITO`.
// - `AUTOCONEXION_INVALIDA_AL_CARGAR`/`CONEXION_DUPLICADA_AL_CARGAR` — NUEVOS,
//   categoria "estructural", clasificacion "rechazo" siempre — `cargador.ts` (Gate 2),
//   momento de carga: mismo criterio de distinción momento-de-carga vs.
//   momento-de-operación que ya usa `UMBRAL_NO_FINITO_AL_CARGAR`.
//
// Phase 1.1 (hallazgo externo E2-02, CRÍTICO) agrega, todos categoria "operacion",
// clasificacion "rechazo" siempre, emitidos por `operaciones.ts` ANTES del
// switch/dispatch de `aplicarOperacion` (ver `docs/programacion-intencion/
// OPERATIONS.md` §9):
// - `SOBRE_OPERACION_INVALIDO` — el sobre (`SobreOperacion`) no es un objeto, o
//   `idOperacion`/`idTransaccion`/`actor` no tienen la forma exigida por el contrato
//   (`idOperacion`: string no vacío; `idTransaccion`, si está presente: string no
//   vacío; `actor`: "agente"|"navegador").
// - `TIPO_OPERACION_DESCONOCIDO` — `operacion.tipo` no es uno de los 8 tipos válidos
//   (`OPERATIONS.md` §4) — también lo emite el `default` del switch de
//   `aplicarOperacion`, como defensa en profundidad (nunca alcanzable hoy).
// - `PAYLOAD_OPERACION_INVALIDO` — el payload no tiene la forma mínima que el
//   `aplicarXxx` del tipo necesita (null/undefined/array en vez de objeto, campo
//   requerido ausente o de tipo incorrecto) — `datos.razon` describe la forma
//   esperada. Nunca valida REFERENCIAS (eso lo sigue haciendo cada `aplicarXxx`) ni
//   valores de enum sintácticamente válidos pero inventados.
// - `CLAVE_DESCONOCIDA` — código YA existente (`cargador.ts`, categoria
//   "estructural") REUSADO acá con categoria "operacion" (hallazgo externo E2-03,
//   MENOR): una clave extra desconocida en el sobre (ej. "extraField") se rechaza,
//   mismo criterio fail-closed que ya aplica el loader — mismo código, dos
//   categorías según quién lo emite, mismo criterio que `AUTOCONEXION_INVALIDA`/
//   `UMBRAL_NO_FINITO`.
//
// Phase 1.1 (hallazgo externo RX-02, CRÍTICO, revisión adversarial independiente,
// reabre E2-02) agregó, categoria "operacion", clasificacion "rechazo" siempre:
// - `EXCEPCION_INESPERADA_EN_VALIDACION_DE_FORMA` — leer un campo del sobre/payload
//   (`analizarSobreOperacion`/`validarFormaPayload`, `operaciones.ts`) lanzó una
//   excepción en vez de devolver un valor (un getter que explota en `actor`,
//   `payload.placa`, `payload.comportamiento.cuando.umbral.valor`, etc. — nunca
//   producible por JSON real, pero sí por cualquier valor JS que un llamador en
//   proceso construya). Distinto de `SOBRE_OPERACION_INVALIDO`/
//   `PAYLOAD_OPERACION_INVALIDO` (esos dos significan "el valor tiene la forma
//   incorrecta"; éste significa "ni siquiera se pudo LEER el valor"). `datos.error`
//   llevaba el mensaje de la excepción original, para diagnóstico.
//
//   Phase 1.1 (RX2, hallazgo externo RX2-01, CRÍTICO — revisión adversarial
//   independiente #2) encontró que el `try/catch` que emitía este código protegía
//   la PRIMERA lectura de `operacion.payload` (la validación de forma) pero no la
//   SEGUNDA, sin proteger, del switch de despacho más abajo — un getter válido en
//   la 1ª lectura que lanza en la 2ª (TOCTOU) lo atravesaba igual. Este código YA
//   NO SE EMITE: `aplicarOperacion` materializa el sobre completo en datos planos
//   (`ENTRADA_NO_ES_DATO_PLANO`, ver abajo) ANTES de esa validación, así que no
//   existe una "segunda lectura" que necesite este código para nada. Se conserva
//   documentado acá (histórico) para que quien busque este string en el código
//   viejo/logs archivados encuentre el porqué y hacia dónde se movió.
//

// Phase 1.1 (hallazgo externo E3-01, CRÍTICO) agrega, categoria "motor",
// clasificacion "rechazo" siempre, emitido por `motor.ts` (`ejecutarLote`, ANTES de
// clonar):
// - `BASE_REVISION_INVALIDA` — la PRIMERA operación de un lote NO VACÍO trae un
//   `baseRevision` que no es un entero no negativo (null/ausente/string/NaN/
//   ±Infinity/negativo/no entero) — DISTINTO de `BASE_REVISION_DESACTUALIZADA` (que
//   es "el dato es válido pero ya no coincide con lo vigente"): acá el dato en sí
//   nunca fue válido, así que nunca se sustituye por la revisión actual (ese era el
//   bug: un `??` que trataba "sin dato" como "usá la revisión de ahora"). Ver
//   `docs/programacion-intencion/OPERATIONS.md` §9 para el detalle, incluida la
//   decisión de E3-05 (lote vacío: no-op explícito, sin motivo, `ok:true`).
//
// Phase 1.1 (hallazgo externo E3-07, MAJOR — resolución humana Phase 1.1, brief §21)
// agrega, categoria "almacen", clasificacion "rechazo" siempre, emitido por
// `almacen.ts` (`guardar()`, ANTES de escribir):
// - `CONFLICTO_REVISION_EN_ALMACEN` — ya existe un documento en disco bajo este id
//   cuya `revision` NO es exactamente `proyecto.revision - 1` (el estado que el
//   llamador cree que acaba de reemplazar) — otro motor con un punto de partida que
//   este llamador nunca vio ya escribió acá. Compare-and-swap sobre la revisión,
//   nunca un lock (`docs/programacion-intencion/OPERATIONS.md` §10 para el detalle,
//   incluida la excepción de re-guardado canónicamente idéntico y el límite conocido
//   de detección por revisión, no por contenido).
//
// Phase 1.1 (RX) — hallazgo externo RX-04, MENOR (revisión adversarial
// independiente) agrega, categoria "operacion", severidad "info" (nunca
// `clasificacion` — es puramente informativo, nunca corta la operación), emitido
// por `operaciones.ts` (`aplicarSetComportamiento`, rama de reemplazo):
// - `COMPORTAMIENTO_REEMPLAZADO` — `SetComportamiento` con un `id` que YA existe
//   reemplaza (upsert) el comportamiento anterior en vez de dar de alta uno nuevo;
//   este motivo documenta esa decisión determinista (mismo patrón que
//   `UNIDAD_CONVERTIDA`, `catalogo.ts`). La semántica upsert no cambia — sigue
//   commiteando igual, `ok:true`.
//
// Phase 3 (vertical #1, contrato B4) agrega la operación `QuitarComportamiento`
// (payload `{ comportamiento: id }`, claves exactas), emitida por `operaciones.ts`
// (`aplicarQuitarComportamiento`):
// - `REFERENCIA_INEXISTENTE` — código YA existente: el `id` no es el de ninguna regla;
//   `datos { comportamiento }`, rechazo, sin mutar.
// - `COMPORTAMIENTO_QUITADO` — categoria "operacion", severidad "info" (nunca
//   `clasificacion`, mismo patrón que `COMPORTAMIENTO_REEMPLAZADO`) — la regla existía y
//   se quitó; `datos { comportamiento, reglaQuitada }` lleva la regla COMPLETA quitada
//   (para un undo futuro). Revisión +1; después `QuitarComponente` vuelve a estar
//   permitido (`REMOCION_CON_DEPENDIENTES` sólo mira slots presentes de reglas vivas).
//
// Phase 3 (vertical #1, contrato B3) agrega, emitidos por `validar.ts::validarSemantico`
// (categoria "semantica", severidad "blocking", clasificacion "representable" — Path A:
// commitean y dejan `listo:false`, NUNCA "rechazo"), todos con `entidad {tipo:
// "comportamiento", id}` y sin nombres de tipo (sólo datos del catálogo):
// - `COMPORTAMIENTO_INCOMPLETO` — `datos { faltan }`, subconjunto de ["sensor",
//   "estado" (la triada capacidad+comparador+umbral), "actuador", "salida" (la
//   acción)], en ese orden.
// - `ACTUADOR_INVALIDO` — `entonces.actuador` cuyo componente de catálogo tiene
//   `clase !== "actuador"`; `datos { componente, clase }`. Tipo desconocido del
//   catálogo: no se emite (ya existe `CATALOGO_COMPONENTE_DESCONOCIDO`). Un documento
//   histórico con un actuador inválido carga igual y muestra este motivo.
// - `MULTIPLES_AUTORIDADES_ACTUADOR` — Multi-Rule Safety (modelo B): dos o más reglas
//   reclaman el mismo actuador (`entonces.actuador`, por referencia, aunque estén
//   incompletas). Uno por regla involucrada; `datos { actuador, comportamiento, otras }`
//   (`otras` ordenadas por id). Blocking + representable: nunca se rechaza la operación,
//   nunca se elige un ganador; un documento histórico con varios dueños carga igual.
// - `ACCION_NO_SOPORTADA` — Semantic Vertical #3 (D-11): `entonces.accion` que el tipo
//   del actuador no declara en su catálogo; `datos { componente, accion, soportadas }`.
//   Blocking + representable: la regla se persiste y se puede corregir. Un documento
//   histórico con una acción no soportada carga igual y muestra este motivo.
// - `SENSOR_INVALIDO` — `cuando.sensor` presente SIN triada cuyo catálogo no declara
//   ninguna capacidad; `datos { componente }`. Con la triada presente no se emite
//   (`CAPACIDAD_NO_DECLARADA` / `CAPACIDAD_INEXISTENTE_EN_CATALOGO` ya la cubren).

// Phase 1.1 (RX) — hallazgo externo RX-01, CRÍTICO (revisión adversarial
// independiente, reabre CP-01) agrega, categoria "estructural", clasificacion
// "rechazo" siempre, emitido por `motor.ts` (`crearMotorDeProyecto`):
// - `EXCEPCION_INESPERADA_LEYENDO_PROYECTO_INICIAL` — leer `deps.proyectoInicial`
//   (al validar su forma, al construir el canónico, o cualquier lectura intermedia)
//   lanzó una excepción en vez de devolver un valor — un getter que explota en un
//   campo, declarado o no, de un Componente/Conexion/ComportamientoRegla anidado.
//   Nunca un `Error` crudo: se convierte acá en `ErrorEstadoInicialInvalido` con
//   este motivo. Ver `docs/programacion-intencion/IR-SPEC.md` §6.5. Phase 1.1 (RX2)
//   dejó este código como BACKSTOP defensivo únicamente (envuelve
//   `congelarProfundo(clonarProfundo(...))` sobre una entrada YA materializada/
//   validada, nunca el objeto crudo del llamador) — la superficie que este código
//   nombra en su documentación original (un getter en `proyectoInicial`) hoy la
//   cierra `ENTRADA_NO_ES_DATO_PLANO` (abajo), antes de llegar acá.
//
// Phase 1.1 (RX2, hallazgo externo RX2-01/RX2-02/RX2-03, CRÍTICOS — segunda
// revisión adversarial independiente, `RX2_REPORT.md`) agrega UN código único,
// reusado con distinta `categoria` según quién lo emite (mismo criterio ya
// establecido por `CLAVE_DESCONOCIDA`/`AUTOCONEXION_INVALIDA`/`UMBRAL_NO_FINITO`),
// `severidad: "blocking"`, `clasificacion: "rechazo"` siempre:
// - `ENTRADA_NO_ES_DATO_PLANO` — `opencode/nucleo/datos-planos.ts`
//   (`materializarDatosPlanos`) rechazó la entrada porque no es un dato plano
//   compatible con JSON leído de forma segura (un accessor/getter, un Proxy que
//   miente en `ownKeys`/`getOwnPropertyDescriptor`, una clave Symbol o no
//   enumerable, un prototipo de clase, un array con huecos, un ciclo, ...) —
//   `datos: { ruta, razon }` describe exactamente qué falló y dónde. Cierra de
//   CLASE, no de instancia, tres CRÍTICOS que un `try/catch` puntual (RX-02/RX-01)
//   no alcanzaba a cerrar del todo: RX2-01 (`aplicarOperacion`/`operaciones.ts`
//   volvía a leer `operacion.payload` sin proteger en el switch de despacho,
//   después de haberlo leído una vez, protegido, para la validación de forma —
//   TOCTOU), RX2-02 (`congelarProfundo`/`canonico.ts`, usado por `motor.ts` en
//   cada commit/dry-run, se topaba con un Proxy vivo dentro de
//   `payload.propiedades`, nunca antes protegido) y RX2-03 (`cargarProyecto()`
//   aceptaba un documento ya-parseado sin ningún `try/catch` propio, y el doble
//   recorrido de `pines` — validar con `Object.values`, copiar con un spread
//   independiente — era un TOCTOU real que rompía el round-trip). Emitido con
//   categoria `"estructural"` por `cargador.ts` (`validarFormaProyecto`, la puerta
//   compartida por `cargarProyecto()` y `crearMotorDeProyecto({proyectoInicial})`),
//   `"operacion"` por `operaciones.ts` (`aplicarOperacion`, el sobre completo antes
//   del switch) y `"motor"` por `motor.ts` (`ejecutarLote`, el LOTE completo antes
//   de leer siquiera `baseRevision`). Ver
//   `docs/programacion-intencion/IR-SPEC.md` §6.6.
//
// Phase 1.1 (RX3, hallazgo externo RX3-01, CRÍTICO — tercera revisión adversarial
// independiente, `RX3_REPORT.md`): antes de este fix, una clave literal
// `"__proto__"` (alcanzable con JSON PURO vía `JSON.parse`, sin Proxies ni
// getters) corrompía el PROTOTIPO de la copia de `materializarDatosPlanos` en vez
// de tratarse como un dato — la asignación `copia[clave]=valor` disparaba el
// setter heredado `Object.prototype.__proto__` sobre un objeto plano `{}`, lo que
// bypaseaba `CLAVE_DESCONOCIDA` en la raíz en silencio. El fix de RAÍZ (ver
// `IR-SPEC.md` §6.7, `DECISIONS.md`) arregla el CONTENEDOR (`Object.defineProperty`
// en vez de asignación por corchetes, en los tres sitios del núcleo que copiaban
// claves de usuario a un objeto fresco) — con eso, `materializarDatosPlanos` NUNCA
// rechaza ninguna clave por su nombre, ni siquiera `"__proto__"`: la preserva como
// dato propio normal, indistinguible de `"constructor"`/`"prototype"`/
// `"toString"`/`"hasOwnProperty"` (ninguno de estos es un accessor real de
// `Object.prototype`). El rechazo de una clave desconocida en una entidad de
// forma CERRADA sigue siendo, como siempre, `CLAVE_DESCONOCIDA` — nunca
// `ENTRADA_NO_ES_DATO_PLANO` por el NOMBRE de una clave en particular.

// Phase 1.1 (hallazgo externo E3-08, barato) agrega, categoria "almacen",
// clasificacion "rechazo" siempre, emitido por `almacen.ts` (`cargar()`):
// - `ID_DOCUMENTO_NO_COINCIDE` — el `Proyecto.id` del documento leído bajo
//   `<id>.json` NO coincide con el `id` que se pidió cargar (documento escrito/
//   movido/copiado a la ruta equivocada) — se rechaza ANTES de devolverlo, nunca se
//   "repara" reasignando el id en silencio. Ver
//   `docs/programacion-intencion/OPERATIONS.md` §10.1.
//
// Phase 1.1 (RX4, hallazgo externo RX4-01, CRÍTICO — cuarta revisión adversarial
// independiente, `RX4_REPORT.md`) agrega, emitidos por `motor.ts` (`ejecutarLote`),
// categoria "motor", `severidad: "blocking"`, `clasificacion: "rechazo"` siempre,
// justo después de materializar el lote y ANTES de leer ningún campo de ningún
// elemento (ver `IR-SPEC.md` §6.8/`OPERATIONS.md` §9.8 para el detalle completo):
// - `LOTE_OPERACIONES_INVALIDO` — NUEVO. El lote (`SobreOperacion[]`) recibido no
//   es, en sí mismo, un array (`null`/objeto/string) — más allá de lo que el tipo
//   promete en compilación, sin protección en runtime. `datos: { razon }`.
// - `SOBRE_OPERACION_INVALIDO` — REUSADO (código ya existente, `operaciones.ts`,
//   categoria "operacion") con categoria `"motor"`: un ELEMENTO del lote, ya
//   materializado en datos planos, no es un objeto (`null` es el caso alcanzable
//   con JSON puro — un array denso con un elemento `null` es JSON perfectamente
//   válido — pero cualquier otro no-objeto cae en el mismo caso). Detectado ACÁ,
//   una capa antes de que el elemento llegue a `aplicarOperacion` (que también lo
//   rechazaría con el mismo código, categoria "operacion", si llegara) — mismo
//   criterio ya establecido por `CLAVE_DESCONOCIDA`/`AUTOCONEXION_INVALIDA`/
//   `UMBRAL_NO_FINITO`/`ENTRADA_NO_ES_DATO_PLANO`: mismo código, distinta categoría
//   según quién lo emite. `datos: { indice, razon }` — el índice del primer
//   elemento inválido dentro del lote.
//
// En ambos casos, el rechazo es del LOTE ENTERO — `resultadosOperaciones: []`,
// canónico/revisión/disco/buffer de undo intactos, igual que `BASE_REVISION_INVALIDA`
// (E3-01, arriba).
//
// Phase 1.1 (RX4, hallazgo externo RX4-02, CRÍTICO — cuarta revisión adversarial
// independiente, `RX4_REPORT.md`; RECLASIFICA E1-04, ver `DECISIONS.md`):
// `esEnteroNoNegativo` (`cargador.ts`, reusada por `revision`/`siguienteIdLocal`/
// `baseRevision`) pasó a usar `Number.isSafeInteger` en vez de `Number.isInteger`
// — un `baseRevision`/`revision` de `1e21` ahora rechaza con `BASE_REVISION_INVALIDA`
// (E3-01, arriba, sin código nuevo) o con `CAMPO_REQUERIDO_FALTANTE` (`cargador.ts`,
// mismo código que cualquier otro valor de forma inválida). Dos códigos NUEVOS,
// porque acotar el DATO DE ENTRADA no alcanza: el límite es válido a la entrada,
// pero incrementarlo (`+1`) puede dejar de ser exacto:
// - `REVISION_EXCEDE_ENTERO_SEGURO` — categoria "motor", `severidad: "blocking"`,
//   `clasificacion: "rechazo"` siempre, emitido por `motor.ts` (`ejecutarLote`, en
//   el commit): `canonico.revision + 1` ya no sería un entero seguro (el único
//   caso posible es `canonico.revision === Number.MAX_SAFE_INTEGER`, porque
//   `esEnteroNoNegativo` ya garantiza que `revision` nunca lo EXCEDE al entrar).
//   Rechazo ANTES de tocar disco o memoria — nunca un commit con un incremento
//   inexacto. `datos: { revisionActual, limite }`.
// - `CONTADOR_ID_EXCEDE_ENTERO_SEGURO` — categoria "operacion", `severidad:
//   "blocking"`, `clasificacion: "rechazo"` siempre, emitido por `operaciones.ts`
//   (`aplicarAgregarComponente`/`aplicarConectar`/`aplicarSetComportamiento`, alta
//   nueva): misma guarda que `REVISION_EXCEDE_ENTERO_SEGURO`, pero para
//   `siguienteIdLocal + 1` — "lo mismo para el contador de ids" que para
//   `revision`. `datos: { siguienteIdLocal, limite }`.

// Phase 1.2 (hallazgo externo REA-01, CRÍTICO — re-auditoría externa,
// PHASE_1_1_REGAUDIT_FINDINGS.md) agrega, categoria "operacion", clasificacion
// "rechazo" siempre, emitido por `operaciones.ts` (`aplicarSetComportamiento`, ANTES
// de tocar ningún estado):
// - `VALOR_ENUM_DESCONOCIDO` — `cuando.comparador`/`entonces.accion` de un
//   `SetComportamiento` es un string SINTÁCTICAMENTE válido pero FUERA del dominio
//   normativo compartido (`ir.ts::COMPARADORES`/`ACCIONES` — los mismos dos
//   conjuntos que `cargador.ts` exige al cargar/recargar, nunca una segunda lista).
//   Antes de este fix, ninguna puerta de Gate 5 lo comprobaba — la operación
//   commiteaba `ok:true` con un valor inventado (ej. `"mayorQue"`), y recién
//   `cargador.ts` lo rechazaba AL RECARGAR con `CAMPO_REQUERIDO_FALTANTE`: un
//   documento PERSISTIBLE que dejaba de ser RECARGABLE (ver
//   `docs/programacion-intencion/IR-SPEC.md` §6.11, invariante "PERSISTIBLE ⇒
//   RECARGABLE"). `datos: { campo, valorRecibido, dominioValido }`.
//
// Phase 1.2 (mismo hallazgo REA-01) agrega, categoria "motor", clasificacion
// "rechazo" siempre, emitido por `motor.ts` (`ejecutarLote`, ANTES de la
// bifurcación dry-run/commit, punto 5c del pipeline):
// - `ESTADO_NO_RECARGABLE` — el `borrador` que ya pasó la validación de la operación
//   Y `validarProyecto`/`validarIdsYContador` TODAVÍA viola un invariante de FORMA
//   que sólo el loader (`validarFormaProyecto`, Gate 2) conoce — la BARRERA general
//   del invariante "PERSISTIBLE ⇒ RECARGABLE": `motor.proponer()` (dry-run) y
//   `motor.aplicar()`/`aplicarTransaccion()` (commit) corren la MISMA barrera, en el
//   MISMO punto del pipeline, así que nunca pueden divergir en el veredicto. Con las
//   8 operaciones públicas actuales, este código NUNCA es alcanzable hoy (REA-01 ya
//   se cierra antes, en la operación misma, con `VALOR_ENUM_DESCONOCIDO` arriba) —
//   es defensa en PROFUNDIDAD, mismo criterio que `validarIdsYContador` post-lote
//   (RX-03) o `REFERENCIA_INEXISTENTE`/`AUTOCONEXION_INVALIDA` post-lote (E2-01):
//   un aplicador futuro (Fase 2+) que dejara pasar un borrador estructuralmente
//   irrecargable se detiene ACÁ, no sólo en la operación de origen. `datos: {
//   motivosLoader }` lleva el/los `Motivo[]` que `validarFormaProyecto` produjo, para
//   diagnóstico — nunca se pierde el detalle original. Ver `IR-SPEC.md` §6.11 y
//   `OPERATIONS.md` §11.

// Phase 1.2 (hallazgo externo REA-02, MAYOR — re-auditoría externa AUD-C-02,
// `PHASE_1_1_EXTERNAL_FINDINGS.md`) agrega, categoria "tecnica", `severidad:
// "warning"`, `clasificacion: "representable"` siempre, emitido por
// `validar-tecnico.ts` (Gate 4, validación CONTINUA de `proyecto.comportamientos`,
// el mismo bucle que ya emite `CAPACIDAD_INEXISTENTE_EN_CATALOGO`/
// `MAGNITUD_INCOMPATIBLE`):
// - `UMBRAL_FUERA_DE_RANGO` — el `umbral` de un `ComportamientoRegla` tiene magnitud/
//   unidad COMPATIBLE con la capacidad real del sensor vigente (si no lo fuera, ya se
//   reportó arriba con `MAGNITUD_INCOMPATIBLE` — nunca se duplica), pero el valor
//   (ya convertido a la unidad de la capacidad, si hiciera falta conversión) cae
//   FUERA de `Capacidad.rango` — ej. un DHT22 (rango `[0,60]°C`) con un umbral de
//   `200°C`, físicamente imposible para el sensor real. Antes de este fix, el ÚNICO
//   lugar que diagnosticaba esto era `reemplazarSensor` (`catalogo.ts`, rama C de
//   §8.1 del brief), y sólo en el instante de la operación `CambiarComponente` — el
//   MISMO estado (mismo sensor, mismo umbral, mismo rango) llegado por
//   `SetComportamiento` directo, `proyectoInicial` o una recarga desde disco validaba
//   SIN ningún aviso, hasta `listo:true` (evidencia:
//   `reaudit/AUD-C/scripts/10_rango_sensor_deuda2.mjs`). Reusa `estaFueraDeRango`
//   (`catalogo.ts`) — extraída de la closure local que `reemplazarSensor` ya usaba,
//   nunca una segunda regla divergente. WARNING, nunca `blocking` — decisión del
//   orquestador con fuente (`DECISIONS.md`): Brief §8.1 rama C ("se conserva el
//   umbral/intención y se advierte") + §12.1 (`warning` = "proyecto utilizable pero
//   requiere atención"; sólo `blocking` impide `ready`) + Brief l.1856 ("no convertir
//   todos los warnings en bloqueos") — nunca afecta `derivarReadiness`, nunca clampa
//   ni reinterpreta el umbral del estudiante. El motivo TRANSITORIO que
//   `reemplazarSensor` ya emitía (`RANGO_INCOMPATIBLE_AL_REEMPLAZAR`, sólo dentro del
//   eco de la operación `CambiarComponente`) se conserva SIN cambios — es informativo
//   del EVENTO puntual de reemplazo, nunca parte de la validación continua; los dos
//   códigos pueden coexistir para la MISMA operación, nunca se fusionan. `datos: {
//   umbral, unidad, rango }`. Ver `docs/programacion-intencion/IR-SPEC.md` §6.12.

// Phase 3 — Pre-Human-Test Hardening, HD-W0-A (docs/programacion-intencion/
// PHASE_3_PRE_HUMAN_TEST_DESIGN.md §1) agrega, categoria "operacion",
// `severidad: "blocking"`, `clasificacion: "rechazo"` siempre, emitido por
// `operaciones.ts` (`aplicarAsignarPin`), justo después de `TERMINAL_NO_DECLARADO` y
// antes de `PIN_INEXISTENTE_EN_PLACA` (hermano directo de ambos, misma función, mismo
// patrón de rechazo):
// - `TERMINAL_NO_ASIGNABLE` — `AsignarPin` sobre un terminal que el catálogo declara
//   `electrica: "riel-fijo"` (destino fijo — "va en el medio del cable", nunca se
//   conecta directo a un pin de la placa) rechaza SIEMPRE, sin excepción (incluido
//   `pin: null`). La fuente de "asignable" es EXCLUSIVAMENTE el catálogo (misma
//   derivación que `terminalesNoRielFijo`/`vista-fisica/vocabulario.ts::asignable`) —
//   nunca el tipo/id del componente. `datos: { componente, terminal, electrica }`
//   (`electrica` da contexto genérico — hoy siempre `"riel-fijo"`, pero el campo no
//   hardcodea ese string como el único motivo posible a futuro). El loader
//   (`cargador.ts`) y la validación continua (`validar-tecnico.ts`, que sigue
//   salteando `riel-fijo` a propósito) NO cambian: un documento histórico que ya
//   tenga este dato sigue cargando igual — la invariancia gobierna sólo la operación
//   NUEVA (PERSISTIBLE ⇒ RECARGABLE, ver `IR-SPEC.md` §6.11).

/**
 * Categorías de motivo del núcleo completo (§5.1). Gate 1 sólo emite "operacion".
 *
 * Phase 1.1 (hallazgo externo E2-04, MAYOR, clasificación B/documentación —
 * PHASE_1_EXTERNAL_FINDINGS.md): `categoria` clasifica el TIPO DE DATO del motivo
 * ("¿de qué habla?" — forma, referencia, hardware/catálogo, etc.), NUNCA cuál
 * módulo lo emitió — son DOS EJES INDEPENDIENTES a propósito, no "5 niveles = 5
 * módulos" como una lectura apresurada del código podría sugerir:
 * - `validar-estructural.ts` (su propio comentario dice "nivel 2 — referencial")
 *   emite motivos con `categoria: "estructural"` (`AUTOCONEXION_INVALIDA`,
 *   `UMBRAL_NO_FINITO`), no "referencial" — la validación ESTRUCTURAL real (forma
 *   del documento) vive en `cargador.ts`, que corre sólo al cargar y nunca vuelve a
 *   correr; lo que `validar-estructural.ts` reusa con esa misma `categoria` es el
 *   MISMO invariante de forma/IR, corrido de nuevo sobre cualquier `Proyecto` sin
 *   importar la puerta de entrada (ver `IR-SPEC.md` §6.3 para el detalle completo
 *   de por qué esto es intencional, no un error de rotulado).
 * - `validar-tecnico.ts` agrupa bajo `categoria: "tecnica"` tanto compatibilidad de
 *   HARDWARE (pin/capacidad) como de CATÁLOGO/COMPONENTE — no hay una `categoria`
 *   "componente" separada en uso real hoy (existe en el enum de abajo, para no
 *   cerrar la puerta a Fase 2, pero Fase 1 no la emite).
 * - `categoria: "semantica"` era un passthrough vacío por diseño (Phase 3 lo llena, ver arriba) en el pipeline
 *   continuo de `validarSemantico` (Gate 4) — pero el código YA existente
 *   `MAGNITUD_INCOMPATIBLE` (`catalogo.ts`, `propagarMagnitud`) usa esa MISMA
 *   `categoria` activamente FUERA de ese pipeline (durante `CambiarComponente`,
 *   `operaciones.ts`) — de nuevo, dato vs. módulo, no lo mismo.
 * - El mismo código puede repetirse con DOS categorías distintas según quién lo
 *   emite (`AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA`/`UMBRAL_NO_FINITO`:
 *   "operacion" cuando lo emite `operaciones.ts`, "estructural" cuando lo emite
 *   `validar-estructural.ts`; `CLAVE_DESCONOCIDA`: "estructural" en `cargador.ts`,
 *   "operacion" en `operaciones.ts`) — esto sólo tiene sentido si `categoria` no
 *   pretende identificar el módulo.
 *
 * Decisión (Phase 1.1): NO se separan físicamente categoría y responsabilidad de
 * módulo en dos tipos/campos nuevos — sería introducir una segunda taxonomía sin un
 * consumidor real que la necesite hoy (nada en Fase 1 filtra motivos por "qué
 * módulo los emitió", sólo por `categoria`/`clasificacion`/`severidad`, que sí son
 * ejes con consumidores reales: `ORDEN_CATEGORIAS`, `derivarReadiness`). Se
 * documenta acá, en el mismo lugar donde se declara el tipo, para que la próxima
 * lectura del código no vuelva a confundir "5 categorías" con "5 módulos".
 */
export type CategoriaMotivo =
  | "estructural"
  | "referencial"
  | "tecnica"
  | "componente"
  | "semantica"
  | "readiness"
  | "pedagogica"
  | "operacion"
  | "motor"
  | "almacen"

/** A qué entidad de la IR se refiere el motivo, cuando corresponde. */
export type EntidadMotivo = {
  readonly tipo: "componente" | "conexion" | "comportamiento" | "placa" | "lote"
  readonly id: string
}

/**
 * Un motivo estructurado: nunca una excepción cruda, nunca una cadena de texto suelta.
 *
 * `clasificacion` viaja CON el motivo (nunca en una tabla central del motor — ver §5.1
 * del diseño consolidado): "representable" = Camino A (la operación commitea con el
 * motivo como advertencia/bloqueo post-commit), "rechazo" = Camino B (la operación no
 * se aplica). En Gate 1 sólo se usa "rechazo": una placa desconocida/ambigua/no
 * soportada nunca se "asigna igual".
 */
export type Motivo = {
  readonly codigo: string
  readonly categoria: CategoriaMotivo
  readonly severidad: "info" | "warning" | "blocking"
  readonly clasificacion?: "representable" | "rechazo"
  readonly entidad?: EntidadMotivo
  readonly datos?: Readonly<Record<string, unknown>>
}

// ════════════════════════════════════════════════════════════════════════════════════
// Orden estable — Gate 4 (validar.ts lo usa para agregar sin mezclar el orden entre
// corridas: (prioridad fija de categoría) → entidad.id (lexicográfico) → código).
// ════════════════════════════════════════════════════════════════════════════════════

/** Prioridad fija: el índice en este array ES la prioridad (0 = primero). */
export const ORDEN_CATEGORIAS: readonly CategoriaMotivo[] = [
  "estructural",
  "referencial",
  "tecnica",
  "componente",
  "semantica",
  "readiness",
  "pedagogica",
  "operacion",
  "motor",
  "almacen",
]

/** Comparador estable para `Array.prototype.sort` — nunca cambia entre corridas para
 * el mismo conjunto de motivos (determinista, sin depender de `Date.now()`/random). */
export function compararMotivos(a: Motivo, b: Motivo): number {
  const pa = ORDEN_CATEGORIAS.indexOf(a.categoria)
  const pb = ORDEN_CATEGORIAS.indexOf(b.categoria)
  if (pa !== pb) return pa - pb
  const idA = a.entidad?.id ?? ""
  const idB = b.entidad?.id ?? ""
  if (idA !== idB) return idA < idB ? -1 : 1
  if (a.codigo !== b.codigo) return a.codigo < b.codigo ? -1 : 1
  return 0
}
