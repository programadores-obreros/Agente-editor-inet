---
name: circuitos-visuales
description: Generar un circuito VISUAL profesional en HTML con piezas reales (Wokwi Elements) que el alumno abre en el navegador. Para cuando piden "circuito bonito", "esquema visual", "mostrame el circuito lindo" de Arduino/ESP32 con servo, LED, sensores, etc.
---

# Circuitos visuales en HTML — piezas reales, offline

Este skill le permite a Tecnia Bot generar un **archivo HTML** con un circuito profesional usando piezas fotorrealistas (Wokwi Elements, licencia MIT). El alumno lo abre con doble clic en el navegador, **sin internet**.

## Cuándo usar este skill

Cuando el alumno o docente pide algo "bonito", "visual", "profesional", "para mostrar/imprimir", "esquema lindo". Para una explicación rápida en el chat, alcanza con el skill `diagramas-conexion` (ASCII). Este skill es para el material visual de calidad.

## Cómo funciona (importante)

1. Generás un archivo `.html` en el directorio actual con el tool `edit`.
2. El HTML referencia la biblioteca local de piezas (ya instalada, no hay que bajar nada).
3. Le decís al alumno que lo abra: "Abrí este archivo 👉 file://(ruta completa)".

> **Regla de oro:** NO inventes coordenadas de pines ni dibujes piezas a mano. Usá la PLANTILLA de abajo tal cual, cambiando solo las piezas y las etiquetas de conexión. La biblioteca de piezas resuelve el dibujo; vos solo armás la escena.

## La biblioteca de piezas (ya instalada)

El archivo de piezas está en:
```
~/.config/opencode/tecniabot-web/wokwi-bundle.js
```

Componentes disponibles (custom elements HTML):
- Placas: `wokwi-esp32-devkit-v1`, `wokwi-arduino-uno`, `wokwi-arduino-nano`, `wokwi-arduino-mega`
- Actuadores: `wokwi-servo`, `wokwi-buzzer`, `wokwi-stepper-motor`
- Sensores: `wokwi-hc-sr04` (ultrasónico), `wokwi-dht22`, `wokwi-pir-motion-sensor`, `wokwi-photoresistor-sensor`, `wokwi-ntc-temperature-sensor`
- Salida: `wokwi-led`, `wokwi-rgb-led`, `wokwi-7segment`, `wokwi-lcd1602`, `wokwi-ssd1306` (OLED), `wokwi-neopixel`
- Entrada: `wokwi-pushbutton`, `wokwi-potentiometer`, `wokwi-slide-switch`, `wokwi-membrane-keypad`
- Pasivos: `wokwi-resistor`

## PLANTILLA (copiala y adaptá solo lo marcado)

Generá un archivo así. Cambiá: el título, las dos piezas (`<wokwi-...>`), las etiquetas de los cables y la tabla. Dejá igual el resto.

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Tecnia Bot — Circuito</title>
<script src="file:///home/USUARIO/.config/opencode/tecniabot-web/wokwi-bundle.js"></script>
<style>
  body { font-family:'Segoe UI',system-ui,sans-serif; background:#eef2f5; margin:0; padding:24px; color:#1a2733; }
  .hoja { max-width:960px; margin:0 auto; background:#fff; border-radius:16px; box-shadow:0 6px 28px rgba(0,0,0,.10); padding:28px 34px; }
  h1 { font-size:23px; margin:0 0 2px; color:#2c3e50; }
  .sub { color:#7f8c8d; font-size:14px; margin-bottom:18px; }
  .escena { position:relative; height:300px; margin:6px 0 14px; }
  .pieza { position:absolute; transform:scale(1.4); transform-origin:top left; }
  .izq { left:30px; top:40px; }
  .der { left:660px; top:80px; }
  svg.cables { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:5; }
  .et { font:600 12px 'Segoe UI'; fill:#2c3e50; }
  .aviso { background:#fff4e5; border-left:4px solid #f39c12; padding:11px 15px; border-radius:8px; font-size:14px; margin:16px 0; }
  table { width:100%; border-collapse:collapse; margin-top:14px; font-size:14px; }
  th,td { text-align:left; padding:9px 11px; border-bottom:1px solid #eef0f2; }
  th { background:#f7f9fb; color:#34495e; }
  .dot{display:inline-block;width:13px;height:13px;border-radius:50%;margin-right:7px;vertical-align:middle;border:1px solid rgba(0,0,0,.15);}
</style>
</head>
<body>
<div class="hoja">
  <h1>🔌 TITULO DEL CIRCUITO</h1>
  <div class="sub">Esquema de conexión — Tecnia Bot · piezas reales, funciona sin internet</div>

  <div class="escena">
    <svg class="cables" viewBox="0 0 960 300" preserveAspectRatio="none">
      <path d="M250,110 C440,110 470,150 690,150" stroke="#e74c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M250,150 C440,150 470,168 690,168" stroke="#f39c12" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M250,190 C440,190 470,186 690,186" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/>
      <text class="et" x="300" y="100">🔴 5V</text>
      <text class="et" x="300" y="142">🟡 señal</text>
      <text class="et" x="300" y="212">🟤 GND</text>
    </svg>
    <wokwi-esp32-devkit-v1 class="pieza izq"></wokwi-esp32-devkit-v1>
    <wokwi-servo class="pieza der"></wokwi-servo>
  </div>

  <div class="aviso">
    ⚠️ <strong>Atención:</strong> ESCRIBIR LA ADVERTENCIA DE VOLTAJE AQUÍ.
  </div>

  <table>
    <tr><th>Cable</th><th>Color</th><th>Conexión</th></tr>
    <tr><td>Alimentación</td><td><span class="dot" style="background:#e74c3c"></span>Rojo</td><td>VIN (5V)</td></tr>
    <tr><td>Señal</td><td><span class="dot" style="background:#f39c12"></span>Naranja</td><td>GPIO18</td></tr>
    <tr><td>Tierra</td><td><span class="dot" style="background:#5d4037"></span>Marrón</td><td>GND</td></tr>
  </table>
</div>
</body>
</html>
```

## Reglas al generar

- **Reemplazá `USUARIO`** en la ruta del `<script>` por el nombre real del usuario del sistema (normalmente el de la carpeta home). Si no lo sabés, usá la ruta `~/.config/...` no funciona en navegador: tenés que poner la ruta absoluta completa. Preguntá el usuario del sistema si hace falta.
- Cambiá las dos piezas `<wokwi-...>` por las que corresponden al circuito.
- Ajustá las etiquetas de los cables (colores reales del componente) y la tabla.
- Mantené la advertencia de voltaje si es ESP32 (3.3V) o si hay 220V (relay).
- Guardá el archivo con `edit` en el directorio actual, nombre claro (ej: `circuito-servo.html`).
- Después de guardarlo, decile al alumno: "Listo! Abrí este archivo en tu navegador (doble clic o file://...)".

## Limitación honesta (comunicarla si preguntan)

Los cables conectan las zonas de los componentes de forma clara y etiquetada, pero no salen pixel-exacto de cada patita (eso requeriría el simulador completo de Wokwi). Para aprender a cablear, la combinación pieza real + color + etiqueta + tabla es más que suficiente y se ve profesional.
