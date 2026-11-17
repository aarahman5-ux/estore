const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function storefront(products) {
  const elements = new Map();
  const listeners = {};
  function element(selector) {
    if (!elements.has(selector)) {
      elements.set(selector, {
        innerHTML: '', textContent: '', value: selector === '#sort' ? 'featured' : '',
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(name, handler) { this[name] = handler; },
        scrollIntoView() {}
      });
    }
    return elements.get(selector);
  }
  const context = {
    document: { querySelector: element, addEventListener(name, handler) { listeners[name] = handler; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async () => ({ ok: true, json: async () => products }),
    console, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { element, listeners };
}
function product(id, name, category) {
  return { id, name, category, description: 'Example item', unit: '1 piece', price: 1000, original_price: null, stock: 3, image: 'https://example.com/image.jpg', featured: 0 };
}
test('storefront categories include suggested and admin-added categories without fake products', async () => {
  const page = await storefront([product(1, 'Tablet', 'electronics'), product(2, 'Sofa', 'Furniture'), product(3, 'Paintbrush', 'Arts & Crafts')]);
  const categories = page.element('#category-grid').innerHTML;
  assert.match(categories, /data-category="Electronics"[^]*1 product/);
  assert.match(categories, /data-category="Furniture"[^]*1 product/);
  assert.match(categories, /data-category="Household Essentials"[^]*No products yet/);
  assert.match(categories, /data-category="Arts &amp; Crafts"[^]*1 product/);
  assert.equal((categories.match(/data-category="Electronics"/g) || []).length, 1);
  assert.match(page.element('#filter-row').innerHTML, /data-category="Arts &amp; Crafts"/);
});
test('category cards clear previous search and all-products filter restores the catalog', async () => {
  const page = await storefront([product(1, 'Tablet', 'electronics'), product(2, 'Sofa', 'Furniture')]);
  page.element('#search').value = 'unrelated';
  page.element('#search').input({ target: page.element('#search') });
  const click = (category, card) => page.listeners.click({ target: { closest() { return { dataset: { category }, classList: { contains() { return card; } } }; } } });
  click('Electronics', true);
  assert.equal(page.element('#search').value, '');
  assert.match(page.element('#products-grid').innerHTML, /Tablet/);
  assert.doesNotMatch(page.element('#products-grid').innerHTML, /Sofa/);
  click('', false);
  assert.match(page.element('#products-grid').innerHTML, /Tablet/);
  assert.match(page.element('#products-grid').innerHTML, /Sofa/);
});
