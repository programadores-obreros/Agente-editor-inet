// Copia de `comoUrl` de opencode/tool/ficha.ts, para poder probar su
// comportamiento sin cargar el plugin de OpenCode. Si cambia allá, cambia acá:
// el test de urls.test.mjs verifica que la función exista en los cuatro tools,
// y éste verifica que el algoritmo sea el correcto.
export function comoUrl(archivo) {
  const barras = archivo.replace(/\\/g, "/")
  return "file://" + (barras.startsWith("/") ? "" : "/") + encodeURI(barras).replace(/#/g, "%23")
}
