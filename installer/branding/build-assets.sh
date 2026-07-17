#!/usr/bin/env bash
# Genera los assets de marca para el instalador a partir de los SVG.
# Salida: tecnia-bot.ico (exe + accesos directos), wizard-grande.bmp (banner del
# asistente), wizard-chico.bmp (logo chico). Requiere rsvg-convert + ImageMagick.
set -euo pipefail
cd "$(dirname "$0")"

# Ícono: PNG 256 -> ICO multi-resolución (conserva transparencia).
rsvg-convert -w 256 -h 256 icono.svg -o icono-256.png
magick icono-256.png -define icon:auto-resize=256,128,64,48,32,16 tecnia-bot.ico

# Banner del asistente: 164x314, BMP 24-bit (Inno no acepta alfa).
rsvg-convert -w 164 -h 314 banner.svg -o banner.png
magick banner.png -background "#3498DB" -alpha remove -type truecolor BMP3:wizard-grande.bmp

# Logo chico: 55x58, BMP 24-bit.
rsvg-convert -w 55 -h 58 logo-chico.svg -o logo-chico.png
magick logo-chico.png -background "#3498DB" -alpha remove -type truecolor BMP3:wizard-chico.bmp

rm -f icono-256.png banner.png logo-chico.png
echo "Assets generados: tecnia-bot.ico, wizard-grande.bmp, wizard-chico.bmp"
