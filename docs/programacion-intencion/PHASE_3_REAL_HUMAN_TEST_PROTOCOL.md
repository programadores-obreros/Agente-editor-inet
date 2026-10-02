# Phase 3: protocolo de la PRUEBA HUMANA REAL (§26)

> Lo ejecuta una **persona real**: un alumno y, si se puede, también un docente. No vale un agente, ni el orquestador, ni un LLM, ni repetir un transcript.
> Este documento es el protocolo y la planilla. **No** es evidencia de que la prueba se haya hecho. Hasta que haya un `PHASE_3_REAL_HUMAN_TEST_REPORT.md` con observaciones reales, el estado es `REAL_HUMAN_TEST = NOT EXECUTED`.

## 1. Build y entorno
- Build: la del freeze pre-humano (HEAD y SHA-256 en el manifest). La instalación en la VM es una actualización en el lugar (sin desinstalar), con los archivos verificados byte a byte contra el commit.
- **Aislamiento de perfil y memoria (F-02).** La prueba NO usa el perfil del dueño de la máquina.
  - Se abre con `C:\tb-human\Abrir-Tecnia-Bot-PRUEBA-alumno.cmd`, o con `…-docente.cmd` para el docente.
  - Ese lanzador fija `XDG_CONFIG_HOME=C:\tb-human\config` y arranca en una carpeta de proyecto vacía.
  - Perfil y memoria = las plantillas vacías del instalador. El bot se presenta como ante un usuario nuevo: pregunta el modo de uso.
  - La configuración del usuario (`C:\Users\win-vm\.config\opencode`) queda intacta. La clave del modelo es la misma de la máquina.
- **Un solo uso por entorno.** Después de la prueba del alumno, el entorno queda "usado" (el perfil guarda el modo y el rol). Para el docente se usa su propio lanzador y carpeta; en el mismo perfil queda registrado el rol del alumno. Si se necesita un docente completamente limpio, pedir un entorno nuevo antes.
- Navegador: el predeterminado de la máquina (Brave). Antes de empezar, **cerrar las pestañas viejas** de la vista física, para no confundir la observación de pestañas (H12).

## 2. Participantes y privacidad
- Identificadores anónimos: `A1` (alumno) y `D1` (docente). Sin nombres, edad exacta, escuela ni datos personales.
- Se registra sólo: rol, experiencia previa aproximada (ninguna / algo / bastante) y conducta observable.
- Si el bot pregunta un nombre, el participante puede inventarlo o no darlo. No se registra.

## 3. Reglas del facilitador
- Da la consigna inicial y observa. **No enseña qué botones tocar, no explica la vista y no corrige al bot.**
- Si el participante se traba más de ~3 minutos o pide ayuda: el facilitador puede intervenir, pero **registra la intervención** (minuto, qué dijo). Ese checkpoint ya no cuenta como autonomía plena.
- Registrar las respuestas **casi textuales**, sin reinterpretarlas en el momento.

## 4. Protocolo del alumno
Consigna inicial (se lee tal cual): **"Quiero armar algo con un ESP32, un LED y un pulsador."**
El alumno la escribe en Tecnia Bot y sigue solo.

| ID | Qué se observa |
|---|---|
| H1 | ¿Entiende qué apareció (pantalla y vista)? |
| H2 | ¿Identifica Entrada y Salida? |
| H3 | ¿Entiende "GPIO18 (D18)"? (¿lo asocia a un pin de la placa?) |
| H4 | ¿Interpreta la resistencia EN SERIE (la corriente al LED pasa por la resistencia)? |
| H5 | ¿Puede cambiar un pin? (anotar si usa el mouse o el teclado, y si abrió el desplegable) |
| H6 | ¿Puede provocar y corregir un problema? (si no lo intenta solo, la consigna neutra es: "probá poner el pulsador en otro pin, el que quieras") |
| H7 | ¿La explicación del problema le sirve para corregirlo? |
| H8 | ¿Comprende que el proyecto persiste (recargar o volver a abrir)? |
| H9 | ¿Aparecen ids internos (`cmp-…`, `senal`, códigos en mayúsculas)? |
| H10 | ¿Aparece código sin que lo pida? |
| H11 | ¿Aparece razonamiento interno o texto del system prompt (inglés, "Let's…", reglas citadas)? |
| H12 | ¿Se confunde con las pestañas (duplicadas, cuál es la buena)? |

Segunda consigna: **"Quiero que el LED se prenda cuando aprieto el pulsador."**

| ID | Qué se observa |
|---|---|
| H13 | ¿Identifica el pulsador como entrada? |
| H14 | ¿Identifica el LED como salida? |
| H15 | ¿Qué cree el alumno que falta? (textual) |
| H16 | ¿Cree, por error, que ya funciona? |
| H17 | ¿Tecnia Bot inventa comportamiento? |
| H18 | ¿Genera u ofrece C++? |
| H19 | ¿El alumno pide código por iniciativa propia? (si lo pide, observar H11 en esa respuesta) |

Preguntas finales (textuales; respuesta casi literal):
1. "¿Qué hace el pulsador?"
2. "¿Qué hace el LED?"
3. "¿Qué tendría que pasar para que uno controle al otro?"
4. "Si cambiás este pin, ¿qué pensás que cambia?"
5. "¿Para qué está la resistencia?"
6. "Mostrame dónde pasa la señal/corriente hacia el LED." (anotar QUÉ señala: la lista de cables, el dibujo, el selector)

**No se mide "le gustó".** Sólo conducta observable.

## 5. Protocolo del docente (abreviado)
Pedirle:
- que cree el mismo proyecto;
- que cambie un pin;
- que interprete un error;
- que explique qué entiende que falta para botón→LED.

Observar:
- vocabulario que usa;
- cantidad de intentos fallidos;
- claridad;
- confianza en el estado ("¿esto quedó guardado?");
- confusión entre la vista y el proyecto.

## 6. Clasificación (por checkpoint)
`PASS` · `FRICTION` · `FAIL` · `NOT_OBSERVED`. **Nunca** convertir NOT_OBSERVED en PASS.
Separar siempre:
- OBSERVACIÓN: lo que pasó o se dijo;
- INTERPRETACIÓN: qué significa.

Si hubo ayuda del facilitador en un checkpoint: anotarla y marcar "con intervención".

## 7. Planilla (una por participante)
```
Participante: A1 | Rol: alumno | Experiencia previa: ____ | Fecha/hora: ____ | Build: ____
Facilitador: ____ (anónimo)

ID  | Resultado (PASS/FRICTION/FAIL/NOT_OBSERVED) | Observación (textual) | Interpretación | Intervención (min, qué)
H1  |  |  |  |
...
H19 |  |  |  |

Preguntas finales (respuesta casi textual):
1. 
2. 
3. 
4. 
5. 
6. (qué señaló)

Riesgos conocidos vistos (marcar si aparecieron): pestaña duplicada [ ] · texto "Ah" o respuesta cortada [ ] · razonamiento en inglés [ ] · type-ahead "D19" [ ] · desplegable que cambia solo [ ]
```

## 8. Después de la prueba
- NO arreglar inmediatamente. NO iniciar Blockly ni W-P3-NUCLEO.
- Se produce `docs/programacion-intencion/PHASE_3_REAL_HUMAN_TEST_REPORT.md`, con secciones A–K (build, entorno, participantes anonimizados, protocolo, observaciones, intervenciones, clasificación, hallazgos nuevos, contradicciones con las simulaciones, impacto sobre PHASE_3_MINIMUM_VERTICAL_DESIGN, recomendación GO / HUMAN_DECISION_REQUIRED).
- `HUMAN_TEST_COMPLETED = YES` no autoriza Phase 3. **STOP y decisión humana.**
