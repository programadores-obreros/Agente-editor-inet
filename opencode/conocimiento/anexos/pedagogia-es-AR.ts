// ANEXO DE PEDAGOGÍA (es-AR) — Component System Foundation #1 (D-10 del Decision Freeze).
//
// Todo texto que ve un estudiante o un docente sobre un componente o una placa vive acá,
// NUNCA en el núcleo semántico (`nucleo/`): cambiar un texto no cambia la identidad del
// catálogo (el hash semántico) ni invalida un proyecto. Las claves son los ids estables
// del núcleo; no existe un campo `displayKey` en el núcleo.
//
// Origen de los datos (mudados sin cambiar el texto):
// - nombres: `nombreVisible` de `nucleo/catalogo-datos.ts` y `nucleo/placas.ts`;
// - conceptos: el campo `pedagogico.conceptos` de `nucleo/catalogo-datos.ts`;
// - etiquetas de terminal: `vista-fisica/etiquetas-terminales.ts` (Fase 3, Wave 0, F-09),
//   que ahora sólo reexporta desde acá.

export const NOMBRE_DE_COMPONENTE: Readonly<Record<string, string>> = {
  led: "LED",
  resistencia: "Resistencia",
  pulsador: "Pulsador",
  dht22: "DHT22",
  ntc: "Sensor de temperatura NTC",
  interruptor: "Interruptor",
  // CK-CG2: el módulo DFRobot Gravity de 3 cables, no el chip pelado de 4 patas.
  dht11: "DHT11 (módulo Gravity)",
}

export const NOMBRE_DE_PLACA: Readonly<Record<string, string>> = {
  "esp32-devkit-v1": "ESP32 DevKit",
  "arduino-uno": "Arduino UNO",
}

export const CONCEPTOS_DE_COMPONENTE: Readonly<Record<string, readonly string[]>> = {
  led: ["salida digital", "resistencia limitadora"],
  pulsador: ["entrada digital", "INPUT_PULLUP"],
  dht22: ["sensor digital", "temperatura", "humedad"],
  ntc: ["sensor analógico", "temperatura", "termistor"],
  // D0: lo que lo distingue del pulsador es pedagógico: queda en la posición en que lo dejan.
  interruptor: ["entrada digital", "INPUT_PULLUP", "estado mantenido"],
  // CK-CG2: mide lo mismo que el DHT22, con menos precisión (±2 °C) y sin decimales; lee cada
  // 3 s y entrega la medición anterior, así que el LED tarda unos segundos en reaccionar.
  dht11: ["sensor digital", "temperatura", "humedad", "lectura lenta"],
}

/**
 * Etiqueta por `(tipo, terminal)`. La tabla vieja era por id de terminal solo, y `senal`
 * significaba lo mismo para un pulsador, un DHT22 y un NTC. Primero se busca la clave
 * compuesta; si no está, la genérica por id (comportamiento de la tabla de Wave 0).
 */
export const ETIQUETA_POR_TIPO_Y_TERMINAL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  led: { anodo: "ánodo (+)", catodo: "cátodo (−)" },
  resistencia: { a: "pata A", b: "pata B" },
  pulsador: { senal: "señal", gnd: "GND" },
  interruptor: { senal: "señal", gnd: "GND" },
  dht22: { vcc: "VCC (+)", senal: "señal (DATA)", gnd: "GND" },
  // CK-CG2: en la serigrafía del módulo Gravity la señal es «D»; el nombre completo es DATA.
  dht11: { vcc: "VCC (+)", senal: "señal (D / DATA)", gnd: "GND" },
}

/** Tabla genérica de Wave 0 (F-09), por id de terminal: se conserva tal cual como
 * respaldo. Claves verificadas contra `nucleo/catalogo-datos.ts`. */
export const ETIQUETA_POR_TERMINAL: Readonly<Record<string, string>> = {
  anodo: "ánodo (+)",
  catodo: "cátodo (−)",
  senal: "señal",
  gnd: "GND",
  a: "pata A",
  b: "pata B",
}

/** Etiqueta de los terminales de potencia de la placa (D-05). */
export const ETIQUETA_DE_TERMINAL_DE_POTENCIA: Readonly<Record<string, string>> = {
  GND: "GND (masa)",
  "3V3": "3,3 V",
  "5V": "5 V",
  VIN: "VIN (entrada de alimentación)",
}

/**
 * Zonas del esquema físico (Physical View UX #1): el rol pedagógico de cada parte del
 * circuito, con una frase corta para el estudiante. La ASIGNACIÓN de una pieza a una
 * zona no sale de acá: sale de la `clase` del catálogo (`snapshot-a-vista.ts::rolDeClase`)
 * y del requisito que agrupa a la resistencia con su LED.
 *
 * 2026-11-26: la descripción decía «Lo que el ESP32 lee.» fija, y en la notebook real, con el
 * proyecto pasado a Arduino UNO, la ventana seguía nombrando al ESP32. Ahora `{placa}` se
 * reemplaza con la placa DEL PROYECTO (`textoDeZona`). Este anexo no guarda el artículo de cada
 * placa, así que la frase no lo necesita: el sustantivo es «la placa» y el nombre va después
 * («la placa Arduino UNO»). Sin placa elegida queda «la placa» sola.
 * Las descripciones de entrada y salida las aprobó el dueño el 2026-11-26.
 */
export const ZONAS_DEL_CIRCUITO: Readonly<Record<"entrada" | "controlador" | "salida" | "otras", { readonly titulo: string; readonly descripcion: string }>> = {
  entrada: { titulo: "Entrada", descripcion: "Lo que lee {placa}." },
  controlador: { titulo: "Controlador", descripcion: "Lee la entrada y decide la salida." },
  salida: { titulo: "Salida", descripcion: "Lo que maneja {placa}." },
  otras: { titulo: "Otras piezas", descripcion: "Todavía no forman parte de una entrada o una salida." },
}

/** Cómo se nombra la placa adentro de la frase de una zona (aprobado por el dueño, 2026-11-26). */
export const PLACA_EN_LA_ZONA = {
  conNombre: "la placa {nombre}",
  sinNombre: "la placa",
} as const

/** El título y la descripción de una zona, con la placa del proyecto (`null`: no hay placa elegida). */
export function textoDeZona(rol: keyof typeof ZONAS_DEL_CIRCUITO, nombreDePlaca: string | null): { readonly titulo: string; readonly descripcion: string } {
  const zona = ZONAS_DEL_CIRCUITO[rol]
  const placa = nombreDePlaca === null ? PLACA_EN_LA_ZONA.sinNombre : PLACA_EN_LA_ZONA.conNombre.replace("{nombre}", nombreDePlaca)
  return { titulo: zona.titulo, descripcion: zona.descripcion.replace("{placa}", placa) }
}

/**
 * Textos fijos de la ventana «vista física» que no dependen de una pieza ni de una placa.
 * Viajan en el snapshot (`vista.textos`): el navegador los muestra, nunca los redacta.
 *
 * Textos aprobados por el dueño el 2026-11-26, todos los de esta tabla.
 */
export const TEXTOS_DE_LA_VENTANA = {
  /** Se cambió un pin en la ventana y el pedido no llegó (Tecnia Bot cerrado, red cortada). */
  cambioDePinNoGuardado: "No se pudo guardar el cambio: se cortó la conexión con Tecnia Bot. El pin quedó como estaba.",
  /** Cómo está el proyecto, en palabras. Las claves son las del estado que deriva el núcleo. */
  estado: {
    listo: "El proyecto está completo",
    invalido: "Hay algo para corregir",
    incompleto: "Todavía le falta algo",
  },
  /** En «Qué hace tu circuito»: una regla que todavía no se puede leer como una oración. */
  reglaSinTerminar: "Hay una regla sin terminar.",
  /** En «Qué hace tu circuito»: el proyecto no tiene ninguna regla. */
  sinReglas: "Todavía no hay ninguna regla: el circuito no hace nada.",
  /** Cuántos avisos hay. `{cantidad}` se reemplaza por el número (de 2 en adelante). */
  avisos: {
    ninguno: "Sin avisos.",
    uno: "Hay 1 aviso para mirar.",
    varios: "Hay {cantidad} avisos para mirar.",
  },
  /** Lo que dice la sección «Avisos» cuando no hay ninguno. */
  sinAvisos: "No hay avisos: no encontramos nada para revisar en este proyecto.",
  /** La etiqueta que lleva cada aviso según su severidad (las claves son las del núcleo). */
  severidad: {
    blocking: "Hay que corregir",
    warning: "Atención",
    info: "Dato",
  },
  /**
   * Cómo leer los cables del esquema. `{terminales}` se reemplaza por las etiquetas de los
   * terminales de potencia de ESA placa (`ETIQUETA_DE_TERMINAL_DE_POTENCIA`): en un ESP32 la
   * alimentación es «3,3 V» y en un Arduino UNO es «5 V».
   */
  leyenda: {
    senal: "señal: un color por pieza",
    alimentacion: "{terminales}: alimentación, siempre en rojo",
    tierra: "{terminales}: siempre en negro y punteado",
  },
} as const

/**
 * El segundo renglón de «Cómo está» (2026-11-26): qué pasa con el PROGRAMA. El estado del proyecto
 * habla del montaje y de las reglas; en la notebook real, «El proyecto está completo» al lado de
 * «Todavía no hay programa» se leyó como una falla. Este renglón lo dice aparte.
 *
 * Viaja en `vista.resumen.programa`. El servidor manda las DOS frases; cuál se muestra lo decide la
 * página con lo que ya le contestó `/api/programa` para ESA revisión (`web/vista-codigo.js`), y si
 * todavía no lo sabe (actualizando, falla, otra revisión, sin conexión) no muestra ninguna.
 *
 * Textos aprobados por el dueño el 2026-11-26. Viven fuera de `TEXTOS_DE_LA_VENTANA` porque los
 * pinta `app.js` con la respuesta de `/api/programa`, no el plan de pintado.
 */
export const TEXTOS_DEL_PROGRAMA_EN_EL_RESUMEN = {
  /** Llegó el programa de la revisión que se está mostrando. */
  generado: "El programa de esta revisión está generado.",
  /** El servidor dijo, para esta revisión, que no hay programa. Va con un enlace al paso 3. */
  sinPrograma: "Todavía no hay programa para este proyecto: mirá el paso 3, «Mirá el código».",
} as const

/** «Sin avisos.» / «Hay 1 aviso para mirar.» / «Hay N avisos para mirar.»: el plural se arma acá. */
export function textoDeCantidadDeAvisos(cantidad: number): string {
  if (cantidad <= 0) return TEXTOS_DE_LA_VENTANA.avisos.ninguno
  if (cantidad === 1) return TEXTOS_DE_LA_VENTANA.avisos.uno
  return TEXTOS_DE_LA_VENTANA.avisos.varios.replace("{cantidad}", String(cantidad))
}

/** Una entrada de la leyenda de cables para los terminales de potencia dados (ya como etiquetas). */
export function textoDeLeyendaDePotencia(rol: "alimentacion" | "tierra", etiquetas: readonly string[]): string {
  const terminales = etiquetas.length <= 1 ? etiquetas.join("") : `${etiquetas.slice(0, -1).join(", ")} y ${etiquetas[etiquetas.length - 1]}`
  return TEXTOS_DE_LA_VENTANA.leyenda[rol].replace("{terminales}", terminales)
}

/**
 * Para qué está una pieza que existe por un REQUISITO de otra (Physical View UX #1).
 * Clave: el tipo de requisito del núcleo; `{componente}` es el nombre de la pieza que
 * lo pide. Texto pedagógico: nunca entra al núcleo ni al hash.
 */
export const EXPLICACION_DE_REQUISITO: Readonly<Record<string, string>> = {
  "resistencia-serie": "Protege al {componente} limitando la corriente.",
}

export function explicacionDeRequisito(tipoRequisito: string, nombreComponente: string): string | undefined {
  return EXPLICACION_DE_REQUISITO[tipoRequisito]?.replace("{componente}", nombreComponente)
}

/**
 * Semantic Vertical #3: cómo se le nombra al alumno cada VALOR de una capacidad booleana,
 * por (tipo de componente, capacidad). La semántica (la tríada canónica) vive en
 * `nucleo/estado-booleano.ts`; esto es sólo el rótulo. Sin rótulo, el estado no se ofrece
 * en la frase ni en Blockly (no se inventa un texto).
 */
export const ETIQUETA_DE_ESTADO_BOOLEANO: Readonly<Record<string, Readonly<Record<string, { readonly verdadero: string; readonly falso: string }>>>> = {
  pulsador: { estadoBooleano: { verdadero: "presionado", falso: "suelto" } },
  // D0: mismo significado que el pulsador (verdadero = contacto cerrado), otro rótulo.
  interruptor: { estadoBooleano: { verdadero: "cerrado", falso: "abierto" } },
}

/**
 * Semantic Vertical #3: cómo se nombra cada ESTADO OBJETIVO de un actuador (el id de
 * `DEFINICIONES_ACCION`), en la forma "el LED está ___". Por id de acción: el rótulo es
 * el mismo para cualquier actuador que la declare.
 */
export const ETIQUETA_DE_ESTADO_OBJETIVO: Readonly<Record<string, string>> = {
  encender: "encendido",
  apagar: "apagado",
}

/**
 * CK-REQ-N1: cómo se nombra al alumno cada CAPACIDAD cuantitativa, por id de capacidad (los
 * ids de capacidad son globales: la `temperatura` de un DHT22 y la de un NTC son la misma
 * capacidad). En minúscula, como sustantivo ("la temperatura del DHT22"); la frase la arma
 * quien la consuma. Presentación: no entra al hash ni a la disponibilidad semántica.
 */
export const ETIQUETA_DE_CAPACIDAD: Readonly<Record<string, string>> = {
  temperatura: "temperatura",
  humedad: "humedad relativa",
}

export function etiquetaDeCapacidad(capacidad: string): string | undefined {
  return Object.hasOwn(ETIQUETA_DE_CAPACIDAD, capacidad) ? ETIQUETA_DE_CAPACIDAD[capacidad] : undefined
}

export function etiquetaDeEstadoBooleano(tipo: string, capacidad: string, valor: "verdadero" | "falso"): string | undefined {
  return ETIQUETA_DE_ESTADO_BOOLEANO[tipo]?.[capacidad]?.[valor]
}

export function etiquetaDeEstadoObjetivo(accion: string): string | undefined {
  return ETIQUETA_DE_ESTADO_OBJETIVO[accion]
}

/**
 * Si el terminal no tiene etiqueta todavía, se devuelve su propio id (comportamiento de
 * Wave 0: nunca se inventa un texto). Para los tipos oficialmente soportados, la suite de
 * admisión exige etiqueta para todos sus terminales, así que este respaldo no se usa.
 */
export function etiquetaDeTerminal(terminalId: string, tipo?: string): string {
  return (tipo !== undefined ? ETIQUETA_POR_TIPO_Y_TERMINAL[tipo]?.[terminalId] : undefined) ?? ETIQUETA_POR_TERMINAL[terminalId] ?? terminalId
}

export function nombreDeComponente(tipo: string): string | undefined {
  return NOMBRE_DE_COMPONENTE[tipo]
}

export function nombreDePlaca(id: string): string | undefined {
  return NOMBRE_DE_PLACA[id]
}

/**
 * Lo que dice cada renglón del bloque «al iniciar» de la ventana (2026-11-26): qué hace el
 * programa con cada pin apenas arranca la placa. Uno por clase de paso del mapa del generador
 * (`codegen/programa.ts::PasoDeInicio`).
 *
 * Textos aprobados PARA LA PRUEBA por el dueño el 2026-11-27, pendientes de verlos en pantalla:
 * los ajusta en la notebook. No es la aprobación final.
 */
export const TEXTOS_DE_AL_INICIAR = {
  /** Un pin que el programa va a leer por su nivel (un pulsador). */
  entrada: "{pieza} ({pin}): entrada",
  /** Un pin por el que el programa conversa con un sensor (un DHT). */
  bus: "{pieza} ({pin}): entrada de datos",
  /** Un pin que el programa maneja; `{reposo}` es cómo queda hasta que una regla diga otra cosa. */
  salida: "{pieza} ({pin}): salida, arranca {reposo}",
} as const

/**
 * El renglón de UN paso de «al iniciar», o `undefined` si falta algo para decirlo (una clase de
 * paso que acá no tiene texto, o el reposo de una salida sin etiqueta). No inventa: quien llama
 * decide qué hacer sin el texto.
 */
export function textoDePasoDeInicio(paso: { readonly papel: string; readonly pieza: string; readonly pin: string; readonly reposo?: string }): string | undefined {
  if (!Object.hasOwn(TEXTOS_DE_AL_INICIAR, paso.papel)) return undefined
  const plantilla: string = TEXTOS_DE_AL_INICIAR[paso.papel as keyof typeof TEXTOS_DE_AL_INICIAR]
  // Con función: un nombre de pieza con `$` no se interpreta como patrón de reemplazo.
  const base = plantilla.replace("{pieza}", () => paso.pieza).replace("{pin}", () => paso.pin)
  if (!plantilla.includes("{reposo}")) return base
  const reposo = paso.reposo === undefined ? undefined : etiquetaDeEstadoObjetivo(paso.reposo)
  return reposo === undefined ? undefined : base.replace("{reposo}", () => reposo)
}
