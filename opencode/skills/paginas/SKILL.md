---
name: paginas
description: Armar una página con el diseño de Tecnia Bot, para leer, repartir o proyectar en el aula, con el tool `pagina`. Para cuando piden una guía de clase, un apunte, una explicación para los alumnos, el resumen de la clase, la consigna de un trabajo práctico o un instructivo paso a paso. No es para ver el proyecto del alumno (eso es `vista-fisica`), ni para dibujar un circuito (`circuito`), ni para la hoja de un componente (`ficha`), ni para la hoja de un proyecto con materiales, conexiones y código (`imprimible`), ni para contestar una duda (eso va en el chat).
---

# Páginas con diseño — usá el tool `pagina`

> ⚠️ **Primero, la frontera.** `pagina` no dibuja y no es el proyecto. El
> proyecto del alumno se ve con `vista-fisica`; un esquema o lámina del
> circuito es `circuito`; la hoja de un componente que ya tiene ficha es
> `ficha`; la hoja de un proyecto (materiales + conexiones + código) es
> `imprimible`. Una duda se contesta en el chat, y la página se ofrece
> después. Ante la duda entre chat y página: chat.

Vos pasás el **contenido** como una lista de bloques; la tool le pone el diseño
de Tecnia Bot (encabezado, navegación por secciones, modo oscuro, botón para
imprimir o guardar en PDF), lo guarda en la carpeta de trabajo y te devuelve la
ruta. **Vos no elegís el diseño ni escribís HTML: elegís qué bloques van y qué
dicen.**

## Antes de llamarla

1. **¿Tenés el tema, el curso y la placa?** Si falta alguno, UNA pregunta.
2. **Contá en una línea qué secciones va a tener** y esperá el sí:
   «Te armo la guía con tres partes: materiales, armado paso a paso y qué
   tiene que pasar. ¿Va?».
3. **Juntá los datos de su fuente** (abajo, «De dónde sale cada cosa»). Lo que
   no tenés de una fuente, no va.

## Catálogo de bloques

Cada bloque es un objeto con `tipo` y **sólo** los campos que ese tipo usa: un
campo de más es un error, no se ignora.

| tipo | exige | admite | usalo cuando | no lo uses para |
|---|---|---|---|---|
| `seccion` | `titulo` | `texto` | abrir una parte numerada de la página (va en la navegación); `texto` es la bajada | poner contenido: la sección sólo abre, el contenido va en los bloques que siguen |
| `texto` | `texto` | `titulo` | explicar con párrafos (separados por una línea en blanco) | una enumeración: eso es `lista` o `pasos` |
| `lista` | `items` | `titulo` | materiales, ideas sueltas, criterios: cosas sin orden | instrucciones que se hacen en orden: eso es `pasos` |
| `pasos` | `items` | `titulo` | un procedimiento: armar, cargar, probar, en orden | cosas sin orden |
| `tabla` | `columnas`, `filas` | `titulo` | conexiones (pieza, pin, color de cable), comparaciones, una rúbrica | una sola columna: eso es `lista` |
| `codigo` | `texto` | `titulo` | un ejemplo de clase que ya compilaste en esta charla, o un pedacito de tres o cuatro líneas | el programa del proyecto físico: ese se ve en la ventana, sección «Mirá el código» |
| `aviso` | `texto`, `severidad` | `titulo` | una advertencia, un dato a no olvidar, un «así tiene que quedar» | adornar: un aviso por tema, no uno por párrafo |
| `plegable` | `titulo` | `texto`, `items` (al menos uno) | lo que no todos necesitan leer: «si no prende», la solución, una ayuda | lo principal de la página: plegado no se lee |

`plegable` necesita su `titulo` y al menos uno de `texto` o `items` (pueden ir
los dos). Hasta 40 bloques y 8 secciones por página: si no alcanza, son dos
páginas.

### Severidades del aviso

| severidad | etiqueta en la página | cuándo |
|---|---|---|
| `info` | Dato | un dato útil, sin riesgo |
| `ok` | Bien | cómo se ve cuando quedó bien |
| `aviso` | Atención | algo que, mal hecho, no anda o rompe una pieza barata (polaridad del LED, 3,3 V del ESP32) |
| `error` | Hay que corregir | **sólo riesgo real**: 220 V de red, o algo que puede quemar la placa |

**Avisos con medida.** `error` no es «importante»: es peligro. Si todo es
`error`, nada lo es.

## De dónde sale cada cosa

**Nada de la página sale de tu memoria.**

- **Pines y conexiones**: de `proyecto-fisico leer` si es el proyecto del
  alumno; de la tabla que devolvió el `circuito` que generaste si es una
  lámina; o de la ficha del proyecto en el skill `proyectos-inet`. Copiados tal
  cual. **Si no los tenés de ninguna de las tres, la página va sin conexiones**
  y lo dice con un aviso `info`: «Las conexiones salen del circuito del
  proyecto».
- **Código del proyecto físico**: no va. Va un `texto` que dice que el
  programa se ve en la ventana del proyecto, sección «Mirá el código».
- **Otro código**: sólo si ya compiló en esta charla, o un pedacito de tres o
  cuatro líneas que ilustra lo que explicás.
- **Contenido curricular** (materias, saberes, ejes): sólo del skill
  `diseno-curricular`, con los nombres tal cual están escritos ahí.
- **La placa** (`placa`): como la nombra el skill `placas`.

**Y además:** en español rioplatense, como hablás en el chat; **sin nombres de
alumnos** (la página se reparte y se proyecta); un título que diga de qué es.

## Recetas por pedido

Son puntos de partida, no moldes: si el docente pide otra cosa, se arma otra.

**Guía de clase** (para seguir en el aula):
`seccion` Qué vamos a hacer → `texto` → `seccion` Materiales → `lista` →
`seccion` Conexiones → `tabla` (de su fuente) → `aviso` → `seccion` Paso a paso
→ `pasos` → `aviso` `ok` con lo que tiene que pasar → `plegable` «Si no anda».

**Apunte** (para leer y estudiar):
`seccion` por idea → `texto` → `lista` con lo clave → `aviso` `info` con el
dato a no olvidar → al final `plegable` con un ejercicio y su solución.

**Consigna de trabajo práctico**:
`seccion` Consigna → `texto` → `seccion` Qué tienen que entregar → `lista` →
`seccion` Cómo se evalúa → `tabla` (criterio, qué se mira) → `aviso` con la
fecha o la condición de entrega si el docente la dio.

**Resumen de la clase**:
sin secciones si es corto: `texto` con qué se vio → `lista` con lo que hay que
recordar → `pasos` con lo que sigue la próxima.

## Ejemplo completo

Una guía de clase del semáforo del INET (pines de la ficha
`01-semaforizacion` de `proyectos-inet`, ESP32):

```json
{
  "titulo": "Semáforo con tres LEDs",
  "resumen": "Armamos el semáforo 1 del proyecto de semaforización: tres LEDs, tres resistencias y el ESP32.",
  "placa": "ESP32 DevKit",
  "bloques": [
    { "tipo": "seccion", "titulo": "Materiales" },
    { "tipo": "lista", "items": ["ESP32 DevKit", "3 LEDs: rojo, amarillo y verde", "3 resistencias de 220 Ω", "Protoboard y cables"] },
    { "tipo": "seccion", "titulo": "Conexiones", "texto": "Cada LED va de su pin a una resistencia, y la resistencia a GND." },
    { "tipo": "tabla", "columnas": ["LED", "Pin del ESP32", "Cable"], "filas": [["Rojo", "GPIO 18", "rojo"], ["Amarillo", "GPIO 17", "amarillo"], ["Verde", "GPIO 16", "verde"]] },
    { "tipo": "aviso", "severidad": "aviso", "texto": "La pata larga del LED va al pin. Al revés no se rompe, pero no prende." },
    { "tipo": "seccion", "titulo": "Paso a paso" },
    { "tipo": "pasos", "items": ["Desconectá el USB.", "Poné los tres LEDs en la protoboard.", "Conectá cada resistencia a GND.", "Cableá cada LED a su pin, según la tabla.", "Revisá todo y recién ahí conectá el USB."] },
    { "tipo": "aviso", "severidad": "ok", "texto": "Si quedó bien, con el programa del semáforo cargado cada LED se prende en su turno." },
    { "tipo": "plegable", "titulo": "Si un LED no prende", "items": ["Mirá la polaridad: pata larga al pin.", "Fijate que la resistencia llegue a GND."] }
  ]
}
```

Sin `abrir`: la tool la guarda y te devuelve la ruta. Contá qué quedó y ofrecé
abrirla; con el sí, la misma llamada con `"abrir": true`.

## Después de llamarla

- **«Armé la página» sólo si la tool devolvió la ruta.** Pasale esa ruta al
  docente.
- **Si rechazó algo**, te dice qué bloque y qué corregir: contale al docente
  en una línea qué pasó, corregilo y volvé a llamar.
- **Nunca digas que está «abierta».** Con `abrir: true` lo más que sabe la tool
  es que le pidió al navegador que la abra.
- Para imprimir o pasar a PDF, la página tiene su botón «Imprimir / PDF».
