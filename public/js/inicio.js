function renderInicio(container, user, onNavigate) {
  container.innerHTML = `
    <div class="greeting">Hola 👋 ${escapeHtml(user.name || user.username)}</div>
    <div class="greeting-sub">¿Qué querés hacer hoy?</div>
    <div class="dashboard-grid">
      <button class="dash-card" data-key="clientes" style="border:none;text-align:left;">
        <h3>Clientes</h3>
        <p>Ver y gestionar tu cartera de clientes</p>
      </button>
      <button class="dash-card" data-key="productos" style="border:none;text-align:left;">
        <h3>Productos</h3>
        <p>Catálogo, precios y stock</p>
      </button>
      <div class="dash-card disabled">
        <h3>Contactos</h3>
        <p>Próximamente</p>
      </div>
      <div class="dash-card disabled">
        <h3>Pedidos</h3>
        <p>Próximamente</p>
      </div>
      <div class="dash-card disabled">
        <h3>Comisiones</h3>
        <p>Próximamente</p>
      </div>
    </div>
  `;
  container.querySelectorAll('.dash-card[data-key]').forEach(el => {
    el.addEventListener('click', () => onNavigate(el.dataset.key));
  });
}
