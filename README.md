# Hábitos

App web instalable (PWA) para seguir hábitos en ordenador y móvil. Funciona sin internet, guarda todo en el propio dispositivo y sincroniza con una hoja de Google tuya cuando vuelve la conexión. Las reglas de cálculo son las de `HabitTracker_v2.gs`: hábitos diarios y mensuales, Estricto/Promedio, pesos, rachas y periodos.

```
app/      la aplicación (esto es lo que se publica)
server/   Code.gs + Engine.gs para Google Apps Script (sincronización y email)
tests/    pruebas del motor de cálculo y del servidor
.github/  publicación automática en GitHub Pages
.devcontainer/  Claude Code en VS Code dentro de un contenedor aislado
```

## Publicación automática

Cada cambio en la rama `main` ejecuta las pruebas y publica `app/` en GitHub Pages. La primera vez, en el repositorio: Settings > Pages > Source: **GitHub Actions**. La dirección queda en `https://<usuario>.github.io/<repositorio>/`.

El repositorio no contiene datos personales: tus hábitos viven en tu hoja de Google y la clave del servidor solo está en tu Apps Script y en tus dispositivos.

Al publicar una versión nueva, la app lo detecta y muestra «Hay una versión nueva · Actualizar».

## Instalar

- **Android / Chrome / Edge**: menú > «Instalar app».
- **iPhone / iPad (Safari)**: Compartir > «Añadir a pantalla de inicio». Hazlo: Safari puede borrar los datos de una web que no abres en una semana, pero no los de una app instalada.
- Abre la app una vez con conexión. A partir de ahí abre sin internet.

## Iniciar sesión en varios dispositivos

Tus datos se guardan en una hoja de Google tuya. «Iniciar sesión» es conectar cada dispositivo a esa hoja con un enlace; no hay servidor de terceros.

**Una vez, en el ordenador:**

1. Crea una hoja de cálculo nueva. **Extensiones > Apps Script**.
2. Pega `server/Code.gs` en `Code.gs`. Crea otro archivo con **+ > Script** llamado `Engine` y pega `server/Engine.gs`.
3. En `Code.gs`, cambia `TOKEN` por una clave larga inventada por ti y pon en `APP_URL` la dirección de la app. Guarda.
4. Ejecuta la función `setup` y acepta los permisos.
5. **Implementar > Nueva implementación > Aplicación web**. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
6. Ejecuta la función `getSetupLink`. En el registro de ejecución aparece un enlace que termina en `#sync=…`.

**En cada dispositivo:** abre ese enlace (envíatelo por correo o mensaje). La app se conecta sola. También puedes pegar el enlace o el código en **Hábitos > Cuenta > Conectar**. Desde un dispositivo ya conectado, **Copiar enlace** genera el mismo enlace.

**Cerrar sesión** (Hábitos > Cuenta) desconecta ese dispositivo y conserva sus datos locales.

Cómo funciona: todo se guarda primero en el dispositivo. Sin conexión puedes seguir apuntando; los cambios se envían al volver internet (arriba verás «Sin conexión · N pendientes» y luego «Sincronizado»). Si dos dispositivos cambian el mismo dato, gana el último cambio.

Si modificas `Code.gs`: Implementar > Gestionar implementaciones > editar > Versión nueva.

## Recordatorio diario por email (opcional)

Ejecuta `installTriggers` una vez. Cada día a `REMINDER_HOUR` (por defecto las 21) llega un email con lo que falta hoy, y ninguno si ya lo has hecho todo. Revisa la zona horaria en Configuración del proyecto. `sendDailyReminder` lo prueba ya; `removeTriggers` lo quita.

## Uso

- **Hoy**: casillas grandes; para cantidades, botones − / + o toca el número para escribirlo (acepta coma). Las flechas del título permiten apuntar días pasados.
- **Mes**: porcentaje del mes, avance por hábito y lista de días.
- **Panel**: periodo a elegir, y un selector de **hábito** (todos o uno). Para todos: KPIs, evolución mensual, día a día, mapa de calor, ranking. Para uno: sus KPIs, cumplimiento por mes, día a día (o acumulado frente al ritmo esperado si su meta es mensual) y mapa de calor. Cada gráfico tiene «Ver tabla».
- **Hábitos**: añadir, editar, reordenar, archivar. Cambiar objetivo o peso aplica desde el mes que elijas. Archivar conserva el historial.
- **Ajustes**: idioma, tema, umbral de racha, cuenta y sincronización, copia de seguridad (JSON y CSV).

## Claude Code en VS Code (aislado)

El contenedor de `.devcontainer/` ejecuta Claude Code en VS Code viendo **solo esta carpeta** y con la red limitada a una lista de dominios.

**Una vez:** instala Docker Desktop (o Docker Engine), VS Code y la extensión **Dev Containers** (`ms-vscode-remote.remote-containers`).

**Cada vez:** abre la carpeta del repo en VS Code > paleta de comandos (Ctrl/Cmd+Mayús+P) > **Dev Containers: Reopen in Container**. La primera vez tarda unos minutos. Después, abre el panel de Claude (icono de chispa arriba a la derecha) o escribe `claude` en el terminal integrado y inicia sesión con tu cuenta de Claude. El login queda en un volumen de Docker del contenedor, no en tu `~/.claude`.

Qué aísla:

- Solo el repo está montado dentro (`/workspace`). Claude no ve tu escritorio, `~/.ssh` ni otras carpetas.
- `init-firewall.sh` corre en cada arranque y bloquea toda salida salvo: API y login de Anthropic, npm, extensiones de VS Code y GitHub. Para permitir otro sitio, añádelo a `ALLOWED_DOMAINS` y haz **Rebuild Container**.
- Claude corre como usuario `node`, sin root salvo ese script.
- Haz el `git push` desde GitHub Desktop (en tu ordenador), no desde el contenedor: así Claude no tiene credenciales de GitHub.

Límites, para que no te sorprendan:

- Claude puede leer y modificar todo lo que haya dentro del repo, incluido lo que pegues en él. No guardes claves en la carpeta.
- Si activas «saltar permisos» (`--dangerously-skip-permissions`), el contenedor no impide que Claude envíe el contenido del repo a los dominios permitidos. Úsalo solo con repos de confianza.
- Dev Containers puede reenviar al contenedor tu configuración de git y credenciales. Si quieres cortarlo, en los ajustes de usuario de VS Code busca «dev containers git» y desactiva copiar `.gitconfig` y el reenvío de credenciales.
- `tests/e2e.js` (Playwright) descarga navegadores desde un dominio no permitido; ejecútalo en tu ordenador o añade `cdn.playwright.dev` a la lista.

## Desarrollo

```
node tests/engine.test.js && node tests/engine_created.test.js && node tests/gas.test.js
cd app && python3 -m http.server 8000      # probar en http://localhost:8000
```

`server/Engine.gs` es una copia exacta de `app/engine.js` (las mismas reglas calculan el email); la publicación falla si difieren. `tests/e2e.js` (Playwright) prueba navegador, modo sin conexión y sincronización entre dos dispositivos contra una simulación de Apps Script.

## Límites

- La sincronización solo ocurre con la app abierta; no hay envío en segundo plano ni notificaciones push. El aviso es por email.
- Gana el cambio con la hora más reciente del dispositivo que lo hizo: un reloj mal ajustado puede ganar a otro.
- El tipo de un hábito (casilla o cantidad) no se cambia después de crearlo; archívalo y crea otro.
- Un hábito diario creado a mitad de mes cuenta desde su primer día.
- El enlace de conexión contiene tu clave: trátalo como una contraseña.
