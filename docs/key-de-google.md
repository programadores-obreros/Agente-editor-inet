# La key de Google: por qué no se podía cambiar, y qué se hizo

> **Estado: resuelto.** Este documento cuenta un incidente del 8 de septiembre de
> 2026 y lo que se decidió a partir de él. Hasta hace poco seguía diciendo que el
> arreglo estaba "propuesto" y que `/clave` no existía; las cinco cosas que
> propone están implementadas, y cada una dice abajo dónde. **Si lo que necesitás
> es cambiar una key hoy, no hace falta leer la historia:**
>
> - **Windows:** menú inicio → **"Reparar Tecnia Bot"**. Si ya hay una key
>   guardada te ofrece cambiarla, y prueba la nueva contra Google antes de guardarla.
> - **Linux:** `bash install/install.sh`. Hace lo mismo.
> - **Con el bot andando:** `/clave`. Si el bot no contesta —que es lo que pasa
>   con una key muerta o sin cuota—, `/clave` tampoco: usá Reparar.
>
> La guía para docentes es [`api-key-google.md`](api-key-google.md).

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

*(Lo que sigue describe el instalador **hasta la v0.3.78**. Hoy la pregunta ya no
vive sólo en esa rama.)*

`install/install.ps1` decidía así si tenía que preguntar por la key:

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
| `/clave` | **Sí** (es nuestro) | Se propuso en este documento y hoy existe: `opencode/command/clave.md`, que usa el tool `opencode/tool/clave.ts`. Muestra el estado de la key, la prueba contra Google, la cambia o la quita. No es un comando de OpenCode: es de Tecnia Bot |

Los comandos propios de Tecnia Bot son archivos `.md` en `opencode/command/`, y
hoy son cinco: `actualizar`, `ayuda`, `clave`, `diagnostico`, `reparar`. **Todos en
español**: un comando nuevo tiene que seguir esa convención.

## Cómo se cambiaba la key con la v0.3.78 o anterior (workaround)

**Con una versión actual esto no hace falta**: "Reparar Tecnia Bot" ofrece
cambiar la key aunque ya haya una. Queda escrito para quien todavía tenga una
versión vieja instalada y no pueda actualizar.

Había que dejar `auth.json` sin el bloque `google` **antes** de reparar, para que
la rama que pregunta se ejecutara.

En PowerShell, en la compu del docente:

```powershell
$f = "$env:USERPROFILE\.local\share\opencode\auth.json"
$d = Get-Content $f -Raw | ConvertFrom-Json
$d.PSObject.Properties.Remove("google")
[System.IO.File]::WriteAllText($f, ($d | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
[Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", $null, "User")
(Get-Item $f).LastWriteTime
```

Después: "Reparar Tecnia Bot" (así sí preguntaba), pegar la key nueva, y **cerrar
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

## El arreglo que correspondía, y dónde quedó

Acá decía "nada de esto está implementado todavía". **Las cinco cosas están
implementadas**; debajo de cada una va dónde mirarla.

1. **Que se pueda cambiar la key aunque ya haya una.** *Hecho*: es el tercer
   camino de la pregunta en `install/install.ps1` e `install/install.sh` ("Ya hay
   una key de Google guardada en esta compu"). Enter, 60 segundos sin contestar o
   una consola sin nadie dejan la que estaba. El texto propuesto era:

   ```
   ==> Ya hay una key de Google guardada en esta compu.
       Enter para dejarla como está, o pegá una nueva para reemplazarla [60s]:
   ```

2. **Un comando `/clave` adentro del bot.** *Hecho*
   (`opencode/command/clave.md`, `opencode/tool/clave.ts`), con un límite que se
   descubrió después: a `/clave` lo atiende el mismo modelo cuya key puede estar
   muerta, así que para una key rechazada o sin cuota la salida que se ofrece es
   "Reparar Tecnia Bot" (ver [`donde-avisa-cada-cosa.md`](donde-avisa-cada-cosa.md)).
   La idea original: el docente que se queda sin cuota
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

3. **Validar la key antes de afirmar que quedó configurada.** *Hecho*: el
   instalador prueba contra Google la key que queda (la nueva o la de siempre) y
   distingue cinco resultados —anda, cuota agotada, rechazada, modelo retirado,
   no se pudo probar—, los mismos en `install.ps1`, `install.sh`,
   `chequear-clave.ps1` y `clave.ts`. "No pude probarla" nunca se cuenta como "anda".

4. **Que el bot traduzca el error de cuota.** *Hecho, pero no donde se pensaba*:
   el bot no puede explicar que su propio modelo no contesta. El aviso lo da el
   lanzador de Windows antes de abrir (`install/chequear-clave.ps1`) y el
   instalador al terminar. En Linux no hay lanzador: el aviso lo da sólo el
   instalador. Cuando se escribió esto, `Resource has been exhausted` no aparecía
   en ningún lado del repo y el docente veía el error crudo en inglés y no sabe si es culpa suya,
   si se arregla solo, ni qué hacer. Hay una salida que nadie le ofrece: sin key
   de Google, Tecnia Bot funciona con Big Pickle, el modelo gratuito de OpenCode.

5. **Verificar la escritura releyendo el archivo**, en vez de imprimir
   `[OK] Key guardada en esta compu.` y confiar. *Hecho*: los dos instaladores
   releen `auth.json` antes de decir que la guardaron, y si no la encuentran lo
   dicen y terminan "CON AVISOS".
