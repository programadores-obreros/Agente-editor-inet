---
name: errores-del-bot
description: Traduce al español los errores del PROPIO Tecnia Bot cuando deja de contestar — cuota de Google agotada ("Resource has been exhausted", RESOURCE_EXHAUSTED, quota, 429), key rechazada ("API key not valid", API_KEY_INVALID, 400/403), sin internet o el filtro de la escuela bloqueando a Google (timeout, fetch failed, ENOTFOUND), y el modelo que Google retiró (404, NOT_FOUND). No es de Arduino ni de compilación.
---

# Cuando el que falla es Tecnia Bot, no el código

Esta guía es para los errores del **bot**, no los de la placa. Se reconocen
porque aparecen cuando el docente manda un mensaje cualquiera y el bot **deja de
contestar**, o porque el texto dice `stream error`, `AI_APICallError`,
`providerID=google` — no `expected ';'` ni `avrdude`.

Para los errores de compilación y de carga a la placa está `errores-comunes`.
Esta skill es la otra mitad: los del proveedor del modelo.

## Lo primero, siempre: EJECUTÁ el tool `clave`

Apenas reconocés uno de estos errores, llamá al tool `clave` con
`accion: "estado"`. **En ese mismo turno, sin preguntar y sin esperar a que la
docente escriba `/clave`** — ella no tiene por qué saber que ese comando existe:
está viendo un error en inglés y quiere seguir dando clase.

El tool lee la key de esta computadora, **la prueba contra Google** y vuelve con
uno de cinco resultados: anda, cuota agotada, no sirve, no se pudo probar, o el
modelo ya no está. Ese resultado es el que manda.

**Contá lo que dice el tool, no lo que suponés.** Esta skill te sirve para
TRADUCIR y ACOMPAÑAR lo que el tool devolvió; nunca para afirmar en su lugar. En
particular:

- No digas que la key anda si el tool no lo dijo.
- **«No pude probarla» NO es «anda».** Si el tool dice que no pudo verificar,
  decí exactamente eso: que no se pudo probar y que no se guardó nada.
- No digas que la cuota se renovó, ni cuándo se renueva con hora exacta: no lo
  sabés y el tool tampoco.
- No digas que quedó arreglado hasta que el tool lo diga.

Un OK falso es peor que un error: manda a buscar el problema al lugar equivocado
y la docente se va tranquila con todo roto.

## NUNCA repitas la key en el chat

Ni entera, ni un pedazo, ni las últimas letras, ni su longitud, ni aunque te la
acaben de pegar. Esta conversación se copia y se pega en un mail o en el grupo de
WhatsApp de la escuela. El tool tampoco la imprime: si alguna vez la ves en su
respuesta, es un error del programa — no la repitas y avisá que hay que
reportarlo.

---

## 1. Se acabó la cuota gratuita de Google

**Qué se ve** (en el chat, o en `opencode.log`):

```
AI_APICallError: Resource has been exhausted (e.g. check quota).
level=ERROR message="stream error" providerID=google
```

También: `RESOURCE_EXHAUSTED`, `429`, `quota exceeded`.

**Qué significa, en criollo:** Google regala una cantidad de mensajes por día y
esa cantidad se terminó. Nada más que eso.

**Y esto va PRIMERO, antes que cualquier instrucción:** *no rompiste nada.* La
key sigue siendo suya, Tecnia Bot está entero, el trabajo está donde estaba, la
computadora está bien. Es lo primero que hay que decir, porque es lo primero que
la docente piensa que pasó.

### La trampa: la cuota es por PROYECTO, no por key

**Una key nueva creada adentro del MISMO proyecto de Google comparte el mismo
límite y va a dar exactamente el mismo error.** Esto casi nadie lo sabe, y es lo
que hizo que en una escuela probaran tres keys distintas una tras otra, perdiendo
la tarde, convencidas de que el problema era otro.

Decíselo antes de que salga a buscar una key nueva, no después. Para tener cuota
nueva, la key tiene que ser de **otro proyecto** de Google Cloud, o de **otra
cuenta** de Google.

### Las tres salidas

1. **Esperar.** El límite gratuito se renueva solo: mañana vuelve a haber cupo.
   Es la salida sin trabajo, y para una clase que ya terminó suele alcanzar.
2. **Una key de otro proyecto (o de otra cuenta).** Se saca gratis, con cualquier
   cuenta de Google y sin tarjeta, en https://aistudio.google.com/apikey. Cuando
   te la pegue, ejecutá `clave` con `accion: "guardar"` y la key en el parámetro
   `clave`: el tool la prueba ANTES de guardarla, así que si esa también está sin
   cuota, no toca nada y te lo dice.
3. **Seguir sin key, con Big Pickle**, el modelo gratuito de OpenCode. Si elige
   esto, ejecutá `clave` con `accion: "quitar"`. Avisale lo mismo que avisa el
   instalador: es gratis por tiempo limitado, y **mientras dure esa etapa
   gratuita OpenCode puede usar lo que se escribe en el chat para mejorar el
   modelo** — así que nada de datos personales ni nombres de alumnos en la
   conversación.

Después de guardar o quitar la key hay que **cerrar y volver a abrir Tecnia
Bot**: la sesión que ya está abierta no se entera del cambio.

---

## 2. Google rechazó la key: no sirve

**Qué se ve:**

```
API key not valid. Please pass a valid API key.
API_KEY_INVALID
```

También: `400 INVALID_ARGUMENT`, `403 PERMISSION_DENIED`, `UNAUTHENTICATED`.

**Qué significa:** la key que tiene guardada esta computadora no la reconoce
Google. Puede estar borrada del proyecto, vencida, o mal copiada — son largas y
al copiarlas se cortan con una facilidad increíble.

**Tampoco rompió nada:** es una credencial, no el programa.

**Un caso puntual que el tool detecta solo:** hasta la versión 0.3.75, Tecnia Bot
traía una **key de respaldo compartida** para quien no pegaba la suya. Esa key se
eliminó y se rotó, así que hoy está muerta en todas las computadoras que la
tengan guardada. Si el tool `clave` dice que la key guardada es esa, no es culpa
de la docente ni hay nada que arreglar en su cuenta: hace falta una key propia.

**Qué hacer:** sacar una key gratis en https://aistudio.google.com/apikey y
pegarla en el chat; vos la guardás con `clave` (`accion: "guardar"`). O seguir sin
key con Big Pickle (`clave` con `accion: "quitar"`), con el mismo aviso de
privacidad de arriba.

---

## 3. No se llega a Google: sin internet, o el filtro de la escuela

**Qué se ve:**

```
fetch failed
ETIMEDOUT / ENOTFOUND / TimeoutError
```

O el bot se queda «pensando» sin contestar nunca.

**Qué significa:** el pedido no llegó hasta Google. En una escuela esto casi
nunca es «se cayó internet»: es el **filtro de contenido** que bloquea el dominio
sin avisar que lo bloqueó — no da un error, da un silencio hasta que corta el
tiempo de espera.

**Cómo se distingue de los otros dos:** acá el tool `clave` contesta **«no pude
probarla»**, no «no sirve» ni «cuota agotada». Esa diferencia es toda la
información que hay: si no se pudo preguntar, no se sabe nada de la key.

**Qué hacer:**

- Probar de nuevo en un rato, o desde otra red (el teléfono compartiendo datos
  sirve para descartar el filtro en dos minutos).
- Si se repite, es tema del **referente técnico** de la escuela: hay que pedir que
  habiliten el acceso. El reporte de «Diagnostico de Tecnia Bot» del menú inicio
  deja por escrito a qué dominios llega esa máquina y a cuáles no, sin mostrar
  ninguna clave: eso es lo que hay que mandarle.
- Y para seguir trabajando ahora mismo: **casi todo Tecnia Bot no necesita
  Google**. Explicar, dibujar circuitos, repartir fichas, revisar un cableado —
  eso sigue andando. Decíselo, porque una docente a la que sólo le contás lo que
  se rompió cree que se rompió todo.

Ojo con no confundirse: si además falla la compilación, eso es otra cosa (el que
se baja de `pypi.org` es PlatformIO) y va por `/diagnostico` y `/reparar`.

---

## 4. El modelo ya no existe (y acá NO se mira la red)

**Qué se ve:**

```
404 NOT_FOUND
models/gemini-3.5-flash-lite is not found for API version v1beta
```

**Qué significa:** Google retiró o renombró el modelo que usa Tecnia Bot. **La
key puede estar perfecta.** Contestó Google, así que la red anda: fue una
respuesta, no un silencio.

**Lo que NO hay que decir acá, y es el error caro:** que revise internet, que
hable con el referente técnico por el filtro, o que pruebe con otra key. La red
funciona —Google contestó— y **ninguna key nueva lo arregla**: el que falta es el
modelo, no la credencial. Mandarla a pelearse con el proxy de la escuela por esto
es hacerle perder la tarde en el lugar equivocado.

**Qué hacer:** escribir `/actualizar` (o pedirlo, y lo ejecutás vos con el tool
`actualizar`), que trae una versión de Tecnia Bot apuntada a un modelo vigente.
Si después de actualizar sigue igual, hay que avisarle al referente técnico que
esto se reporta: es un problema del producto, no de su computadora.

Mientras tanto puede seguir trabajando con Big Pickle (`clave` con
`accion: "quitar"`), que no depende de Google.

---

## Cómo se lo contás

En este orden, siempre:

1. **Qué pasó**, en una línea y sin jerga.
2. **Que no rompió nada** — antes que cualquier instrucción.
3. **Las salidas**, con la que menos trabajo cuesta primero.
4. **Una pregunta concreta** para seguir: «¿te dejo el modelo gratuito así seguís
   ahora, o preferís esperar a mañana?». Dos opciones concretas, no «avisame».

Y el error en inglés, si se muestra, va **después** de la traducción y sólo si
sirve para algo. Nunca solo.
