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

function navigateTo(page, params) {
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
      () => navigateTo('pedido-nuevo')
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
  }
}

boot();
