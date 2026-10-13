// Sesión viva del Modo Vivo V1 — el "Live Service" de MODO-VIVO-PLAN.md §2, dentro del proceso
// de OpenCode (no hay daemon). Contrato: tecnia-bot-docs/esp32-completo/PROTOCOLO-VIVO-V1.md.
//
// Qué hace: sobre un `Puente` de líneas (el serie real de `transporte-serie.ts` o uno falso en los
// tests) espera el `hola` del runtime, decide la compatibilidad, manda `ping` cada 2 s y marca
// `DESCONECTADA` tras 5 s sin `pong`; despacha UN comando a la vez (cola) y traduce componente de
// la IR → terminal asignable → pin con el catálogo. Antes de mandar cualquier comando cruza las dos
// fuentes del Capability Model: A, el pin existe y tiene esa capacidad en `nucleo/placas.ts`; B, el
// comando está en el `hola` del runtime. Lo observado va al estado observado (`estado-observado.ts`)
// con procedencia `OBSERVED` e instante del reloj inyectado. Nunca escribe en la IR ni en el almacén.
//
// Qué NO hace: abrir puertos (eso es `transporte-serie.ts`), flashear, generar código, reglas.
//
// Sin `node:`: el reloj y el temporizador se inyectan (los tests no duermen), y por defecto usan
// `Date.now`/`setTimeout`, que son globales. Ningún método público lanza una excepción: todo
// fallo es un `ResultadoVivo` con código estable, que la tool traduce para el alumno.

import type { Proyecto } from "../nucleo/ir.ts"
import type { Capacidades, Placa, RegistroPin } from "../nucleo/placas.ts"
import type { ComponentKnowledge } from "../conocimiento/conocimiento.ts"
import { parsearRespuesta, serializarComando, type Comando, type Respuesta } from "./protocolo.ts"
import {
  aplicarHola,
  aplicarReinicio,
  aplicarRespuesta,
  estadoInicial,
  marcarConectando,
  marcarDesconectada,
  marcarSinRuntime,
  type EstadoObservado,
} from "./estado-observado.ts"

// ════════════════════════════════════════════════════════════════════════════════════
// Interfaz pública (la tool `vivo` se escribe contra esto)
// ════════════════════════════════════════════════════════════════════════════════════

/** Un canal de líneas (sin `\n`) hacia y desde el runtime. El real vive en `transporte-serie.ts`. */
export interface Puente {
  enviar(linea: string): void
  alRecibir(cb: (linea: string) => void): () => void
  alCerrar(cb: (motivo: string) => void): () => void
  cerrar(): Promise<void>
}

export type ResultadoVivo<T> = { ok: true; valor: T } | { ok: false; codigo: string; datos?: Record<string, unknown> }

export type AccionViva = { tipo: "nivel"; nivel: "alto" | "bajo" } | { tipo: "pwm"; porcentaje: number }

export interface SesionViva {
  estado(): EstadoObservado
  accionar(componente: string, accion: AccionViva): Promise<ResultadoVivo<Respuesta>>
  leer(componente: string): Promise<ResultadoVivo<Respuesta>>
  /** Acceso por pin, sin pasar por nombres de la IR. Valida igual contra A (placa) y B (`hola`). */
  comando(comando: Comando): Promise<ResultadoVivo<Respuesta>>
  cerrar(): Promise<void>
}

/** Como `setTimeout`, pero inyectable: devuelve la cancelación. */
export interface Temporizador {
  programar(ms: number, cb: () => void): () => void
}

export interface TiemposSesion {
  /** Cuánto se espera el `hola` espontáneo antes de pedirlo. */
  readonly esperaHolaMs: number
  /** Contrato §2: `ping` cada 2 s. */
  readonly pingCadaMs: number
  /** Contrato §2: 5 s sin `pong` = `DESCONECTADA`. */
  readonly sinPongMs: number
  /** Cuánto se espera la respuesta a un comando antes de `TIEMPO_AGOTADO`. */
  readonly respuestaMs: number
}

export interface OpcionesSesion {
  readonly puente: Puente
  /** La placa del proyecto: el registro, o su id (se resuelve con `conocimiento.placa`). */
  readonly placa: Placa | string
  readonly proyecto: Proyecto
  readonly conocimiento: ComponentKnowledge
  /** Milisegundos; por defecto `Date.now`. */
  readonly reloj?: () => number
  readonly temporizador?: Temporizador
  readonly tiempos?: Partial<TiemposSesion>
}

/**
 * Valores por defecto. Los dos del contrato (`ping` cada 2 s, 5 s sin `pong`) son de §2; los otros
 * dos son una elección de este módulo, sin fuente: 1,5 s para el `hola` espontáneo (al abrir el
 * puerto el DevKit se reinicia y tarda menos de un segundo en arrancar, sin medir acá) y 3 s para
 * una respuesta (menor que los 5 s del `pong`, así un comando colgado se reporta antes de que la
 * sesión caiga).
 */
export const TIEMPOS_POR_DEFECTO: TiemposSesion = Object.freeze({ esperaHolaMs: 1500, pingCadaMs: 2000, sinPongMs: 5000, respuestaMs: 3000 })

const temporizadorReal: Temporizador = {
  programar(ms, cb) {
    const id = setTimeout(cb, ms)
    return () => clearTimeout(id)
  },
}

// ════════════════════════════════════════════════════════════════════════════════════
// Validaciones puras
// ════════════════════════════════════════════════════════════════════════════════════

/** Fuente A: qué capacidad de `RegistroPin.capacidades` necesita cada comando con pin. */
function capacidadNecesaria(comando: Comando): keyof Capacidades | undefined {
  switch (comando.comando) {
    case "pin.modo":
      return comando.modo === "salida" ? "salidaDigital" : "entradaDigital"
    case "digital.escribir":
      return "salidaDigital"
    case "pwm.escribir":
      return "pwm"
    case "digital.leer":
      return "entradaDigital"
    case "analogico.leer":
      return "adc"
    default:
      return undefined
  }
}

const falla = (codigo: string, datos?: Record<string, unknown>): ResultadoVivo<never> => ({ ok: false, codigo, ...(datos ? { datos } : {}) })

/**
 * La respuesta a un comando tiene que ser EXACTAMENTE la que el contrato asocia a ese comando y a
 * ese pin; cualquier otra cosa es `RESPUESTA_INVALIDA` (un OK falso es peor que un error). Un
 * `error` del runtime se devuelve con su propio código, sin disfraz.
 */
function validarRespuesta(comando: Comando, respuesta: Respuesta, linea: string): ResultadoVivo<Respuesta> {
  if (respuesta.tipo === "error") {
    const { tipo: _tipo, ...datos } = respuesta
    return falla(respuesta.codigo, datos)
  }
  const invalida = () => falla("RESPUESTA_INVALIDA", { comando: comando.comando, linea })
  switch (comando.comando) {
    case "hola":
      return respuesta.tipo === "hola" ? { ok: true, valor: respuesta } : invalida()
    case "ping":
      return respuesta.tipo === "pong" ? { ok: true, valor: respuesta } : invalida()
    case "pin.modo":
    case "digital.escribir":
    case "pwm.escribir":
      return respuesta.tipo === "ok" && respuesta.comando === comando.comando && respuesta.pin === comando.pin ? { ok: true, valor: respuesta } : invalida()
    case "digital.leer":
      return respuesta.tipo === "lectura" && "nivel" in respuesta && respuesta.pin === comando.pin ? { ok: true, valor: respuesta } : invalida()
    case "analogico.leer":
      return respuesta.tipo === "lectura" && "crudo" in respuesta && respuesta.pin === comando.pin ? { ok: true, valor: respuesta } : invalida()
  }
}

// ════════════════════════════════════════════════════════════════════════════════════
// La sesión
// ════════════════════════════════════════════════════════════════════════════════════

interface Pendiente {
  readonly comando: Comando
  readonly resolver: (r: ResultadoVivo<Respuesta>) => void
  cancelarEspera?: () => void
}

export async function abrirSesion(opciones: OpcionesSesion): Promise<SesionViva> {
  const { puente, proyecto, conocimiento } = opciones
  const placaResuelta = typeof opciones.placa === "string" ? opciones.conocimiento.placa(opciones.placa) : opciones.placa
  // Error de programación del llamador, no una condición del runtime: se lanza, no se envuelve.
  if (!placaResuelta) throw new TypeError(`abrirSesion: placa desconocida para el conocimiento: ${String(opciones.placa)}`)
  const placa: Placa = placaResuelta
  const reloj = opciones.reloj ?? (() => Date.now())
  const temporizador = opciones.temporizador ?? temporizadorReal
  const tiempos: TiemposSesion = { ...TIEMPOS_POR_DEFECTO, ...opciones.tiempos }
  const pinPorNumero = new Map<number, RegistroPin>(placa.pines.map((p) => [p.numero, p]))

  let estado = marcarConectando(estadoInicial(proyecto, placa, conocimiento))
  let ultimaVida = reloj()
  let holaRecibido = false
  /** `DESCONECTADA` es terminal: a partir de acá no se escucha ni se manda nada más. */
  let terminada = false
  let cerrada = false
  const cola: Pendiente[] = []
  let enCurso: Pendiente | undefined
  let pingEnVuelo = false
  /** Pines que ya recibieron su `pin.modo` en esta vida del runtime (se vacía con cada `reinicio`). */
  const pinesConfigurados = new Set<number>()
  const cancelaciones = new Set<() => void>()
  let resolverHandshake: () => void = () => {}
  const handshake = new Promise<void>((resolver) => {
    resolverHandshake = resolver
  })

  const programar = (ms: number, cb: () => void) => {
    const cancelar = temporizador.programar(ms, () => {
      cancelaciones.delete(cancelar)
      cb()
    })
    cancelaciones.add(cancelar)
    return cancelar
  }

  function fallarPendientes(codigo: string, datos: Record<string, unknown>) {
    const pendientes = enCurso ? [enCurso, ...cola.splice(0)] : cola.splice(0)
    enCurso = undefined
    for (const p of pendientes) {
      p.cancelarEspera?.()
      p.resolver(falla(codigo, { ...datos, comando: p.comando.comando }))
    }
  }

  function despachar() {
    if (terminada || enCurso || cola.length === 0) return
    const pendiente = cola.shift()
    if (!pendiente) return
    enCurso = pendiente
    pendiente.cancelarEspera = programar(tiempos.respuestaMs, () => {
      if (enCurso !== pendiente) return
      enCurso = undefined
      pendiente.resolver(falla("TIEMPO_AGOTADO", { comando: pendiente.comando.comando, esperadoMs: tiempos.respuestaMs }))
      despachar()
    })
    puente.enviar(serializarComando(pendiente.comando))
  }

  function encolar(comando: Comando): Promise<ResultadoVivo<Respuesta>> {
    return new Promise((resolver) => {
      cola.push({ comando, resolver })
      despachar()
    })
  }

  function terminarEnCurso(resultado: ResultadoVivo<Respuesta>, respuesta?: Respuesta) {
    const pendiente = enCurso
    if (!pendiente) return
    enCurso = undefined
    pendiente.cancelarEspera?.()
    if (resultado.ok && respuesta) {
      if (respuesta.tipo === "hola") recibirHola(respuesta)
      else {
        if (respuesta.tipo === "pong") ultimaVida = reloj()
        estado = aplicarRespuesta(estado, pendiente.comando, respuesta, reloj())
      }
    }
    pendiente.resolver(resultado)
    despachar()
  }

  function recibirHola(hola: Extract<Respuesta, { tipo: "hola" }>) {
    estado = aplicarHola(estado, hola)
    ultimaVida = reloj()
    holaRecibido = true
    if (estado.sesion === "RUNTIME_INCOMPATIBLE") fallarPendientes("RUNTIME_INCOMPATIBLE", { ...estado.incompatibilidad })
    resolverHandshake()
  }

  function desconectar(motivo: string) {
    if (terminada) return
    terminada = true
    estado = marcarDesconectada(estado, motivo)
    for (const cancelar of cancelaciones) cancelar()
    cancelaciones.clear()
    fallarPendientes("SESION_NO_CONECTADA", { sesion: "DESCONECTADA", motivo })
    resolverHandshake()
  }

  function alLlegar(linea: string) {
    if (terminada) return
    const parseo = parsearRespuesta(linea)
    if (!parseo.ok) {
      if (enCurso) terminarEnCurso(falla("RESPUESTA_INVALIDA", { comando: enCurso.comando.comando, linea }))
      return
    }
    const respuesta = parseo.valor
    if (respuesta.tipo === "reinicio") {
      // Contrato §3: la placa arrancó de nuevo. Lo que estaba en vuelo nunca va a contestarse.
      estado = aplicarReinicio(estado, respuesta.causa, reloj())
      ultimaVida = reloj()
      pinesConfigurados.clear()
      fallarPendientes("SESION_NO_CONECTADA", { sesion: "CONECTANDO", motivo: "REINICIO", causa: respuesta.causa })
      return
    }
    if (enCurso) {
      // La respuesta a un comando es la próxima línea que no sea `reinicio`.
      terminarEnCurso(validarRespuesta(enCurso.comando, respuesta, linea), respuesta)
      return
    }
    // Sin comando en curso sólo tiene sentido un `hola` espontáneo (arranque o reinicio); el resto
    // (un `pong` tardío, una línea suelta) no es evidencia de nada y se ignora.
    if (respuesta.tipo === "hola") recibirHola(respuesta)
  }

  const quitarReceptor = puente.alRecibir(alLlegar)
  const quitarCierre = puente.alCerrar((motivo) => {
    if (!cerrada) desconectar(motivo)
  })

  // Handshake: si el `hola` no llega solo, se pide; si tampoco llega, no hay runtime.
  programar(tiempos.esperaHolaMs, () => {
    if (holaRecibido || terminada) return
    void encolar({ comando: "hola" }).then((r) => {
      if (holaRecibido || terminada) return
      estado = marcarSinRuntime(estado, r.ok ? "HOLA_INVALIDO" : r.codigo === "TIEMPO_AGOTADO" ? "SIN_HOLA" : r.codigo)
      resolverHandshake()
    })
  })

  // Latido: cada `pingCadaMs`, primero se mira si hace demasiado que no hay señal de vida (`hola` o
  // `pong`), y si no, se manda un `ping` (sólo con la sesión conectada y sin otro `ping` en vuelo).
  function programarLatido() {
    programar(tiempos.pingCadaMs, () => {
      if (terminada) return
      if (holaRecibido && (estado.sesion === "CONECTADA" || estado.sesion === "CONECTANDO") && reloj() - ultimaVida > tiempos.sinPongMs) {
        desconectar("SIN_PONG")
        return
      }
      if (estado.sesion === "CONECTADA" && !pingEnVuelo) {
        pingEnVuelo = true
        void encolar({ comando: "ping" }).then(() => {
          pingEnVuelo = false
        })
      }
      programarLatido()
    })
  }
  programarLatido()

  // ── superficie pública ──

  function verificarSesion(): ResultadoVivo<never> | undefined {
    if (estado.sesion === "RUNTIME_INCOMPATIBLE") return falla("RUNTIME_INCOMPATIBLE", { ...estado.incompatibilidad })
    if (estado.sesion !== "CONECTADA") return falla("SESION_NO_CONECTADA", { sesion: estado.sesion, ...(estado.motivo ? { motivo: estado.motivo } : {}) })
    return undefined
  }

  /** A (placa) y después B (`hola`), como pide el Capability Model: dos fuentes, nunca una. */
  function validarComando(comando: Comando): ResultadoVivo<Comando> {
    const capacidad = capacidadNecesaria(comando)
    if (capacidad && "pin" in comando) {
      const registro = pinPorNumero.get(comando.pin)
      if (!registro) return falla("CAPACIDAD_NO_SOPORTADA_POR_PLACA", { placa: placa.id, pin: comando.pin, capacidad, motivo: "PIN_INEXISTENTE_EN_PLACA" })
      if (!registro.capacidades[capacidad]) return falla("CAPACIDAD_NO_SOPORTADA_POR_PLACA", { placa: placa.id, pin: registro.id, capacidad })
    }
    const comandos = estado.runtime?.comandos ?? []
    if (!comandos.includes(comando.comando)) return falla("COMANDO_NO_SOPORTADO_POR_RUNTIME", { comando: comando.comando, comandos: [...comandos] })
    return { ok: true, valor: comando }
  }

  async function comando(c: Comando): Promise<ResultadoVivo<Respuesta>> {
    const noConectada = verificarSesion()
    if (noConectada) return noConectada
    const valido = validarComando(c)
    if (!valido.ok) return valido
    return encolar(valido.valor)
  }

  /** componente de la IR → su entrada del estado observado + el terminal del catálogo, o el fallo. */
  function resolverComponente(id: string): ResultadoVivo<{ pin: RegistroPin; terminal: NonNullable<ReturnType<ComponentKnowledge["terminales"]>[number]>; tipo: string }> {
    const observado = estado.componentes.find((c) => c.id === id)
    if (!observado) {
      const existe = proyecto.componentes.find((c) => c.id === id)
      return existe ? falla("ACCION_NO_APLICABLE", { componente: id, tipo: existe.tipo, motivo: "SIN_TERMINAL_ASIGNABLE" }) : falla("COMPONENTE_INEXISTENTE", { componente: id })
    }
    if (!observado.pin) return falla("COMPONENTE_SIN_PIN", { componente: id, tipo: observado.tipo, terminal: observado.terminal })
    const pin = pinPorNumero.get(observado.pin.numero)
    const terminal = conocimiento.terminales(observado.tipo).find((t) => t.id === observado.terminal)
    if (!pin || !terminal) return falla("COMPONENTE_SIN_PIN", { componente: id, tipo: observado.tipo, terminal: observado.terminal })
    return { ok: true, valor: { pin, terminal, tipo: observado.tipo } }
  }

  async function accionar(componente: string, accion: AccionViva): Promise<ResultadoVivo<Respuesta>> {
    const noConectada = verificarSesion()
    if (noConectada) return noConectada
    const resuelto = resolverComponente(componente)
    if (!resuelto.ok) return resuelto
    const { pin, terminal, tipo } = resuelto.valor
    const contexto = { componente, tipo, terminal: terminal.id, electrica: terminal.electrica, direccion: terminal.direccion, accion: accion.tipo }
    // Sólo un terminal digital de SALIDA se acciona (el ánodo de un LED). Un terminal de entrada
    // (pulsador, NTC) o bidireccional (DHT) no: no se le escribe un nivel a un sensor.
    if (terminal.electrica !== "digital" || terminal.direccion !== "salida") return falla("ACCION_NO_APLICABLE", contexto)
    if (accion.tipo === "nivel") return comando({ comando: "digital.escribir", pin: pin.numero, nivel: accion.nivel })
    if (!Number.isInteger(accion.porcentaje) || accion.porcentaje < 0 || accion.porcentaje > 100) {
      return falla("ACCION_NO_APLICABLE", { ...contexto, motivo: "PORCENTAJE_FUERA_DE_RANGO", porcentaje: accion.porcentaje })
    }
    return comando({ comando: "pwm.escribir", pin: pin.numero, porcentaje: accion.porcentaje })
  }

  async function leer(componente: string): Promise<ResultadoVivo<Respuesta>> {
    const noConectada = verificarSesion()
    if (noConectada) return noConectada
    const resuelto = resolverComponente(componente)
    if (!resuelto.ok) return resuelto
    const { pin, terminal, tipo } = resuelto.valor
    const contexto = { componente, tipo, terminal: terminal.id, electrica: terminal.electrica, direccion: terminal.direccion }
    // Un terminal bidireccional (DHT11/DHT22) habla un protocolo propio: en V1 no hay `sensor.leer`
    // (reservado), y leer su nivel con `digital.leer` sería una lectura sin significado.
    if (terminal.direccion !== "entrada") return falla("ACCION_NO_APLICABLE", { ...contexto, accion: "leer" })
    if (terminal.electrica === "analogica") return comando({ comando: "analogico.leer", pin: pin.numero })
    if (terminal.electrica !== "digital") return falla("ACCION_NO_APLICABLE", { ...contexto, accion: "leer" })
    // Un pulsador o interruptor se cablea sin resistencia porque usa el pull-up interno del pin
    // (`requierePullUpInterno`, catálogo): sin configurarlo, `digital.leer` lo dejaría flotando y
    // leería cualquier cosa. Se configura una vez por vida del runtime.
    if (terminal.requierePullUpInterno && !pinesConfigurados.has(pin.numero)) {
      const configurado = await comando({ comando: "pin.modo", pin: pin.numero, modo: "entradaPullUp" })
      if (!configurado.ok) return configurado
      pinesConfigurados.add(pin.numero)
    }
    return comando({ comando: "digital.leer", pin: pin.numero })
  }

  async function cerrar(): Promise<void> {
    if (cerrada) return
    cerrada = true
    quitarReceptor()
    quitarCierre()
    desconectar("CERRADA_POR_HOST")
    try {
      await puente.cerrar()
    } catch {
      // El puente ya estaba caído: la sesión igual queda cerrada.
    }
  }

  await handshake
  return Object.freeze({ estado: () => estado, accionar, leer, comando, cerrar })
}
