# Recorrido · MVP web

Una web local para convertir un video de celular en un recorrido de Gaussian Splatting, o importar un escaneo PLY existente. Captura desde Android/iPhone o carga un archivo; el computador procesa con FFmpeg → COLMAP → Brush → SplatTransform. SuperSplat Viewer muestra la escena y hasta ocho puntos de vista de la captura. La web nivela la reconstrucción y sus cámaras usando la orientación media de la captura.

El producto se llama **Recorrido**, el paquete npm `recorrido-mvp` y el repositorio `ignaciofmh/playcanvas`. Utiliza el ecosistema PlayCanvas; este repositorio es un proyecto independiente, no una copia del motor oficial.

**Instalación:** consulta la [guía para macOS Apple Silicon, Windows 11 x64 y Ubuntu 24.04](INSTALLATION.md). Incluye una prueba ligera de importación PLY, configuración de binarios, acceso desde el celular y diagnóstico. La reconstrucción completa está probada en macOS; las rutas de Windows y Linux están documentadas y pendientes de ejecución en esos sistemas.

## Ejecutar

En este equipo las herramientas ya están instaladas:

```sh
npm start
```

Abre http://localhost:4173. El script encuentra Node.js 22+ instalado aunque el shell tenga Node 20 seleccionado.

Para reinstalar en otro Mac Apple Silicon:

```sh
nvm install 22
nvm use 22
npm install
npm run setup
npm start
```

Requisitos: Homebrew, Python 3, Node.js 22+ y GPU compatible con Brush. Versiones usadas: FFmpeg 9.0.2, COLMAP 4.2.0, Brush 0.3.0, SplatTransform 3.10.0, SuperSplat Viewer 1.37.0. Los paquetes npm están fijados en el lockfile; Homebrew instala su versión disponible. Las opciones de COLMAP en este MVP corresponden a la versión 4.2; una instalación distinta debe comprobarse antes de usarla.

## Usar desde el celular

```sh
npm run start:lan
```

Abre `http://localhost:4173` en el computador. Arriba del formulario aparece “Capturar desde el celular”, con una dirección Wi-Fi y un código de conexión. Abre esa dirección desde el celular en el mismo Wi-Fi, escribe el código y pulsa “Entrar al estudio”. El código y la sesión conceden acceso a todos los recorridos de este MVP y caducan al reiniciar el servidor. No los compartas fuera de tus dispositivos. Los enlaces anteriores con `/connect?key=…` siguen funcionando mientras no caduquen; si caducan, muestran el formulario de código. Se permiten diez intentos fallidos por minuto para todo el servidor. Por defecto el servidor solo escucha en loopback; el modo LAN es explícito. La entrada “Usar cámara” invoca la captura nativa del navegador cuando el dispositivo la admite; “Elegir video” siempre permite seleccionar una grabación existente. La selección de cámara y el render real deben verificarse en dispositivos físicos.

El teléfono solo captura/carga. Mantén el Mac y el servidor encendidos durante el procesamiento. No hace falta conservar abierta la pestaña: el estado se consulta nuevamente al abrirla.

El formulario de conexión requiere cookies y caduca a los diez minutos; si caduca, vuelve a escribir el código en el formulario renovado. Verifica un token firmado además del código para admitir navegadores que ocultan el Origin. La consola del servidor registra el origen normalizado y el resultado de conexión, sin códigos ni cookies.

## Primera captura

1. Una habitación iluminada y estática. Abre puertas, conserva una lente y evita cambios de zoom, exposición, espejos y personas en movimiento.
2. Camina despacio durante 30–90 segundos. Captura paredes, muebles y suelo desde posiciones distintas, manteniendo mucho solapamiento.
3. Pon un nombre y elige “Borrador”. Pulsa “Crear recorrido”.
4. Revisa el resultado y las advertencias antes de usarlo. Las vistas usan posiciones calculadas; no hay medidas métricas verificadas ni colisiones de caminar.

Límites: video de 5–180 segundos, máximo 1 GB; hasta 360 imágenes (2/s), dimensión máxima 1600 px. Borrador: 3000 pasos, 1024 px, hasta 500000 splats. Más detalle: 10000 pasos, 1280 px, hasta 1000000 splats. Se exige conectar al menos 10 imágenes y el 60% de la captura en una misma reconstrucción. Una escena faltante o mal capturada produce un error, no un éxito simulado. La compresión SOG usa CPU en macOS para evitar depender de otro backend GPU.

## Datos y errores

Cada captura vive en `data/jobs/<uuid>/`: `source.video` o `source.ply` (original), `job.json` (estado), `process.log` (diagnóstico), `work/` (archivos derivados), `output/scene.ply`, `scene.sog`, `settings.json` y, para videos, `poster.jpg`. Esta carpeta está ignorada por Git. Los videos y las escenas no se envían a servicios externos.

Un solo trabajo se procesa a la vez. Los trabajos en espera persisten; un procesamiento interrumpido al reiniciar queda marcado como fallido. “Volver a procesar” conserva el original y reemplaza exclusivamente `work/`, `output/` y el diagnóstico derivados. “Cancelar” detiene los procesos y conserva el archivo. No hay publicación pública automática ni gestión multiusuario; el acceso LAN es para una prueba controlada en red local. Antes de desplegar se necesita autenticación propia, aislamiento por cliente, cuotas y almacenamiento operable.

## Importar un escaneo del teléfono

Pulsa “Ya tengo un escaneo · importar .ply”, selecciona un **Gaussian Splat PLY binario little-endian sin compresión**, pon un nombre y crea el recorrido. Se exige que incluya color SH, opacidad, escala y rotación; una malla o una nube de puntos no es suficiente. Límite: 2 millones de splats y 1 GB. La importación solo requiere los paquetes npm; no ejecuta COLMAP ni Brush. El visor encuadra automáticamente la escena y permite exploración libre; estos archivos no incluyen las posiciones de captura necesarias para generar nuestras vistas guiadas.

Puedes exportar PLY desde una app de escaneo o desde [SuperSplat](https://superspl.at/editor), que también permite recortar escenas pesadas. No se implementó un editor de splats dentro del MVP.

La guía recibida propone Scaniverse → PLY → SuperSplat. [SuperSplat es gratuito, abierto y tiene licencia MIT](https://github.com/playcanvas/supersplat). [La documentación actual de Niantic](https://www.nianticspatial.com/pricing) distingue Scaniverse Classic, con procesamiento ilimitado en el dispositivo sin contratar los planes nuevos, de New Scaniverse, cuyo servicio incluye créditos y exige Pro/Enterprise para derechos comerciales y reventa. No se verificaron aquí los términos comerciales específicos de Classic. La disponibilidad gratuita de una app no prueba que su código sea abierto. El flujo de video local permite evaluar el MVP sin depender de esa app. Las cifras de costos, ingresos y peso de escenas de la guía no están comprobadas.

Variables opcionales: `PORT`, `FFMPEG_PATH`, `FFPROBE_PATH`, `COLMAP_PATH`, `BRUSH_PATH` (rutas absolutas a binarios). El servidor usa el mismo Node que lo arranca para ejecutar SplatTransform. Fuera de macOS configura esas rutas y sigue el arranque directo `node server.mjs` de la [guía de instalación](INSTALLATION.md); los scripts npm de arranque/setup existentes usan Bash y el instalador usa Homebrew. No se cargan archivos `.env` automáticamente.

## Validación

```sh
npm run check
npm test
```

Las pruebas cubren almacenamiento, recuperación tras reinicio, cola, cancelación, formatos de cámaras, límites de carga, acceso a archivos y flujo HTTP. No prueban por sí solas calidad de reconstrucción. Consulta `VALIDATION.md` para la evidencia de ejecución y los límites de lo comprobado.

## Herramientas abiertas

- [COLMAP](https://github.com/colmap/colmap): BSD; revisar las licencias de sus dependencias.
- [Brush](https://github.com/ArthurBrussee/brush): Apache 2.0. Binario de la release oficial; checksum verificado.
- [SplatTransform](https://github.com/playcanvas/splat-transform), [SuperSplat Viewer](https://github.com/playcanvas/supersplat-viewer): MIT. Se conservan los avisos de sus paquetes.
- [FFmpeg](https://ffmpeg.org/legal.html): la licencia depende de la compilación utilizada; Homebrew conserva sus avisos.

El código propio de Recorrido se distribuye con [licencia MIT](LICENSE). Las herramientas y dependencias mantienen sus respectivas licencias; no se incluyen sus binarios en este repositorio. No se utiliza el entrenador de referencia INRIA ni un servicio comercial de reconstrucción.

La [plantilla de GitHub Actions](docs/ci/check.yml.example) contempla instalación npm, sintaxis y pruebas Node en Windows, Ubuntu y macOS. Para activarla, cópiala a `.github/workflows/check.yml` usando una credencial con permiso para workflows o el editor web de GitHub. La credencial usada en la primera subida no tiene ese permiso; **CI todavía no está activa**. Estas comprobaciones no instalan COLMAP/Brush ni validan GPU o reconstrucción en esos sistemas; para ese alcance consulta [VALIDATION.md](VALIDATION.md).
