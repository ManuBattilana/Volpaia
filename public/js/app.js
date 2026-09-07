const Nav = {
  user: null,
  route: { page: 'inicio' }
};

async function boot() {
  try {
    const data = await Api.get('/api/me');
    Nav.user = data.user;
    showApp();
  } catch (e) {
    renderLogin((user) => {
      Nav.user = user;
      showApp();
    });
  }
}

// Cuando se toca una notificación push (chat o pedido) con la app ya
// abierta en una pestaña, el service worker navega esa pestaña a una URL
// como /?open=chat o /?open=pedido&id=5 — acá se traduce eso a la pantalla
// correspondiente en vez de mostrar siempre Inicio.
function routeFromLocation() {
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  if (!open) return null;
  history.replaceState(null, '', location.pathname);
  if (open === 'chat') return { page: 'chat' };
  if (open === 'pedido' && params.get('id')) return { page: 'pedido-detalle', id: Number(params.get('id')) };
  return null;
}

function showApp() {
  Nav.route = routeFromLocation() || { page: 'inicio' };
  draw();
}

// Respaldo para navegadores donde el service worker no puede navegar
// directamente la pestaña ya abierta (ver public/sw.js): manda un mensaje
// en cambio, y acá se aplica igual que si se hubiera abierto esa URL.
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'navigate' && event.data.url) {
    const url = new URL(event.data.url, location.origin);
    history.replaceState(null, '', url.pathname + url.search);
    const route = routeFromLocation();
    if (route && Nav.user) { Nav.route = route; draw(); }
  }
});

async function handleLogout() {
  await Api.post('/api/logout');
  Nav.user = null;
  renderLogin((user) => { Nav.user = user; showApp(); });
}

// Cada búsqueda vive en un objeto de estado a nivel de módulo (State,
// ProdState, OrdersState, ContactsState) que sobrevive entre renders para
// no perder el filtro al ir de la lista a un detalle y volver. Pero al
// cambiar de sección (ej. Pedidos -> Comisiones) el usuario espera
// encontrar la búsqueda vacía la próxima vez que entre a Pedidos, así que
// se limpia solo cuando el módulo realmente cambia.
const PAGE_MODULE = {
  clientes: 'clientes', 'cliente-detalle': 'clientes',
  productos: 'productos', 'productos-lista': 'productos', 'producto-detalle': 'productos',
  pedidos: 'pedidos', 'pedido-detalle': 'pedidos',
  presupuestos: 'presupuestos', 'presupuesto-nuevo': 'presupuestos', 'presupuesto-detalle': 'presupuestos',
  contactos: 'contactos', 'contacto-detalle': 'contactos',
};

function resetModuleSearch(moduleKey) {
  if (moduleKey === 'clientes' && typeof State !== 'undefined') State.search = '';
  if (moduleKey === 'productos' && typeof ProdState !== 'undefined') { ProdState.search = ''; ProdState.globalSearch = ''; }
  if (moduleKey === 'pedidos' && typeof OrdersState !== 'undefined') OrdersState.search = '';
  if (moduleKey === 'contactos' && typeof ContactsState !== 'undefined') ContactsState.search = '';
  if (moduleKey === 'presupuestos' && typeof QuotesState !== 'undefined') QuotesState.search = '';
}

function navigateTo(page, params) {
  const prevModule = PAGE_MODULE[Nav.route.page];
  const nextModule = PAGE_MODULE[page];
  if (prevModule && prevModule !== nextModule) resetModuleSearch(prevModule);
  Nav.route = { page, ...(params || {}) };
  draw();
}

function draw() {
  const content = renderLayout(Nav.user, Nav.route.page, navigateTo, handleLogout);
  const { page } = Nav.route;

  if (page === 'inicio') {
    renderInicio(content, Nav.user, navigateTo);
  } else if (page === 'clientes') {
    renderClientesList(content, (id) => navigateTo('cliente-detalle', { id }));
  } else if (page === 'cliente-detalle') {
    renderClientDetail(
      content,
      Nav.route.id,
      () => navigateTo('clientes'),
      () => navigateTo('clientes'),
      (client) => navigateTo('presupuesto-nuevo', { preset: { type: 'client', record: client } }),
      (orderId) => navigateTo('pedido-detalle', { id: orderId }),
      (quoteId) => navigateTo('presupuesto-detalle', { id: quoteId })
    );
  } else if (page === 'productos') {
    renderProductosCategorias(
      content,
      (cat) => navigateTo('productos-lista', { category: cat }),
      (q) => navigateTo('productos-lista', { category: 'Todas', search: q })
    );
  } else if (page === 'stock') {
    renderStockList(content, (id) => navigateTo('stock-detalle', { id }));
  } else if (page === 'stock-detalle') {
    renderStockDetail(content, Nav.route.id, () => navigateTo('stock'));
  } else if (page === 'fabrica') {
    renderFabrica(content, (orderId) => navigateTo('pedido-detalle', { id: orderId }));
  } else if (page === 'productos-lista') {
    renderProductosLista(
      content,
      Nav.route.category,
      (id, cat) => navigateTo('producto-detalle', { id, category: cat }),
      () => navigateTo('productos'),
      Nav.route.search
    );
  } else if (page === 'producto-detalle') {
    renderProductoDetail(
      content,
      Nav.route.id,
      Nav.route.category,
      () => navigateTo('productos-lista', { category: Nav.route.category || 'Todas' }),
      () => navigateTo('productos-lista', { category: Nav.route.category || 'Todas' })
    );
  } else if (page === 'pedidos') {
    renderPedidosList(
      content,
      (id) => navigateTo('pedido-detalle', { id }),
      () => navigateTo('presupuesto-nuevo'),
      Nav.route.statusFilter
    );
  } else if (page === 'pedido-detalle') {
    renderPedidoDetail(
      content,
      Nav.route.id,
      Nav.user,
      () => navigateTo('pedidos')
    );
  } else if (page === 'presupuestos') {
    renderPresupuestosList(
      content,
      (id) => navigateTo('presupuesto-detalle', { id }),
      () => navigateTo('presupuesto-nuevo')
    );
  } else if (page === 'presupuesto-nuevo') {
    renderPresupuestoForm(
      content,
      () => navigateTo('presupuestos'),
      (id) => navigateTo('presupuesto-detalle', { id }),
      Nav.route.preset
    );
  } else if (page === 'presupuesto-detalle') {
    renderPresupuestoDetail(
      content,
      Nav.route.id,
      () => navigateTo('presupuestos'),
      (orderId) => navigateTo('pedido-detalle', { id: orderId })
    );
  } else if (page === 'configuracion') {
    renderConfiguracion(content, Nav.user);
  } else if (page === 'contactos') {
    renderContactosList(content, (id) => navigateTo('contacto-detalle', { id }));
  } else if (page === 'contacto-detalle') {
    renderContactDetail(
      content,
      Nav.route.id,
      () => navigateTo('contactos'),
      () => navigateTo('contactos'),
      (clientId) => navigateTo('cliente-detalle', { id: clientId }),
      (contact) => navigateTo('presupuesto-nuevo', { preset: { type: 'contact', record: contact } }),
      (quoteId) => navigateTo('presupuesto-detalle', { id: quoteId })
    );
  } else if (page === 'posventa') {
    renderPosventa(
      content,
      (orderId) => navigateTo('posventa-detalle', { id: orderId })
    );
  } else if (page === 'posventa-detalle') {
    renderPosventaDetail(
      content,
      Nav.route.id,
      () => navigateTo('posventa'),
      (orderId) => navigateTo('pedido-detalle', { id: orderId }),
      (client) => navigateTo('presupuesto-nuevo', { preset: { type: 'client', record: client } })
    );
  } else if (page === 'comisiones') {
    renderComisiones(content, (orderId) => navigateTo('pedido-detalle', { id: orderId }));
  } else if (page === 'chat') {
    renderChat(content, Nav.user);
  } else if (page === 'notificaciones') {
    renderNotificaciones(content, (orderId) => navigateTo('pedido-detalle', { id: orderId }));
  }
}

boot();
