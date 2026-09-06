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

function showApp() {
  Nav.route = { page: 'inicio' };
  draw();
}

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
  pedidos: 'pedidos', 'pedido-nuevo': 'pedidos', 'pedido-detalle': 'pedidos',
  contactos: 'contactos', 'contacto-detalle': 'contactos',
};

function resetModuleSearch(moduleKey) {
  if (moduleKey === 'clientes' && typeof State !== 'undefined') State.search = '';
  if (moduleKey === 'productos' && typeof ProdState !== 'undefined') { ProdState.search = ''; ProdState.globalSearch = ''; }
  if (moduleKey === 'pedidos' && typeof OrdersState !== 'undefined') OrdersState.search = '';
  if (moduleKey === 'contactos' && typeof ContactsState !== 'undefined') ContactsState.search = '';
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
      () => navigateTo('clientes')
    );
  } else if (page === 'productos') {
    renderProductosCategorias(
      content,
      (cat) => navigateTo('productos-lista', { category: cat }),
      (q) => navigateTo('productos-lista', { category: 'Todas', search: q })
    );
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
      () => navigateTo('pedido-nuevo'),
      Nav.route.statusFilter
    );
  } else if (page === 'pedido-nuevo') {
    renderPedidoForm(
      content,
      () => navigateTo('pedidos'),
      (id) => navigateTo('pedido-detalle', { id })
    );
  } else if (page === 'pedido-detalle') {
    renderPedidoDetail(
      content,
      Nav.route.id,
      Nav.user,
      () => navigateTo('pedidos')
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
      (clientId) => navigateTo('cliente-detalle', { id: clientId })
    );
  } else if (page === 'comisiones') {
    renderComisiones(content, (orderId) => navigateTo('pedido-detalle', { id: orderId }));
  } else if (page === 'chat') {
    renderChat(content, Nav.user);
  }
}

boot();
