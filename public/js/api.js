const Api = {
  async request(method, url, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      if (isForm) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  patch(url, body) { return this.request('PATCH', url, body); },
  del(url) { return this.request('DELETE', url); },
  async upload(url, file) {
    const fd = new FormData();
    fd.append('photo', file);
    return this.request('POST', url, fd, true);
  }
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  return '$' + Number(v).toLocaleString('es-AR');
}
