# API key de Google (Gemini) 🔑

Tecnia Bot usa **Google Gemini** como modelo de lenguaje. Google te deja usarlo gratis (sin tarjeta), pero necesita saber quién sos — para eso hace falta una **API key**: un código que identifica tu cuenta, no una contraseña que escribís cada vez.

> No es lo mismo que tu contraseña de Gmail. Es un código que generás una vez, específico para esto, y que podés borrar cuando quieras sin afectar tu cuenta de Google.

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

El instalador (`.exe`, `install.ps1` o `install.sh`) te la pide solo, al final:

```
==> Tecnia Bot necesita una API key GRATIS de Google (sin tarjeta) para hablar con el modelo.
    Pegala aca (o Enter para hacerlo despues con /connect dentro de OpenCode) [60s]:
```

Pegala ahí y seguí. Se guarda en tu compu, no se vuelve a pedir en las próximas actualizaciones.

### Si Tecnia Bot ya está instalado y funcionando

Abrí OpenCode, escribí `/connect`, buscá **Google** en la lista, y pegá tu key cuando te la pida.

---

## Si algo no anda

| Síntoma | Qué pasa | Solución |
| --- | --- | --- |
| **"Invalid API key"** o **"Agent tecnia-bot's configured model ... is not valid"** | La key guardada no es válida — puede ser que nunca se puso una de verdad, o que la que había dejó de funcionar (por ejemplo, si venía de la key de respaldo del instalador y Google la desactivó) | Conseguí tu propia key (pasos de arriba) y ponela con `/connect` — pisa la que estaba antes, sin tocar nada más de tu instalación |
| El instalador **nunca te pidió la key** | Ya había una guardada de una instalación anterior (aunque esté rota, el instalador no lo sabe, así que no vuelve a preguntar) | Usá `/connect` para poner la tuya, como en el caso de arriba — no hace falta reinstalar nada |
| **"429 Too Many Requests"** o el bot tarda mucho en responder | Se llegó al límite de uso por minuto de tu key (normal si varias personas la usan a la vez, o con pedidos muy grandes) | Esperá un minuto y probá de nuevo — se destraba solo. Si pasa seguido, cada persona/aula debería tener su propia key en vez de compartir una |
| No tenés ganas de generar una key ahora | — | Apretá Enter cuando el instalador te la pida — vas a poder usar Tecnia Bot igual (con una key de respaldo compartida), y agregar la tuya después cuando quieras con `/connect` |

---

## Por qué cada persona/escuela necesita la suya (y no alcanza con una sola para todos)

La cuota gratis de Google (cuántos mensajes por minuto/día podés mandar) está atada al **proyecto** detrás de tu key, no al hardware ni a la persona. Si muchas personas usan la **misma** key, todas comparten la **misma** cuota — y con un aula activa, se agota rápido para todos al mismo tiempo, sin aviso previo.

Con tu propia key (gratis, 2 minutos, cero tarjeta), tenés tu cuota aislada: lo que hagan otras escuelas no te afecta a vos, y viceversa.

---

## Cómo funciona por dentro

*(para quien quiera contribuir — esto es open source)*

La key se guarda en el archivo de credenciales de OpenCode (`~/.local/share/opencode/auth.json` en Linux/macOS, `%USERPROFILE%\.local\share\opencode\auth.json` en Windows), con este formato:

```json
{
  "google": { "type": "api", "key": "TU_KEY_ACA" }
}
```

**Nunca** vive en este repositorio ni en ningún archivo versionado — el código de `install/install.ps1` e `install/install.sh` solo la *pide y escribe* ahí, en tu compu. El modelo usado (`google/gemini-flash-lite-latest`) está en `opencode/agent/tecnia-bot.md`.
