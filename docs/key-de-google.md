# La key de Google: por qué no se puede cambiar, y qué hacer

Este documento existe porque el 8 de septiembre de 2026, en una escuela, varias
docentes intentaron cambiar su key de Google —incluso con keys de otras cuentas—
y todas seguían recibiendo el mismo error de cuota agotada.

No era la cuota de las keys nuevas. **Las keys nuevas nunca entraron.**

## El síntoma

Adentro del bot, al primer mensaje:

```
AI_APICallError: Resource has been exhausted (e.g. check quota).
```

Se corre "Reparar Tecnia Bot" esperando poder pegar una key nueva. El instalador
termina bien y nunca la pide. Se prueba con la key de otra cuenta de Google:
mismo error.

## La causa

`install/install.ps1` decide así si tiene que preguntar por la key:

```powershell
$tieneGoogle = [bool](($authData.PSObject.Properties.Name -contains "google") -and $authData.google.key)
...
} elseif (-not $tieneGoogle) {     # <-- la pregunta vive SOLO adentro de esta rama
```

Y el comentario de más arriba lo dice con todas las letras:

> Es **idempotente**: si ya hay una key de "google" guardada (de esta instalacion
> o de un /connect manual), **no se pregunta de nuevo**.

O sea: **en una compu que ya tiene una key guardada, el instalador nunca ofrece
cambiarla.** No importa cuántas veces se corra "Reparar". La rama que pregunta no
se ejecuta.

La idempotencia se puso por una buena razón: no molestar al docente
preguntándole en cada actualización algo que ya contestó. Pero se convirtió en
una trampa sin salida justo para el caso en que hay que rotar la key, que es
exactamente el de una cuota agotada.

### Cómo se confirmó

Reproducido en la VM de Windows 10, con la copia maestra de la 0.3.78:

| Escenario | ¿El instalador pregunta por la key? |
|---|---|
| `auth.json` **con** una key de Google guardada | **NO** |
| `auth.json` **sin** key | SÍ |

Y en el escenario con key, `auth.json` **no se modifica**: la fecha de
modificación queda igual antes y después de correr el instalador.

Ese detalle es el que permite diagnosticarlo a distancia. En el reporte de
"Diagnostico de Tecnia Bot" de la máquina de la escuela, tomado el 8 de
septiembre después de reinstalar:

```
auth.json    OK
fecha        20/8/2026 10:17:21
```

Fecha del 20 de agosto: el día de la capacitación. **Ninguno de los intentos de
cambiar la key del 8 de septiembre tocó el archivo.**

> **Regla práctica:** para saber si una key nueva entró, mirar la FECHA de
> `auth.json`, no el mensaje del instalador. Si la fecha no cambió, no entró.

## Un segundo problema, encontrado en la misma prueba

Con la key literal `AIzaSyFALSA0000000000000000000000000000000`, el instalador
imprime:

```
==> Modelo configurado: google/gemini-3.5-flash-lite (Gemini, con tu key de Google).
```

**La key nunca se valida contra Google.** Una credencial muerta, vencida o con la
cuota agotada produce exactamente el mismo mensaje que una que funciona. El
docente lee que quedó todo configurado y se entera de que no en el primer
mensaje al bot, con un error en inglés que no explica nada.

Es el mismo defecto que el resto del repo persigue con nombre propio: afirmar
sobre algo que no se miró. Ver la regla en `opencode/command/reparar.md`
("Nunca digas que algo quedó instalado si el tool no lo dijo").

## Qué comandos existen de verdad

Verificado sobre el binario de **OpenCode 1.18.18**, que es la versión que fija
`install/OPENCODE_VERSION`:

| Comando | ¿Existe? | Qué es |
|---|---|---|
| `/connect` | **Sí** | El comando de OpenCode para credenciales de proveedores. Aparece en el binario como la vía para configurar tokens ("Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)") |
| `/auth` | **No** | Las apariciones de esa cadena en el binario son un MIME type (`application/auth-policy+xml`) y URLs de OAuth de Google. No es un comando |
| `/clave` | **No** | Propuesto en este documento. Sería nuestro |

Los comandos propios de Tecnia Bot son archivos `.md` en `opencode/command/`, y
hoy son cuatro: `actualizar`, `ayuda`, `diagnostico`, `reparar`. **Todos en
español**: un comando nuevo tiene que seguir esa convención.

## Cómo cambiar la key hoy (workaround, sin versión nueva)

Hay que dejar `auth.json` sin el bloque `google` **antes** de reparar, para que
la rama que pregunta se ejecute.

En PowerShell, en la compu del docente:

```powershell
$f = "$env:USERPROFILE\.local\share\opencode\auth.json"
$d = Get-Content $f -Raw | ConvertFrom-Json
$d.PSObject.Properties.Remove("google")
[System.IO.File]::WriteAllText($f, ($d | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
[Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $null, "User")
(Get-Item $f).LastWriteTime
```

Después: "Reparar Tecnia Bot" (ahora sí pregunta), pegar la key nueva, y **cerrar
y volver a abrir** Tecnia Bot.

El `UTF8Encoding $false` no es decorativo. `Set-Content -Encoding UTF8` en
PowerShell 5.1 escribe con BOM, OpenCode revienta al parsear `auth.json` y **se
traga el error sin avisar**: el bot abre perfecto y falla al primer mensaje. Está
documentado en `install/install.ps1`, en el comentario de la escritura de la key.

### Si la cuota vuelve a agotarse con una key nueva

En el tier gratuito de Google, **la cuota es por proyecto, no por key**. Dos keys
creadas en el mismo proyecto de Google Cloud comparten el límite. Para tener
cuota nueva hay que crear la key en otro proyecto, o con otra cuenta.

## Contexto: la key compartida de las versiones viejas

Hasta la v0.3.75, `install.ps1` traía **una key de Google fija embebida en el
script**, que se usaba cuando nadie pegaba la suya —incluyendo a quien apretaba
Enter o dejaba pasar los 60 segundos del timeout. Esa key se eliminó y se rotó.

El instalador la reconoce por su SHA-256 (`$HashKeyVieja`) y la quita de
`auth.json` y de la variable de usuario `GOOGLE_GENERATIVE_AI_API_KEY` antes de
decidir el modelo. Si el docente la pega de un apunte viejo, se rechaza.

Esto importa para las máquinas instaladas en la capacitación del 20 de agosto de
2026 (v0.3.69): **quien no pegó una key propia quedó con la compartida**, aunque
crea que puso la suya.

En la máquina de la escuela ese no fue el caso: la fecha de `auth.json` sin
cambios después de correr el instalador prueba que la purga no se disparó, así
que la key guardada es una key real de la docente, con su cuota agotada.

## El arreglo que corresponde

Nada de esto está implementado todavía.

1. **Que se pueda cambiar la key aunque ya haya una.** Sin volver a la fricción
   de preguntar siempre:

   ```
   ==> Ya hay una key de Google guardada en esta compu.
       Enter para dejarla como está, o pegá una nueva para reemplazarla [60s]:
   ```

2. **Un comando `/clave` adentro del bot.** El docente que se queda sin cuota
   está hablando con el bot en ese momento: que pueda pegar la key ahí, sin
   PowerShell ni menú inicio. Es la misma lección que dio origen a la acción
   `reparar` del tool `platformio`, cuando una docente contestó *"vos tenés
   platformio, hacelo"*.

   > **Por qué un comando y no la pregunta del instalador:** `/actualizar` y
   > `/reparar` lanzan los scripts con `Bun.spawn(..., { stdout: "pipe", stderr:
   > "pipe" })`. No hay consola real donde tipear. Cualquier pregunta que haga el
   > instalador por esa vía se le hace al vacío. La pregunta del punto 1 sirve
   > para quien corre el `.exe` o el acceso directo del menú inicio; para el
   > docente que está adentro del bot hace falta el punto 2.

3. **Validar la key antes de afirmar que quedó configurada.** Una llamada, dos
   segundos. Si no responde, decirlo.

4. **Que el bot traduzca el error de cuota.** Hoy `Resource has been exhausted`
   no aparece en ningún lado del repo: ni en los tools, ni en los comandos, ni en
   las skills. El docente ve el error crudo en inglés y no sabe si es culpa suya,
   si se arregla solo, ni qué hacer. Hay una salida que nadie le ofrece: sin key
   de Google, Tecnia Bot funciona con Big Pickle, el modelo gratuito de OpenCode.

5. **Verificar la escritura releyendo el archivo**, en vez de imprimir
   `[OK] Key guardada en esta compu.` y confiar.
