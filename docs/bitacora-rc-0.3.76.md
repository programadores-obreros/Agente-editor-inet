# Bitácora de la release candidate 0.3.76

Registro de lo que se probó, dónde, y qué falta. Se actualiza a medida que avanza la
prueba de `docs/prueba-rc.md`. La regla que gobernó esta RC: **todo se reproduce y se
arregla en la VM antes de tocar una máquina real.**

## Entornos

| Entorno | Qué es | Estado al 2026-09-06 |
|---|---|---|
| VM `win10` | Windows 10 22H2 (19045), PowerShell 5.1, usuario `win-vm` sin admin, QEMU | Tecnia Bot 0.3.76 instalado desde el `.exe` de la CI; OpenCode 1.18.18 fijado con hold; Big Pickle |
| CI Windows | `windows-latest`, PowerShell 5.1, corre `bootstrap.ps1` de punta a punta | Verde en la primera corrida del PR #6 (run 34015560945) |
| Notebook real | Windows 10 Pro 19045, usuario sin admin, red de una escuela | Tecnia Bot 0.3.76 instalado desde el `.exe` de la CI (run 34066192110); OpenCode 1.18.18; Gemini con key propia |

## Lo que la notebook real encontró y la VM confirmó

1. **La página oficial apunta a `releases/latest` = 0.3.75.** El usuario instaló la versión
   vieja creyendo que era la nueva. Correcto por diseño (no publicamos), pero confirma que
   la RC sólo se distribuye por el artefacto de la CI hasta el tag.
2. **OpenCode se había auto-actualizado a 1.18.29** tres minutos después de instalar la
   0.3.75: el pin sin `autoupdate: false` no servía. Ya corregido en la rama.
3. **El bootstrap no activaba la versión fijada** cuando la carpeta estaba en disco pero
   `current` apuntaba a otra: Scoop decía "already installed" y nadie hacía `scoop reset`.
   Corregido.
4. **"OpenCode no arranca en esta máquina" era RedirectionGuard.** Inno Setup 6.7.0 activa
   esa mitigación y la heredan sus hijos: `bootstrap.ps1` y el lanzador abierto desde la
   última pantalla no podían atravesar los junctions `current` de Scoop. `opencode.exe`
   "no existía", el shim no leía su destino, Scoop no podía rehacer shims. Por su ruta real
   el binario contestaba al instante. Corregido con `RedirectionGuard=no` en el `.iss`.
   **Es, casi seguro, la causa de la máquina que quedó afuera en la capacitación del
   20 de agosto.**

## Prueba de `docs/prueba-rc.md` en la notebook real

| # | Paso | Resultado | Observación |
|---|---|---|---|
| 1 | Instalar el `.exe` encima de la versión anterior | ✅ | Sin admin. Respetó la key propia de Google. Consola: "La 1.18.18 ya está en el disco: la vuelvo a activar", "fijado". |
| 2 | Splash | ✅ | v0.3.76 · Tecnia-Bot · Gemini 3.5 Flash Lite · OpenCode **1.18.18** |
| 3 | Primer mensaje de docente | ✅ | Castellano, dos caminos concretos, sin código, cierra con pregunta. No preguntó el nombre porque el perfil ya lo tenía. |
| 4 | Circuito del LED sin abrir, luego abrir | ✅ | `circuito-led-esp32.html`: **220Ω** en el dibujo y en la tabla, aviso con la comparación contra los 330Ω del UNO. |
| 5 | Teclado 4x4 sin GPIO12 | pendiente | |
| 6 | Ficha del LDR | pendiente | |
| 7 | Crear proyecto y compilar (ESP32 enchufado) | pendiente | |
| 8 | **Cargar a la placa** | pendiente | Lo único que ninguna VM ni CI puede probar. |
| 9 | Monitor serial | pendiente | |
| 10 | `/diagnostico` | pendiente | Un `/diagnostico` corrido antes, con la copia 0.3.76 recién instalada, ya dio "estás al día", PlatformIO 6.1.19 y "sin placa" correctamente. |
| 11 | Reparar desde el menú inicio | pendiente | |
| 12 | Desinstalar | pendiente | |

## Publicación

**Publicada el 2026-09-06 a las 23:57 UTC** como [v0.3.76](https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.76),
con pasos 5 a 12 de la prueba todavía pendientes. Se decidió publicar igual: la key de
respaldo revocada ese mismo día dejaba mudas las instalaciones de agosto sin key propia, y
la página oficial seguía distribuyendo la 0.3.75. Ninguno de los pasos pendientes puede
dejar una máquina peor de lo que la dejaba la 0.3.75 con la key muerta.

| Verificación | Resultado |
|---|---|
| PR #7 `release/0.3.76` → `main`, CI Linux + Windows (bootstrap de punta a punta) | verde |
| Tag coincide con `VERSION`; smoke; parseo 5.1 de la copia instalada; `OPENCODE_VERSION` y manifiesto | verde |
| `Instalar-Tecnia-Bot.exe` adjunto | 3.864.584 bytes, SHA256 verificado contra `SHA256SUMS.txt` |
| `releases/latest` | redirige a `v0.3.76`: la página oficial ya baja la nueva |

## Qué falta después de publicar

- Pasos 5 a 12 de la prueba en la notebook, con el ESP32 (el 8, cargar a la placa, es el
  que ninguna VM ni CI puede probar). Anotar los resultados en la tabla de arriba.
- Notas de la release en GitHub (la CI la crea sin texto).

- Pasos 5 a 12 en la notebook, con el ESP32.
- Después de publicar: decidir qué hace el bot cuando Big Pickle deje de ser gratis, el
  lock del modo aula, y el gate de seguridad antes de cargar. Y Educabot.
