const CATEGORIES = ['Conjunto', 'Bombacha lisa', 'Bombacha estampada', 'Otro'];

const ProdState = { category: null, search: '', viewMode: 'grid', globalSearch: '' };

const PRODUCTS_CSV_COLUMNS = [
  'id', 'code', 'description', 'category', 'size', 'size_curve', 'colors',
  'sale_dozen', 'sale_pack3', 'sale_unit',
  'price_dozen', 'price_pack3', 'price_unit',
  'stock_immediate', 'stock_order',
];

// Parser de CSV chico pero correcto con comillas: soporta campos con comas,
// comillas dobles escapadas ("") y saltos de línea dentro de un campo — lo
// que exporta Excel al guardar un .csv con textos que tienen comas.
function parseProductsCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // ignorado, \n hace el corte de línea
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const nonEmptyRows = rows.filter(r => r.some(cell => cell.trim() !== ''));
  if (nonEmptyRows.length === 0) return [];
  const header = nonEmptyRows[0].map(h => h.trim());
  return nonEmptyRows.slice(1).map(cells => {
    const obj = {};
    header.forEach((key, idx) => { obj[key] = (cells[idx] !== undefined ? cells[idx] : '').trim(); });
    return obj;
  });
}

async function renderProductosCategorias(container, onOpenCategory, onGlobalSearch) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Productos</h2>
      <div class="page-actions">
        <button class="btn btn-secondary" id="btn-export-products">Exportar a Excel</button>
        <button class="btn btn-secondary" id="btn-import-products">Importar desde Excel</button>
        <input type="file" id="import-products-file" accept=".csv" hidden>
      </div>
    </div>
    <div id="import-products-msg" style="margin-bottom:10px;font-size:13px;"></div>
    <div class="search-bar">
      <input type="text" id="global-search" placeholder="Buscar producto en todo el catálogo...">
    </div>
    <div class="card-grid" id="category-grid"></div>
  `;

  document.getElementById('btn-export-products').addEventListener('click', () => {
    window.open('/api/products/export', '_blank');
  });
  const importInput = document.getElementById('import-products-file');
  document.getElementById('btn-import-products').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    const msg = document.getElementById('import-products-msg');
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Importando...';
    try {
      const text = await file.text();
      const rows = parseProductsCsv(text);
      const result = await Api.post('/api/products/import', { rows });
      msg.style.color = '#2e7d32';
      msg.textContent = `Importación lista: ${result.created} nuevo(s), ${result.updated} actualizado(s).`;
      renderProductosCategorias(container, onOpenCategory, onGlobalSearch);
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message || 'No se pudo importar el archivo.';
    }
    importInput.value = '';
  });

  const summary = await Api.get('/api/products/categories/summary');
  const counts = {};
  summary.categories.forEach(c => { counts[c.category] = c.count; });

  const grid = document.getElementById('category-grid');
  const allCats = [...CATEGORIES, 'Todas'];
  grid.innerHTML = allCats.map(cat => `
    <button class="category-card" data-cat="${escapeHtml(cat)}">
      ${escapeHtml(cat)}
      <span class="count">${cat === 'Todas' ? summary.total : (counts[cat] || 0)} producto(s)</span>
    </button>
  `).join('');

  grid.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => onOpenCategory(btn.dataset.cat));
  });

  const searchInput = document.getElementById('global-search');
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const val = searchInput.value.trim();
      if (val) onGlobalSearch(val);
    }, 300);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && searchInput.value.trim()) onGlobalSearch(searchInput.value.trim());
  });
}

function stockBadge(p) {
  if (p.stock_immediate) return '<span class="stock-badge">Stock inmediato</span>';
  if (p.stock_order) return '<span class="stock-badge order">Solo por pedido</span>';
  return '';
}

function productCardGrid(p) {
  return `
    <div class="product-card" data-id="${p.id}">
      <div class="thumb">${p.photo1 ? `<img src="${p.photo1}" alt="">` : 'Sin foto'}</div>
      <div class="info">
        <div class="code">${escapeHtml(p.code || 'Sin código')}</div>
        <div class="desc">${escapeHtml(p.description || '')}</div>
        ${stockBadge(p)}
      </div>
    </div>
  `;
}

function productRowList(p) {
  return `
    <div class="product-list-row" data-id="${p.id}">
      <div class="thumb-sm">${p.photo1 ? `<img src="${p.photo1}" alt="">` : 'Sin foto'}</div>
      <div class="info">
        <div class="code">${escapeHtml(p.code || 'Sin código')}</div>
        <div class="desc">${escapeHtml(p.description || '')} ${p.category ? '· ' + escapeHtml(p.category) : ''}</div>
        ${stockBadge(p)}
      </div>
    </div>
  `;
}

async function renderProductosLista(container, category, onOpen, onBack, presetSearch) {
  ProdState.category = category;
  ProdState.search = presetSearch || '';

  container.innerHTML = `
    <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver a categorías</button>
    <div class="page-header">
      <h2>${escapeHtml(category)}</h2>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-product">+ Nuevo producto</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="text" id="prod-search" placeholder="Buscar en esta categoría..." style="flex:1;min-width:220px;padding:11px 14px;border-radius:8px;border:1px solid var(--border);">
      <div class="view-toggle">
        <button data-mode="grid" class="${ProdState.viewMode === 'grid' ? 'active' : ''}">Grilla</button>
        <button data-mode="list" class="${ProdState.viewMode === 'list' ? 'active' : ''}">Lista</button>
      </div>
    </div>
    <div id="products-container"></div>
  `;

  document.getElementById('btn-back').addEventListener('click', onBack);
  document.getElementById('btn-new-product').addEventListener('click', () => onOpen(null, category));

  const searchInput = document.getElementById('prod-search');
  searchInput.value = ProdState.search;
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ProdState.search = searchInput.value.trim(); refresh(); }, 250);
  });

  container.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      ProdState.viewMode = btn.dataset.mode;
      container.querySelectorAll('.view-toggle button').forEach(b => b.classList.toggle('active', b === btn));
      refresh();
    });
  });

  async function refresh() {
    const params = new URLSearchParams();
    if (category !== 'Todas') params.set('category', category);
    if (ProdState.search) params.set('q', ProdState.search);
    const products = await Api.get('/api/products?' + params.toString());
    const listEl = document.getElementById('products-container');
    if (products.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No se encontraron productos.</div>`;
      return;
    }
    if (ProdState.viewMode === 'grid') {
      listEl.innerHTML = `<div class="product-grid">${products.map(productCardGrid).join('')}</div>`;
      listEl.querySelectorAll('.product-card').forEach(el => el.addEventListener('click', () => onOpen(Number(el.dataset.id), category)));
    } else {
      listEl.innerHTML = `<div class="list-view">${products.map(productRowList).join('')}</div>`;
      listEl.querySelectorAll('.product-list-row').forEach(el => el.addEventListener('click', () => onOpen(Number(el.dataset.id), category)));
    }
  }

  await refresh();
}

function lightbox(photos, startIndex) {
  let idx = startIndex;
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  function draw() {
    overlay.innerHTML = `
      <button class="lightbox-close">&times;</button>
      ${photos.length > 1 ? '<button class="lightbox-nav prev">&#8249;</button>' : ''}
      <img src="${photos[idx]}" alt="">
      ${photos.length > 1 ? '<button class="lightbox-nav next">&#8250;</button>' : ''}
    `;
    overlay.querySelector('.lightbox-close').addEventListener('click', () => overlay.remove());
    const prev = overlay.querySelector('.lightbox-nav.prev');
    const next = overlay.querySelector('.lightbox-nav.next');
    if (prev) prev.addEventListener('click', (e) => { e.stopPropagation(); idx = (idx - 1 + photos.length) % photos.length; draw(); });
    if (next) next.addEventListener('click', (e) => { e.stopPropagation(); idx = (idx + 1) % photos.length; draw(); });
  }
  draw();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function renderProductoDetail(container, productId, defaultCategory, onBack, onDeleted) {
  let product = productId ? await Api.get(`/api/products/${productId}`) : {
    code: '', description: '', category: defaultCategory && defaultCategory !== 'Todas' ? defaultCategory : CATEGORIES[0],
    size: '', size_curve: '', colors: '',
    sale_dozen: 0, sale_pack3: 0, sale_unit: 0,
    price_dozen: '', price_pack3: '', price_unit: '',
    stock_immediate: 0, stock_order: 0,
    price_history: '', photo1: null, photo2: null, photo3: null
  };
  let editing = !productId;
  let pendingPhotos = { photo1: product.photo1, photo2: product.photo2, photo3: product.photo3 };

  function draw() {
    const photos = [pendingPhotos.photo1, pendingPhotos.photo2, pendingPhotos.photo3].filter(Boolean);

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">${productId ? 'PRODUCTO' : 'NUEVO PRODUCTO'}</div>
          <h1>${escapeHtml(product.code || 'Sin código')}</h1>
        </div>
        <div class="detail-actions">
          ${!editing ? `
            <button class="btn btn-secondary" id="btn-edit">Editar</button>
            ${productId ? '<button class="btn btn-danger" id="btn-delete">Eliminar</button>' : ''}
          ` : `
            <button class="btn btn-primary" id="btn-save">Guardar</button>
            <button class="btn btn-ghost" id="btn-cancel">Cancelar</button>
          `}
        </div>
      </div>

      <div style="display:flex; gap:24px; flex-wrap:wrap;">
        <div style="flex:0 0 auto;">
          <div class="photo-stack" id="photo-stack">
            ${[1,2,3].map(n => photoSlot(n)).join('')}
          </div>
        </div>
        <div style="flex:1; min-width:280px;">
          <div class="detail-section">
            <h3>Datos del producto</h3>
            <div class="field-grid">
              ${textField('code', 'Código de artículo')}
              ${textField('description', 'Descripción', true)}
              ${categoryField()}
              ${textField('size', 'Talle')}
              ${textField('size_curve', 'Curva de talles')}
              ${textField('colors', 'Colores', true)}
            </div>
          </div>

          <div class="detail-section">
            <h3>Presentación de venta</h3>
            <div class="checkbox-row">
              ${checkboxField('sale_dozen', 'Docena')}
              ${checkboxField('sale_pack3', 'Pack x3')}
              ${checkboxField('sale_unit', 'Unidad')}
            </div>
            <div class="price-grid" style="margin-top:16px;">
              ${priceField('price_dozen', 'Precio Docena')}
              ${priceField('price_pack3', 'Precio Pack x3')}
              ${priceField('price_unit', 'Precio Unidad')}
            </div>
          </div>

          <div class="detail-section">
            <h3>Estado de stock</h3>
            <div class="checkbox-row">
              ${checkboxField('stock_immediate', 'Con stock inmediato')}
              ${checkboxField('stock_order', 'Solo por pedido')}
            </div>
          </div>

          <div class="detail-section">
            <h3>Historial de precios</h3>
            <div class="history-box">${escapeHtml(product.price_history) ? escapeHtml(product.price_history).replace(/\n/g, '<br>') : 'Sin historial todavía.'}</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    [1,2,3].forEach(n => {
      const key = 'photo' + n;
      const slot = document.getElementById('slot-' + n);
      const img = slot.querySelector('img');
      if (img) {
        img.addEventListener('click', (e) => {
          if (editing) return;
          e.stopPropagation();
          const startIdx = photos.indexOf(pendingPhotos[key]);
          lightbox(photos, startIdx >= 0 ? startIdx : 0);
        });
      }
      if (editing) {
        const input = slot.querySelector('input[type=file]');
        if (input) {
          input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
              const res = await Api.upload('/api/upload', file);
              pendingPhotos[key] = res.url;
              draw();
            } catch (err) {
              alert(err.message);
            }
          });
        }
        const removeBtn = slot.querySelector('.remove-photo');
        if (removeBtn) {
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingPhotos[key] = null;
            draw();
          });
        }
      }
    });

    if (!editing) {
      const editBtn = document.getElementById('btn-edit');
      if (editBtn) editBtn.addEventListener('click', () => { editing = true; draw(); });
      const delBtn = document.getElementById('btn-delete');
      if (delBtn) delBtn.addEventListener('click', () => {
        confirmModal({
          title: 'Eliminar producto',
          message: `¿Seguro que querés eliminar "${product.code || 'este producto'}"? Esta acción no se puede deshacer.`,
          onConfirm: async () => {
            await Api.del(`/api/products/${productId}`);
            onDeleted();
          }
        });
      });
    } else {
      document.getElementById('btn-save').addEventListener('click', async () => {
        const payload = { ...pendingPhotos };
        container.querySelectorAll('[data-field]').forEach(el => {
          const key = el.dataset.field;
          if (el.type === 'checkbox') payload[key] = el.checked ? 1 : 0;
          else payload[key] = el.value;
        });
        try {
          if (productId) {
            product = await Api.put(`/api/products/${productId}`, payload);
          } else {
            product = await Api.post('/api/products', payload);
            productId = product.id;
          }
          pendingPhotos = { photo1: product.photo1, photo2: product.photo2, photo3: product.photo3 };
          editing = false;
          draw();
        } catch (err) {
          alert(err.message);
        }
      });
      document.getElementById('btn-cancel').addEventListener('click', () => {
        if (!productId) { onBack(); return; }
        pendingPhotos = { photo1: product.photo1, photo2: product.photo2, photo3: product.photo3 };
        editing = false;
        draw();
      });
    }
  }

  function photoSlot(n) {
    const key = 'photo' + n;
    const url = pendingPhotos[key];
    return `
      <div class="photo-slot" id="slot-${n}">
        ${url ? `<img src="${url}" alt="Foto ${n}">` : `<div class="placeholder">Foto ${n}${editing ? '<br>(hacé click para subir)' : ''}</div>`}
        ${editing ? '<input type="file" accept="image/*">' : ''}
        ${editing && url ? '<button class="remove-photo" type="button">&times;</button>' : ''}
      </div>
    `;
  }

  function textField(key, label, full) {
    const val = product[key] || '';
    if (editing) {
      return `<div class="field ${full ? 'full' : ''}"><label>${label}</label><input type="text" data-field="${key}" value="${escapeHtml(val)}"></div>`;
    }
    return `<div class="field ${full ? 'full' : ''}"><label>${label}</label><div class="value ${val ? '' : 'empty'}">${val ? escapeHtml(val) : 'Sin datos'}</div></div>`;
  }

  function categoryField() {
    if (editing) {
      const opts = CATEGORIES.map(c => `<option value="${c}" ${c === product.category ? 'selected' : ''}>${c}</option>`).join('');
      return `<div class="field"><label>Categoría</label><select data-field="category">${opts}</select></div>`;
    }
    return `<div class="field"><label>Categoría</label><div class="value">${escapeHtml(product.category || '')}</div></div>`;
  }

  function checkboxField(key, label) {
    const checked = !!product[key];
    if (editing) {
      return `<label><input type="checkbox" data-field="${key}" ${checked ? 'checked' : ''}> ${label}</label>`;
    }
    return `<label style="opacity:${checked ? 1 : 0.4};">${checked ? '✓' : '—'} ${label}</label>`;
  }

  function priceField(key, label) {
    const val = product[key];
    if (editing) {
      return `<div class="field"><label>${label}</label><input type="number" step="0.01" data-field="${key}" value="${val ?? ''}"></div>`;
    }
    return `<div class="field"><label>${label}</label><div class="value ${val ? '' : 'empty'}">${val ? formatMoney(val) : 'Sin definir'}</div></div>`;
  }

  draw();
}
