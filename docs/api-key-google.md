# API key de Google (Gemini) 🔑

**La API key de Google es opcional.** Tecnia Bot funciona con dos modelos de lenguaje, y el instalador elige uno según tengas o no una key guardada:

| | Sin API key | Con API key de Google |
| --- | --- | --- |
| **Modelo** | **Big Pickle** (`opencode/big-pickle`), el modelo gratuito de OpenCode | **Gemini 3.5 Flash-Lite** (`google/gemini-3.5-flash-lite`), vía la free tier de Google AI Studio |
| **Qué hay que hacer** | Nada: apretá Enter cuando el instalador pregunte | Conseguir la key (2 minutos, gratis, sin tarjeta) y pegarla |
| **Costo** | Gratis **por tiempo limitado**: OpenCode lo ofrece así mientras dure esa etapa, y puede cambiarlo | Gratis dentro de la cuota de Google (de sobra para un aula) |
| **Privacidad** | ⚠️ Mientras Big Pickle sea gratis, **OpenCode puede usar lo que se escribe en el chat para mejorar el modelo**. No pongas datos personales (ni nombres de alumnos) en la conversación | Lo que se escribe va a Google bajo los términos de la API de Gemini; la key identifica tu cuenta, no a los alumnos |
| **Cuota** | Compartida por todos los usuarios de OpenCode; puede haber demoras en horas pico | Propia de tu key: lo que hagan otras escuelas no te afecta |

Big Pickle sirve para empezar sin ningún trámite. Si el aula va a usar Tecnia Bot seguido, conviene la key de Google: cuota propia, y sin la cláusula de "puede usarse para mejorar el modelo".

> La key **no es lo mismo que tu contraseña de Gmail**. Es un código que generás una vez, específico para esto, y que podés borrar cuando quieras sin afectar tu cuenta de Google.

---

## Conseguir la tuya (2 minutos, gratis)

1. Entrá a **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** con cualquier cuenta de Google (personal o de la escuela).
2. Tocá **"Create API key"** (o "Crear clave de API").
3. Elegí **"Create key in new project"** si te lo pregunta — así queda con su propia cuota, sin compartir nada con nadie más.
4. Copiá el código que te muestra (empieza distinto según el caso, pero siempre es una tira larga de letras y números).

Eso es todo. No hace falta tarjeta, no hay período de prueba que se corte: es gratis mientras te quedes dentro de los límites normales de uso (de sobra para un aula).

---

## Ponerla en Tecnia Bot

### Si estás instalando por primera vez

El instalador (`.exe`, `install.ps1` o `install.sh`) te la pide solo:

```
==> API key de Google (OPCIONAL). Con una key gratis (sin tarjeta) Tecnia Bot usa Gemini.
    Sacala en: https://aistudio.google.com/apikey (1 minuto, con cualquier cuenta de Google)
    Se guarda en ESTA compu, nunca se comparte ni sube a ningun lado.
    Pegala aca, o Enter para seguir sin key: Tecnia Bot va a usar el modelo gratuito Big Pickle de OpenCode [60s]:
```

- **Pegala** y seguí: se guarda en tu compu, no se vuelve a pedir en las próximas actualizaciones, y el agente queda en Gemini.
- **Enter** (o 60 segundos sin responder): el agente queda en Big Pickle. No se guarda ninguna key.

En los dos casos el instalador te dice al final con qué modelo quedó:

```
==> Modelo configurado: opencode/big-pickle (Big Pickle, el modelo gratuito de OpenCode).
    Es gratis por tiempo limitado y no pide cuenta. OJO: mientras dure la etapa gratuita,
    OpenCode puede usar lo que se escribe en el chat para mejorar el modelo.
```

### Cambiar de modelo después

El instalador **re-evalúa la decisión cada vez que corre** (instalación, "Reparar Tecnia Bot", `/actualizar`): si encuentra una key de Google guardada usa Gemini; si no, Big Pickle.

- **Pasar de Big Pickle a Gemini**: conseguí la key y
  - **Windows**: Menú inicio → **"Reparar Tecnia Bot"**. Te la pide y la aplica en el acto.
  - **Linux/macOS**: `bash install/install.sh` (o `bash install/bootstrap.sh`).
  - También podés pegarla con `/connect` dentro de OpenCode (elegí **Google**). `/connect` sólo **guarda** la key: el cambio de modelo se aplica en la próxima corrida del instalador (`/actualizar` o Reparar).
- **Volver a Big Pickle**: quitá la entrada `google` de `auth.json` (ruta más abajo) y volvé a correr el instalador.

---

## Si algo no anda

| Síntoma | Qué pasa | Solución |
| --- | --- | --- |
| **"Invalid API key"** | La key guardada no es válida: se pegó mal, o Google la desactivó | Conseguí una key nueva (pasos de arriba), ponela con `/connect` (pisa la anterior) y corré Reparar / `/actualizar` |
| **"Agent tecnia-bot's configured model ... is not valid"** | El agente apunta a Gemini pero no hay key de Google (o al revés: la config quedó de una versión anterior) | Corré **"Reparar Tecnia Bot"** (menú inicio) o `bash install/install.sh`: vuelve a elegir el modelo según la key que haya. `/diagnostico` te muestra qué modelo está configurado y si hay key |
| El instalador **nunca te pidió la key** | Ya había una guardada de una instalación anterior (aunque esté rota, el instalador no lo sabe, así que no vuelve a preguntar) | Usá `/connect` para poner la tuya y corré Reparar / `/actualizar` |
| El instalador dice **"Se quitó la key de respaldo compartida que traían las versiones anteriores"** | Tu instalación venía de la v0.3.75 o anterior, con la key compartida que ya fue rotada (inválida). El instalador la reconoce por su huella (SHA-256) y la saca de `auth.json` y de la variable de entorno, sin tocar otras credenciales | Nada que hacer: el agente queda en Big Pickle. Si querés Gemini, conseguí tu propia key. Si la pegás desde un apunte viejo, el instalador también la rechaza |
| **"429 Too Many Requests"** o el bot tarda mucho en responder | Se llegó al límite de uso por minuto (de tu key de Google, o de la cuota compartida de Big Pickle) | Esperá un minuto y probá de nuevo — se destraba solo. Si pasa seguido con Big Pickle, pasá a una key de Google propia; si pasa con tu key, cada persona/aula debería tener la suya en vez de compartir una |
| No tenés ganas de generar una key ahora | — | Apretá Enter cuando el instalador te la pida: Tecnia Bot usa Big Pickle (leé la nota de privacidad de arriba). Podés agregar tu key después cuando quieras |

---

## Por qué cada persona/escuela necesita la suya (y no alcanza con una sola para todos)

La cuota gratis de Google (cuántos mensajes por minuto/día podés mandar) está atada al **proyecto** detrás de tu key, no al hardware ni a la persona. Si muchas personas usan la **misma** key, todas comparten la **misma** cuota — y con un aula activa, se agota rápido para todos al mismo tiempo, sin aviso previo.

Con tu propia key (gratis, 2 minutos, cero tarjeta), tenés tu cuota aislada: lo que hagan otras escuelas no te afecta a vos, y viceversa.

---

## Cómo funciona por dentro

*(para quien quiera contribuir — esto es open source)*

**La key** se guarda en el archivo de credenciales de OpenCode (`~/.local/share/opencode/auth.json` en Linux/macOS, `%USERPROFILE%\.local\share\opencode\auth.json` en Windows), con este formato:

```json
{
  "google": { "type": "api", "key": "TU_KEY_ACA" }
}
```

**El modelo** lo escribe el instalador como override del agente en la config de OpenCode (`~/.config/opencode/opencode.json`, o `.jsonc` si ya existía), sin tocar el resto de tu config:

```json
{
  "agent": { "tecnia-bot": { "model": "opencode/big-pickle" } }
}
```

Con key de Google el valor es `google/gemini-3.5-flash-lite`. **Ésa es la única fuente del modelo**: el frontmatter del agente (`opencode/agent/tecnia-bot.md`) **no declara `model`**, a propósito. OpenCode arma la lista de agentes con `mergeDeep(config.agent, agentes .md)` (`config.ts`), es decir que los `.md` se mezclan *encima* del JSON: un `model:` en el frontmatter siempre ganaría sobre `opencode.json` y Big Pickle nunca correría (se verificó en una VM: con el override escrito, el agente seguía en Gemini). Sin key ni cuenta, OpenCode expone el provider `opencode` sólo con sus modelos gratuitos y una credencial pública (`apiKey: "public"`): por eso Big Pickle no necesita login. Dos tests lo protegen: `tests/tecnia-bot-prompt.test.mjs` verifica que el frontmatter no tenga `model`, y `tests/modelo.test.mjs` que `install.ps1` e `install.sh` usen los mismos ids y que ningún `.md` de `opencode/agent/` declare modelo.

**Historia, para ser honestos**: hasta la **v0.3.75** el instalador traía una key de Google **embebida en el código** como fallback cuando nadie pegaba la suya (decisión registrada en el changelog de la 0.3.36, con el riesgo documentado). Esa key **se eliminó del código y se rotó** — ya no sirve, y ninguna key vive hoy en este repositorio; el mismo test lo verifica. Como las instalaciones existentes la tienen guardada en `auth.json` (y en Windows también en la variable de usuario `GOOGLE_GENERATIVE_AI_API_KEY`), el instalador la reconoce por su **SHA-256** (el hash sí está en el código; el literal no) y la quita de los dos lugares antes de decidir el modelo, preservando cualquier otra credencial del archivo. Si alguien la pega en el prompt, se rechaza por el mismo motivo. `diagnostico.ps1` también la detecta y manda a correr Reparar. La key que pegue el docente sólo la *piden y escriben* `install/install.ps1` e `install/install.sh` en `auth.json`, en su compu.
