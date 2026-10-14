```
STATUS: SUPERSEDED (2026-10-13)
IMPLEMENTATION: Modo Vivo V1–V4 implementado en opencode/vivo/, opencode/codegen/runtime*.ts y opencode/tool/vivo.ts (rama feat/modo-vivo-v4-wifi)
```
> Este documento fue la exploración previa. Lo vigente es `tecnia-bot-docs/esp32-completo/MODO-VIVO-PLAN.md`
> (decisiones HD-08) y `PROTOCOLO-VIVO-V1.md` (contrato; §9 decisiones V4-x), resumidos en `DECISIONS.md`
> («Modo Vivo — HD-08 y V4»). Sigue sin haber daemon: la sesión viva corre dentro del proceso de OpenCode
> (puente Python con pyserial) y el runtime, en la placa.

# Modo Vivo — Preguntas de investigación abiertas

Ninguna de estas preguntas está respondida en esta propuesta. Están acá para que, si
alguna vez se decide investigar Modo Vivo en serio, no se arranque de cero.

- **Serial directo vs WebSerial/WebUSB**: ¿el canal vive en un proceso Node/Bun con
  acceso directo al puerto serie, o en el navegador vía WebSerial/WebUSB? Cada opción
  tiene su propia superficie de permisos y su propia historia de soporte por SO.
- **Daemon vs conexión directa por sesión**: ¿un proceso persistente aparte (con todo
  lo que implica de ciclo de vida, logs, crashes) o una conexión que se abre y cierra
  con cada sesión de OpenCode?
- **ESP32 vs AVR**: ¿el protocolo asume un chip con WiFi/BT propio (ESP32) que podría
  hablar directamente, o sólo serie clásico (AVR/UNO)? Las dos familias conviven hoy en
  el catálogo de placas.
- **Descubrimiento**: ¿cómo se entera Modo Vivo de que hay una placa conectada, sin
  pisar la detección que ya hace `platformio.ts` (`detectPort()`, VID:PID)?
- **Reconexión**: si se desconecta el cable a mitad de sesión, ¿qué pasa con el estado
  `OBSERVED` ya mostrado? ¿se marca como stale, se borra, se reintenta?
- **Seguridad**: ¿quién puede abrir el canal en vivo? ¿Se valida el mismo modelo de
  permisos que ya usa el resto del producto?
- **Versionado del protocolo**: si `LIVE-MODE-PROTOCOL.md` cambia de forma, ¿cómo
  conviven firmwares viejos con un Live Service nuevo?
- **Multiplexación**: ¿puede haber más de un consumidor del canal en vivo a la vez
  (UI + bot), o es exclusivo?
- **Reset/reflash durante una sesión en vivo**: ¿qué le pasa al canal cuando
  `platformio.ts` hace `flash` mientras Modo Vivo está conectado al mismo puerto? Son
  dos planos (ver `LIVE-MODE-ARCHITECTURE.md`) pero comparten el mismo puerto físico.
- **Latencia**: ¿qué tan "en vivo" necesita ser esto para que sea pedagógicamente útil
  sin prometer tiempo real que no se puede sostener sobre serie/USB?
- **Propiedad del puerto serie**: si el monitor serie clásico (`pio device monitor`) y
  Modo Vivo quieren el mismo puerto a la vez, ¿quién gana? ¿Es mutuamente excluyente?
- **Convivencia con el monitor serie y con `platformio monitor`**: ¿Modo Vivo reemplaza
  la acción `monitor` de `platformio.ts`, o son complementarios y coexisten?
- **Simulador vs hardware real**: ¿tiene sentido un modo simulado de Modo Vivo (sin
  placa conectada) para que el alumno practique, o eso le quita el punto justamente a
  la parte de "física real" que `vista-fisica`/`proyecto-fisico` ya resuelven de otra
  forma?
