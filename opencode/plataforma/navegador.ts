// Navegador — con qué comando se abre el enlace del vínculo en el navegador por defecto.
//
// Acá sólo se ARMA el comando. Lanzarlo es cosa del tool (`opencode/tool/cuenta.ts`),
// que es quien tiene `Bun.spawn`. Está separado para poder probarlo bajo Node: lo
// que falló fue el armado, y eso no necesita abrir nada para verse.
//
// POR QUÉ EN WINDOWS NO SE USA `cmd /c start`:
// El enlace del vínculo lleva tres datos separados por `&`:
//   …/vincular-bot?challenge=…&port=…&state=…
// Hasta el 21/11/2026 se abría con `cmd /c start "" <enlace>`, como los demás tools
// del repo abren un archivo. Para cmd.exe un `&` separa comandos. Como el enlace no
// tiene espacios viajaba sin comillas, y cmd lo partía: `start` recibía sólo hasta
// `challenge=…` y lo demás (`port=…`, `state=…`) lo intentaba correr como comandos,
// que fallaban sin que nadie lo viera porque la salida se descarta.
// Resultado en una Windows 11 real: Edge abría el enlace cortado y la plataforma
// contestaba «El enlace está incompleto o no es válido». No se vinculaba nunca.
// En Linux y macOS no pasa (no hay un intérprete en el medio), y por eso la prueba
// contra producción hecha en Linux dio bien.
//
// `rundll32 url.dll,FileProtocolHandler` le pasa el enlace al mismo mecanismo de
// Windows que abre un enlace al hacerle clic, sin ningún intérprete de comandos en
// el medio: ningún carácter del enlace significa nada.
//
// Los otros tools siguen usando `cmd /c start` con rutas de archivos. Una carpeta
// con `&` en el nombre les haría lo mismo; no se tocó acá.

/**
 * El comando para abrir `url` en el navegador por defecto, o `null` si `url` no es
 * un enlace http(s) que se pueda abrir. Nunca devuelve un comando que pase por un
 * intérprete: el enlace va entero en un solo argumento.
 *
 * `raizWindows` es `%SystemRoot%`. Si está, se usa la ruta completa de rundll32
 * en vez de dejar que lo busque el PATH.
 */
export function comandoParaAbrir(plataforma: string, url: string, raizWindows?: string): string[] | null {
  let enlace: string
  try {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    // `href` y no el texto que llegó: sale sin espacios ni comillas, ya codificados.
    enlace = u.href
  } catch {
    return null
  }
  if (plataforma === "win32") {
    const rundll32 = raizWindows ? `${raizWindows.replace(/[\\/]+$/, "")}\\System32\\rundll32.exe` : "rundll32.exe"
    return [rundll32, "url.dll,FileProtocolHandler", enlace]
  }
  if (plataforma === "darwin") return ["open", enlace]
  return ["xdg-open", enlace]
}
