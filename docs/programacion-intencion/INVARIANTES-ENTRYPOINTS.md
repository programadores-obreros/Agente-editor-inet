# INVARIANTES-ENTRYPOINTS.md — matriz de invariantes por puerta de entrada (Phase 1.1)

Este documento **referencia** el Brief congelado, `IR-SPEC.md` y `OPERATIONS.md` — no
es una segunda especificación ni reemplaza a ninguno de los tres. Su único propósito
es dejar visible, para cada invariante de contrato, **qué puerta de entrada del núcleo
lo hace cumplir de verdad hoy**, con qué código de `Motivo`, y con qué test — para que
un GAP real (invariante que una puerta debería reforzar y no lo hace, o que sólo se
sostiene por una cadena de suposiciones no verificadas) quede visible en vez de
asumido.

Cada celda salió de LEER el código real (`opencode/nucleo/*.ts`) y de encontrar o
correr el test que lo prueba — nunca se copió de un reporte de auditoría anterior.

## Puertas de entrada (7 columnas, con su función/archivo real)

| Puerta | Función/archivo |
|---|---|
| **Loader** | `cargarProyecto()` / `validarFormaProyecto()` — `cargador.ts`, Gate 2 |
| **Project initial** | `crearMotorDeProyecto({ proyectoInicial })` — `motor.ts`, Gate 6, momento de construcción |
| **Operation** | `aplicarOperacion()` — `operaciones.ts`, Gate 5, función pura, UNA operación |
| **Batch** | `motor.aplicar()` / `motor.aplicarTransaccion()` — `motor.ts`, `ejecutarLote(..., comprometer:true)`, Gate 6 |
| **Dry-run** | `motor.proponer()` — `motor.ts`, `ejecutarLote(..., comprometer:false)`, Gate 6 |
| **Store load** | `almacen.cargar(id)` — `almacen.ts`, Gate 7 |
| **Catalog revalidation** | `validarProyecto(proyecto, catalogoDistinto)` invocado directo — `validar.ts`, Gate 4 |

Valores de celda: **refuerza** (la puerta corre el chequeo, con la función que se
nombra) · **N/A** (el motivo por el que esa puerta no aplica) · **por construcción**
(el invariante se sostiene porque el código que rodea a esa puerta lo garantiza por
diseño, no porque haya un chequeo explícito ahí — se explica cuál) · **GAP** (hueco
real encontrado, reportado, NO corregido acá).

---

## Matriz

| # | Invariante | Owner canónico | Loader | Project initial | Operation | Batch | Dry-run | Store load | Catalog revalidation | Reason code(s) | Representable/reject | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | IDs únicos (cmp+conn+beh, string exacto) | `analizarIdsLocales`/`validarIdsYContador` (`id.ts`) | refuerza | refuerza | por construcción [a] | refuerza (defensa en profundidad post-lote, Phase 1.1 RX, hallazgo RX-03) [a] | refuerza (mismo pipeline que Batch, sin persistir) [a] | refuerza (vía `cargarProyecto`) | N/A [b] | `ID_DUPLICADO` | reject | `nucleo-ir-cargador.test.mjs::id-duplicado-entre-componentes-rechaza`, `::id-duplicado-entre-conexiones-rechaza`, `::id-duplicado-entre-comportamientos-rechaza`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-ids-duplicados-entre-conexiones`, `::defensa-en-profundidad-post-lote: contador de ids inconsistente en el commit se rechaza (RX-03)` |
| 2 | Contador (`siguienteIdLocal`) monotónico / consistente | `contadorEsConsistente`/`validarIdsYContador` (`id.ts`) | refuerza | refuerza | por construcción [c] | refuerza (defensa en profundidad post-lote, Phase 1.1 RX, hallazgo RX-03) [c] | refuerza (mismo pipeline que Batch, sin persistir) [c] | refuerza (vía `cargarProyecto`) | N/A [b] | `CONTADOR_ID_INCONSISTENTE` | reject | `nucleo-ir-cargador.test.mjs::contador-siguienteIdLocal-inconsistente-con-id-existente-rechaza`, `::contador-siguienteIdLocal-igual-al-maximo-existente-rechaza`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-contador-id-inconsistente`, `::defensa-en-profundidad-post-lote: contador de ids inconsistente en el commit se rechaza (RX-03)`; `nucleo-operaciones.test.mjs::quitar-luego-agregar: el contador nunca retrocede... (M22)` |
| 3 | Referencias válidas (conexión/comportamiento → componente existente) | `cargador.ts` (carga) + `validarEstructural` (post-construcción) — DOS implementaciones a propósito, IR-SPEC §7 | refuerza | refuerza (vía `validarProyecto` al construirse) | refuerza (cada `aplicarXxx` re-chequea antes de mutar) | refuerza (hereda Operation + defensa en profundidad post-lote) [d] | refuerza (mismo pipeline que Batch, sin persistir) | refuerza (vía `cargarProyecto`) | refuerza | `REFERENCIA_ROTA_AL_CARGAR` (carga) / `REFERENCIA_INEXISTENTE` (cualquier `Proyecto`) | reject (ambos) | `nucleo-ir-cargador.test.mjs::referencia-colgada-en-conexion-rechaza`, `::referencia-colgada-en-comportamiento-rechaza`; `nucleo-validacion.test.mjs::referencia-inexistente-en-validar-estructural`; `nucleo-operaciones.test.mjs::quitarcomponente-inexistente-rechaza`, `::desconectar-inexistente-rechaza`, `::setcomportamiento-sensor-inexistente-rechaza`; `nucleo-adversarial.test.mjs::14. referencia rota da REFERENCIA_ROTA_AL_CARGAR al cargar y REFERENCIA_INEXISTENTE en validar-estructural, nunca el mismo codigo` |
| 4 | Sin auto-conexión (self-loop) | `esAutoconexion`/`analizarConexionesInvalidas` (`conexion.ts`) | refuerza | refuerza (vía `validarProyecto`) | refuerza (`aplicarConectar`) | refuerza (hereda + defensa en profundidad) [d] | refuerza | refuerza (vía `cargarProyecto`) | refuerza | `AUTOCONEXION_INVALIDA` (operacion/estructural) / `AUTOCONEXION_INVALIDA_AL_CARGAR` (carga) | reject (siempre) | `nucleo-operaciones.test.mjs::conectar-autoconexion-rechaza`; `nucleo-ir-cargador.test.mjs::loader-rechaza-documento-con-selfloop`; `nucleo-validacion.test.mjs::validarEstructural-detecta-selfloop-en-conexion`, `::validarProyecto-directo-rechaza-selfloop-con-listo-false`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-selfloop` |
| 5 | Sin conexión duplicada (A→B ≡ B→A) | `mismaConexion`/`analizarConexionesInvalidas` (`conexion.ts`) | refuerza | refuerza (vía `validarProyecto`) | refuerza (`aplicarConectar`) | refuerza (hereda + defensa en profundidad) [d] | refuerza | refuerza (vía `cargarProyecto`) | refuerza | `CONEXION_DUPLICADA` (operacion/estructural) / `CONEXION_DUPLICADA_AL_CARGAR` (carga) | reject (siempre) | `nucleo-operaciones.test.mjs::conectar-duplicada-rechaza`; `nucleo-ir-cargador.test.mjs::loader-rechaza-documento-con-conexion-duplicada`; `nucleo-validacion.test.mjs::validarEstructural-detecta-conexion-duplicada-con-extremos-invertidos`, `::validarEstructural-no-rechaza-conexiones-distintas-que-comparten-terminal` (no-regresión); `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-conexion-duplicada` |
| 6 | Capacidad de comportamiento válida | `aplicarSetComportamiento` (operación) + `validar-tecnico.ts` (continuo) — DOS momentos, IR-SPEC §6.2 | N/A (Gate 2 no conoce catálogo) | refuerza (diagnostica, representable — no bloquea construcción) | refuerza (`CAPACIDAD_NO_DECLARADA`, rechazo) | refuerza (hereda Operation + diagnóstico post-lote) | refuerza | N/A [e] | refuerza | `CAPACIDAD_NO_DECLARADA` (operacion, rechazo) / `CAPACIDAD_INEXISTENTE_EN_CATALOGO` (tecnica, representable) | mixto (reject en Operation, representable en validación continua) | `nucleo-operaciones.test.mjs::setcomportamiento-capacidad-no-declarada-rechaza`; `nucleo-validacion.test.mjs::capacidad-inexistente-en-catalogo-representable`, `::sensor-sin-la-capacidad-requerida-representable`, `::comportamiento-valido-bajo-un-catalogo-deja-de-serlo-bajo-otro...` |
| 7 | Magnitud/unidad de umbral compatible con la capacidad | `propagarMagnitud` (`catalogo.ts`, oráculo) reusado por `validar-tecnico.ts` | N/A (sin catálogo) | refuerza (diagnostica) | N/A (deliberado: IR-SPEC §6.2, se deja pasar, se diagnostica después de commitear — mismo criterio que `PIN_OCUPADO`) | refuerza (diagnostica post-lote, representable) | refuerza (diagnostica) | N/A [e] | refuerza | `MAGNITUD_INCOMPATIBLE` (tecnica, código ya existente de `catalogo.ts`) | representable (nunca rechazo — IR-SPEC §6.2) | `nucleo-validacion.test.mjs::umbral-magnitud-incompatible-representable`, `::umbral-unidad-incompatible-representable`; `nucleo-catalogo.test.mjs::magnitud-dimension-incompatible`; `nucleo-operaciones.test.mjs::setcomportamiento-temperatura-negativa-commitea` (no-regresión: confirma que NO rechaza a nivel operación) |
| 8 | Umbral finito (`Number.isFinite`) | 3 puertas por diseño (`cargador.ts`/`operaciones.ts`/`validar-estructural.ts`), IR-SPEC §6.2 | refuerza | refuerza (vía `validarProyecto`) | refuerza (`aplicarSetComportamiento`, antes de mutar) | refuerza (hereda + defensa en profundidad) | refuerza | refuerza (vía `cargarProyecto`) | refuerza | `UMBRAL_NO_FINITO_AL_CARGAR` (carga) / `UMBRAL_NO_FINITO` (operacion y estructural, según quién emite) | reject (los 3 códigos) | `nucleo-ir-cargador.test.mjs::umbral-nan-al-cargar-rechaza`, `::umbral-infinito-positivo-al-cargar-rechaza`, `::umbral-infinito-negativo-al-cargar-rechaza`; `nucleo-operaciones.test.mjs::setcomportamiento-umbral-nan-rechaza`, `::setcomportamiento-umbral-infinito-positivo-rechaza`, `::setcomportamiento-umbral-infinito-negativo-rechaza`; `nucleo-validacion.test.mjs::umbral-no-finito-rechaza-en-validar-estructural`, `::umbral-nan-rechaza-en-validar-estructural`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-umbral-no-finito` |
| 9 | `baseRevision` válido (entero no negativo, no sustituido nunca por la revisión actual) | `esEnteroNoNegativo` + `ejecutarLote` (`motor.ts`), Gate 6 exclusivo | N/A (no existe en el documento `Proyecto`) | N/A (no existe en `proyectoInicial`) | N/A (`aplicarOperacion`, Gate 5, no conoce `baseRevision` — es puramente Gate 6) | refuerza (`ejecutarLote`, para `aplicar` y `aplicarTransaccion` por igual — sólo la PRIMERA operación del lote se contrasta, OPERATIONS.md §2/§9) | refuerza (mismo `ejecutarLote`, sin persistir) | N/A (`almacen.cargar` no conoce operaciones) | N/A (`validarProyecto` directo no recibe ningún sobre de operación) | `BASE_REVISION_INVALIDA` (dato nunca válido) / `BASE_REVISION_DESACTUALIZADA` (dato válido pero stale) | reject (ambos) | `nucleo-motor.test.mjs::baseRevision invalido en la PRIMERA operacion rechaza...`, `::baseRevision AUSENTE...`, `::ResultadoTransaccion con baseRevision invalido ecoa...`, `::segunda-operacion-con-baseRevision-valido-pero-stale...`; `nucleo-adversarial.test.mjs::5a...`, `::5b...` |
| 10 | Sobre/payload de operación con forma válida (y su LECTURA nunca crashea — Phase 1.1 RX/RX2, hallazgos RX-02/RX2-01) | `analizarSobreOperacion`/`validarFormaPayload` (`operaciones.ts`), corridas SOBRE la copia YA materializada (fila 15) — nunca sobre el sobre crudo | N/A (concierne al sobre de operación, no al documento `Proyecto`) | N/A (`proyectoInicial` no es un sobre de operación) | refuerza (`aplicarOperacion`, después de materializar, antes del switch) | refuerza (hereda: `ejecutarLote` llama `aplicarOperacion` una vez por operación del lote, YA materializado por la fila 15) | refuerza (mismo pipeline) | N/A | N/A | `SOBRE_OPERACION_INVALIDO` / `TIPO_OPERACION_DESCONOCIDO` / `PAYLOAD_OPERACION_INVALIDO` / `CLAVE_DESCONOCIDA` (categoria operacion) | reject (siempre) | `nucleo-operaciones.test.mjs::aplicarOperacion/ejecutarOperacion NUNCA lanzan una excepcion cruda...`, `::el sobre de operacion rechaza una clave extra desconocida...`, `::aplicarOperacion/ejecutarOperacion NUNCA propagan un getter-que-explota... (RX-02/RX2-01)`; `nucleo-motor.test.mjs::motor.aplicar/aplicarTransaccion/proponer NUNCA propagan una excepcion cruda...`, `::motor.aplicar/aplicarTransaccion/proponer NUNCA propagan un getter-que-explota... (RX-02/RX2-01)` |
| 11 | Forma/schema del documento `Proyecto` (claves, tipos, versión) | `validarFormaProyecto` (`cargador.ts`) — MISMA función, reusada, no copiada (fix CP-01) | refuerza | refuerza (extraída para esto, CP-01) | N/A (asume un `Proyecto` ya bien formado — validado en Loader/Project-initial) | N/A (idem) | N/A (idem) | refuerza (vía `cargarProyecto`) | N/A (`validarEstructural`/`validarTecnico` asumen un `Proyecto` "ya bien tipado" — comentario propio del archivo) | `CLAVE_DESCONOCIDA` / `CAMPO_REQUERIDO_FALTANTE` / `VERSION_SCHEMA_DESCONOCIDA` / `DOCUMENTO_MALFORMADO` (categoria estructural) | reject (siempre) | `nucleo-ir-cargador.test.mjs::clave-top-level-desconocida-rechaza`, `::falta-campo-requerido-rechaza`, `::schemaVersion-futura-rechaza-sin-proyecto-parcial`, `::json-corrupto-rechaza`, `::documento-no-es-un-objeto-rechaza`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-forma-invalida (CP-01)`; `nucleo-almacen.test.mjs::cargar-json-corrupto-da-motivos-estructurados` |
| 12 | Inmutabilidad del catálogo construido | `construirCatalogo` (`catalogo.ts`, fix E3-03) | N/A (Gate 2 no toca catálogo) | por construcción [f] | por construcción [f] | por construcción [f] | por construcción [f] | N/A (`almacen.cargar` sólo compara `catalogoHash`, nunca reconstruye ni lee componentes) | por construcción [f] | N/A (esto es un invariante de aislamiento de referencia — se prueba con `Object.isFrozen`, no es un `Motivo`) | N/A | `nucleo-catalogo.test.mjs::obtenerComponente() devuelve un objeto CONGELADO — mutarlo explota, nunca se propaga en silencio (hallazgo externo E3-03)` |
| 13 | Colisión de escritura en almacén (compare-and-swap por revisión) | `almacen.ts::guardar()` (fix E3-07) | N/A (no escribe) | N/A (no escribe) | N/A (`aplicarOperacion` es pura, sin I/O) | refuerza (el commit de `ejecutarLote` es quien llama `almacen.guardar()`) | N/A (`proponer()` nunca llama a `guardar`, verificado por test) | N/A (concierne a escritura, no a lectura — ver fila 14) | N/A (no escribe) | `CONFLICTO_REVISION_EN_ALMACEN` (categoria almacen) | reject | `nucleo-almacen.test.mjs::guardar-detecta-conflicto-cuando-el-disco-ya-avanzo-mas-alla-de-lo-que-este-llamador-vio (E3-07)`; `nucleo-motor.test.mjs::dos-motores-mismo-almacen-real-y-mismo-id-el-segundo-commit-recibe-conflicto-en-vez-de-pisar-al-primero (E3-07)` |
| 14 | El `id` del documento cargado coincide con el `id` pedido | `almacen.ts::cargar()` (fix E3-08) | N/A (`cargarProyecto` no recibe un "id pedido" — sólo el documento) | N/A | N/A | N/A | N/A | refuerza | N/A | `ID_DOCUMENTO_NO_COINCIDE` (categoria almacen) | reject | `nucleo-almacen.test.mjs::cargar-rechaza-si-el-id-del-documento-no-coincide-con-el-id-pedido (E3-08)` |
| 15 | Entrada es DATO PLANO — objetos JS exóticos (getter/Proxy/prototipo de clase/ciclo) se rechazan SIN invocar el peligro, nunca una excepción cruda; y el CONTENEDOR que copia claves de usuario es inmune a cualquier setter heredado (`"__proto__"` incluido), así que ningún nombre de clave corrompe un prototipo ni se pierde en silencio (Phase 1.1 RX2, hallazgos RX2-01/RX2-02/RX2-03/RX2-04; Phase 1.1 RX3, hallazgos RX3-01/RX3-02) | `materializarDatosPlanos` (`datos-planos.ts`), corrida como PRIMER paso, antes de cualquier otra lectura — copia construida con `Object.defineProperty` (RX3-01, nunca `copia[clave]=valor`; MISMO fix aplicado en `canonico.ts::ordenarClavesProfundo` y `cargador.ts::validarComponente` — los tres únicos sitios del núcleo que copian claves de usuario a un objeto fresco, auditado con `rg`) — con el contenedor seguro, NINGÚN nombre de clave (`"__proto__"`/`"constructor"`/`"prototype"`) se rechaza por nombre: una entidad de forma CERRADA la rechaza vía `CLAVE_DESCONOCIDA` (mismo mecanismo que cualquier clave no declarada), una bolsa ABIERTA (`propiedades`/`pines`) la acepta como dato ordinario preservado exacto | refuerza (`validarFormaProyecto`, doc completo) | refuerza (misma función, `proyectoInicial`; RX3-02: si la forma ya rechazó, 0 invocaciones adicionales sobre el crudo — los chequeos de Gate 4 corren sobre una materialización propia) | refuerza (`aplicarOperacion`, sobre completo; Phase 1.2, hallazgo externo REA-03, MAYOR: `ejecutarOperacion` materializa esa MISMA copia UNA sola vez, en su propia frontera, y la reusa tanto para decidir la aplicación (`aplicarOperacionMaterializada`) como para el eco `idOperacion`/`idTransaccion`/`baseRevision` — antes de este fix materializaba una SEGUNDA copia independiente sólo para el eco, que un Proxy con `getOwnPropertyDescriptor` estatoso podía divergir de la primera) | refuerza (`ejecutarLote`, LOTE completo, antes de leer `baseRevision`) | refuerza (mismo pipeline que Batch) | N/A (`almacen.cargar()` siempre recibe un string desde disco — `JSON.parse` nunca produce objetos exóticos; `"__proto__"` dentro de `propiedades` sobrevive el ciclo guardar→cargar como dato ordinario, verificado con round-trip formal, `nucleo-almacen.test.mjs`) | N/A (`validarProyecto` directo recibe un `Proyecto` ya construido por una puerta de arriba) | `ENTRADA_NO_ES_DATO_PLANO` (objeto exótico: categoria estructural/operacion/motor según quién emite) / `CLAVE_DESCONOCIDA` (clave peligrosa en forma cerrada, mismo código que cualquier clave no declarada) | reject (objeto exótico); reject en forma cerrada / representable en bolsa abierta (clave peligrosa como dato) | `nucleo-datos-planos.test.mjs` (contrato completo del módulo, incluye invariante de prototipo/claves de salida y aceptación de `"__proto__"`/`"constructor"`/`"prototype"` como dato ordinario, round-trip formal a nivel de módulo, RX3-01); `nucleo-ir-cargador.test.mjs::cargarProyecto(objetoJS) con un Proxy que lanza en 'ownKeys'/'getOwnPropertyDescriptor'...`, `::...con un accessor en un campo RAIZ DECLARADO...`, `::cargarProyecto(string/objeto) rechaza "__proto__"/"constructor"/"prototype" ... con CLAVE_DESCONOCIDA` (raíz/componente/conexión/comportamiento) y `::... ACEPTA ... como dato ORDINARIO` (pines/propiedades), ambas puertas, `::regresion ... exp_proto_pollution.mjs` (RX3-01); `nucleo-almacen.test.mjs::round-trip formal ... '__proto__'/'constructor'/'prototype' dentro de propiedades sobreviven identicos (RX3-01)`; `nucleo-motor.test.mjs::constructor-rechaza-proyectoInicial-con-accessor-en-un-campo-RAIZ-DECLARADO (R06)`, `::motor.proponer/aplicar/aplicarTransaccion NUNCA crashean con un Proxy que lanza en propiedades... (RX2-02)`, `::constructor-rechaza-proyectoInicial-con-clave-'__proto__'-en-la-raiz-con-CLAVE_DESCONOCIDA (RX3-01)`, `::motor.proponer/aplicar/aplicarTransaccion rechazan .../ACEPTAN ... en el SOBRE/en propiedades de AgregarComponente (RX3-01)`, `::constructor NUNCA vuelve a invocar un getter... 0 invocaciones, no 3 (RX3-02)`; `nucleo-operaciones.test.mjs::aplicarOperacion/ejecutarOperacion NUNCA propagan un getter-que-explota... (RX2-01)`, `::aplicarOperacion ACEPTA '__proto__'/'constructor'/'prototype' como clave en payload.propiedades ... (RX3-01)`, `::aplicarOperacion/ejecutarOperacion usan SIEMPRE el payload MATERIALIZADO en los 8 tipos de operacion, nunca vuelven a leer el payload crudo (Proxy con getOwnPropertyDescriptor/get inconsistentes, hallazgo M3 W9-M2a)`, `::ejecutarOperacion materializa el sobre UNA sola vez: el eco (idOperacion/baseRevision) y el efecto REALMENTE aplicado siempre describen la MISMA operación — nunca dos pasadas de materialización independientes que puedan divergir (hallazgo externo REA-03)`; `nucleo-motor.test.mjs::motor.aplicar/aplicarTransaccion/proponer usan SIEMPRE el baseRevision MATERIALIZADO de la primera operacion, nunca vuelven a leer el lote crudo (Proxy con getOwnPropertyDescriptor/get inconsistentes, hallazgo M3 W9-M2b)` |
| 16 | Forma del LOTE de `SobreOperacion[]` — array denso de objetos no nulos, verificado UNA vez ANTES de leer cualquier campo de cualquier elemento (Phase 1.1 RX4, hallazgo RX4-01) | `ejecutarLote` (`motor.ts`), justo después de materializar el lote (fila 15) | N/A (concierne al LOTE de operaciones, no al documento `Proyecto`) | N/A (`proyectoInicial` no es un lote de operaciones) | N/A (`aplicarOperacion`, Gate 5, procesa UNA operación — la forma del LOTE es exclusivamente Gate 6) | refuerza (`ejecutarLote`, ANTES de leer `baseRevision` de la primera operación — fila 9 — y antes de entrar al loop de aplicadores) | refuerza (mismo pipeline que Batch, sin persistir) | N/A | N/A | `LOTE_OPERACIONES_INVALIDO` (el lote mismo no es un array, categoria motor) / `SOBRE_OPERACION_INVALIDO` (un elemento del lote no es un objeto, REUSADO con categoria motor — mismo código de la fila 10, categoria operacion, cuando lo emite `operaciones.ts`) | reject (siempre, lote entero) | `nucleo-motor.test.mjs::motor.aplicar/aplicarTransaccion/proponer NUNCA propagan una excepcion cruda ante un elemento null (u otro no-objeto) en el lote... (RX4-01)`, `::motor.aplicarTransaccion/proponer NUNCA propagan una excepcion cruda cuando el LOTE MISMO no es un array (RX4-01)`, `::elemento null en el lote rechaza con SOBRE_OPERACION_INVALIDO, categoria motor, e incluye el indice (RX4-01)`; `nucleo-operaciones.test.mjs::aplicarOperacion/ejecutarOperacion NUNCA lanzan una excepcion cruda... — caso "operacion === null" (RX4-01)` |
| 17 | `revision`/`siguienteIdLocal`/`baseRevision` acotados a `Number.isSafeInteger` — el INCREMENTO (`+1`) tiene que seguir siendo exacto, nunca un compare-and-swap neutralizado en silencio (Phase 1.1 RX4, hallazgo RX4-02, RECLASIFICA E1-04) | `esEnteroNoNegativo` (`cargador.ts`, única definición, fila 9) + guarda de commit (`ejecutarLote`, `motor.ts`) + guarda de contador (`operaciones.ts`, alta nueva) | refuerza (`revision`/`siguienteIdLocal`, vía `validarFormaProyecto`) | refuerza (misma función, `proyectoInicial`) | refuerza (guarda de `CONTADOR_ID_EXCEDE_ENTERO_SEGURO` en `aplicarAgregarComponente`/`aplicarConectar`/`aplicarSetComportamiento`, alta nueva) | refuerza (`baseRevision` vía fila 9, cota ahora `Number.isSafeInteger`; guarda de `REVISION_EXCEDE_ENTERO_SEGURO` en el commit) | refuerza (mismo pipeline que Batch, sin persistir — la guarda de commit no aplica porque `proponer()` nunca incrementa `revision`) | refuerza (`revision`/`siguienteIdLocal`, vía `cargarProyecto`) | N/A | `CAMPO_REQUERIDO_FALTANTE` (revision/siguienteIdLocal fuera de rango, carga) / `BASE_REVISION_INVALIDA` (fila 9, cota mas estricta) / `REVISION_EXCEDE_ENTERO_SEGURO` (commit, categoria motor) / `CONTADOR_ID_EXCEDE_ENTERO_SEGURO` (alta nueva, categoria operacion) | reject (siempre) | `nucleo-ir-cargador.test.mjs::revision mas alla de Number.MAX_SAFE_INTEGER rechaza al cargar (RX4-02)`, `::revision === Number.MAX_SAFE_INTEGER - 1/=== Number.MAX_SAFE_INTEGER carga sin problema (RX4-02)`, `::siguienteIdLocal mas alla de Number.MAX_SAFE_INTEGER rechaza al cargar (RX4-02)`; `nucleo-motor.test.mjs::baseRevision === 1e21 en una operacion rechaza con BASE_REVISION_INVALIDA... (RX4-02)`, `::un proyectoInicial con revision:1e21 NUNCA construye un motor operable... (RX4-02)`, `::revision === Number.MAX_SAFE_INTEGER - 1 commitea exacto a Number.MAX_SAFE_INTEGER (RX4-02)`, `::en revision === Number.MAX_SAFE_INTEGER el siguiente commit rechaza SIN cambiar nada... (RX4-02)`, `::el contador de ids (siguienteIdLocal) tambien se niega a producir un incremento inexacto... (RX4-02)` |
| 18 | `comparador`/`accion` de un comportamiento ∈ dominio normativo único (`ir.ts::COMPARADORES`/`ACCIONES`) — PERSISTIBLE ⇒ RECARGABLE (Phase 1.2, hallazgo externo REA-01, CRÍTICO — re-auditoría externa) | `aplicarSetComportamiento` (operación, Gate 5) + `validarFormaProyecto` vía la barrera de `ejecutarLote` (Gate 6, defensa en profundidad) — DOS momentos, `IR-SPEC.md` §6.11 | refuerza (`validarComportamiento`, dominio importado de `ir.ts`, ya vigente desde antes de Phase 1.2 — sólo dejó de ser una lista local) | refuerza (`validarFormaProyecto`, misma función, `proyectoInicial`) | refuerza (`VALOR_ENUM_DESCONOCIDO`, ANTES de crear estado — Phase 1.2, capa 1) | refuerza (hereda Operation + barrera post-lote `ESTADO_NO_RECARGABLE`, Phase 1.2 capa 2 — nunca alcanzable hoy vía las 8 operaciones públicas, la capa 1 ya cierra el gap; defensa PROSPECTIVA, mismo criterio que fila 1/nota [a]) | refuerza (misma barrera que Batch, sin persistir — decisión Phase 1.2: `proponer()` nunca aprueba lo que `aplicar()` rechazaría) | refuerza (vía `cargarProyecto`) | refuerza | `VALOR_ENUM_DESCONOCIDO` (operacion, rechazo, Phase 1.2) / `ESTADO_NO_RECARGABLE` (motor, rechazo, Phase 1.2, barrera) / `CAMPO_REQUERIDO_FALTANTE` (carga, código ya existente — el loader sigue tratando un comparador/accion inválido como campo ausente) | reject (todos) | `nucleo-operaciones.test.mjs::setcomportamiento-comparador-fuera-de-dominio-rechaza-ANTES-de-crear-estado (REA-01)`, `::setcomportamiento-accion-fuera-de-dominio-rechaza-ANTES-de-crear-estado (REA-01)`, `::setcomportamiento-todo-valor-REAL-del-dominio-compartido-sigue-commiteando-sin-rechazo (REA-01, no-regresion)`; `nucleo-motor.test.mjs::barrera-PERSISTIBLE-RECARGABLE: un borrador con comparador fuera de dominio... rechaza en el COMMIT con ESTADO_NO_RECARGABLE (REA-01)`, `::barrera-PERSISTIBLE-RECARGABLE: proponer() (dry-run) rechaza IGUAL que aplicar()... (REA-01, decisión sobre el dry-run)` |

---

## Notas por fila (detalle que no entra en la celda)

**[a] Fila 1, columna Operation — "por construcción":** `aplicarOperacion` nunca
verifica explícitamente que un id nuevo no colisione — genera el id con
`formatearIdLocal(prefijo, proyecto.siguienteIdLocal)` y confía en que
`proyecto.siguienteIdLocal` YA es consistente (garantía que entra por Loader/Project
initial, filas 1-2). `SetComportamiento`, además, IGNORA por completo cualquier `id`
que el payload sugiera para una entidad nueva (sólo lo usa para el camino de
reemplazo, cuando coincide con un `id` YA existente) — así que un cliente no puede
forzar una colisión ni aunque lo intente. Se mantiene consistente por INDUCCIÓN: los 3
aplicadores que generan un id local sólo lo INCREMENTAN, nunca lo decrementan (cerrado
con regresión de cobertura en el hallazgo M22, `tests/nucleo-operaciones.test.mjs`).

**Phase 1.1 (RX) — columnas Batch/Dry-run YA NO son "por construcción" (hallazgo
externo RX-03, MAYOR):** `ejecutarLote` (`motor.ts`) ahora corre `validarIdsYContador`
sobre el `borrador` DESPUÉS de aplicar el lote entero, como defensa en profundidad
exclusiva del camino de commit/dry-run del motor — si un aplicador futuro (Fase 2+)
rompiera la disciplina "sólo incrementa" que hoy sostiene el contador únicamente por
inducción, el lote entero se rechaza acá con `CONTADOR_ID_INCONSISTENTE`/
`ID_DUPLICADO`, en vez de colar el estado roto sin ningún diagnóstico. Con las 8
operaciones públicas actuales esto NUNCA dispara (siguen siendo consistentes por
construcción — RX confirmó activamente que no hay forma de romperlo vía la API
pública) — la defensa es prospectiva, mismo patrón que ya usan las filas 3-5 para
`REFERENCIA_INEXISTENTE`/`AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA`. Deliberadamente
NO se agregó a `validarProyecto`/`validar-estructural.ts` (nota [b] sigue vigente para
la columna Catalog revalidation) — sólo al pipeline exclusivo del motor.

**GAP encontrado (fila 1, columna Batch):** ningún test de
`tests/nucleo-motor.test.mjs`/`tests/nucleo-adversarial.test.mjs` afirma EXPLÍCITAMENTE
que 2+ operaciones que generan un id local (ej. dos `AgregarComponente`) DENTRO del
MISMO `aplicarTransaccion([...])` producen ids distintos y consecutivos. El
comportamiento SE VERIFICÓ correcto por lectura + repro manual
(`evidencia/T7/matriz_gap_multiop_ids_repro.mjs`/`_output.txt`: dos `AgregarComponente`
en un solo lote producen `cmp-0`/`cmp-1`, `siguienteIdLocal` termina en 2) — no es un
defecto de código, es un hueco de COBERTURA de test explícita para un invariante que
hoy se sostiene sólo "por construcción". No se agregó el test acá (fuera del alcance
de la Parte 4 de T7, que pide reportar un GAP, no corregirlo en silencio) — reportado
para que Phase 1.1/Fase 2 decida si amerita un test dedicado.

**Phase 1.1 — GAP cerrado (commit 79da20a):** se agregó el test dedicado
`tests/nucleo-motor.test.mjs::lote-con-varias-altas-genera-ids-distintos-y-consecutivos`
(tres altas en un lote → `cmp-0`/`cmp-1`/`cmp-2`, `siguienteIdLocal` 3). Mutante
verificado: si `aplicarAgregarComponente` no avanza el contador, el test falla con
`['cmp-0','cmp-0','cmp-0']`. Ese mutante muestra además un límite que en ese momento
quedó registrado: dentro de un lote, la unicidad de ids dependía SÓLO de la monotonía
de los aplicadores, porque la validación post-lote (`validarProyecto`) no re-chequeaba
ids duplicados/contador — ese test era, en ese momento, la única red para esa puerta.

**Actualización Phase 1.1 (RX), hallazgo externo RX-03:** esa afirmación ya NO es
exacta — `ejecutarLote` ahora corre `validarIdsYContador` (nota [a] de arriba,
defensa en profundidad exclusiva del camino de commit/dry-run del motor, NUNCA
agregada a `validarProyecto`/`validar-estructural.ts`). El test de
`lote-con-varias-altas-genera-ids-distintos-y-consecutivos` sigue siendo la
regresión de COBERTURA correcta para "las 8 operaciones públicas nunca rompen esto
por construcción" — pero ya no es la ÚNICA red: si algo SÍ lo rompiera (un aplicador
futuro de Fase 2+, o el mutante de `clonar` inyectado en
`tests/nucleo-motor.test.mjs::defensa-en-profundidad-post-lote...`), el commit
entero se rechaza con un motivo estructurado en vez de colarse sin diagnóstico.

**[b] Filas 1-2, columna Catalog revalidation — N/A, por diseño explícito:**
`validarIdsYContador` deliberadamente NO se agregó al pipeline continuo de
`validar-estructural.ts`/`validarProyecto` (IR-SPEC §6.1): esa validación corre sobre
CUALQUIER `Proyecto`, incluidos fixtures de test armados a mano que usan
intencionalmente ids no numerados o fuera de secuencia como estado "sano". Una vez
consistente al construirse (filas Loader/Project initial), el contador se mantiene
consistente por inducción — no por revalidación continua.

**[c] Fila 2, igual razón que [a]** aplicada al contador en sí: ningún aplicador
decrementa `siguienteIdLocal`; el M22 regression test (`tests/nucleo-operaciones.
test.mjs`) es justamente la prueba de esa propiedad "por construcción".

**[d] Filas 3-5, columna Batch — "defensa en profundidad", con matiz:** el commit de
`ejecutarLote` corre `validarProyecto(borrador, catalogo)` una vez DESPUÉS de aplicar
todo el lote — si trae un motivo `clasificacion:"rechazo"` (fila 3:
`REFERENCIA_INEXISTENTE`; filas 4/5: `AUTOCONEXION_INVALIDA`/`CONEXION_DUPLICADA` con
categoría `estructural`), el lote entero se descarta igual que un rechazo por
operación (hallazgo adversarial Gate 8, `DECISIONS.md`). Para las filas 4/5, esta
segunda capa hoy NUNCA encuentra nada distinto vía las 8 operaciones públicas, porque
`aplicarConectar` ya rechaza el self-loop/duplicado ANTES de llegar a ese punto — la
defensa real es contra un `proyectoInicial`/estado bypaseado, no contra las
operaciones normales. Para la fila 3, la auditoría externa (§29,
`PHASE_1_EXTERNAL_FINDINGS.md`) confirma lo mismo: "no reproducible hoy vía API
pública", el mecanismo se prueba forzado (`validacionAdicionalSoloTests` o
`proyectoInicial` roto).

**[e] Filas 6-7, columna Store load — N/A por diseño, no GAP:** `almacen.cargar()`
(Gate 7) sólo compara `catalogoHash` guardado vs. activo y emite un aviso INFORMATIVO
(`CATALOGO_CAMBIO_DETECTADO`, severidad `info`) — nunca re-corre `validar-tecnico.ts`.
Esto es arquitectura deliberada (Gate 7 = persistencia física, Gate 4 = validación
semántica): el diagnóstico técnico completo (capacidad/magnitud/unidad) lo corre quien
construya el motor sobre el `Proyecto` recién cargado (`crearMotorDeProyecto`, fila
Project initial) o quien llame `validarProyecto` directo (columna Catalog
revalidation) — nunca `almacen.cargar()` por sí solo. Documentado en el propio
`almacen.ts` ("Version-skew (R11/R2): ... se AVISA, nunca se muta el proyecto ni se
rechaza la carga").

**[f] Fila 12 — "por construcción" en las puertas del motor/operaciones:** el
`Catalogo` llega YA construido (inmutable) como dependencia inyectada
(`DependenciasMotor.catalogo`) — ninguna puerta del motor/operaciones invoca
`construirCatalogo()` de nuevo ni necesita reverificar el aislamiento: se benefician
de la garantía establecida UNA sola vez, upstream, en el composition root.

---

## Resumen de GAPs encontrados

Un (1) GAP real, de COBERTURA (no de comportamiento — verificado correcto por
lectura + repro manual), documentado en la nota **[a]** de la fila 1: falta un test
explícito de que 2+ operaciones generadoras de id, dentro del MISMO lote
(`aplicarTransaccion`), producen ids distintos y consecutivos. No corregido en esta
tarea (T7, Parte 4 pide reportar, no corregir en silencio).

**Phase 1.1 — cerrado** con el test dedicado citado en la nota [a].

**Phase 1.1 (RX) — segundo GAP encontrado y cerrado (hallazgo externo RX-03, MAYOR):**
`validarIdsYContador` corría en el Loader y en la construcción del motor, pero NUNCA
en el pipeline continuo de commit (filas 1-2, columnas Batch/Dry-run) — un gap
arquitectónico de PROFUNDIDAD DE DEFENSA (no explotable hoy vía las 8 operaciones
públicas, confirmado activamente por RX), a diferencia de su hallazgo gemelo E2-01
(filas 4-5), que sí se agregó al pipeline continuo. Cerrado agregando
`validarIdsYContador` al camino de commit de `ejecutarLote` (`motor.ts`) — nunca a
`validarProyecto`/`validar-estructural.ts`, para no romper los fixtures manuales de
`nucleo-validacion.test.mjs` (nota [a]/[b] arriba).

**Phase 1.1 (RX2) — tercer GAP encontrado y cerrado (hallazgos externos
RX2-01/RX2-02/RX2-03, CRÍTICOS):** una segunda revisión adversarial independiente
reabrió E2-02/RX-02/CP-01/RX-01 por ángulos que un `try/catch` puntual (protege UNA
lectura) no podía cerrar de raíz: una SEGUNDA lectura sin proteger del mismo campo
(`aplicarOperacion`, RX2-01), una superficie nunca antes tocada (`congelarProfundo`,
RX2-02), y una puerta sin ningún `try/catch` propio más un TOCTOU real que rompía el
round-trip (`cargarProyecto(objeto)`, RX2-03). Cerrado de CLASE (fila 15 nueva,
arriba) con un módulo único (`datos-planos.ts`) aplicado en cada frontera pública
ANTES de cualquier otra lectura — nunca una copia del mecanismo por puerta.

Ningún otro invariante de los 15 relevados carece de refuerzo real en alguna puerta
donde el contrato (Brief/IR-SPEC/OPERATIONS) lo exige — las celdas `N/A` de arriba
corresponden todas a límites de diseño ya documentados (capa Gate 2 vs. Gate 4, Gate 5
vs. Gate 6, alcance de `almacen.cargar()`), no a huecos sin explicación.

**Phase 1.2 (fila 18 nueva) — cuarto GAP encontrado y cerrado (hallazgo externo
REA-01, CRÍTICO — re-auditoría externa):** el dominio de `comparador`/`accion` de un
comportamiento sólo lo exigía `cargador.ts` (Loader/Project initial), con un `Set`
LOCAL nunca compartido — `operaciones.ts` (Gate 5, columna Operation) no lo comprobaba
en absoluto: un valor sintácticamente válido pero inventado (`"mayorQue"`) commiteaba
igual, PERSISTIBLE pero no RECARGABLE. Una auditoría dedicada ("loader-only",
recorriendo TODO invariante estructural del loader contra las 8 operaciones públicas
+ `id.ts`/`datos-planos.ts`, evidencia de Phase 1.2 fuera de este repositorio) confirmó
que este era el ÚNICO gap real de esa clase — ningún otro invariante de la matriz
tenía el mismo problema. Cerrado en dos capas: dominio normativo único en `ir.ts`
consumido por ambas puertas (columna Operation, `VALOR_ENUM_DESCONOCIDO`) y una barrera
general en profundidad en el commit (columnas Batch/Dry-run, `ESTADO_NO_RECARGABLE`,
nunca alcanzable hoy vía las 8 operaciones públicas — defensa prospectiva, mismo
criterio que la nota [a] de la fila 1).

**Phase 1.2 (fila 15, hallazgo externo REA-03, MAYOR — re-auditoría externa AUD-B-01)
— quinto GAP encontrado y cerrado:** `ejecutarOperacion` (`operaciones.ts`, columna
Operation) violaba en los hechos el propio invariante de esta fila ("no puede existir
una segunda lectura que diverja de la primera") — llamaba a `aplicarOperacion` (que
materializa su copia puertas adentro, nunca expuesta) y LUEGO materializaba, de forma
INDEPENDIENTE, el MISMO sobre crudo una segunda vez, sólo para el eco
(`idOperacion`/`idTransaccion`/`baseRevision`). Reproducido con
`reaudit/AUD-B/scripts/04_toctou_eco_ejecutarOperacion.mjs`: un Proxy con
`getOwnPropertyDescriptor` ESTATOSO (datos distintos en la 2ª pasada completa que en
la 1ª) hacía que el eco devuelto describiera una operación DISTINTA de la que
realmente se aplicó (`Proyecto` resultante intacto — sólo el eco divergía). No
alcanzable por JSON real (requiere un Proxy in-process); `ejecutarOperacion` no tiene
consumidor de producción hoy (`motor.ts` llama siempre a `aplicarOperacion` directo,
nunca a `ejecutarOperacion`). Se verificó además que `motor.ts::ejecutarLote`
(columna Batch/Dry-run) NO tiene una segunda materialización equivalente: el LOTE ya
materializado (fila 15, columna Batch) alimenta `aplicarOperacion` con un elemento
que es un objeto plano ORDINARIO (construido con `Object.defineProperty`, sin
accessors/traps) — materializarlo de nuevo ahí adentro es redundante pero
demostrablemente NUNCA puede divergir entre pasadas (sin trap que cambie de
comportamiento, no hay nada que pueda "mentir" una segunda vez). Cerrado extrayendo
`aplicarOperacionMaterializada` (núcleo interno que recibe el sobre YA MATERIALIZADO
y nunca vuelve a materializar): `aplicarOperacion` (frontera pública) y
`ejecutarOperacion` son sus DOS únicos llamadores, cada uno materializa UNA vez en su
propia frontera y alimenta esa MISMA copia al núcleo (y, en `ejecutarOperacion`,
también al eco) — nunca dos pasadas independientes sobre el mismo sobre crudo.
