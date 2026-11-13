# Hábitos (HabitTrackerApp)

PWA vanilla JS sin build: `app/` se publica tal cual en GitHub Pages. Sin dependencias en runtime.

- Reglas de cálculo en `app/engine.js`. `server/Engine.gs` debe ser copia exacta (`cmp app/engine.js server/Engine.gs`); CI falla si difieren.
- Sincronización: `app/store.js` (cliente, IndexedDB, last-write-wins) y `server/Code.gs` (Apps Script).
- Textos en `app/i18n.js` (es/en): toda cadena nueva va en ambos idiomas.
- Si cambias archivos de `app/` que el service worker cachea, no toques `BUILD` en `sw.js`: lo estampa el workflow.

Pruebas: `node tests/engine.test.js && node tests/engine_created.test.js && node tests/gas.test.js && node tests/store_sync.test.js`
Servir en local: `cd app && python3 -m http.server 8000`
Tras hacer commit, haz también el push a `origin main` (el usuario lo pidió el 2026-11-14; antes lo hacía él desde GitHub Desktop). El push a `main` publica la app.
