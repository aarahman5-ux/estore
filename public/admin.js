const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = amount => `MVR ${(amount / 100).toFixed(2)}`;
let products = [];
const statuses = ['pending', 'confirmed', 'preparing', 'out for delivery', 'delivered', 'cancelled'];
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function showError(element, error) { element.textContent = error.message; element.classList.remove('hidden'); }
async function loadOrders() {
  const orders = await request('/api/admin/orders');
  $('#orders-list').innerHTML = orders.length ? orders.map(order => `<article class="order-card"><div class="order-card-top"><div><h3>Order #${order.id} · ${money(order.total)}</h3><p>${escapeHTML(order.customer_name)} · ${escapeHTML(order.phone)}<br>${escapeHTML(order.address)}<br>${escapeHTML(order.created_at)} UTC</p></div><label>Status <select data-order="${order.id}" ${order.status === 'cancelled' ? 'disabled' : ''}>${statuses.map(status => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></label></div><p>${order.items.map(item => `${item.quantity} × ${escapeHTML(item.name)} (${money(item.unit_price)})`).join('<br>')}</p>${order.notes ? `<p>Note: ${escapeHTML(order.notes)}</p>` : ''}<p>Cash on delivery · Delivery charge to be confirmed</p></article>`).join('') : '<p class="fine-print">No orders yet.</p>';
}
async function loadProducts() {
  products = await request('/api/products');
  $('#admin-products').innerHTML = products.map(product => `<div class="admin-item"><img src="${escapeHTML(product.image)}" alt=""><div class="admin-item-info"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.category)} · ${money(product.price)} · ${product.stock} in stock</small></div><button data-edit="${product.id}">Edit</button></div>`).join('');
}
async function showDashboard() {
  await Promise.all([loadOrders(), loadProducts()]);
  $('#login-view').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  $('#login-error').classList.add('hidden');
  try {
    await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: new FormData(form).get('password') }) });
    form.reset();
    await showDashboard();
  } catch (error) { showError($('#login-error'), error); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  try { await request('/api/admin/logout', { method: 'POST' }); location.reload(); }
  catch (error) { showError($('#admin-error'), error); }
});
$('#orders-tab').addEventListener('click', () => { $('#orders-tab').classList.add('active'); $('#products-tab').classList.remove('active'); $('#orders-panel').classList.remove('hidden'); $('#products-panel').classList.add('hidden'); });
$('#products-tab').addEventListener('click', () => { $('#products-tab').classList.add('active'); $('#orders-tab').classList.remove('active'); $('#products-panel').classList.remove('hidden'); $('#orders-panel').classList.add('hidden'); });
$('#refresh-orders').addEventListener('click', () => loadOrders().catch(error => showError($('#admin-error'), error)));
$('#orders-list').addEventListener('change', async event => {
  const select = event.target.closest('[data-order]');
  if (!select) return;
  select.disabled = true;
  $('#admin-error').classList.add('hidden');
  try {
    await request(`/api/admin/orders/${select.dataset.order}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value }) });
    await Promise.all([loadOrders(), loadProducts()]);
  } catch (error) {
    showError($('#admin-error'), error);
    try { await loadOrders(); } catch (reloadError) { showError($('#admin-error'), reloadError); }
  } finally { select.disabled = false; }
});
function openProduct(product) {
  const form = $('#product-form');
  form.reset();
  $('#product-error').classList.add('hidden');
  $('#product-form-title').textContent = product ? 'Edit product' : 'Add product';
  for (const name of ['id', 'name', 'category', 'unit', 'stock', 'image', 'description']) form.elements[name].value = product?.[name] ?? '';
  form.elements.price.value = product ? (product.price / 100).toFixed(2) : '';
  form.elements.original_price.value = product?.original_price != null ? (product.original_price / 100).toFixed(2) : '';
  form.elements.featured.checked = Boolean(product?.featured);
  $('#product-form-dialog').showModal();
}
$('#add-product').addEventListener('click', () => openProduct());
$('#admin-products').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (button) openProduct(products.find(product => product.id === Number(button.dataset.edit))); });
$('#close-product-form').addEventListener('click', () => $('#product-form-dialog').close());
$('#product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  const input = { name: data.get('name'), category: data.get('category'), unit: data.get('unit'), stock: Number(data.get('stock')), price: Math.round(Number(data.get('price')) * 100), original_price: data.get('original_price') === '' ? null : Math.round(Number(data.get('original_price')) * 100), image: data.get('image'), description: data.get('description'), featured: form.elements.featured.checked };
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  $('#product-error').classList.add('hidden');
  try {
    await request(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    $('#product-form-dialog').close();
    await loadProducts();
  } catch (error) { showError($('#product-error'), error); }
  finally { button.disabled = false; }
});
showDashboard().catch(error => { if (!error.message.includes('sign in')) showError($('#login-error'), error); });
