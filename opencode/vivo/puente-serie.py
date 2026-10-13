#!/usr/bin/env python3
"""Puente serie del Modo Vivo V1 — tecnia-bot-docs/esp32-completo/MODO-VIVO-PLAN.md §10.2.

Node y Bun no tienen puerto serie nativo, y `serialport` es un módulo nativo que no queremos
instalar en cada escuela. El Python del penv de PlatformIO ya trae pyserial 3.5 en toda máquina
con Tecnia Bot, así que este script es el único que toca el puerto: lo abre y hace de puente de
LÍNEAS entre el proceso padre (`transporte-serie.ts`) y la placa.

  stdin  → puerto : cada línea que entra se escribe al puerto terminada en `\\n`.
  puerto → stdout : cada línea que llega del puerto sale tal cual, terminada en `\\n`.

No interpreta nada: ni JSON, ni comandos. Sólo stdlib + pyserial.

Salida: código 0 cuando stdin se cierra (el padre terminó), 2 si el puerto no se pudo abrir
(`PUERTO_NO_ABIERTO`), 3 si falta pyserial (`PYSERIAL_AUSENTE`), 4 si el puerto desapareció en
el medio (`PUERTO_PERDIDO`). Por stderr va UNA línea por evento, con el código primero, y
`PUERTO_ABIERTO <puerto>` cuando el puerto quedó abierto: es el centinela que espera el padre
para no suponer que "no falló todavía" significa "abrió".

Al abrir el puerto, pyserial levanta DTR/RTS; en un DevKit eso dispara el circuito de
auto-reset y la placa arranca de nuevo (hecho conocido del esquema del DevKit, sin cita en el
repo). Es esperable y el protocolo lo contempla: el runtime emite `reinicio` y `hola` al arrancar.
"""

import argparse
import os
import sys
import threading

try:
    import serial
except ImportError:
    sys.stderr.write("PYSERIAL_AUSENTE el Python usado no tiene pyserial\n")
    sys.stderr.flush()
    sys.exit(3)


def avisar(mensaje):
    """Una línea por stderr, sin esperar a que nadie la lea."""
    sys.stderr.write(mensaje + "\n")
    sys.stderr.flush()


def terminar(codigo):
    """Salida inmediata desde cualquier hilo: el hilo principal puede estar bloqueado en stdin."""
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    finally:
        os._exit(codigo)


def leer_del_puerto(puerto, detener):
    """Hilo lector: junta bytes hasta cada `\\n` y escribe la línea entera a stdout.

    `readline()` de pyserial devuelve lo que haya cuando vence el timeout, así que una línea
    larga podría salir partida; por eso el buffer propio: una línea se emite sólo completa.
    """
    salida = sys.stdout.buffer
    pendiente = b""
    while not detener.is_set():
        try:
            trozo = puerto.read(puerto.in_waiting or 1)
        except (serial.SerialException, OSError):
            if detener.is_set():
                return
            avisar("PUERTO_PERDIDO el puerto desapareció mientras se leía")
            terminar(4)
        if not trozo:
            continue
        pendiente += trozo
        while True:
            fin = pendiente.find(b"\n")
            if fin < 0:
                break
            linea = pendiente[:fin]
            pendiente = pendiente[fin + 1 :]
            if linea.endswith(b"\r"):
                linea = linea[:-1]
            salida.write(linea + b"\n")
            salida.flush()


def main():
    parser = argparse.ArgumentParser(description="puente de líneas entre stdin/stdout y un puerto serie")
    parser.add_argument("--puerto", required=True, help="ruta del puerto (/dev/ttyUSB0, COM3)")
    parser.add_argument("--baudios", type=int, default=115200)
    args = parser.parse_args()

    try:
        # 8N1, timeout corto para que el hilo lector pueda mirar `detener` seguido.
        puerto = serial.Serial(
            port=args.puerto,
            baudrate=args.baudios,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.05,
            write_timeout=1,
        )
    except (serial.SerialException, OSError, ValueError) as error:
        avisar("PUERTO_NO_ABIERTO %s" % str(error).replace("\n", " "))
        sys.exit(2)

    avisar("PUERTO_ABIERTO %s" % args.puerto)

    detener = threading.Event()
    lector = threading.Thread(target=leer_del_puerto, args=(puerto, detener), daemon=True)
    lector.start()

    entrada = sys.stdin.buffer
    try:
        for linea in entrada:
            linea = linea.rstrip(b"\r\n")
            try:
                puerto.write(linea + b"\n")
                puerto.flush()
            except (serial.SerialException, OSError):
                avisar("PUERTO_PERDIDO el puerto desapareció mientras se escribía")
                terminar(4)
    except KeyboardInterrupt:
        pass

    # stdin se cerró: el padre terminó. Se cierra el puerto en orden y se sale limpio.
    detener.set()
    try:
        puerto.close()
    except (serial.SerialException, OSError):
        pass
    terminar(0)


if __name__ == "__main__":
    main()
