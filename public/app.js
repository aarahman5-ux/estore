const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = amount => `MVR ${(amount / 100).toFixed(2)}`;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const suggestedCategories = [
  ['Electronics', '📱'], ['Furniture', '🛋️'], ['Household Essentials', '🧹']
];
const categoryIcons = new Map([...suggestedCategories,
  ['Fruits & Vegetables', '🍊'], ['Dairy & Eggs', '🥛'], ['Pantry Essentials', '🫙'],
  ['Beverages', '🧃'], ['Bakery', '🥐'], ['Snacks', '🍪']
].map(([name, emoji]) => [name.toLowerCase(), emoji]));
let products = [];
let cart = {};
let category = '';
let query = '';
let appliedCoupon = '';
let couponDiscount = 0;
let toastTimer;
try {
  const saved = JSON.parse(localStorage.getItem('island-basket-cart') || '{}');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [id, quantity] of Object.entries(saved)) {
      if (/^\d+(?::\d+)?$/.test(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 100) cart[id] = quantity;
    }
  }
} catch (error) {
  console.error('Could not read the saved basket:', error);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 3000);
}
function saveCart() {
  appliedCoupon = '';
  couponDiscount = 0;
  try { localStorage.setItem('island-basket-cart', JSON.stringify(cart)); }
  catch (error) { console.error('Could not save the basket:', error); toast('Your basket could not be saved on this device.'); }
}
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
async function loadProducts() {
  products = await request('/api/products');
  render();
  try {
    const settings=await request('/api/store-settings');
    if(settings && typeof settings.store_name==='string'){
      document.title=settings.page_title;
      document.querySelectorAll('.brand').forEach(brand=>{
        brand.innerHTML=`${settings.logo_url?`<img class="brand-logo" src="${escapeHTML(settings.logo_url)}" alt="">`:'<span class="brand-mark">✳</span>'}<span>${escapeHTML(settings.store_name)}<small>${escapeHTML(settings.tagline)}</small></span>`;
      });
      if(settings.favicon_url){
        let favicon=document.querySelector('link[rel="icon"]');
        if(!favicon){favicon=document.createElement('link');favicon.rel='icon';document.head.append(favicon);}
        favicon.href=settings.favicon_url;
      }
      const description=document.querySelector('meta[name="description"]');
      if(description)description.content=settings.tagline;
    }
  } catch(error) {
    console.error('Could not load store branding:',error);
    toast('Store branding could not be loaded.');
  }
}
function productCard(product) {
  const discount = product.original_price ? Math.round((1 - product.price / product.original_price) * 100) : 0;
  const variants = product.variants || [];
  const available = product.stock > 0 || variants.some(variant => variant.stock > 0);
  return `<article class="product-card">
    <div class="product-image-wrap"><img class="product-image" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
      ${!available ? '<span class="badge sold-out">OUT OF STOCK</span>' : discount ? `<span class="badge">SAVE ${discount}%</span>` : ''}
    </div>
    <div class="product-info"><span class="product-category">${escapeHTML(product.category)}</span>
      <button class="product-title" data-detail="${product.id}"><span class="product-name">${escapeHTML(product.name)}</span></button>
      <span class="product-unit">${escapeHTML(product.unit)}</span>
      <div class="product-bottom"><div class="price">${product.original_price ? `<span class="old-price">${money(product.original_price)}</span>` : ''}${variants.length ? 'Standard ' : ''}${money(product.price)}</div>
      <button class="add-button" ${variants.length ? `data-detail="${product.id}"` : `data-add="${product.id}"`} aria-label="${variants.length ? 'Choose options for' : 'Add'} ${escapeHTML(product.name)}" ${!available ? 'disabled' : ''}>${icon('plus')}</button></div>
    </div></article>`;
}
function renderCategories() {
  const categories = new Map(suggestedCategories.map(([name]) => [name.toLowerCase(), name]));
  for (const product of products) {
    const key = product.category.toLowerCase();
    if (!categories.has(key)) categories.set(key, product.category);
  }
  const names = [...categories.values()];
  $('#category-grid').innerHTML = names.map(name => {
    const count = products.filter(product => product.category.toLowerCase() === name.toLowerCase()).length;
    return `<button class="category-card" data-category="${escapeHTML(name)}"><span class="category-image">${categoryIcons.get(name.toLowerCase()) || '🛍️'}</span><strong>${escapeHTML(name)}</strong><small>${count ? `${count} ${count === 1 ? 'product' : 'products'}` : 'No products yet'}</small></button>`;
  }).join('');
  $('#filter-row').innerHTML = `<button class="filter-button ${!category ? 'active' : ''}" data-category="">All products</button>` +
    names.map(name => `<button class="filter-button ${name.toLowerCase() === category.toLowerCase() ? 'active' : ''}" data-category="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('');
}
function renderProducts() {
  let visible = products.filter(product => (!category || product.category.toLowerCase() === category.toLowerCase()) && `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query));
  const sort = $('#sort').value;
  if (sort === 'price-low') visible.sort((a, b) => a.price - b.price);
  else if (sort === 'price-high') visible.sort((a, b) => b.price - a.price);
  else if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name));
  else visible.sort((a, b) => b.featured - a.featured || a.id - b.id);
  $('#products-grid').innerHTML = visible.map(productCard).join('');
  $('#empty-products').classList.toggle('hidden', visible.length > 0);
  $('#results-label').textContent = query || category ? `${visible.length} ${visible.length === 1 ? 'product' : 'products'} found.` : 'A little something for everyone.';
  $('#offers-grid').innerHTML = products.filter(product => product.original_price && product.stock > 0).slice(0, 4).map(productCard).join('');
}
function cartItem(key) {
  const [id, variantId] = key.split(':').map(Number);
  const product = products.find(item => item.id === id);
  const variant = variantId ? (product?.variants || []).find(item => item.id === variantId) : null;
  return product && (!variantId || variant) ? { product, variant } : null;
}
function renderCart() {
  const items = Object.entries(cart).map(([key, quantity]) => ({ key, selection: cartItem(key), quantity }));
  const quantity = Object.values(cart).reduce((sum, amount) => sum + amount, 0);
  const subtotal = items.reduce((sum, item) => sum + (item.selection ? (item.selection.variant || item.selection.product).price * item.quantity : 0), 0);
  couponDiscount = Math.min(couponDiscount, subtotal);
  const total = subtotal - couponDiscount;
  $('#cart-count').textContent = quantity;
  $('#cart-summary').textContent = `${quantity} ${quantity === 1 ? 'item' : 'items'}`;
  $('#cart-total').textContent = money(total);
  $('#checkout-total').textContent = money(total);
  $('#checkout-open').disabled = items.length === 0 || items.some(item => !item.selection);
  $('#cart-items').innerHTML = items.length ? items.map(({ key, selection, quantity: amount }) => {
    if (!selection) return `<div class="cart-item"><div class="cart-item-info"><strong>Item no longer available</strong></div><button class="remove-item" data-remove="${escapeHTML(key)}">Remove</button></div>`;
    const { product, variant } = selection;
    const price = (variant || product).price;
    return `<div class="cart-item">
    <img src="${escapeHTML(product.image)}" alt=""><div class="cart-item-info"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(variant ? variant.name : product.unit)} · ${money(price)}</small>
    <div class="quantity"><button data-decrease="${escapeHTML(key)}" aria-label="Decrease ${escapeHTML(product.name)} quantity">−</button><span>${amount}</span><button data-add="${escapeHTML(key)}" aria-label="Increase ${escapeHTML(product.name)} quantity">+</button></div></div>
    <div class="cart-item-price">${money(price * amount)}<button class="remove-item" data-remove="${escapeHTML(key)}">Remove</button></div></div>`;
  }).join('') : '<p class="cart-empty">Your basket is empty.<br>Let’s find something good!</p>';
}
function render() { renderCategories(); renderProducts(); renderCart(); }
function setCategory(name) {
  category = name;
  renderCategories();
  renderProducts();
  $('#shop').scrollIntoView({ behavior: 'smooth' });
}
function add(key) {
  const selection = cartItem(key);
  if (!selection) return toast('This item is no longer available. Please refresh.');
  const { product, variant } = selection;
  if ((cart[key] || 0) >= Math.min((variant || product).stock, 100)) return toast('No more of this product is currently available.');
  cart[key] = (cart[key] || 0) + 1;
  saveCart();
  renderCart();
  toast(`${product.name} added to your basket`);
}
function openCart() {
  $('#overlay').classList.remove('hidden');
  $('#cart-drawer').classList.add('open');
  $('#cart-drawer').setAttribute('aria-hidden', 'false');
  $('#cart-close').focus();
}
function closeCart() {
  $('#overlay').classList.add('hidden');
  $('#cart-drawer').classList.remove('open');
  $('#cart-drawer').setAttribute('aria-hidden', 'true');
}
function showDetail(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  const variants = product.variants || [];
  const available = product.stock > 0 || variants.some(variant => variant.stock > 0);
  const options = variants.length ? `<label>Choose an option<select id="detail-variant"><option value="" ${product.stock === 0 ? 'disabled' : ''}>Standard · ${money(product.price)}${product.stock === 0 ? ' · Out of stock' : ''}</option>${variants.map(variant => `<option value="${variant.id}" ${variant.stock === 0 ? 'disabled' : ''}>${escapeHTML(variant.name)} · ${money(variant.price)}${variant.stock === 0 ? ' · Out of stock' : ''}</option>`).join('')}</select></label>` : '';
  $('#product-detail').innerHTML = `<img class="detail-image" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}"><p class="product-category">${escapeHTML(product.category)}</p><h2>${escapeHTML(product.name)}</h2><p class="dialog-intro">${escapeHTML(product.description)}</p><p>${escapeHTML(product.unit)} · Standard ${money(product.price)}</p>${options}<button class="button button-dark full-width" data-add="${product.id}" ${variants.length ? 'data-select-variant="true"' : ''} ${!available ? 'disabled' : ''}>${!available ? 'Out of stock' : 'Add to basket'} ${icon('plus')}</button>`;
  $('#product-dialog').showModal();
}
document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.add) {
    const variant = target.dataset.selectVariant ? $('#detail-variant').value : '';
    add(variant ? `${target.dataset.add}:${variant}` : target.dataset.add);
  }
  if (target.dataset.detail) showDetail(Number(target.dataset.detail));
  if (Object.hasOwn(target.dataset, 'category')) {
    if (target.classList.contains('category-card')) { query = ''; $('#search').value = ''; }
    setCategory(target.dataset.category);
  }
  if (target.dataset.decrease) {
    const id = target.dataset.decrease;
    if (--cart[id] <= 0) delete cart[id];
    saveCart(); renderCart();
  }
  if (target.dataset.remove) { delete cart[target.dataset.remove]; saveCart(); renderCart(); }
});
$('#all-categories').addEventListener('click', () => { category = ''; query = ''; $('#search').value = ''; renderCategories(); renderProducts(); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); query = $('#search').value.trim().toLowerCase(); category = ''; renderCategories(); renderProducts(); $('#shop').scrollIntoView({ behavior: 'smooth' }); });
$('#search').addEventListener('input', event => { query = event.target.value.trim().toLowerCase(); renderProducts(); });
$('#sort').addEventListener('change', renderProducts);
$('#contact-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type=submit]');
  const data = new FormData(form);
  button.disabled = true;
  $('#contact-result').textContent = '';
  try {
    await request('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data)) });
    form.reset();
    $('#contact-result').textContent = 'Your message has been sent to the store.';
  } catch (error) { $('#contact-result').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#cart-open').addEventListener('click', openCart);
$('#cart-close').addEventListener('click', closeCart);
$('#continue-shopping').addEventListener('click', closeCart);
$('#overlay').addEventListener('click', closeCart);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#cart-drawer').classList.contains('open')) closeCart(); });
$('#checkout-open').addEventListener('click', async () => {
  closeCart();
  $('#checkout-error').classList.add('hidden');
  $('#place-order').disabled = true;
  appliedCoupon = '';
  couponDiscount = 0;
  $('#coupon-code').value = '';
  $('#coupon-message').textContent = '';
  $('#checkout-total').textContent = money(Object.entries(cart).reduce((sum,[key,amount])=>{const selection=cartItem(key);return sum+(selection?(selection.variant||selection.product).price*amount:0);},0));
  $('#bank-details').textContent = 'Loading bank details…';
  $('#checkout-dialog').showModal();
  try {
    const bank = await request('/api/payment-settings');
    if (!bank) { $('#bank-details').textContent = 'Bank transfer is not configured. Please contact the store.'; return; }
    $('#bank-details').textContent = `Bank: ${bank.bank_name}\nAccount name: ${bank.account_name}\nAccount number: ${bank.account_number}${bank.instructions ? `\n${bank.instructions}` : ''}`;
    $('#place-order').disabled = false;
  } catch (error) {
    console.error(error);
    $('#bank-details').textContent = 'Could not load bank details. Close checkout and try again.';
  }
});
$('#apply-coupon').addEventListener('click', async event => {
  const button=event.currentTarget;
  const code=$('#coupon-code').value.trim();
  const subtotal=Object.entries(cart).reduce((sum,[key,amount])=>{const selection=cartItem(key);return sum+(selection?(selection.variant||selection.product).price*amount:0);},0);
  button.disabled=true;
  $('#coupon-message').textContent='';
  try{
    const result=await request('/api/coupons/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,subtotal})});
    appliedCoupon=result.code;couponDiscount=result.discount;
    $('#coupon-message').textContent=`${result.code} applied · ${money(result.discount)} off`;
    $('#checkout-total').textContent=money(result.total);
  }catch(error){appliedCoupon='';couponDiscount=0;$('#coupon-message').textContent=error.message;}
  finally{button.disabled=false;}
});
$('#checkout-close').addEventListener('click', () => $('#checkout-dialog').close());
$('#product-close').addEventListener('click', () => $('#product-dialog').close());
$('#success-close').addEventListener('click', () => $('#success-dialog').close());
$('#checkout-form').addEventListener('submit', async event => {
  event.preventDefault();
  const checkoutForm = event.currentTarget;
  const button = $('#place-order');
  button.disabled = true;
  $('#checkout-error').classList.add('hidden');
  const form = new FormData(checkoutForm);
  try {
    const file = form.get('payment_proof');
    if (!file || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Upload a JPG, PNG, or PDF slip no larger than 5 MB.');
    const proof = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('Could not read the payment slip.'));
      reader.onerror = () => reject(new Error('Could not read the payment slip.'));
      reader.readAsDataURL(file);
    });
    const order = await request('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), phone: form.get('phone'), address: form.get('address'), notes: form.get('notes'), payment_proof: proof, ...(appliedCoupon?{coupon_code:appliedCoupon}:{}), expected_total: Object.entries(cart).reduce((total, [key, quantity]) => { const selection = cartItem(key); if (!selection) throw new Error('Remove unavailable items before checkout.'); return total + (selection.variant || selection.product).price * quantity; }, 0)-couponDiscount, items: Object.entries(cart).map(([key, quantity]) => { const [id, variant] = key.split(':').map(Number); return { product_id: id, ...(variant ? { variant_id: variant } : {}), quantity }; }) })
    });
    cart = {}; saveCart(); renderCart();
    appliedCoupon = ''; couponDiscount = 0;
    checkoutForm.reset();
    $('#checkout-dialog').close();
    $('#success-message').textContent = `Your order #${order.id} has been placed. Subtotal: ${money(order.total)}. Your payment is awaiting verification.`;
    $('#success-dialog').showModal();
    try { await loadProducts(); } catch (error) { console.error(error); toast('Order placed, but products could not be refreshed.'); }
  } catch (error) {
    $('#checkout-error').textContent = error.message;
    $('#checkout-error').classList.remove('hidden');
    try { await loadProducts(); } catch (refreshError) { console.error(refreshError); toast('Could not refresh the product list.'); }
  } finally { button.disabled = false; }
});
$('#year').textContent = new Date().getFullYear();
loadProducts().catch(error => { console.error(error); $('#results-label').textContent = 'Products could not be loaded. Please refresh the page.'; toast('Could not load products. Please refresh the page.'); });
