# Tecnia Bot en una Chromebook — guía de prueba

> ⚠️ **Esto es una prueba, no una instalación soportada.** Nadie corrió Tecnia Bot en una
> Chromebook todavía — ni nosotros. Cada pieza está verificada por separado, la cadena
> completa no. Si lo probás, **contanos qué pasó** en el
> [issue #16](https://github.com/programadores-obreros/Agente-editor-inet/issues/16):
> sos la primera persona en hacerlo.

En una Chromebook, Linux no corre sobre el hardware: corre adentro de una máquina virtual.
Eso agrega tres cosas que pueden fallar y que **no dependen de vos**. Por eso esta guía
arranca chequeando, no instalando.

---

## Antes de instalar nada: los tres chequeos

Copiá este bloque entero, pegalo en la terminal de Linux de tu Chromebook y apretá Enter.
**No instala nada** — solo mira y cuenta.

```bash
echo "── 1. Sistema ──"
uname -m                                  # x86_64 o aarch64
cat /etc/os-release 2>/dev/null | head -2

echo "── 2. Disco libre ──"
df -h ~ | tail -1

echo "── 3. Python ──"
python3 --version 2>&1 || echo "FALTA python3"

echo "── 4. La placa ──"
lsusb 2>/dev/null || echo "lsusb no está: sudo apt install usbutils"
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "NINGUNA placa visible"

echo "── 5. ModemManager (el ladrón de puertos) ──"
systemctl is-active ModemManager 2>/dev/null || echo "no está (mejor)"
```

**Pegá la salida completa en el issue #16.** Con eso sabemos si tu Chromebook sirve, y de
paso ayudás a las escuelas que vengan después.

### Qué mirar en esa salida

| Si ves… | Significa |
|---|---|
| `x86_64` o `aarch64` | Las dos andan. OpenCode y PlatformIO tienen binarios para ambas |
| Menos de **3 GB libres** | No va a entrar el toolchain. Ampliá el disco de Linux desde Configuración |
| `FALTA python3` | `sudo apt install python3` |
| **`NINGUNA placa visible`** con la placa enchufada | Es el problema grande — seguí leyendo |
| `ModemManager` activo | Te va a robar el puerto serie al cargar. `sudo systemctl stop ModemManager` |

---

## El problema grande: que la placa no aparezca

Antes de que Linux vea tu Arduino, **ChromeOS tiene que prestárselo**:

**Configuración → Acerca de ChromeOS → Desarrolladores → Linux → Preferencias de USB**

Ahí tenés que ver tu placa y activarla. Si **no aparece en esa lista**, hay dos motivos
posibles y ninguno se arregla desde la terminal:

### Motivo 1 — el administrador de la escuela deshabilitó Linux

Si ni siquiera existe la opción "Entorno de desarrollo de Linux" en Configuración, tu
Chromebook está administrada y el administrador la bloqueó. **No hay forma de activarla
desde el equipo.** Hay que pedírselo a quien administra el dominio de Google de la escuela.

### Motivo 2 — ChromeOS no reconoce el chip USB de tu placa

ChromeOS tiene una **lista blanca de chips USB** que deja pasar. Si el de tu placa no está,
no aparece y no hay workaround.

| Tu placa usa… | ¿Pasa? |
|---|---|
| **Arduino oficial** (UNO, Mega, Nano originales) | ✅ Sí, todos |
| Clon con **CP2102** | ✅ Sí |
| Clon con **CH9102** | ✅ Sí |
| Clon con **FT232R** | ✅ Sí |
| **Clon con CH340** (el más común y barato) | ❌ **Probablemente no** |
| **ESP32-S3 / C3 con USB nativo** | ❌ Probablemente no |

Para saber cuál tenés, enchufala a **cualquier PC con Linux** y corré `lsusb`. El número
que sale (`1a86:7523`, `10c4:ea60`, `2341:0043`…) te lo dice.

> **Digo "probablemente" a propósito.** Hay Chromebooks nuevas que dejan pasar cualquier
> dispositivo externo sin mirar la lista. Depende del modelo, no de la placa. La única
> forma de saberlo es enchufar y mirar.

**Si vas a comprar placas para usar con Chromebooks: comprá Arduino oficial, o cualquiera
con CP2102.** Te ahorrás el problema entero.

---

## Si los chequeos dieron bien: instalar

Es la **misma instalación de Linux**, sin nada especial:

```bash
git clone https://github.com/programadores-obreros/Agente-editor-inet.git tecnia-bot
cd tecnia-bot
bash install/install.sh
```

Y después, el permiso del puerto serie:

```bash
sudo usermod -a -G dialout $USER
```

**Cerrá la ventana de Linux y volvé a abrirla** para que tome efecto.

---

## El fastidio que no se arregla

**El permiso del USB no es persistente.** Cada vez que desenchufás y volvés a enchufar la
placa, hay que volver a compartirla desde *Preferencias de USB*.

Y hay algo peor: al cargar un programa, la placa se reinicia sola, y algunas **se vuelven a
presentar como un dispositivo USB nuevo**. Ahí el permiso se pierde a mitad de la carga.

Si la carga falla de manera intermitente y sin patrón, es esto. No es tu código.

---

## ¿Y si mi Chromebook no da?

**Podés enseñar Arduino igual.** Que no corra Tecnia Bot no te deja sin clase:

- **Educablocks**, la plataforma de Educabot, es web: abre en el navegador de la Chromebook.
- **Arduino Cloud Editor** también corre en el navegador.
- Las **17 fichas de Tecnia Lab** se imprimen desde cualquier navegador, sin instalar nada.

Lo que aporta Tecnia Bot es el acompañamiento en español, la traducción de los errores y el
paso a paso — no la capacidad de programar un Arduino, que ya existe por otros caminos.

---

## Contanos cómo te fue

Funcione o no, **el resultado sirve**. Pegá en el
[issue #16](https://github.com/programadores-obreros/Agente-editor-inet/issues/16):

- La salida del bloque de chequeo
- El modelo de tu Chromebook
- Si la placa apareció en *Preferencias de USB*
- Si llegaste a cargar un programa

Con eso pasamos de "debería andar" a "anda", que no es lo mismo.
