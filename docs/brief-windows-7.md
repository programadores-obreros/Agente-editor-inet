# Brief — Windows 7 y Tecnia Bot: qué se comunica, dónde y con qué palabras

> Estado al 5 de septiembre de 2026 · rama `feat/instalador-detecta-win7`, sin publicar.
> Este documento es la **única fuente de verdad** para comunicar el tema en el repo
> y en la web. Los datos duros están verificados contra el código fuente de OpenCode
> y la documentación oficial de cada herramienta. No inventar versiones, fechas ni
> promesas que no estén acá.

---

## 0. Qué se pide

Una escuela pidió un instalador de Tecnia Bot para **Windows 7**. No lo va a haber,
y no por falta de ganas: el motor sobre el que corre el bot no arranca en ese
Windows. Hay que decirlo **claro, en todos lados y con las alternativas al lado**,
para que ninguna docente descargue, pruebe, falle y se quede sin saber por qué.

Tres superficies, en este orden:

1. **El instalador** — ya hecho (ver §3).
2. **El repositorio oficial** — ya hecho (ver §3).
3. **La web de descarga** (`tecnialab.net.ar/tecnia-bot`) — pendiente (ver §4).

---

## 1. Datos duros (verificados, usar tal cual)

| Dato | Valor | Fuente |
|---|---|---|
| Qué es Tecnia Bot, técnicamente | El binario de OpenCode para Windows x64 más una capa educativa | `install/bootstrap.ps1`, `installer/abrir-tecnia-bot.cmd` |
| Con qué se compila OpenCode | Bun, como ejecutable único (`bun-windows-x64`) | `packages/opencode/script/build.ts` del repo de OpenCode |
| Mínimo de Bun en Windows | **Windows 10 versión 1809** (compilación 17763, octubre de 2018) | bun.sh/docs/installation: «Bun requires Windows 10 version 1809 or later» |
| Arquitectura | **Sólo 64 bits** (OpenCode no publica binario de 32 bits) | assets de release de OpenCode |
| Último Python para Windows 7 | 3.8 | docs.python.org/3/using/windows.html |
| Python que exige PlatformIO Core | 3.9 o más nuevo | docs.platformio.org, requisitos |
| PowerShell que trae Windows 7 | 2.0 (Scoop necesita 5.1 y .NET 4.5) | Microsoft, WMF 5.1 |
| Fin de soporte de Windows 7 | Enero de 2020 (ESU: enero de 2023) | Microsoft |
| Fin de soporte de Windows 10 | Octubre de 2025 | Microsoft |
| Inno Setup 6.3+ corre en | Windows 7 SP1 o más nuevo | jrsoftware.org, historial 6.3.0 |

**La regla que aplica el instalador**, sin margen agregado de nuestro lado:

> Windows 10 versión 1809 (compilación 17763) o más nueva, o Windows 11, **de 64 bits**.

---

## 2. La decisión, en una frase

**No hay segundo instalador.** El mismo `.exe` detecta el Windows y, si no sirve, lo
dice con nombre y apellido: qué Windows encontró, por qué no puede seguir y a dónde
ir. El razonamiento completo, la tabla de la cadena de dependencias y los criterios
de revisión están en [`decisiones.md`, D-05](decisiones.md#d-05--windows-7-no-se-soporta-y-el-instalador-lo-dice-con-nombre-y-apellido).

**Registro público, con link para mandar a la escuela:** [issue #5](https://github.com/programadores-obreros/Agente-editor-inet/issues/5),
cerrado como `wontfix` y abierto a comentarios. Es el lugar donde una escuela dice
cuántas máquinas con Windows 7 tiene.

---

## 3. Lo que YA está hecho (repo, rama sin publicar)

| Pieza | Archivo | Estado |
|---|---|---|
| Detección y mensaje en el instalador | `installer/tecnia-bot.iss` (`InitializeSetup`, `[Messages]`) | Escrito. Falta compilar y probar en VM Win7 y Win10 |
| Tests | `tests/instalador.test.mjs` (+3, 155/155 verdes) | Hecho |
| Decisión | `docs/decisiones.md`, D-05 | Hecho |
| Requisitos en la guía | `docs/instalacion-windows.md`, sección «Requisitos» | Hecho |
| README | callout de Windows (Instalación) y línea «Requisitos» (Estado) | Hecho |
| CHANGELOG | `## [Unreleased]`, «Cambiado» | Hecho |

Orden para publicar: compilar el `.exe` (VM Win10 con `installer/compilar-en-windows.ps1`
o el workflow «Instalador Windows (.exe)» desde Actions) → probar en Win7 SP1 (tiene
que decir «Windows 7 (compilación 7601)» y ofrecer la web) → probar en Win10 (nada
cambia) → commit → versión y release → recién ahí tocar la web (§4), para que el
enlace de descarga apunte a un `.exe` que ya se comporta como dice la web.

---

## 4. Lo que falta: la web de descarga

Repo: `sgi-plataforma/tecnialab-web` (Astro, rama `main`, despliega a Firebase).
Cuatro toques, chicos y en este orden de importancia.

### 4.1 Página de descarga — `src/pages/tecnia-bot/index.astro`

Junto al botón «Descargar Tecnia Bot», **antes** de que la persona haga clic, una
línea de requisitos. Texto:

> **Necesita Windows 10 (versión 1809 o más nueva) o Windows 11, de 64 bits.**
> ¿Tenés Windows 7 u 8? Mirá [qué opciones hay](#windows-7).

Y más abajo, una sección corta con ancla `windows-7` (o en la guía, §4.2, y desde
acá sólo el enlace):

> ### ¿Tengo Windows 7 u 8? ¿Puedo usar Tecnia Bot?
>
> No, y no es algo que un instalador pueda arreglar. Tecnia Bot corre sobre
> OpenCode, y OpenCode está construido con un motor que necesita Windows 10
> (versión 1809, de octubre de 2018) o más nuevo. En Windows 7 el programa
> directamente no arranca. Si igual corrés el instalador, no rompe nada: te dice
> qué Windows encontró y por qué no puede seguir.
>
> Lo que sí se puede hacer con esa computadora:
>
> - **Ponerle Linux.** Una PC de la época de Windows 7 corre Linux Mint o Huayra
>   sin problema, y Tecnia Bot tiene instalador para Linux. Es la opción que
>   recomendamos si la máquina no se puede actualizar a Windows 10. Si tu escuela
>   tiene varias máquinas así, [escribinos](#contacto): estamos evaluando un
>   pendrive listo para usar.
>
> (`#contacto` es un marcador: reemplazar por el enlace de contacto real del sitio.)
> - **Actualizarla a Windows 10 de 64 bits.** Corre el bot completo. Necesita
>   licencia y que el hardware lo aguante.
> - **Mientras tanto, sin Tecnia Bot:** Arduino IDE 1.8.19 funciona en Windows 7,
>   y las 17 fichas de Tecnia Lab se pueden imprimir desde cualquier navegador.

**No prometer** en la web: ni versión para Windows 7, ni fecha para el pendrive
Linux, ni «modo remoto». Lo que no existe no se anuncia.

### 4.2 Guía de instalación — `src/pages/tecnia-bot/guia/index.astro`

- Un **paso 0** o una nota antes de «Descargá el instalador»: el requisito de §1,
  con cómo saber qué Windows tenés (tecla Windows + R, `winver`, Enter; o
  Configuración > Sistema > Acerca de).
- Una **pregunta nueva en la FAQ** (misma estructura que «¿La advertencia azul de
  Windows va a aparecer siempre?»): «¿Tengo Windows 7 u 8, puedo usarlo?» con el
  texto de §4.1 resumido y el enlace a la sección completa.
- En el bloque de datos estructurados `HowTo`, `tool` pasa de «Una PC con Windows»
  a «Una PC con Windows 10 o 11 de 64 bits». Es lo que lee Google.

### 4.3 Versiones — `src/pages/tecnia-bot/versiones.astro`

Cuando salga la versión que trae la detección, la entrada correspondiente, con el
mismo texto del CHANGELOG (lead de una oración). No antes.

### 4.4 Datos — `src/data/tecnia-bot.ts`

La línea de roadmap «Versión portable (en un pendrive, sin instalar nada, para las
PCs bloqueadas de la escuela)» es pariente directa del pendrive Linux de §5. Si el
piloto se decide, unificar las dos ideas en una sola línea de roadmap; si no, dejarla
como está. No agregar nada nuevo al roadmap por este brief.

---

## 5. Alternativas para escuelas con Windows 7 (para quien atiende el pedido)

Ordenadas de mejor a peor. Ninguna está armada; están para responder con criterio.

| # | Alternativa | Qué da | Qué cuesta | Qué falta verificar antes de prometerla |
|---|---|---|---|---|
| 1 | **Linux en la misma máquina** (Mint o Huayra) con el instalador Linux de Tecnia Bot | El bot completo, en hardware viejo, sin licencia | Alguien que instale; docentes que no vieron Linux | OpenCode en CPU sin AVX2 (existe build baseline, probarlo); permisos del puerto serial (`dialout`); `install.sh` en Debian; fichas offline |
| 2 | **Windows 10 de 64 bits** en la misma máquina | El bot completo | Licencia (la actualización gratis desde Win7 terminó en 2023) y hardware que aguante; Windows 10 también está fuera de soporte desde octubre de 2025 | Nada técnico de nuestro lado |
| 3 | **Modo remoto**: una PC Win10 del aula corre OpenCode como servidor, las Win7 entran por navegador | Conversar con el bot | No compila ni carga la placa enchufada en la Win7; Chrome 109 / Firefox ESR 115 son los últimos para Win7 | La interfaz web de OpenCode para este uso |
| 4 | **Modo manual**: Arduino IDE 1.8.19 + las fichas PDF + un chat web | La clase se da | Se pierde todo lo que hace especial al bot | Nada |

**Disparador para armar el piloto de la alternativa 1:** un caso real con número de
máquinas y arquitectura (64 bits sí o sí). Sin ese dato no se empieza.

---

## 6. Qué NO decir, en ningún lado

- «Próximamente para Windows 7». No va a pasar: Bun no va hacia atrás y Windows 7
  está fuera de soporte desde 2020.
- «Es un problema del instalador». No lo es, y decirlo manda a la gente a esperar
  un arreglo que no existe.
- Fechas para el pendrive Linux o el modo remoto. Son evaluaciones, no compromisos.
- Que Tecnia Bot «funciona en cualquier Windows». Funciona en Windows 10 1809+ y 11,
  de 64 bits. Punto.

---

## 7. Checklist de publicación

- [ ] `.exe` compilado desde la rama y probado en VM Windows 7 SP1 (cartel propio) y Windows 10 (sin regresión)
- [ ] Commit en `feat/instalador-detecta-win7`, merge a `main`
- [ ] `VERSION`, `package.json`, README y CHANGELOG con la versión nueva; tag y release con el `.exe`
- [ ] Web: §4.1 y §4.2 en `tecnialab-web`, desplegados **después** del release
- [ ] Web: §4.3 con la entrada de la versión
- [ ] Respuesta a la escuela que pidió Windows 7, con la tabla de §5 y la pregunta de cuántas máquinas y de qué arquitectura son
