#!/usr/bin/env bash
# Genera los assets de marca para el instalador a partir de los SVG + logos oficiales.
# Salida: tecnia-bot.ico (exe + accesos directos), wizard-grande.bmp (banner del
# asistente, con el logo Tecnia Lab), wizard-chico.bmp (isotipo Tecnia Lab).
# Requiere rsvg-convert + ImageMagick. Los logos oficiales viven en tecnialab/.
set -euo pipefail
cd "$(dirname "$0")"

# Ícono: robot (producto Tecnia Bot) en paleta Tecnia Lab -> ICO multi-resolución.
rsvg-convert -w 256 -h 256 icono.svg -o icono-256.png
magick icono-256.png -define icon:auto-resize=256,128,64,48,32,16 tecnia-bot.ico

# Banner del asistente: robot + nombre + logo Tecnia Lab embebido. 164x314, BMP 24-bit.
rsvg-convert -w 164 -h 314 banner.svg -o banner.png
magick banner.png -background "#6d28d9" -alpha remove -type truecolor BMP3:wizard-grande.bmp

# Logo chico (arriba a la derecha del asistente, sobre el header azul Tecnia Lab): isotipo.
magick tecnialab/isotipo.png -resize 46x -background "#6d28d9" -gravity center -extent 55x58 -type truecolor BMP3:wizard-chico.bmp

rm -f icono-256.png banner.png
echo "Assets generados: tecnia-bot.ico, wizard-grande.bmp, wizard-chico.bmp"
