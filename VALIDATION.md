# Evidencia de validación

## Preparación del repositorio y guía de instalación: 17 de octubre de 2026

Se añadió `INSTALLATION.md` con macOS Apple Silicon, Windows 11 x64 y Ubuntu 24.04 x86_64; distingue la prueba ligera PLY de la reconstrucción completa. Los nombres de paquetes oficiales y sus archivos Windows se inspeccionaron sin ejecutarlos. Se revisaron las opciones de CMake y la documentación de COLMAP en la etiqueta 4.2.0. Pasaron las comprobaciones de sintaxis Bash de 15 bloques del documento y los enlaces relativos; los 6 bloques PowerShell se revisaron manualmente (PowerShell no está instalado en este Mac).

Se probó una copia limpia temporal que contenía solo los fuentes, scripts, tests y manifests, sin `node_modules`, `.tools` ni `data` del desarrollador: `npm ci`, `npm run check` y `node --test test/core.test.mjs test/http.test.mjs` PASS, 21/21 y cero omitidas. Esa prueba sigue siendo macOS, no una instalación completa de las herramientas ni una prueba Windows/Linux. Se preparó una matriz GitHub Actions para los tres sistemas, pero GitHub rechazó la primera subida porque la credencial OAuth no tiene el scope `workflow`. Se conserva como `docs/ci/check.yml.example`, para activación posterior por el propietario. CI no está activa y no hay resultados remotos de esa matriz.

La licencia del código propio se declara MIT. Las carpetas de capturas, herramientas, dependencias instaladas y evidencias locales siguen excluidas de Git. No se distribuye el dataset ni los binarios del equipo del desarrollador.

## Compatibilidad con Origin opaco y diagnóstico de acceso

El usuario confirmó que el cambio de Referrer-Policy no resolvió el acceso en el teléfono. Por lo tanto no se presenta esa configuración como causa raíz confirmada del dispositivo. Se agregó una verificación de formulario independiente de Origin para la conexión: token aleatorio con firma HMAC del servidor, caducidad de diez minutos y cookie HttpOnly coincidente, además del código y límite de intentos existentes. Un POST de conexión con Origin null solo se acepta si cumple todas esas verificaciones; otros orígenes explícitos siguen rechazados. Las lecturas GET/HEAD no se rechazan por Origin, ya que una redirección puede conservarlo opaco; siguen requiriendo sesión donde corresponde y no se conceden permisos CORS. Las escrituras de captura conservan la validación de origen anterior.

Se registran en la consola eventos de conexión, origen recibido normalizado y origen esperado, sin URL completa, códigos, tokens, cuerpos ni cookies. Son diagnóstico de acceso intencional; no se agregó almacenamiento de logs. `npm run check` PASS y `npm test` PASS 21/21. La nueva cobertura incluye Origin null con formulario válido, token ausente/manipulado, cookie ausente, firma falsa aunque coincida la cookie, código incorrecto, redirección con Origin null, y rechazo de escrituras y de orígenes ajenos. Sigue pendiente observar el intento del teléfono real en esta versión.

## Rechazo de origen en el formulario del iPhone: 17 de octubre de 2026

La captura del teléfono mostró `Origen no permitido` después del cambio de acceso. Se verificó que todas las respuestas enviaban `Referrer-Policy: no-referrer`, una política que transforma el Origin de los POST de formulario en `null` según el [estándar Fetch](https://fetch.spec.whatwg.org/#append-a-request-origin-header) y la [documentación de Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header). La validación del servidor rechazaba ese valor. No se capturaron los encabezados de la petición concreta del teléfono: la política es una causa reproducible y compatible con el síntoma.

Se cambió la política a `same-origin`, que conserva el Origin en formularios del mismo sitio y no envía Referer a otros sitios. Se mantienen los rechazos de Origin ajeno y `null`; no se agregó una excepción de acceso. La nueva prueba falló antes del cambio de política y pasó después. Incluye POST con Origin correcto, rechazo con Origin null/ajeno sin emitir cookie y verificación del encabezado servido. No sustituye una prueba de navegación real del iPhone: el control de navegador local está deshabilitado en esta sesión.

## Acceso desde celular: corrección del 17 de octubre de 2026

El usuario reportó que el enlace Wi-Fi seguía mostrando el error JSON de acceso. La reproducción por HTTP desde el Mac con el enlace y cookie funcionaba; no se pudo determinar si en el celular se usaba un enlace caducado o si se perdía la cookie en la navegación. Se agregó una entrada con código visible únicamente desde loopback y un formulario al abrir la IP local. Los enlaces caducados muestran ese formulario. La cookie usa SameSite=Lax para navegación desde otras apps; se mantiene la validación de Origin y la protección de APIs. Hay límite global de diez códigos fallidos por minuto.

`npm run check` PASS; `npm test` PASS 19/19, sin pruebas omitidas. Las pruebas nuevas usan una interfaz IPv4 real del Mac para comprobar formulario sin sesión, código correcto/incorrecto, cookie, acceso autenticado a recorridos, no exposición remota del código, enlace anterior, enlace caducado, límite de intentos y origen ajeno. La aceptación en Safari/Chrome del celular físico queda pendiente del usuario.

Comprobaciones realizadas el 7 de octubre de 2026 (America/Santiago). MVP local, macOS Apple Silicon. No se publicó en internet ni se hicieron commits.

## Código y contratos

- `npm run check`: PASS. Verificación de sintaxis de servidor, procesamiento, almacenamiento, cámaras e interfaz.
- `npm test`: PASS, 17/17 pruebas. Persistencia, recuperación, concurrencia de cola, cancelación de procesos reales, errores de subprocess, conversión/nivelación de cámaras, validación PLY, video fuera de duración, rechazo de reconstrucciones incompletas, cargas HTTP, origen, rangos de descarga, archivos privados y reintento preservando originales.
- Los workers simulados en los tests HTTP comprueban los contratos de la web; **no prueban reconstrucción ni render**. La ejecución real está descrita por separado abajo.
- Dependencias npm fijadas: SplatTransform 3.10.0, SuperSplat Viewer 1.37.0. Node 22.15.0. FFmpeg 9.0.2, COLMAP 4.2.0, Brush 0.3.0; checksum del binario oficial verificado durante instalación. Las operaciones pesadas ejecutan binarios con argumentos separados, sin shell.

## Captura de referencia

Se usaron las primeras 24 fotografías del dataset público [South Building de COLMAP](https://github.com/colmap/colmap/releases/download/3.11.1/south-building.zip), P1180141.JPG–P1180164.JPG. Procedencia y archivos originales en `artifacts/reference/provenance.json` e `artifacts/reference/images/` (ignorados por Git). Se creó un MP4 de 12 segundos a 2 imágenes/s y 800 px; `artifacts/reference/capture.mp4`, 5,560,050 bytes.

Es una secuencia de fotografías de un exterior convertida a video para comprobar la integración. **No es un video de celular, una casa completa ni evidencia de calidad comercial.**

La primera ejecución real completó FFmpeg → COLMAP → Brush (3000 pasos) → SOG, conectando 24/24 imágenes. Duró 45 s y produjo un SOG de 224,747 bytes. La revisión visual encontró inclinación y una vista inicial oscura: COLMAP no fija una vertical y el visor iniciaba movimiento automático. Se añadió nivelación común de escena/cámaras y se abren las vistas desde la interfaz con `?noanim`. El borrador de 3000 pasos tiene detalle limitado.

## Ejecución y visor reales

| Caso | Resultado observado |
| --- | --- |
| Video, perfil Más detalle | PASS de integración: 24/24 imágenes, 10000 pasos, 8 vistas. Job `457cceca-2a5e-4a2c-b0a4-25a781569f69`. Procesamiento inicial completo: 170.6 s. |
| Nivelación | Se comprobó en el código instalado que SplatTransform aplica rotaciones en espacio PlayCanvas. Se corrigió el signo del giro X y se repitió la compresión y generación de vistas sobre el PLY entrenado; no fue necesario volver a entrenar. |
| Render final | PASS: modelo del edificio visible en el visor real y cambio de Vista 1 a Vista 2 desde los controles. Sin errores/advertencias en la consola capturada del navegador. Conserva bordes incompletos y detalle limitado; es un borrador. |
| Importación PLY | PASS de carga/conversión: archivo real de Brush, 2,252,989 bytes, 9540 splats. Subido desde el selector de archivos y formulario de la web; completó en 0.8 s. La vista general de ese PLY de borrador tiene puntos dispersos y encuadre deficiente: necesita limpieza para presentar el resultado. |
| Layout móvil | PASS de layout a 390 × 844: ancho del documento 390 px, sin desborde horizontal; no equivale a probar hardware móvil. |

Capturas de evidencia: `artifacts/qa/desktop.jpg` y `artifacts/qa/mobile.jpg`. Los dos casos iniciales se conservaron en `artifacts/reference/previous-cases/`, fuera del historial principal; no contienen capturas del usuario. La demo visible es el resultado de Más detalle.

Archivo final: `data/jobs/457cceca-2a5e-4a2c-b0a4-25a781569f69/output/scene.sog`, 2,275,097 bytes. SHA-256: `0bb456489435882a4f0dfc9bed181a6663732173b683a87c35aa49daa3fac1c7`.

## Lo que requiere una captura propia

- Grabar una habitación de 30–90 segundos, con desplazamiento, buena luz y mucho solapamiento. Comparar el resultado con la habitación antes de usarlo con clientes.
- Captura nativa, teclado, gestos y render en Android Chrome e iOS Safari físicos. Se revisó el layout del navegador a 390 × 844 y en escritorio; eso no prueba compatibilidad con un teléfono real.
- Puertas, paredes lisas, espejos, movimiento, habitaciones conectadas y zonas que no se capturaron. No se implementó unión de escaneos independientes.
- Los puntos de vista no incorporan colisiones ni medidas métricas verificadas. El enlace actual solo funciona con el servidor local, o en la red local si se activa explícitamente el modo LAN.
- La importación soporta Gaussian Splat PLY binario little-endian sin compresión, hasta 2 millones de puntos. No soporta mallas, PLY comprimido, SPZ o SOG como entrada en este MVP. El SOG se ofrece como descarga.

## Sobre la guía recibida

Se verificó el editor [SuperSplat abierto/MIT](https://github.com/playcanvas/supersplat) y la [distinción oficial entre Scaniverse Classic y New Scaniverse](https://www.nianticspatial.com/pricing). El procesamiento Classic en el dispositivo no necesita contratar los planes nuevos; la documentación de New Scaniverse exige Pro/Enterprise para derechos comerciales y reventa. No se comprobaron aquí los términos comerciales específicos de Classic ni las cifras de ingresos/costos atribuidas al creador del video. La ruta de video del MVP usa procesamiento propio.
