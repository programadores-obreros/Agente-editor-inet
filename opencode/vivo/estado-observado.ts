// Estado OBSERVADO del Modo Vivo (protocolo v1, slices V1–V4) — tecnia-bot-docs/esp32-completo/
// MODO-VIVO-PLAN.md §4 y docs/programacion-intencion/LIVE-MODE-CAPABILITY-MODEL.md.
//
// Es OTRO dominio, distinto de la IR: lo que la sesión viva vio en la placa en ESTA sesión. Nunca
// entra en la IR, en el almacén ni en el hash; se pierde al cerrar la sesión, a propósito. Este
// módulo es PURO: sin I/O, sin reloj propio (el instante lo pone quien llama), sin `node:`; todo
// lo que devuelve está congelado en profundidad, y cada función devuelve un estado nuevo.
//
// Procedencia (Capability Model): una observación existe sólo si vino de una línea del runtime
// en esta sesión (`OBSERVED`). Un componente sin observación es UNKNOWN: no hay campo "valor por
// defecto", no se inventa. Un `ok` a `digital.escribir`/`pwm.escribir` también es evidencia: el
// runtime aceptó escribir ese nivel en ese pin.

import type { Proyecto } from "../nucleo/ir.ts"
import type { Placa } from "../nucleo/placas.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { clonarProfundo, congelarProfundo } from "../nucleo/canonico.ts"
import { COMANDOS_V1, VERSION_PROTOCOLO, type CausaDeReinicio, type Comando, type Nivel, type RedWifi, type Respuesta } from "./protocolo.ts"

/** Estados de la sesión (plan §4). `SIN_RUNTIME` también cubre "abrí el puerto y nadie dijo `hola`". */
export type EstadoDeSesion = "SIN_RUNTIME" | "CONECTANDO" | "CONECTADA" | "DESCONECTADA" | "RUNTIME_INCOMPATIBLE"

/** El pin como lo conoce el host (`RegistroPin.id`) y como viaja por el cable (número de GPIO). */
export interface PinObservable {
  readonly id: string
  readonly numero: number
}

export type ValorObservado =
  | { readonly tipo: "nivel"; readonly nivel: Nivel }
  | { readonly tipo: "crudo"; readonly crudo: number }
  | { readonly tipo: "pwm"; readonly porcentaje: number }

export interface Observacion {
  readonly valor: ValorObservado
  /** Instante del reloj inyectado por la sesión (ms). Es lo que permite decir "cuándo fue". */
  readonly instante: number
  readonly procedencia: "OBSERVED"
}

export interface ComponenteObservado {
  /** `Componente.id` de la IR. */
  readonly id: string
  readonly tipo: string
  /** El terminal asignable por el que se observa/acciona (p. ej. `anodo`, `senal`). */
  readonly terminal: string
  /** Ausente = el terminal no tiene pin asignado en la IR (o el pin no existe en la placa): no se puede observar. */
  readonly pin?: PinObservable
  /** Ausente = UNKNOWN. Nunca se inventa. */
  readonly ultimaObservacion?: Observacion
}

/** Lo que el runtime anunció en su `hola` (fuente B del Capability Model), tal cual. */
export interface InfoRuntime {
  readonly version: string
  readonly protocolo: number
  /** La placa que el runtime dice ser (su propio dato, no el del proyecto). */
  readonly placa: string
  readonly comandos: readonly string[]
  readonly protocolos: readonly string[]
  /** V4: la red propia que el runtime anunció (ssid, clave, ip). Ausente en un runtime de sólo serie. */
  readonly wifi?: RedWifi
}

export interface Reinicio {
  readonly causa: CausaDeReinicio
  readonly instante: number
}

export interface Incompatibilidad {
  readonly protocoloRuntime: number
  readonly protocoloHost: number
  /** Comandos de V1 que el `hola` no anunció. */
  readonly comandosFaltantes: readonly string[]
}

export interface EstadoObservado {
  readonly sesion: EstadoDeSesion
  /** La placa con la que se abrió la sesión (copia congelada del registro de `nucleo/placas.ts`). */
  readonly placa: Placa
  readonly componentes: readonly ComponenteObservado[]
  readonly runtime?: InfoRuntime
  readonly ultimoReinicio?: Reinicio
  readonly incompatibilidad?: Incompatibilidad
  /** Por qué está `DESCONECTADA`/`SIN_RUNTIME` (código corto, nunca prosa). */
  readonly motivo?: string
}

export type ResultadoCompatibilidad = { readonly ok: true } | ({ readonly ok: false } & Incompatibilidad)

// ════════════════════════════════════════════════════════════════════════════════════
// Construcción
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Un componente del proyecto entra al estado observado si su tipo tiene algún terminal
 * asignable (un LED por su ánodo, un pulsador o un NTC por `senal`). Los que no tienen ninguno
 * (una resistencia) no se pueden observar por un GPIO y no figuran. Si el terminal no tiene pin
 * en la IR, el componente figura SIN `pin`: se ve que existe y que no hay nada que leer.
 *
 * Con más de un terminal asignable se toma el primero que declara el catálogo (hoy ningún tipo
 * del catálogo mínimo tiene dos).
 */
export function estadoInicial(proyecto: Proyecto, placa: Placa, conocimiento: ComponentKnowledge): EstadoObservado {
  const pinPorId = new Map(placa.pines.map((p) => [p.id, p] as const))
  const componentes: ComponenteObservado[] = []
  for (const componente of proyecto.componentes) {
    const terminal = conocimiento.terminales(componente.tipo).find((t) => t.asignable)
    if (!terminal) continue
    const idPin = componente.pines[terminal.id]
    const registro = typeof idPin === "string" ? pinPorId.get(idPin) : undefined
    componentes.push({
      id: componente.id,
      tipo: componente.tipo,
      terminal: terminal.id,
      ...(registro ? { pin: { id: registro.id, numero: registro.numero } } : {}),
    })
  }
  // Copia propia: congelar en el lugar la constante compartida del registro sería un efecto colateral.
  return congelarProfundo({ sesion: "SIN_RUNTIME", placa: clonarProfundo(placa), componentes })
}

// ════════════════════════════════════════════════════════════════════════════════════
// Compatibilidad (plan §10.4): versión de protocolo + comandos del `hola`. Nunca un hash.
// ════════════════════════════════════════════════════════════════════════════════════

export function evaluarCompatibilidad(hola: Extract<Respuesta, { tipo: "hola" }>): ResultadoCompatibilidad {
  const comandosFaltantes = COMANDOS_V1.filter((c) => !hola.comandos.includes(c))
  if (hola.protocolo === VERSION_PROTOCOLO && comandosFaltantes.length === 0) return { ok: true }
  return { ok: false, protocoloRuntime: hola.protocolo, protocoloHost: VERSION_PROTOCOLO, comandosFaltantes }
}

export function esCompatible(hola: Extract<Respuesta, { tipo: "hola" }>): boolean {
  return evaluarCompatibilidad(hola).ok
}

// ════════════════════════════════════════════════════════════════════════════════════
// Transiciones — cada una devuelve un estado NUEVO y congelado
// ════════════════════════════════════════════════════════════════════════════════════

/** Las claves de `EstadoObservado` que pueden no estar: las únicas que una transición puede quitar. */
type ClaveOpcional = { [K in keyof EstadoObservado]-?: undefined extends EstadoObservado[K] ? K : never }[keyof EstadoObservado]

/** Copia de `objeto` sin `claves`. Sólo claves opcionales: así el resultado sigue siendo un `EstadoObservado` entero. */
function omitir<K extends ClaveOpcional>(objeto: EstadoObservado, claves: readonly K[]): Omit<EstadoObservado, K> {
  const copia: { -readonly [P in keyof EstadoObservado]?: EstadoObservado[P] } = { ...objeto }
  for (const clave of claves) delete copia[clave]
  return copia as Omit<EstadoObservado, K>
}

function siguiente(estado: EstadoObservado, cambios: Partial<EstadoObservado>, quitar: readonly ClaveOpcional[] = []): EstadoObservado {
  return congelarProfundo({ ...omitir(estado, quitar), ...cambios })
}

/** Los componentes sin su `ultimaObservacion`: lo que se vio ya no describe la placa. */
function sinObservaciones(estado: EstadoObservado): ComponenteObservado[] {
  return estado.componentes.map(({ ultimaObservacion: _anterior, ...resto }) => resto)
}

/** El puerto está abierto y se espera el `hola`. */
export function marcarConectando(estado: EstadoObservado): EstadoObservado {
  return siguiente(estado, { sesion: "CONECTANDO" }, ["motivo", "incompatibilidad"])
}

/**
 * V4-9 (contrato §9): pasaron más de 5 s sin `pong`. No se sabe qué le pasó a la placa (cable
 * flojo, `loop()` bloqueado por un cliente HTTP lento, reinicio sin que llegara el `reinicio`), así
 * que la sesión vuelve a `CONECTANDO` para pedir `hola` de nuevo, y las observaciones se descartan
 * como en `aplicarReinicio`: un valor `OBSERVED` de antes del silencio no se puede vender como
 * vigente. No se inventa un `ultimoReinicio`: nadie dijo que la placa reinició.
 */
export function marcarReconectando(estado: EstadoObservado): EstadoObservado {
  return siguiente(estado, { sesion: "CONECTANDO", componentes: sinObservaciones(estado) }, ["motivo", "incompatibilidad"])
}

/** Nadie contestó el `hola`: lo más probable es que en la placa no haya un runtime. */
export function marcarSinRuntime(estado: EstadoObservado, motivo: string): EstadoObservado {
  return siguiente(estado, { sesion: "SIN_RUNTIME", motivo })
}

/**
 * Llegó un `hola` (al arrancar, tras un reinicio o pedido por el host). Se guarda lo que el
 * runtime anunció y se decide la compatibilidad. Un `hola` nuevo reemplaza al anterior.
 */
export function aplicarHola(estado: EstadoObservado, hola: Extract<Respuesta, { tipo: "hola" }>): EstadoObservado {
  const runtime: InfoRuntime = {
    version: hola.runtime,
    protocolo: hola.protocolo,
    placa: hola.placa,
    comandos: [...hola.comandos],
    protocolos: [...hola.protocolos],
    ...(hola.wifi === undefined ? {} : { wifi: { ssid: hola.wifi.ssid, clave: hola.wifi.clave, ip: hola.wifi.ip } }),
  }
  const compatibilidad = evaluarCompatibilidad(hola)
  if (compatibilidad.ok) return siguiente(estado, { sesion: "CONECTADA", runtime }, ["motivo", "incompatibilidad"])
  const { ok: _ok, ...incompatibilidad } = compatibilidad
  return siguiente(estado, { sesion: "RUNTIME_INCOMPATIBLE", runtime, incompatibilidad }, ["motivo"])
}

/**
 * El runtime avisó que arrancó de nuevo: se registra la causa y la sesión vuelve a `CONECTANDO`
 * hasta el próximo `hola`. Las observaciones anteriores se descartan: después de un reinicio los
 * pines ya no están como se los vio (vuelven a su estado de arranque), y conservar un valor
 * `OBSERVED` viejo sería venderlo como vigente.
 */
export function aplicarReinicio(estado: EstadoObservado, causa: CausaDeReinicio, instante: number): EstadoObservado {
  return siguiente(estado, { sesion: "CONECTANDO", ultimoReinicio: { causa, instante }, componentes: sinObservaciones(estado) }, ["motivo", "incompatibilidad"])
}

export function marcarDesconectada(estado: EstadoObservado, motivo: string): EstadoObservado {
  return siguiente(estado, { sesion: "DESCONECTADA", motivo })
}

/** Qué se observó, según el par (comando enviado, respuesta recibida). `undefined` = nada observable. */
function observacionDe(comando: Comando, respuesta: Respuesta): { readonly pin: number; readonly valor: ValorObservado } | undefined {
  if (respuesta.tipo === "ok") {
    if (comando.comando === "digital.escribir" && respuesta.comando === comando.comando && respuesta.pin === comando.pin) {
      return { pin: comando.pin, valor: { tipo: "nivel", nivel: comando.nivel } }
    }
    if (comando.comando === "pwm.escribir" && respuesta.comando === comando.comando && respuesta.pin === comando.pin) {
      return { pin: comando.pin, valor: { tipo: "pwm", porcentaje: comando.porcentaje } }
    }
    return undefined
  }
  if (respuesta.tipo === "lectura") {
    if ("nivel" in respuesta) return { pin: respuesta.pin, valor: { tipo: "nivel", nivel: respuesta.nivel } }
    return { pin: respuesta.pin, valor: { tipo: "crudo", crudo: respuesta.crudo } }
  }
  return undefined
}

/**
 * Incorpora la respuesta a un comando. Sólo un `ok` a una escritura o una `lectura` cambian algo:
 * se anota en TODOS los componentes que tengan ese pin (la IR no deja compartir pines entre dos
 * terminales, pero el estado observado no lo asume). Un `error`, un `pong` o un `ok` a `pin.modo`
 * no son observaciones de un valor y dejan el estado igual (misma referencia).
 */
export function aplicarRespuesta(estado: EstadoObservado, comando: Comando, respuesta: Respuesta, instante: number): EstadoObservado {
  const observado = observacionDe(comando, respuesta)
  if (!observado) return estado
  const observacion: Observacion = { valor: observado.valor, instante, procedencia: "OBSERVED" }
  let cambio = false
  const componentes = estado.componentes.map((c) => {
    if (c.pin?.numero !== observado.pin) return c
    cambio = true
    return { ...c, ultimaObservacion: observacion }
  })
  return cambio ? siguiente(estado, { componentes }) : estado
}
