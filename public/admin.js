const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = amount => `MVR ${(amount / 100).toFixed(2)}`;
const statuses = ['pending', 'confirmed', 'preparing', 'out for delivery', 'delivered', 'cancelled'];
const state = { user: null, products: [], staff: [], orderOffset: 0, productOffset: 0, orderTotal: 0, productTotal: 0, orderRequest: 0, productRequest: 0 };
const pageSize = 25;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.');
    error.status = response.status;
    if (response.status === 401 && state.user) showLogin('Your session expired. Please sign in again.');
    throw error;
  }
  return data;
}
function showError(element, error) {
  element.textContent = error.message;
  element.classList.remove('hidden');
}
function clearError(element) { element.classList.add('hidden'); }
function report(error) { showError($('#admin-error'), error); }
function post(url, method, data) {
  return request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
function dateTime(value) {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function statusBadge(status) {
  return `<span class="status-badge status-${escapeHTML(status.replaceAll(' ', '-'))}">${escapeHTML(status)}</span>`;
}
function orderRow(order) {
  return `<div class="order-row"><div class="order-number"><strong>#${order.id}</strong><small>${escapeHTML(dateTime(order.created_at))}</small></div><div class="order-customer"><strong>${escapeHTML(order.customer_name)}</strong><small>${order.phone ? escapeHTML(order.phone) : ''}</small></div>${statusBadge(order.status)}<strong class="row-total">${money(order.total)}</strong><button class="row-action" data-order="${order.id}">View →</button></div>`;
}
async function loadOverview() {
  const data = await request('/api/admin/overview');
  $('#metric-pending').textContent = data.pending;
  $('#metric-progress').textContent = data.in_progress;
  $('#metric-delivered').textContent = data.delivered;
  $('#metric-subtotal').textContent = `${money(data.delivered_subtotal)} order subtotal`;
  $('#metric-low').textContent = data.low_stock;
  $('#recent-orders').innerHTML = data.recent.length ? data.recent.map(orderRow).join('') : '<p class="empty-admin">No orders yet. New orders will appear here.</p>';
}
function pagination(type, offset, total) {
  $(`#${type}-prev`).disabled = offset === 0;
  $(`#${type}-next`).disabled = offset + pageSize >= total;
  $(`#${type}-count`).textContent = total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}` : 'No results';
}
async function loadOrders() {
  const sequence = ++state.orderRequest;
  const params = new URLSearchParams({ q: $('#order-search').value.trim(), status: $('#order-status-filter').value, limit: String(pageSize), offset: String(state.orderOffset) });
  const data = await request(`/api/admin/order-search?${params}`);
  if (sequence !== state.orderRequest) return;
  state.orderTotal = data.total;
  $('#orders-list').innerHTML = data.items.length ? data.items.map(orderRow).join('') : '<p class="empty-admin">No orders match your filters.</p>';
  pagination('orders', state.orderOffset, data.total);
}
async function loadProducts() {
  const sequence = ++state.productRequest;
  const params = new URLSearchParams({ q: $('#product-search').value.trim(), category: $('#product-category-filter').value, stock: $('#product-stock-filter').value, limit: String(pageSize), offset: String(state.productOffset) });
  const data = await request(`/api/admin/product-search?${params}`);
  if (sequence !== state.productRequest) return;
  state.products = data.items;
  state.productTotal = data.total;
  const category = $('#product-category-filter').value;
  $('#product-category-filter').innerHTML = `<option value="">All categories</option>${data.categories.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('')}`;
  $('#product-category-filter').value = category;
  $('#admin-products').innerHTML = data.items.length ? data.items.map(product => `<div class="admin-item"><img src="${escapeHTML(product.image)}" alt=""><div class="admin-item-info"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.category)} · ${money(product.price)} · ${escapeHTML(product.unit)}</small></div><span class="${product.stock <= 5 ? 'stock-alert' : 'stock-normal'}">${product.stock === 0 ? 'Out of stock' : `${product.stock} in stock`}</span><button data-edit="${product.id}">Edit</button></div>`).join('') : '<p class="empty-admin">No products match your filters.</p>';
  pagination('products', state.productOffset, data.total);
}
async function loadStaff() {
  state.staff = await request('/api/admin/staff');
  $('#staff-list').innerHTML = state.staff.map(person => `<div class="admin-item"><div class="staff-avatar">${escapeHTML(person.username.slice(0, 1).toUpperCase())}</div><div class="admin-item-info"><strong>${escapeHTML(person.username)} ${person.id === state.user.id ? '(you)' : ''}</strong><small>${escapeHTML(person.role)} · ${person.active ? 'Active' : 'Disabled'}</small></div>${person.id !== state.user.id ? `<button data-reset-staff="${person.id}">Reset password</button><button data-toggle-staff="${person.id}">${person.active ? 'Disable' : 'Enable'}</button>` : ''}</div>`).join('');
}
async function loadBackups() {
  const data = await request('/api/admin/backups');
  $('#backup-status').textContent = data.last_error ? `Last backup failed: ${data.last_error}` : data.running ? 'Backup in progress.' : data.last_success ? `Latest verified backup: ${dateTime(data.last_success)}` : 'Automatic backup has not completed yet.';
  $('#backup-status').classList.toggle('form-error', Boolean(data.last_error));
}
async function switchPanel(panel) {
  if (!['overview', 'orders', 'products', 'staff', 'backups'].includes(panel)) return;
  if (['staff', 'backups'].includes(panel) && state.user.role !== 'admin') return;
  document.querySelectorAll('.dashboard-panel').forEach(element => element.classList.add('hidden'));
  document.querySelectorAll('[data-panel]').forEach(element => element.classList.toggle('active', element.dataset.panel === panel));
  $(`#${panel}-panel`).classList.remove('hidden');
  clearError($('#admin-error'));
  try {
    await ({ overview: loadOverview, orders: loadOrders, products: loadProducts, staff: loadStaff, backups: loadBackups })[panel]();
  } catch (error) { report(error); }
}
async function showDashboard() {
  state.user = await request('/api/admin/me');
  $('#current-user').textContent = `${state.user.username} · ${state.user.role}`;
  document.querySelectorAll('.admin-only').forEach(element => element.classList.toggle('hidden', state.user.role !== 'admin'));
  $('#login-view').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  await switchPanel('overview');
}
function showLogin(message) {
  state.user = null;
  $('#dashboard').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  if (message) showError($('#login-error'), new Error(message));
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type=submit]');
  const data = new FormData(form);
  button.disabled = true;
  clearError($('#login-error'));
  try {
    await post('/api/admin/login', 'POST', { username: data.get('username'), password: data.get('password') });
    form.elements.password.value = '';
    await showDashboard();
  } catch (error) { showError($('#login-error'), error); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  try { await request('/api/admin/logout', { method: 'POST' }); showLogin(); }
  catch (error) { report(error); }
});
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => switchPanel(button.dataset.panel)));
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.close) $(`#${button.dataset.close}`).close();
  if (button.dataset.go) {
    if (button.dataset.go === 'orders') { state.orderOffset = 0; $('#order-search').value = ''; $('#order-status-filter').value = button.dataset.status || ''; }
    if (button.dataset.go === 'products') { state.productOffset = 0; $('#product-search').value = ''; $('#product-category-filter').value = ''; $('#product-stock-filter').value = button.dataset.stock || ''; }
    await switchPanel(button.dataset.go);
  }
  if (button.dataset.order) {
    try { await openOrder(Number(button.dataset.order)); } catch (error) { report(error); }
  }
  if (button.dataset.edit) openProduct(state.products.find(product => product.id === Number(button.dataset.edit)));
  if (button.dataset.resetStaff) openStaff(state.staff.find(person => person.id === Number(button.dataset.resetStaff)));
  if (button.dataset.toggleStaff) {
    const person = state.staff.find(item => item.id === Number(button.dataset.toggleStaff));
    if (!person || !confirm(`${person.active ? 'Disable' : 'Enable'} ${person.username}'s account?`)) return;
    button.disabled = true;
    try { await post(`/api/admin/staff/${person.id}`, 'PATCH', { active: !person.active }); await loadStaff(); }
    catch (error) { report(error); button.disabled = false; }
  }
});
$('#refresh-overview').addEventListener('click', () => loadOverview().catch(report));
$('#refresh-orders').addEventListener('click', () => loadOrders().catch(report));
$('#refresh-products').addEventListener('click', () => loadProducts().catch(report));
let orderTimer;
$('#order-search').addEventListener('input', () => { state.orderOffset = 0; clearTimeout(orderTimer); orderTimer = setTimeout(() => loadOrders().catch(report), 250); });
$('#order-status-filter').addEventListener('change', () => { state.orderOffset = 0; loadOrders().catch(report); });
let productTimer;
$('#product-search').addEventListener('input', () => { state.productOffset = 0; clearTimeout(productTimer); productTimer = setTimeout(() => loadProducts().catch(report), 250); });
['#product-category-filter', '#product-stock-filter'].forEach(selector => $(selector).addEventListener('change', () => { state.productOffset = 0; loadProducts().catch(report); }));
$('#orders-prev').addEventListener('click', () => { state.orderOffset = Math.max(0, state.orderOffset - pageSize); loadOrders().catch(report); });
$('#orders-next').addEventListener('click', () => { if (state.orderOffset + pageSize < state.orderTotal) { state.orderOffset += pageSize; loadOrders().catch(report); } });
$('#products-prev').addEventListener('click', () => { state.productOffset = Math.max(0, state.productOffset - pageSize); loadProducts().catch(report); });
$('#products-next').addEventListener('click', () => { if (state.productOffset + pageSize < state.productTotal) { state.productOffset += pageSize; loadProducts().catch(report); } });

async function openOrder(id) {
  const order = await request(`/api/admin/orders/${id}`);
  $('#order-title').textContent = `Order #${order.id}`;
  $('#order-detail').innerHTML = `<div class="order-detail-block"><div class="detail-line"><span>Status</span>${statusBadge(order.status)}</div><div class="detail-line"><span>Placed</span><strong>${escapeHTML(dateTime(order.created_at))}</strong></div><div class="detail-line"><span>Customer</span><strong>${escapeHTML(order.customer_name)}</strong></div><div class="detail-line"><span>Phone</span><strong>${escapeHTML(order.phone)}</strong></div><div class="detail-line"><span>Address</span><strong>${escapeHTML(order.address)}</strong></div>${order.notes ? `<div class="detail-line"><span>Notes</span><strong>${escapeHTML(order.notes)}</strong></div>` : ''}</div><h3>Items</h3>${order.items.map(item => `<div class="detail-line"><span>${item.quantity} × ${escapeHTML(item.name)}</span><strong>${money(item.quantity * item.unit_price)}</strong></div>`).join('')}<div class="detail-line detail-total"><span>Order subtotal</span><strong>${money(order.total)}</strong></div><p class="fine-print">Cash on delivery. Payment and delivery charges are not tracked here.</p><label class="detail-status">Update status<select id="order-status-update" ${order.status === 'cancelled' ? 'disabled' : ''}>${statuses.map(status => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><p class="form-error hidden" id="order-error" role="alert"></p><h3>Status history</h3><div class="history-list">${order.history.map(item => `<div><strong>${escapeHTML(item.status)}</strong><small>${escapeHTML(item.actor)} · ${escapeHTML(dateTime(item.created_at))}</small></div>`).join('')}</div>`;
  const select = $('#order-status-update');
  select.addEventListener('change', async () => {
    const next = select.value;
    if (next === 'cancelled' && !confirm('Cancel this order and restore its stock? Cancelled orders cannot be reopened.')) { select.value = order.status; return; }
    select.disabled = true;
    try {
      await post(`/api/admin/orders/${order.id}`, 'PATCH', { status: next });
      $('#order-dialog').close();
      await Promise.all([loadOrders(), loadOverview()]);
      await openOrder(order.id);
    } catch (error) {
      if ($('#order-dialog').open) showError($('#order-error'), error);
      else report(error);
      select.disabled = false;
      select.value = order.status;
    }
  });
  if (!$('#order-dialog').open) $('#order-dialog').showModal();
}
function openProduct(product) {
  const form = $('#product-form');
  form.reset();
  clearError($('#product-error'));
  $('#product-form-title').textContent = product ? 'Edit product' : 'Add product';
  for (const name of ['id', 'version', 'name', 'category', 'unit', 'stock', 'image', 'description']) form.elements[name].value = product?.[name] ?? '';
  form.elements.price.value = product ? (product.price / 100).toFixed(2) : '';
  form.elements.original_price.value = product?.original_price != null ? (product.original_price / 100).toFixed(2) : '';
  form.elements.featured.checked = Boolean(product?.featured);
  $('#product-form-dialog').showModal();
}
$('#add-product').addEventListener('click', () => openProduct());
$('#product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  const input = { name: data.get('name'), category: data.get('category'), unit: data.get('unit'), stock: Number(data.get('stock')), price: Math.round(Number(data.get('price')) * 100), original_price: data.get('original_price') === '' ? null : Math.round(Number(data.get('original_price')) * 100), image: data.get('image'), description: data.get('description'), featured: form.elements.featured.checked, ...(id ? { version: Number(data.get('version')) } : {}) };
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  clearError($('#product-error'));
  try {
    await post(id ? `/api/admin/products/${id}` : '/api/admin/products', id ? 'PUT' : 'POST', input);
    $('#product-form-dialog').close();
    try { await Promise.all([loadProducts(), loadOverview()]); } catch (error) { report(error); }
  } catch (error) { showError($('#product-error'), error); }
  finally { button.disabled = false; }
});
function openStaff(person) {
  const form = $('#staff-form');
  form.reset();
  form.elements.id.value = person?.id ?? '';
  $('#staff-form-title').textContent = person ? `Reset ${person.username}'s password` : 'Add staff member';
  $('#staff-identity').classList.toggle('hidden', Boolean(person));
  form.elements.username.required = !person;
  clearError($('#staff-error'));
  $('#staff-dialog').showModal();
}
$('#add-staff').addEventListener('click', () => openStaff());
$('#staff-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  clearError($('#staff-error'));
  try {
    const input = id ? { password: data.get('password') } : { username: data.get('username'), role: data.get('role'), password: data.get('password') };
    await post(id ? `/api/admin/staff/${id}` : '/api/admin/staff', id ? 'PATCH' : 'POST', input);
    form.reset();
    $('#staff-dialog').close();
    try { await loadStaff(); } catch (error) { report(error); }
  } catch (error) { showError($('#staff-error'), error); }
  finally { button.disabled = false; }
});
$('#change-password').addEventListener('click', () => { $('#password-form').reset(); clearError($('#password-error')); $('#password-dialog').showModal(); });
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  clearError($('#password-error'));
  try {
    await post('/api/admin/password', 'POST', { current_password: data.get('current_password'), new_password: data.get('new_password') });
    form.reset();
    $('#password-dialog').close();
    showLogin('Password changed. Please sign in again.');
  } catch (error) { showError($('#password-error'), error); }
  finally { button.disabled = false; }
});
$('#backup-now').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await request('/api/admin/backups', { method: 'POST' });
    await loadBackups();
    $('#backup-status').textContent = `Backup created: ${result.filename}`;
  } catch (error) { report(error); }
  finally { button.disabled = false; }
});
showDashboard().catch(error => { if (error.status !== 401) showError($('#login-error'), error); });
