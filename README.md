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

- **Inicio**: accesos directos a Clientes, Productos, Pedidos y Contactos; Comisiones aparece como "Próximamente".
- **Clientes**: alta/edición/baja, numeración automática (#1, #2, ...) que nunca se recicla, favoritos, búsqueda, botón de WhatsApp.
- **Contactos**: registro de posibles clientes (todavía sin pedido confirmado), con seguimiento de catálogo/lista de precios enviados (historial acumulativo) y botón "Convertir a cliente" que crea un Cliente nuevo autocompletando los datos coincidentes.
- **Productos**: categorías (Conjunto, Bombacha lisa, Bombacha estampada, Otro, Todas), vista grilla/lista, buscador, hasta 3 fotos con lightbox, 3 precios independientes (Docena/Pack x3/Unidad) con historial acumulativo de cambios, estado de stock.
- **Pedidos**: flujo de 9 estados (Pedido creado → Confirmado → Datos enviados → Esperando comprobante → Pago confirmado → En preparación → Listo para despachar → Despachado → Seguimiento posventa), con generación automática de PDF del pedido (con precios) y de la lista de preparación (sin precios, con casillero), comisión automática al despachar, y recordatorios de seguimiento posventa. Melany y Darío pueden avanzar y retroceder un paso por igual.
- **Configuración**: días de recordatorio, % de comisión, teléfono de Damián (para el botón de WhatsApp del paso 1), y cambio de usuario/contraseña propio.
- **Notificaciones**: campanita en la barra superior con los cambios de estado hechos por el otro usuario y los recordatorios vencidos.

## Pendiente (siguientes iteraciones)

- Selector real de colores en Productos (hoy es texto libre).
- Módulo de Stock por producto/color/talle con descuento automático al vender.
- Pantalla dedicada de Comisiones (hoy el registro existe y se ve dentro de cada pedido despachado).
- Chat interno entre Melany y Darío.
