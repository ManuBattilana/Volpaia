function renderLogin(onSuccess) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="logo-wrap"><span class="brand">VOLPAIA</span></div>
        <h1>Gestión interna</h1>
        <p class="subtitle">Ingresá con tu usuario y contraseña</p>
        <form id="login-form">
          <input type="text" id="login-username" placeholder="Usuario" autocomplete="username" required>
          <input type="password" id="login-password" placeholder="Contraseña" autocomplete="current-password" required>
          <div class="login-error" id="login-error"></div>
          <button type="submit">Ingresar</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    try {
      const data = await Api.post('/api/login', { username, password });
      onSuccess(data.user);
    } catch (err) {
      errorEl.textContent = err.message || 'Error al iniciar sesión';
    }
  });
}
