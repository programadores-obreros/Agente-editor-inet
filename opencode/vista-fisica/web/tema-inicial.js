// Tema inicial de la ventana, ANTES del primer pintado (rediseño del 2026-11-26).
//
// Script CLÁSICO a propósito (no módulo): va en el <head> y corre antes de que la página se pinte,
// para que quien eligió el tema oscuro no vea un destello en claro en cada carga. No puede ir
// escrito en la página: la política de seguridad (`script-src 'self'`) prohíbe los scripts en
// línea, y no se relajó.
//
// La regla es LA MISMA que `temaInicial` de `tema.js` (la preferencia guardada si es válida; si
// no, la del sistema). Está repetida porque un script clásico no puede importar un módulo; que
// las dos digan lo mismo lo prueba `tests/ventana-tema.test.mjs`, que ejecuta este archivo en
// todas las combinaciones y lo compara con la función.
//
// Límite conocido (explicado en `tema.js`): la preferencia no se recuerda entre sesiones de
// Tecnia Bot, porque el servidor abre en un puerto distinto cada vez.
;(function () {
  var guardado = null
  try {
    guardado = localStorage.getItem("tecnia-tema")
  } catch (error) {
    /* sin almacenamiento: manda el sistema */
  }
  var sistemaOscuro = false
  try {
    sistemaOscuro = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches === true
  } catch (error) {
    /* sin matchMedia: claro */
  }
  var tema = guardado === "dark" || guardado === "light" ? guardado : sistemaOscuro ? "dark" : "light"
  if (tema === "dark") document.documentElement.setAttribute("data-theme", "dark")
})()
