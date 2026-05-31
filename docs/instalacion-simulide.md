# Instalación de SimulIDE (simulador de circuitos)

SimulIDE permite simular circuitos Arduino **sin placa física**. Es open source, gratuito y **portable** (no necesita instalación ni permisos de administrador) — ideal para las computadoras de escuela.

> ⚠️ **Importante:** SimulIDE simula bien **Arduino UNO y Nano**. Para **ESP32 NO es confiable** — ahí hay que usar la placa real.

## Descarga

Página oficial: https://simulide.com/p/downloads/

Elegí la versión estable más reciente (1.1.0-SR2 o superior) para tu sistema.

## Windows (plataforma principal)

1. Descargá el archivo `.zip` de Windows 64-bit
2. Descomprimí la carpeta donde quieras (Escritorio, Documentos, etc.)
3. Entrá a la carpeta descomprimida
4. Doble clic en `SimulIDE.exe`

No hace falta instalar nada más. Si Windows muestra una advertencia de seguridad (porque no está firmado), elegí "Más información" → "Ejecutar de todas formas".

## Linux

1. Descargá el archivo `.tar.gz` de Linux 64-bit
2. Descomprimilo:
   ```bash
   tar -xzf SimulIDE_*.tar.gz
   ```
3. Entrá a la carpeta y ejecutá el binario:
   ```bash
   cd SimulIDE_*
   ./bin/simulide
   ```

Si falta alguna librería Qt5, instalala según tu distro:
```bash
# Debian/Ubuntu:
sudo apt install libqt5core5a libqt5gui5 libqt5widgets5 libqt5serialport5

# Arch/Manjaro:
sudo pacman -S qt5-base qt5-serialport
```

## Verificar que funciona

1. Abrí SimulIDE
2. Arrastrá un "Arduino Uno" desde el panel Micro → Arduino al centro
3. Si lo ves aparecer en el área de trabajo, está funcionando

## Próximo paso

Una vez instalado, mirá el skill `simulide` (Profe Bot lo activa cuando preguntás por simulación) para aprender a armar un circuito, cargar el `.hex` de PlatformIO y correr la simulación paso a paso.

---

## Nota para el equipo de desarrollo

Pendiente de Fase 2: validar el formato de archivo de circuito `.sim1` de SimulIDE para poder **generar circuitos automáticamente** desde Profe Bot. Esto requiere instalar SimulIDE, armar un circuito simple a mano, guardarlo y analizar el XML resultante. El formato no está documentado oficialmente y debe verificarse con un archivo real antes de generar plantillas.
