# Volpaia · Gestión interna

Aplicación web independiente para reemplazar el sistema interno que corría en WordPress.

## Stack

- Backend: Node.js + Express + SQLite (better-sqlite3), sesiones por cookie, subida de fotos con multer.
- Frontend: HTML/CSS/JavaScript vanilla (sin framework ni build step).

## Cómo correrlo

```bash
npm install
npm start
```

La app queda disponible en `http://localhost:3000`.

Al iniciar por primera vez se crea un usuario admin:

- usuario: `admin`
- contraseña: `volpaia2026` (o el valor de la variable de entorno `VOLPAIA_ADMIN_PASSWORD`)

La base de datos SQLite se guarda en `data/volpaia.db` y las fotos subidas en `uploads/`. Ambas carpetas están excluidas del control de versiones.

## Módulos

- **Inicio**: accesos directos a Clientes y Productos; Contactos/Pedidos/Comisiones aparecen como "Próximamente".
- **Clientes**: alta/edición/baja, numeración automática (#1, #2, ...) que nunca se recicla, favoritos, búsqueda, botón de WhatsApp.
- **Productos**: categorías (Conjunto, Bombacha lisa, Bombacha estampada, Otro, Todas), vista grilla/lista, buscador, hasta 3 fotos con lightbox, 3 precios independientes (Docena/Pack x3/Unidad) con historial acumulativo de cambios, estado de stock.

## Pendiente (siguientes iteraciones)

- Selector real de colores (hoy es texto libre).
- Módulo de Stock por producto/color/talle con descuento automático al vender.
- Contactos, Pedidos y Comisiones.
