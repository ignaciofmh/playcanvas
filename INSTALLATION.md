# Instalación de Recorrido

Recorrido es un MVP web local para crear recorridos 3D desde video de celular o importar Gaussian Splats en formato PLY. El teléfono captura y carga; el computador procesa y sirve el visor.

Nombre del producto: **Recorrido**. Nombre del paquete: **`recorrido-mvp`**. La carpeta original de desarrollo se llama **`playcanvas`**; puedes llamar `recorrido` a tu copia. Este proyecto utiliza herramientas de PlayCanvas, pero no es el repositorio oficial de su motor.

## 1. Plataformas y estado de validación

| Sistema del computador | Ruta documentada | Estado de este MVP |
| --- | --- | --- |
| macOS Apple Silicon, M1 o posterior | Instalador existente con Homebrew | Reconstrucción completa probada en el equipo de desarrollo |
| Windows 11 x64 | PowerShell, herramientas nativas y arranque con Node | Instrucciones contrastadas con los paquetes oficiales; ejecución pendiente en Windows |
| Ubuntu 24.04 LTS x86_64 | Bash, FFmpeg de APT, COLMAP 4.2.0 compilado y Brush oficial | Instrucciones contrastadas con las fuentes; ejecución pendiente en Linux |

El acceso desde el celular por Wi-Fi fue confirmado por el usuario. No hay una matriz de calidad de captura ni de GPU validada en varios equipos. Esta guía no certifica todas las combinaciones de hardware.

Por ahora no se documentan Mac Intel, Windows ARM, otras distribuciones, Docker ni WSL. Windows y Linux necesitan sus propios binarios; los descargados en un Mac no son reutilizables allí.

## 2. Elegir el tipo de instalación

| Qué quieres probar | Qué necesitas |
| --- | --- |
| Importar un escaneo PLY y verlo en la web | Node.js 22+ y las dependencias npm |
| Reconstruir un video de celular | Lo anterior, FFmpeg/FFprobe, COLMAP **4.2.0** y Brush **0.3.0**, con una GPU compatible con Brush |

El flujo de video es `FFmpeg → COLMAP → Brush → SplatTransform → SuperSplat Viewer`. COLMAP extrae y empareja características en **CPU** en este MVP: no necesitas instalar CUDA para esas etapas. Brush sí necesita un dispositivo gráfico compatible y sus controladores; consulta el [proyecto oficial de Brush](https://github.com/ArthurBrussee/brush/tree/v0.3.0). Una máquina virtual o un servidor sin GPU no se consideran compatibles por el solo hecho de poder instalar Node.

Las versiones npm están fijadas en `package-lock.json`: SplatTransform 3.10.0 y SuperSplat Viewer 1.37.0. El entorno de referencia usó Node 22.15.0 y FFmpeg 9.0.2. No se ha establecido un mínimo medido de RAM o VRAM para este MVP; el consumo depende de la captura. Empieza con una habitación y el perfil Borrador.

**No reemplaces COLMAP 4.2.0 por una versión antigua sin comprobar las opciones.** El código usa `FeatureExtraction.use_gpu`, `FeatureMatching.use_gpu` y otras opciones de la rama 4.2. Algunas versiones de APT usan nombres diferentes. Un ejecutable presente en disco no basta para asegurar compatibilidad.

## 3. Descargar el proyecto e instalar Node

Instala **Node.js 22 o posterior** desde [nodejs.org](https://nodejs.org/en/download). Para reducir diferencias respecto del entorno probado, utiliza Node 22. Si ya usas un gestor de versiones, selecciona Node 22 con él. Instala la arquitectura correcta para tu computador.

Usa **Code → Download ZIP** en [ignaciofmh/playcanvas](https://github.com/ignaciofmh/playcanvas), extrae el archivo y abre una terminal en la carpeta que contiene `package.json`. También puedes clonar con Git:

```sh
git clone https://github.com/ignaciofmh/playcanvas.git recorrido
cd recorrido
```

Comprueba Node e instala las dependencias **desde esa carpeta**:

macOS / Linux:

```sh
node --version
npm --version
npm ci
```

Windows, en PowerShell:

```powershell
node --version
npm.cmd --version
npm.cmd ci
```

En Windows se usa `npm.cmd` para evitar depender de la política de ejecución de scripts PowerShell. No hace falta cambiarla. `npm ci` necesita el `package-lock.json` incluido en el proyecto. Las descargas de paquetes y herramientas requieren internet; las capturas no se envían a un servicio externo de reconstrucción.

### Prueba ligera: importar PLY

Con las dependencias npm instaladas, ejecuta en cualquiera de los tres sistemas:

```sh
node server.mjs
```

Abre **http://localhost:4173**. Si faltan las herramientas de video, la web lo indica; aún puedes pulsar **“Ya tengo un escaneo · importar .ply”**. Usa un Gaussian Splat PLY binario little-endian sin compresión, con color SH, opacidad, escala y rotación. No sirve una malla o una nube de puntos normal. Límite: 1 GB y 2 millones de splats. El visor necesita aceleración gráfica del navegador.

Detén el servidor con `Ctrl+C` antes de continuar la instalación completa. La prueba de importación no verifica la reconstrucción desde video.

## 4. macOS Apple Silicon: instalación completa

Requisitos adicionales: [Homebrew](https://brew.sh), Python 3 y las herramientas de línea de comandos de Apple necesarias para Homebrew. Sigue sus instaladores oficiales si aún no están disponibles.

Desde la carpeta del proyecto, con Node 22+ activo:

```sh
npm ci
npm run setup
npm start
```

`npm run setup` instala FFmpeg y COLMAP mediante Homebrew. Descarga Brush 0.3.0 para Apple Silicon y comprueba su SHA-256. Solo ese instalador es específico de macOS. Puede descargar dependencias de Homebrew y consumir tiempo y espacio; no es un instalador universal.

Verifica lo instalado:

```sh
/opt/homebrew/bin/ffmpeg -version
/opt/homebrew/bin/ffprobe -version
/opt/homebrew/bin/colmap -h
.tools/brush/brush-app-aarch64-apple-darwin/brush_app --version
```

Homebrew instala la versión disponible, no fija automáticamente COLMAP 4.2.0. Si obtienes otra versión, comprueba las opciones indicadas en la sección 7 antes de procesar un video. El arranque `npm start` detecta Node 22+ en algunas ubicaciones habituales de macOS; en todos los sistemas puedes arrancar explícitamente con `node server.mjs`.

## 5. Windows 11 x64: instalación completa

Usa **PowerShell** con Node y npm instalados. No necesitas Git Bash para los comandos de esta sección. `npm start`, `npm run start:lan` y `npm run setup` usan scripts Bash del proyecto: aquí se sustituyen por arranque directo con Node e instalación manual.

### 5.1. FFmpeg y FFprobe

Abre la [página oficial de descargas de FFmpeg](https://ffmpeg.org/download.html#build-windows). Sus enlaces para Windows llevan a distribuidores de binarios. Descarga una compilación x64 que incluya **`ffmpeg.exe` y `ffprobe.exe`**, extráela y deja esta estructura:

```text
C:\Tools\ffmpeg\bin\ffmpeg.exe
C:\Tools\ffmpeg\bin\ffprobe.exe
```

Puedes usar otra carpeta: tendrás que ajustar las rutas del paso 5.4. No basta con descargar el código fuente de FFmpeg.

### 5.2. COLMAP 4.2.0 sin CUDA

Desde la raíz de Recorrido, descarga y extrae el [paquete oficial de Windows sin CUDA](https://github.com/colmap/colmap/releases/tag/4.2.0):

```powershell
New-Item -ItemType Directory -Force '.tools/downloads', '.tools/colmap-windows' | Out-Null
Invoke-WebRequest -Uri 'https://github.com/colmap/colmap/releases/download/4.2.0/colmap-x64-windows-nocuda.zip' -OutFile '.tools/downloads/colmap-windows.zip'
Expand-Archive -LiteralPath '.tools/downloads/colmap-windows.zip' -DestinationPath '.tools/colmap-windows' -Force
```

Conserva el contenido completo: `bin`, las DLL y `plugins`. El archivo publicado en esa release contiene `bin/colmap.exe` y `plugins/platforms/qoffscreen.dll`; se comprobó su estructura, no su ejecución en Windows.

**`COLMAP_PATH` debe apuntar a `bin/colmap.exe`, no a `COLMAP.bat`.** El servidor ejecuta herramientas directamente, sin shell. El `.bat` oficial prepara las rutas de DLL y plugins; el paso 5.4 configura ese entorno antes de arrancar Node.

### 5.3. Brush 0.3.0

Descarga el binario x64 de la [release oficial](https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0), verifica el checksum publicado y extráelo:

```powershell
New-Item -ItemType Directory -Force '.tools/downloads', '.tools/brush-windows' | Out-Null
$brushUrl = 'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip'
Invoke-WebRequest -Uri $brushUrl -OutFile '.tools/downloads/brush-windows.zip'
Invoke-WebRequest -Uri "$brushUrl.sha256" -OutFile '.tools/downloads/brush-windows.sha256'
$expectedHash = ((Get-Content -Raw '.tools/downloads/brush-windows.sha256').Trim() -split '\s+')[0]
$actualHash = (Get-FileHash -Algorithm SHA256 '.tools/downloads/brush-windows.zip').Hash
if ($actualHash -ne $expectedHash) { throw 'Checksum de Brush incorrecto. No continúes con este archivo.' }
Expand-Archive -LiteralPath '.tools/downloads/brush-windows.zip' -DestinationPath '.tools/brush-windows' -Force
```

El ZIP oficial contiene `brush_app.exe` directamente en su raíz. Actualiza los controladores gráficos desde el proveedor de tu equipo/GPU si Brush no encuentra un dispositivo compatible. Tener una tarjeta NVIDIA no es un requisito general de Brush, ni instalar CUDA sustituye comprobar que Brush funcione.

### 5.4. Configurar y arrancar en la misma terminal

Ejecuta desde la raíz del proyecto:

```powershell
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
$env:FFPROBE_PATH = 'C:\Tools\ffmpeg\bin\ffprobe.exe'
$env:COLMAP_PATH = (Resolve-Path '.tools/colmap-windows/bin/colmap.exe').Path
$env:BRUSH_PATH = (Resolve-Path '.tools/brush-windows/brush_app.exe').Path
$colmapBin = (Resolve-Path '.tools/colmap-windows/bin').Path
$colmapPlugins = (Resolve-Path '.tools/colmap-windows/plugins').Path
$env:PATH = "$colmapBin;$env:PATH"
$env:QT_PLUGIN_PATH = $colmapPlugins
$env:QT_QPA_PLATFORM = 'offscreen'

& $env:FFMPEG_PATH -version
& $env:FFPROBE_PATH -version
& $env:COLMAP_PATH -h
& $env:BRUSH_PATH --version
& $env:BRUSH_PATH --help
```

Si alguno falla, corrígelo antes de arrancar. Después:

```powershell
node server.mjs
```

Las variables son de esta sesión: vuelve a configurarlas al abrir otra terminal. No se leen automáticamente archivos `.env`. No elimines las comillas de las rutas con espacios. Esta ruta nativa necesita una prueba completa en Windows, incluida cancelación y reintento de procesos; no se ha ejecutado aquí.

## 6. Ubuntu 24.04 LTS x86_64: instalación completa

Usa Bash y Node 22+ instalado desde su distribución oficial o tu gestor de versiones. La versión de Node disponible por defecto en APT puede no cumplir el requisito: comprueba `node --version`.

### 6.1. FFmpeg y COLMAP 4.2.0

Instala FFmpeg y las dependencias de compilación. La receta se basa en las [instrucciones de COLMAP fijadas en 4.2.0](https://github.com/colmap/colmap/blob/4.2.0/doc/install.rst), usa OpenBLAS OpenMP y desactiva GPU, interfaz gráfica y ONNX en COLMAP. Es suficiente para las etapas SIFT/CPU de este MVP. **Esta compilación no se ejecutó en el Mac de desarrollo.**

```bash
sudo apt-get update
sudo apt-get install -y \
  ffmpeg git curl xz-utils ca-certificates cmake ninja-build build-essential \
  libboost-program-options-dev libboost-graph-dev libboost-system-dev \
  libeigen3-dev libopenimageio-dev openimageio-tools libmetis-dev \
  libgoogle-glog-dev libgtest-dev libgmock-dev libsqlite3-dev libglew-dev \
  qt6-base-dev libqt6opengl6-dev libqt6openglwidgets6 qt6-svg-dev \
  libcgal-dev libceres-dev libsuitesparse-dev libcurl4-openssl-dev \
  libssl-dev libopenblas-openmp-dev
sudo mkdir -p /usr/include/opencv4
```

El directorio `opencv4` es una solución documentada por COLMAP para la configuración CMake de OpenImageIO en Ubuntu. Se mantiene la lista de dependencias oficiales aunque la compilación desactive algunas funciones.

Desde la raíz de Recorrido, compila en `.tools/` e instala solo bajo esa carpeta; no reemplaza un COLMAP del sistema:

```bash
mkdir -p .tools
git clone --depth 1 --branch 4.2.0 https://github.com/colmap/colmap.git .tools/colmap-src
cmake -S .tools/colmap-src -B .tools/colmap-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PWD/.tools/colmap-linux" \
  -DCUDA_ENABLED=OFF -DHIP_ENABLED=OFF -DGUI_ENABLED=OFF \
  -DOPENGL_ENABLED=OFF -DONNX_ENABLED=OFF -DTESTS_ENABLED=OFF \
  -DBLA_VENDOR=OpenBLAS
cmake --build .tools/colmap-build --parallel 2
cmake --install .tools/colmap-build
```

Necesitas internet también durante la configuración: COLMAP puede descargar dependencias de compilación. Si `.tools/colmap-src` ya existe, no repitas `git clone`; utiliza la copia 4.2.0 existente. La compilación puede ser larga y consumir bastante RAM/espacio. No se presenta `sudo apt install colmap` como sustituto porque su versión depende de Ubuntu y podría ser incompatible.

### 6.2. Brush 0.3.0

Descarga, verifica y extrae el binario Linux x64:

```bash
mkdir -p .tools/downloads .tools/brush-linux
brush_url='https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-unknown-linux-gnu.tar.xz'
curl -fL "$brush_url" -o .tools/downloads/brush-linux.tar.xz
curl -fL "$brush_url.sha256" -o .tools/downloads/brush-linux.sha256
brush_expected=$(awk '{print $1; exit}' .tools/downloads/brush-linux.sha256)
printf '%s  %s\n' "$brush_expected" '.tools/downloads/brush-linux.tar.xz' | sha256sum --check -
```

Continúa solo si el checksum devuelve **OK**:

```bash
tar -xJf .tools/downloads/brush-linux.tar.xz -C .tools/brush-linux
find "$PWD/.tools/brush-linux" -type f -name brush_app
```

El último comando permite ver la ubicación real sin asumir el nombre de la carpeta superior del paquete. Configura la ruta que devuelve:

```bash
export FFMPEG_PATH="$(command -v ffmpeg)"
export FFPROBE_PATH="$(command -v ffprobe)"
export COLMAP_PATH="$PWD/.tools/colmap-linux/bin/colmap"
export BRUSH_PATH="$(find "$PWD/.tools/brush-linux" -type f -name brush_app -print -quit)"
test -n "$BRUSH_PATH" && test -x "$BRUSH_PATH"

"$FFMPEG_PATH" -version
"$FFPROBE_PATH" -version
"$COLMAP_PATH" -h
"$BRUSH_PATH" --version
"$BRUSH_PATH" --help
```

Brush necesita un controlador gráfico compatible en la sesión que lo ejecuta. Poder ejecutar `--version` o `--help` no demuestra que se pueda entrenar. No se ha validado aquí la selección de GPU ni un despliegue Linux sin pantalla.

### 6.3. Arrancar

En la misma terminal, desde la raíz de Recorrido:

```bash
node server.mjs
```

Las variables `export` deben volver a configurarse en otra terminal. No se cargan desde `.env`. Aunque el sistema sea Linux, las rutas predeterminadas del código siguen siendo las de macOS; por eso se configuran explícitamente.

## 7. Comprobar la instalación

En todos los sistemas, desde la raíz del proyecto:

```sh
node --check server.mjs
node --test test/core.test.mjs test/http.test.mjs
```

Para revisar además la sintaxis de todos los módulos:

```sh
npm run check
```

En PowerShell usa `npm.cmd run check`. Se enumeran los archivos de test explícitamente para no depender de cómo el shell expanda `test/*.test.mjs`. Estas pruebas validan lógica y contratos HTTP; no prueban los binarios externos, la GPU ni la calidad de una captura. Algunas pruebas de red necesitan una interfaz IPv4; informa las omitidas además de las que pasan.

Antes de procesar video, comprueba que las opciones de COLMAP realmente existen:

macOS / Linux, con las variables configuradas; en Mac puedes usar `export COLMAP_PATH=/opt/homebrew/bin/colmap`:

```sh
"$COLMAP_PATH" feature_extractor -h
"$COLMAP_PATH" sequential_matcher -h
"$COLMAP_PATH" mapper -h
```

Windows:

```powershell
& $env:COLMAP_PATH feature_extractor -h
& $env:COLMAP_PATH sequential_matcher -h
& $env:COLMAP_PATH mapper -h
```

En las ayudas busca respectivamente `FeatureExtraction.use_gpu`, `FeatureMatching.use_gpu` y `Mapper.min_model_size`. En Brush busca `--total-steps`, `--max-resolution`, `--max-splats`, `--export-every`, `--export-path` y `--export-name`. No continúes con otra CLI solo porque el archivo exista: la comprobación de herramientas de la web revisa presencia, no versiones ni capacidad de GPU.

Abre http://localhost:4173 y carga un video de una habitación, de 30–90 segundos, en **Borrador**. Debe pasar por extracción de imágenes, conexión, reconstrucción y preparación, terminar en “Listo para explorar”, abrir el visor y permitir descargar el SOG. Si falla, consulta “Ver diagnóstico del procesamiento”. Una prueba válida incluye ver el modelo; que un proceso termine sin error no garantiza una buena escena.

## 8. Probar desde Android o iPhone por Wi-Fi

Detén el servidor normal con `Ctrl+C`. Mantén las variables configuradas y arranca:

```sh
node server.mjs --lan
```

Este comando funciona como entrada del servidor en los tres sistemas. En Mac también puedes usar `npm run start:lan`.

1. Conecta teléfono y computador a la misma red Wi-Fi.
2. En el computador abre **http://localhost:4173** y recarga la página. Arriba aparece “Capturar desde el celular”, con la IP y un código.
3. En el teléfono abre la dirección IP que muestra la web, **incluyendo `http://` y el puerto**. No uses `localhost`: en el teléfono apuntaría al propio teléfono.
4. Escribe el código y pulsa “Entrar al estudio”. El código y las sesiones cambian al reiniciar el servidor.
5. Usa “Elegir video” para cargar una grabación existente; “Usar cámara” depende del soporte del navegador. Mantén computador y servidor encendidos mientras procesa.

Si el firewall pregunta, permite Node solo en la red privada/de confianza. No abras el puerto en el router. Una Wi-Fi de invitados puede aislar los dispositivos aunque tengan el mismo nombre de red. El modo normal solo escucha en loopback; `--lan` escucha en la red local.

El acceso LAN es para tus dispositivos de prueba. Todos los conectados ven los mismos recorridos. Esta guía no configura publicación pública del servidor, HTTPS, multiusuario ni ngrok. La carga de una grabación mediante el selector no requiere una vista previa de cámara en vivo con `getUserMedia`.

## 9. Variables y datos

| Variable | Significado |
| --- | --- |
| `FFMPEG_PATH` | Ruta absoluta a `ffmpeg` o `ffmpeg.exe` |
| `FFPROBE_PATH` | Ruta absoluta a `ffprobe` o `ffprobe.exe` |
| `COLMAP_PATH` | Ruta absoluta al ejecutable nativo COLMAP; en Windows, **no** el `.bat` |
| `BRUSH_PATH` | Ruta absoluta a `brush_app` o `brush_app.exe` |
| `PORT` | Puerto HTTP; 4173 si no se configura |

Las variables se definen antes de arrancar Node y pertenecen a esa terminal. El servidor **no busca automáticamente los binarios en PATH**, aunque agregar el directorio de COLMAP a PATH en Windows permite resolver sus dependencias. Usa las rutas explícitas de las secciones anteriores.

El servidor crea `data/jobs/`: originales, estado JSON, diagnósticos, intermediarios y escenas. No necesitas PostgreSQL, Docker, cuentas de procesamiento ni claves de API. Los archivos locales de captura, `.tools`, `node_modules` y `artifacts` están excluidos de Git. La escena de prueba del desarrollador no se distribuye automáticamente con una copia del código; aporta tu propio video o PLY.

## 10. Problemas frecuentes

| Síntoma | Qué revisar |
| --- | --- |
| Node indica versión 20 o anterior | Selecciona Node 22+ y vuelve a abrir la terminal. |
| PowerShell bloquea `npm.ps1` | Usa `npm.cmd`; no necesitas cambiar la política de ejecución. |
| Windows indica que no encuentra `bash` | Arranca con `node server.mjs`; no uses los scripts Bash de macOS. |
| La web indica herramientas faltantes | Revisa las cuatro rutas en la misma terminal que ejecuta Node. Para PLY solo hacen falta las dependencias npm. |
| `spawn ... ENOENT`, `EINVAL`, DLL o plugin Qt en Windows | Apunta a `bin/colmap.exe`, conserva sus DLL y configura PATH/QT_PLUGIN_PATH como en 5.4; no uses `COLMAP.bat`. |
| COLMAP rechaza una opción | Compara la versión y las ayudas con la sección 7; versiones antiguas usan otros nombres. |
| Brush no encuentra GPU o falla al entrenar | Comprueba sus drivers y ejecuta Brush en ese mismo equipo. Las pruebas Node no validan GPU. |
| Linux informa `GLIBC_x.y not found` | El binario descargado no es compatible con esa distribución. No reemplaces glibc manualmente; utiliza un sistema compatible o compila Brush desde su fuente oficial. |
| `EADDRINUSE` | Ya hay un servidor en el puerto. Detén la instancia que arrancaste antes de abrir otra; no ejecutes dos instancias sobre el mismo `data/jobs`. |
| El teléfono no conecta | Comprueba modo `--lan`, IP actual, firewall y aislamiento de Wi-Fi. Recarga localhost en el computador y abre una pestaña nueva en el teléfono. |
| El enlace antiguo o el código no funciona | Reiniciar cambia las credenciales. Usa el código actual del computador; permite cookies para el formulario. |
| Pocas imágenes conectadas o escena incompleta | Es un problema de captura: camina despacio, con luz, mucho solapamiento y una sola lente. Evita espejos, desenfoque y objetos en movimiento. |

Para reportar un problema, incluye sistema/arquitectura, GPU, `node --version`, versiones de las herramientas, etapa fallida y el fragmento pertinente del diagnóstico. Revisa el contenido antes de compartirlo: puede incluir nombres y rutas de archivos. No adjuntes el código de conexión, cookies ni videos privados.

## Fuentes y límites de esta guía

Consultadas al preparar el documento el 17 de octubre de 2026:

- [Node.js: descargas oficiales](https://nodejs.org/en/download).
- [FFmpeg: descargas y enlaces a compilaciones](https://ffmpeg.org/download.html).
- [COLMAP 4.2.0: binarios oficiales](https://github.com/colmap/colmap/releases/tag/4.2.0).
- [COLMAP 4.2.0: instalación desde fuentes](https://github.com/colmap/colmap/blob/4.2.0/doc/install.rst).
- [Brush 0.3.0: binarios por plataforma y checksums](https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0).
- [Brush 0.3.0: formatos, CLI y plataformas](https://github.com/ArthurBrussee/brush/tree/v0.3.0).
- [Validación local de Recorrido](VALIDATION.md).

Se revisaron los scripts y variables reales del proyecto, las opciones de compilación de COLMAP 4.2.0 y el contenido de los ZIP oficiales de Windows. **Windows y Ubuntu quedan pendientes de instalación y prueba completa en equipos de esos sistemas.** La documentación amplía las instrucciones; no añade instaladores automáticos ni convierte esas plataformas en verificadas.
