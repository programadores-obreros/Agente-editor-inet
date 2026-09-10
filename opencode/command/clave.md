---
description: Ver, probar o cambiar la key de Google de esta computadora (o seguir sin key, con el modelo gratuito)
---

Ejecutá el tool `clave` con `accion: "estado"`. Sin preguntar antes: el docente ya
pidió ver su key al escribir `/clave`.

El tool lee las credenciales de esta compu, **prueba la key contra Google** y
devuelve uno de cuatro resultados: anda, cuota agotada, no sirve, o no se pudo
probar.

## NUNCA repitas la key en el chat

Ni entera, ni un pedazo, ni las últimas letras, ni su longitud. **Ni cuando te la
acaban de pegar** (no la confirmes repitiéndola: decí "ya la tengo"), ni cuando
pidas que te la peguen de nuevo, ni en un ejemplo, ni para mostrar qué formato
tiene.

Esta conversación se copia y se pega: en un mail al referente técnico, en el
WhatsApp del grupo, en una foto de la pantalla del aula. Una key que aparece en el
chat es una key filtrada. Es la misma regla que ya cumple el reporte de
«Diagnostico de Tecnia Bot», que informa si `auth.json` existe y si parsea, y
jamás su contenido.

El tool tampoco la imprime. Si alguna vez ves la key en la respuesta del tool, es
un bug: no la repitas y avisá que hay que reportarlo.

## Cuando la cuota está agotada

Es el caso más común y el más frustrante, así que contalo completo y con calma:

- **No rompió nada.** La key sigue siendo suya, el bot está entero, el trabajo
  está donde estaba. Google regala una cantidad de mensajes por día y se terminó.
- **Esperar** sirve: el límite gratuito se renueva solo.
- Si va a poner otra key, tiene que ser de **otro proyecto** de Google. La cuota
  gratuita es **por proyecto, no por key**: una key nueva del mismo proyecto
  comparte el mismo límite y va a dar exactamente el mismo error. Esto casi nadie
  lo sabe, y es lo que hizo que en una escuela probaran tres keys distintas
  creyendo que el problema era otro.
- **Puede seguir sin key**, con Big Pickle, el modelo gratuito de OpenCode. Si
  elige eso, ejecutá `clave` con `accion: "quitar"`. Avisale lo mismo que avisa el
  instalador: es gratis por tiempo limitado, y mientras dure esa etapa OpenCode
  puede usar lo que se escribe en el chat para mejorar el modelo — así que nada de
  datos personales ni nombres de alumnos.

## Cuando te pegan una key nueva

Ejecutá `clave` con `accion: "guardar"` y la key en el parámetro `clave`. El tool
la prueba ANTES de guardarla: si no anda, no toca nada.

Avisale que después tiene que **cerrar y volver a abrir Tecnia Bot**. La key nueva
no entra en la sesión que ya está abierta.

## Contá lo que dice el tool, no lo que suponés

**«No pude probarla» NO es «anda».** Si el tool dice que no pudo verificar —sin
internet, timeout, el filtro de la escuela bloqueando a Google—, decí exactamente
eso: que no se pudo probar y que no se guardó nada. No lo redondees a «quedó
configurada» ni a «debería andar».

Esto no es una precaución teórica: es el defecto que este comando vino a arreglar.
El instalador imprimía «Modelo configurado: Gemini, con tu key de Google» sin
haberle preguntado nunca a Google — con una key falsa decía exactamente lo mismo—.
La docente leía que estaba todo listo y se enteraba de que no en el primer mensaje,
con un error en inglés que no explica nada.

Un OK falso es peor que un error: manda a buscar el problema al lugar equivocado.
Nunca digas que la key quedó guardada, ni que anda, si el tool no lo dijo.
