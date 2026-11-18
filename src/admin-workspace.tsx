import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';

type Product = { id: number; name: string; category: string; stock: number };
type ProductPage = { items: Product[]; total: number };
type Variant = { id: number; name: string; price: number; stock: number; version: number };
type LowVariant = { id: number; name: string; product_name: string; stock: number };
const formatMoney = (amount: number) => `MVR ${(amount / 100).toFixed(2)}`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.');
  return data as T;
}

function Inventory() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ProductPage>({ items: [], total: 0 });
  const [selected, setSelected] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lowVariants, setLowVariants] = useState<{ items: LowVariant[]; total: number }>({ items: [], total: 0 });
  const [lowOffset, setLowOffset] = useState(0);
  const [editing, setEditing] = useState<Variant | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const reset = () => { setEditing(null); setName(''); setPrice(''); setStock(''); };

  useEffect(() => {
    const open = () => { setOpened(true); setRefresh(value => value + 1); };
    window.addEventListener('inventory:open', open);
    return () => window.removeEventListener('inventory:open', open);
  }, []);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: search, limit: '20', offset: String(offset) });
    request<ProductPage>(`/api/admin/product-search?${params}`, { signal: controller.signal })
      .then(setPage)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load products.'); });
    return () => controller.abort();
  }, [search, offset, opened, refresh]);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    request<{ items: LowVariant[]; total: number }>(`/api/admin/low-variants?limit=10&offset=${lowOffset}`, { signal: controller.signal })
      .then(data => {
        setLowVariants(data);
        if (lowOffset > 0 && lowOffset >= data.total) setLowOffset(Math.max(0, Math.ceil(data.total / 10 - 1) * 10));
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load low stock variants.'); });
    return () => controller.abort();
  }, [opened, refresh, lowOffset]);

  const loadVariants = useCallback(async (productId: number) => {
    const data = await request<Variant[]>(`/api/admin/products/${productId}/variants`);
    setVariants(data);
  }, []);

  useEffect(() => {
    if (!selected || !opened) return;
    const controller = new AbortController();
    request<Variant[]>(`/api/admin/products/${selected.id}/variants`, { signal: controller.signal })
      .then(setVariants)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load variants.'); });
    return () => controller.abort();
  }, [selected, opened, refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const path = `/api/admin/products/${selected.id}/variants${editing ? `/${editing.id}` : ''}`;
      await request(path, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price: Math.round(Number(price) * 100), stock: Number(stock), ...(editing ? { version: editing.version } : {}) })
      });
      reset();
      await loadVariants(selected.id);
      setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save variant.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="panel-heading"><div><span className="section-kicker">SINGLE LOCATION</span><h2>Variants &amp; stock</h2><p className="fine-print">Create separately priced options and manage their stock.</p></div><button className="filter-button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="admin-card low-variants">
      <h2>Low-stock variants <span>({lowVariants.total})</span></h2>
      <p className="fine-print">Options with five or fewer units. Standard stock is shown on Overview.</p>
      {lowVariants.items.length ? <ul>{lowVariants.items.map(item => <li key={item.id}><strong>{item.product_name} · {item.name}</strong><span>{item.stock === 0 ? 'Out of stock' : `${item.stock} left`}</span></li>)}</ul> : <p className="fine-print">No low-stock variants.</p>}
      {lowVariants.total > 10 && <div className="pagination"><button className="filter-button" disabled={lowOffset === 0} onClick={() => setLowOffset(Math.max(0, lowOffset - 10))}>Previous variants</button><span>{lowOffset + 1}–{Math.min(lowOffset + 10, lowVariants.total)} of {lowVariants.total}</span><button className="filter-button" disabled={lowOffset + 10 >= lowVariants.total} onClick={() => setLowOffset(lowOffset + 10)}>Next variants</button></div>}
    </section>
    <div className="inventory-layout">
      <section className="admin-card">
        <h2>Choose a product</h2>
        <form onSubmit={event => { event.preventDefault(); setError(''); setOffset(0); setSearch(query.trim()); }}>
          <label>Search products<input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
          <button className="filter-button" type="submit">Search</button>
        </form>
        <div className="inventory-products">{page.items.length ? page.items.map(product =>
          <button key={product.id} className={selected?.id === product.id ? 'inventory-product selected' : 'inventory-product'} disabled={busy} onClick={() => { setSelected(product); setVariants([]); setError(''); reset(); }} aria-pressed={selected?.id === product.id}>
            <strong>{product.name}</strong><small>{product.category} · {product.stock} standard stock</small>
          </button>
        ) : <p className="fine-print">No products found.</p>}</div>
        <div className="pagination"><button className="filter-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button><span>{page.total ? `${offset + 1}–${Math.min(offset + 20, page.total)} of ${page.total}` : 'No results'}</span><button className="filter-button" disabled={offset + 20 >= page.total} onClick={() => setOffset(offset + 20)}>Next</button></div>
      </section>
      <section className="admin-card">
        {selected ? <>
          <h2>{selected.name}</h2><p className="fine-print">Standard stock remains separate and can be edited in Products. Each option has its own price and stock; customers can also buy the standard item.</p>
          <div className="admin-list">{variants.length ? variants.map(variant =>
            <div className="admin-item" key={variant.id}><div className="admin-item-info"><strong>{variant.name}</strong><small>MVR {(variant.price / 100).toFixed(2)} · {variant.stock} in stock{variant.stock <= 5 ? ' · Low stock' : ''}</small></div><button onClick={() => { setEditing(variant); setName(variant.name); setPrice((variant.price / 100).toFixed(2)); setStock(String(variant.stock)); setError(''); }}>Edit</button></div>
          ) : <p className="fine-print">No variants yet.</p>}</div>
          <h3>{editing ? 'Edit variant' : 'Add variant'}</h3>
          <form onSubmit={save}>
            <label>Option name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Blue / Large" /></label>
            <div className="admin-form-grid"><label>Price (MVR)<input required type="number" min="0" max="1000000" step="0.01" value={price} onChange={event => setPrice(event.target.value)} /></label><label>Stock<input required type="number" min="0" max="100000" step="1" value={stock} onChange={event => setStock(event.target.value)} /></label></div>
            <div className="dashboard-actions"><button className="button button-dark" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save variant'}</button>{editing && <button className="filter-button" type="button" onClick={reset}>Cancel edit</button>}</div>
          </form>
        </> : <p className="fine-print">Select a product to manage its variants.</p>}
      </section>
    </div>
  </>;
}

type ContentField = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'url' | 'email' | 'datetime-local' | 'select';
  required?: boolean;
  maxLength?: number;
  step?: string;
  pattern?: string;
  options?: string[];
  hint?: string;
};
type ContentDefinition = {
  label: string;
  description: string;
  statuses: string[];
  fields: ContentField[];
  limitation?: string;
};
const contentModules = [
  'pages', 'blog_posts', 'blog_categories', 'faqs', 'navigation', 'popups',
  'testimonials', 'testimonial_categories', 'brands', 'collections', 'attributes',
  'tags', 'reviews', 'coupons', 'promotions', 'gift_cards', 'campaigns',
  'email_templates', 'email_drafts', 'notifications', 'media', 'teams',
  'roles', 'permissions', 'integrations', 'webhooks', 'settings'
] as const;
type ContentModule = typeof contentModules[number];
const contentGroups: { label: string; modules: ContentModule[] }[] = [
  { label: 'Storefront content', modules: ['pages', 'blog_posts', 'blog_categories', 'faqs', 'navigation', 'popups', 'testimonials', 'testimonial_categories'] },
  { label: 'Catalog & offers', modules: ['brands', 'collections', 'attributes', 'tags', 'reviews', 'coupons', 'promotions', 'gift_cards', 'campaigns'] },
  { label: 'Communication', modules: ['email_templates', 'email_drafts', 'notifications'] },
  { label: 'Workspace administration', modules: ['media', 'teams', 'roles', 'permissions', 'integrations', 'webhooks', 'settings'] }
];
function isContentModule(value: string): value is ContentModule {
  return contentModules.some(module => module === value);
}
const textField = (key: string, label: string, required = false, hint?: string): ContentField => ({ key, label, required, maxLength: 1000, hint });
const longField = (key: string, label: string, required = false): ContentField => ({ key, label, type: 'textarea', required, maxLength: 5000 });
const urlField = (key: string, label: string): ContentField => ({ key, label, type: 'url', maxLength: 1000, pattern: 'https://.*', hint: 'Use an HTTPS URL.' });
const slugField = (): ContentField => ({ key: 'slug', label: 'URL slug', required: true, maxLength: 120, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*', hint: 'Lowercase letters, numbers, and hyphens only.' });
const contentDefinitions: Record<ContentModule, ContentDefinition> = {
  pages: { label: 'Pages', description: 'Create public information pages using a unique URL slug.', statuses: ['draft', 'published', 'archived'], fields: [slugField(), longField('body', 'Page content', true)] },
  blog_posts: { label: 'Blog posts', description: 'Draft and publish articles on the public store.', statuses: ['draft', 'published', 'archived'], fields: [slugField(), textField('author', 'Author'), textField('excerpt', 'Excerpt'), urlField('featured_image', 'Featured image URL'), longField('body', 'Article content', true)] },
  blog_categories: { label: 'Blog categories', description: 'Organize published articles by category.', statuses: ['active', 'inactive'], fields: [slugField(), longField('description', 'Description'), urlField('image', 'Category image URL')] },
  faqs: { label: 'FAQs', description: 'Create public answers to common customer questions.', statuses: ['draft', 'published', 'archived'], fields: [slugField(), textField('question', 'Question', true), longField('answer', 'Answer', true)] },
  navigation: { label: 'Navigation', description: 'Maintain menu link records for your storefront navigation.', statuses: ['active', 'inactive'], fields: [textField('label', 'Link label', true), textField('url', 'Destination URL', true), { key: 'position', label: 'Position', type: 'number', step: '1' }, textField('parent', 'Parent link label')] },
  popups: { label: 'Popups', description: 'Prepare promotional popup content and its display schedule.', statuses: ['draft', 'active', 'inactive', 'archived'], fields: [textField('headline', 'Headline', true), longField('body', 'Message'), textField('cta_label', 'Button label'), urlField('cta_url', 'Button destination'), urlField('image', 'Image URL'), { key: 'starts_at', label: 'Starts at', type: 'datetime-local' }, { key: 'ends_at', label: 'Ends at', type: 'datetime-local' }], limitation: 'Popup display is not yet connected to the storefront.' },
  testimonials: { label: 'Testimonials', description: 'Manage customer quote records and optional images.', statuses: ['draft', 'published', 'archived'], fields: [textField('author', 'Customer name', true), longField('quote', 'Testimonial', true), { key: 'rating', label: 'Rating (1–5)', type: 'number', step: '1' }, urlField('image', 'Customer image URL'), textField('category', 'Category')] },
  testimonial_categories: { label: 'Testimonial categories', description: 'Group testimonials into reusable categories.', statuses: ['active', 'inactive'], fields: [textField('slug', 'Category key', true), longField('description', 'Description')] },
  brands: { label: 'Brands', description: 'Maintain brand information for your catalogue.', statuses: ['active', 'inactive'], fields: [textField('slug', 'Brand key', true), urlField('logo', 'Logo URL'), urlField('website', 'Website'), longField('description', 'Description')] },
  collections: { label: 'Collections', description: 'Group catalogue items into named collections.', statuses: ['draft', 'published', 'archived'], fields: [slugField(), longField('description', 'Description'), urlField('image', 'Collection image URL'), textField('product_ids', 'Product IDs', false, 'Comma-separated product IDs.')] },
  attributes: { label: 'Attributes', description: 'Define product attribute names and their available values.', statuses: ['active', 'inactive'], fields: [textField('attribute', 'Attribute name', true), textField('values', 'Values', true, 'Comma-separated options, such as Small, Medium, Large.')] },
  tags: { label: 'Tags', description: 'Maintain reusable catalogue labels.', statuses: ['active', 'inactive'], fields: [textField('slug', 'Tag key', true), textField('color', 'Color (optional)', false, 'CSS color name or hex value.')] },
  reviews: { label: 'Reviews', description: 'Moderate customer review records.', statuses: ['pending', 'published', 'rejected'], fields: [textField('product_id', 'Product ID', true), textField('reviewer', 'Reviewer name', true), { key: 'rating', label: 'Rating (1–5)', type: 'number', step: '1', required: true }, textField('headline', 'Review title'), longField('body', 'Review', true)], limitation: 'Reviews are managed here but are not yet displayed on product pages.' },
  coupons: { label: 'Coupons', description: 'Configure checkout discounts and redemption limits.', statuses: ['active', 'inactive', 'archived'], fields: [textField('code', 'Coupon code', true), { key: 'discount_type', label: 'Discount type', type: 'select', required: true, options: ['percentage', 'fixed'] }, { key: 'value', label: 'Discount value', type: 'number', step: '1', required: true, hint: 'Whole percent or MVR cents for a fixed discount.' }, { key: 'min_subtotal', label: 'Minimum subtotal (MVR cents)', type: 'number', step: '1' }, { key: 'max_redemptions', label: 'Maximum redemptions', type: 'number', step: '1' }, { key: 'expires_at', label: 'Expires at', type: 'datetime-local' }] },
  promotions: { label: 'Promotions', description: 'Plan promotions with dates, offer details, and eligibility notes.', statuses: ['draft', 'active', 'inactive', 'archived'], fields: [textField('offer', 'Offer description', true), textField('discount_type', 'Discount type'), { key: 'value', label: 'Offer value', type: 'number', step: '1' }, { key: 'starts_at', label: 'Starts at', type: 'datetime-local' }, { key: 'ends_at', label: 'Ends at', type: 'datetime-local' }, longField('rules', 'Eligibility rules')], limitation: 'Only coupons are currently applied during checkout.' },
  gift_cards: { label: 'Gift cards', description: 'Record gift card details for staff reference.', statuses: ['draft', 'active', 'redeemed', 'expired', 'cancelled'], fields: [textField('code', 'Gift card code', true), { key: 'initial_value', label: 'Initial value (MVR cents)', type: 'number', step: '1', required: true }, { key: 'balance', label: 'Remaining balance (MVR cents)', type: 'number', step: '1', required: true }, { key: 'expires_at', label: 'Expires at', type: 'datetime-local' }, textField('recipient', 'Recipient')] , limitation: 'Gift cards are records only and are not redeemable at checkout.' },
  campaigns: { label: 'Campaigns', description: 'Organize campaign content, channel, audience, and budget.', statuses: ['draft', 'active', 'paused', 'completed'], fields: [textField('channel', 'Channel', true), textField('audience', 'Audience'), { key: 'budget', label: 'Budget (MVR cents)', type: 'number', step: '1' }, { key: 'starts_at', label: 'Starts at', type: 'datetime-local' }, { key: 'ends_at', label: 'Ends at', type: 'datetime-local' }, longField('content', 'Campaign content')], limitation: 'Campaigns are not sent or published automatically.' },
  email_templates: { label: 'Email templates', description: 'Save reusable email subject and body drafts.', statuses: ['draft', 'active', 'inactive'], fields: [textField('subject', 'Subject', true), textField('preheader', 'Preheader'), longField('body', 'Template body', true)], limitation: 'Email delivery requires an email provider, which is not configured.' },
  email_drafts: { label: 'Email drafts', description: 'Prepare message drafts for staff review.', statuses: ['draft', 'ready', 'archived'], fields: [textField('to', 'Recipient email', true), textField('subject', 'Subject', true), longField('body', 'Message body', true)], limitation: 'Drafts are saved only; this workspace does not send email.' },
  notifications: { label: 'Notifications', description: 'Maintain notification message templates and event notes.', statuses: ['active', 'inactive'], fields: [textField('event', 'Event key', true), textField('channel', 'Channel', true), textField('subject', 'Subject'), longField('message', 'Message', true)], limitation: 'Notifications are not delivered automatically.' },
  media: { label: 'Media', description: 'Keep a searchable catalogue of externally hosted media.', statuses: ['active', 'archived'], fields: [urlField('url', 'Media URL'), textField('alt', 'Alternative text'), textField('media_type', 'Media type'), textField('file_name', 'File name')], limitation: 'Files are not uploaded or stored by the app.' },
  teams: { label: 'Teams', description: 'Maintain team names and staff assignment notes.', statuses: ['active', 'inactive'], fields: [longField('description', 'Team description'), textField('members', 'Members', false, 'Comma-separated staff usernames.')] , limitation: 'Team records do not change staff permissions.' },
  roles: { label: 'Roles', description: 'Document role names and responsibility notes.', statuses: ['active', 'inactive'], fields: [textField('role_key', 'Role key', true), longField('description', 'Responsibilities'), textField('permissions', 'Permission notes', false, 'Comma-separated permission keys.')] , limitation: 'Access is controlled by the built-in admin and staff roles.' },
  permissions: { label: 'Permissions', description: 'Document permission keys and descriptions.', statuses: ['active', 'inactive'], fields: [textField('key', 'Permission key', true), longField('description', 'Description')] , limitation: 'Custom permission records are not enforced by authorization.' },
  integrations: { label: 'Integrations', description: 'Track integration providers and setup status.', statuses: ['inactive', 'active'], fields: [textField('provider', 'Provider', true), textField('account_reference', 'Account reference'), longField('notes', 'Setup notes')], limitation: 'This page tracks configuration notes; it does not connect external services.' },
  webhooks: { label: 'Webhooks', description: 'Record webhook endpoints and subscribed event names.', statuses: ['inactive', 'active'], fields: [urlField('url', 'Endpoint URL'), textField('events', 'Events', false, 'Comma-separated event names.'), textField('description', 'Description')], limitation: 'Webhook events are not emitted by this app.' },
  settings: { label: 'Workspace settings', description: 'Store additional internal settings and notes.', statuses: ['active', 'inactive'], fields: [textField('key', 'Setting key', true), longField('value', 'Setting value'), longField('description', 'Description')], limitation: 'Use Store branding for the live storefront settings.' }
};
const moduleLabels: Record<string, string> = {
  returns: 'Returns & refunds', stock: 'Stock adjustments', customers: 'Customers',
  reports: 'Reports', content: 'Store content', inbox: 'Contact inbox'
};

function Operations() {
  const [module, setModule] = useState('returns');
  useEffect(() => {
    const open = (event: Event) => {
      const selected = (event as CustomEvent<string>).detail;
      if (Object.hasOwn(moduleLabels, selected)) setModule(selected);
    };
    window.addEventListener('operations:open', open);
    return () => window.removeEventListener('operations:open', open);
  }, []);
  return <>
    <div className="panel-heading"><div><span className="section-kicker">STORE OPERATIONS</span><h2>{moduleLabels[module]}</h2><p className="fine-print">Manage store workflows and review persisted records.</p></div></div>
    <label className="operation-module">Workspace<select value={module} onChange={event => setModule(event.target.value)}>{Object.entries(moduleLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {module === 'returns' && <ReturnsWorkspace />}
    {module === 'stock' && <StockWorkspace />}
    {module === 'customers' && <CustomersWorkspace />}
    {module === 'reports' && <ReportsWorkspace />}
    {module === 'content' && <ContentWorkspace />}
    {module === 'inbox' && <InboxWorkspace />}
  </>;
}

function CustomersWorkspace() {
  const [items,setItems]=useState<Record<string,unknown>[]>([]);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  useEffect(()=>{const controller=new AbortController();const params=new URLSearchParams({limit:'100',q:query});request<{items:Record<string,unknown>[]}>(`/api/admin/customers?${params}`,{signal:controller.signal}).then(data=>setItems(data.items)).catch(reason=>{if(!controller.signal.aborted)setError(String(reason));});return()=>controller.abort();},[query]);
  return <section className="admin-card"><h3>Guest customer history</h3><p className="fine-print">Customers are grouped by phone number. This is not a customer login or profile system.</p><label className="operation-module">Search customers<input type="search" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name or phone number" /></label>{error&&<p className="form-error">{error}</p>}<div className="operations-table">{items.length?items.map((item,index)=><div className="operations-row" key={`${String(item.phone)}-${index}`}><strong>{String(item.customer_name)}</strong><span>{String(item.phone)}</span><span>{String(item.order_count)} orders · {String(item.delivered_count)} delivered · {formatMoney(Number(item.order_subtotal))} subtotal</span><small>Last order {String(item.last_order)}</small></div>):<p className="fine-print">No customer history matches this search.</p>}</div></section>;
}

function reportCell(key: string, value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && /(subtotal|amount|budget|price)/i.test(key)) return formatMoney(value);
  return String(value);
}
function ReportContent({ value, label }: { value: unknown; label: string }) {
  if (Array.isArray(value)) {
    if (!value.length) return <p className="fine-print">No records for this report.</p>;
    const rows = value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
    if (!rows.length) return <p className="fine-print">No records for this report.</p>;
    const firstRow = rows[0];
    if (!firstRow) return <p className="fine-print">No records for this report.</p>;
    const columns = Object.keys(firstRow);
    return <div className="report-table-wrap"><table className="report-table"><thead><tr>{columns.map(key=><th key={key}>{key.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.id??row.day??row.status??index)}>{columns.map(key=><td key={key}>{reportCell(key,row[key])}</td>)}</tr>)}</tbody></table></div>;
  }
  if (value && typeof value === 'object') {
    const entries=Object.entries(value as Record<string,unknown>);
    const simple=entries.every(([,item])=>item===null||['string','number','boolean'].includes(typeof item));
    if(simple)return <div className="report-metrics">{entries.map(([key,item])=><article key={key}><small>{key.replaceAll('_',' ')}</small><strong>{reportCell(key,item)}</strong></article>)}</div>;
    return <div className="report-groups">{entries.map(([key,item])=><section className="report-group" key={key}><h3>{key.replaceAll('_',' ')}</h3><ReportContent value={item} label={key} /></section>)}</div>;
  }
  return <p className="fine-print">{reportCell(label,value)}</p>;
}
function ReportsWorkspace() {
  const [type,setType]=useState('sales');
  const [report,setReport]=useState<unknown>(null);
  const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();request(`/api/admin/reports?type=${type}`,{signal:controller.signal}).then(setReport).catch(reason=>{if(!controller.signal.aborted)setError(String(reason));});return()=>controller.abort();},[type]);
  return <section className="admin-card"><label className="operation-module">Report<select value={type} onChange={event=>setType(event.target.value)}>{['sales','orders','products','inventory','customers','returns','payments'].map(name=><option key={name}>{name}</option>)}</select></label>{error&&<p className="form-error">{error}</p>}<ReportContent value={report} label={type} /><p className="fine-print">Figures are calculated from local order and inventory records; ordered subtotals are not bank reconciliation.</p></section>;
}

function ContentWorkspace() {
  const [module,setModule]=useState<ContentModule>('pages');
  const [items,setItems]=useState<Record<string,unknown>[]>([]);
  const [editing,setEditing]=useState<Record<string,unknown>|null>(null);
  const [title,setTitle]=useState('');
  const [status,setStatus]=useState('draft');
  const [values,setValues]=useState<Record<string,string>>({});
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const definition=contentDefinitions[module];
  const emptyValues=()=>Object.fromEntries(definition.fields.map(field=>[field.key,'']));
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try{const params=new URLSearchParams({limit:'100',q:search});const data=await request<{items:Record<string,unknown>[]}>(`/api/admin/workspace/${module}?${params}`);setItems(data.items);}
    catch(reason){setError(reason instanceof Error?reason.message:'Could not load records.');}
    finally{setLoading(false);}
  },[module,search]);
  useEffect(()=>{setEditing(null);setTitle('');setStatus(contentDefinitions[module].statuses[0]||'draft');setValues(emptyValues());},[module]);
  useEffect(()=>{void reload();},[reload]);
  function resetForm(){setEditing(null);setTitle('');setStatus(definition.statuses[0]||'draft');setValues(emptyValues());}
  function edit(item:Record<string,unknown>){
    const data=(item.data||{}) as Record<string,unknown>;
    setEditing(item);setTitle(String(item.title));setStatus(String(item.status));
    setValues(Object.fromEntries(definition.fields.map(field=>{
      const value=data[field.key];
      if(value===undefined||value===null)return[field.key,''];
      if(field.type==='datetime-local'){
        const date=new Date(String(value));
        return[field.key,Number.isNaN(date.getTime())?'':new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)];
      }
      return[field.key,String(value)];
    })));
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    const data:Record<string,unknown>={};
    for(const field of definition.fields){
      const value=values[field.key]?.trim()||'';
      if(!value)continue;
      if(field.type==='number'){
        const number=Number(value);
        if(!Number.isFinite(number)){setError(`${field.label} must be a valid number.`);return;}
        data[field.key]=number;
      }else if(field.type==='datetime-local'){
        const date=new Date(value);
        if(Number.isNaN(date.getTime())){setError(`${field.label} must be a valid date and time.`);return;}
        data[field.key]=date.toISOString();
      }else data[field.key]=value;
    }
    try{
      await request(`/api/admin/workspace/${module}${editing?`/${editing.id}`:''}`,{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,status,data:{...data,...(editing?{version:editing.version}:{})}})});
      resetForm();await reload();
    }catch(reason){setError(reason instanceof Error?reason.message:'Could not save this record.');}
  }
  async function remove(item:Record<string,unknown>){
    if(!confirm(`Delete “${String(item.title)}”?`))return;
    try{await request(`/api/admin/workspace/${module}/${item.id}`,{method:'DELETE'});await reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Could not delete this record.');}
  }
  const statusOptions=definition.statuses.includes(status)?definition.statuses:[status,...definition.statuses];
  return <div className="content-workspace">
    <div className="content-page-heading"><div><h3>{definition.label}</h3><p className="fine-print">{definition.description}</p></div><label className="operation-module">Page<select value={module} onChange={event=>{if(isContentModule(event.target.value))setModule(event.target.value);}}>{contentGroups.map(group=><optgroup key={group.label} label={group.label}>{group.modules.map(name=><option key={name} value={name}>{contentDefinitions[name].label}</option>)}</optgroup>)}</select></label></div>
    <div className="operations-grid">
      <section className="admin-card">
        <label>Search records<input type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)} placeholder={`Search ${definition.label.toLowerCase()}`} /></label>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <div className="operations-table" aria-live="polite">
          {loading?<p className="fine-print">Loading records…</p>:items.length?items.map(item=>{
            const data=(item.data||{}) as Record<string,unknown>;
            const summary=definition.fields.filter(field=>data[field.key]!==undefined&&data[field.key]!==null&&String(data[field.key])!=='').slice(0,2);
            return <article className="content-record" key={String(item.id)}>
              <div><strong>{String(item.title)}</strong><span className="status-badge">{String(item.status)}</span></div>
              {summary.map(field=><small key={field.key}><b>{field.label}:</b> {String(data[field.key])}</small>)}
              <div className="dashboard-actions"><button className="filter-button" type="button" onClick={()=>edit(item)}>Edit</button><button className="filter-button" type="button" onClick={()=>void remove(item)}>Delete</button></div>
            </article>;
          }):<p className="fine-print">No {definition.label.toLowerCase()} found. Add the first record using the form.</p>}
        </div>
      </section>
      <section className="admin-card">
        <h3>{editing?`Edit ${definition.label} record`:`New ${definition.label} record`}</h3>
        <form onSubmit={save}>
          <label>Title<input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)} /></label>
          <label>Status<select value={status} onChange={event=>setStatus(event.target.value)}>{statusOptions.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
          {definition.fields.map(field=><label key={field.key}>{field.label}
            {field.type==='textarea'?<textarea required={field.required} maxLength={field.maxLength} rows={4} value={values[field.key]||''} onChange={event=>setValues({...values,[field.key]:event.target.value})} />:
              field.type==='select'?<select required={field.required} value={values[field.key]||''} onChange={event=>setValues({...values,[field.key]:event.target.value})}><option value="">Select…</option>{field.options?.map(option=><option key={option} value={option}>{option}</option>)}</select>:
                <input required={field.required} type={field.type||'text'} maxLength={field.maxLength} step={field.step} pattern={field.pattern} value={values[field.key]||''} onChange={event=>setValues({...values,[field.key]:event.target.value})} />}
            {field.hint&&<small className="field-hint">{field.hint}</small>}
          </label>)}
          {error&&<p className="form-error" role="alert">{error}</p>}
          <div className="dashboard-actions"><button className="button button-dark" type="submit">{editing?'Save changes':'Create record'}</button>{editing&&<button className="filter-button" type="button" onClick={resetForm}>Cancel edit</button>}</div>
        </form>
        {definition.limitation&&<p className="fine-print content-limitation">{definition.limitation}</p>}
      </section>
    </div>
  </div>;
}

function InboxWorkspace() {
  const [items,setItems]=useState<Record<string,unknown>[]>([]);
  const [error,setError]=useState('');
  const reload=useCallback(()=>request<{items:Record<string,unknown>[]}>('/api/admin/contact-messages?limit=100').then(data=>setItems(data.items)).catch(reason=>setError(String(reason))),[]);
  useEffect(()=>{void reload();},[reload]);
  async function update(item:Record<string,unknown>,status:string){try{await request(`/api/admin/contact-messages/${item.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});await reload();}catch(reason){setError(String(reason));}}
  return <section className="admin-card"><h3>Contact messages</h3>{error&&<p className="form-error">{error}</p>}{items.map(item=><article className="message-card" key={String(item.id)}><h4>{String(item.subject)}</h4><p>{String(item.message)}</p><small>{String(item.name)} · {String(item.email||item.phone)} · {String(item.created_at)}</small><select value={String(item.status)} onChange={event=>void update(item,event.target.value)}>{['new','open','resolved','spam'].map(value=><option key={value}>{value}</option>)}</select></article>)}</section>;
}

function StockWorkspace() {
  const [products,setProducts]=useState<Product[]>([]);
  const [selected,setSelected]=useState('');
  const [variants,setVariants]=useState<Variant[]>([]);
  const [variant,setVariant]=useState('');
  const [delta,setDelta]=useState('');
  const [reason,setReason]=useState('');
  const [history,setHistory]=useState<Record<string,unknown>[]>([]);
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{try{const data=await request<ProductPage>('/api/admin/product-search?limit=100');setProducts(data.items);const movements=await request<{items:Record<string,unknown>[]}>('/api/admin/stock-adjustments?limit=50');setHistory(movements.items);}catch(reason){setError(String(reason));}},[]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{if(!selected){setVariants([]);return;}request<Variant[]>(`/api/admin/products/${selected}/variants`).then(setVariants).catch(reason=>setError(String(reason)));},[selected]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();try{await request('/api/admin/stock-adjustments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:Number(selected),variant_id:variant?Number(variant):null,delta:Number(delta),reason})});setDelta('');setReason('');setError('');await reload();}catch(reason){setError(String(reason));}}
  return <div className="operations-grid"><section className="admin-card"><h3>Record adjustment</h3><p className="fine-print">Positive quantities add stock; negative quantities remove it. Adjustments are audited and cannot make stock negative.</p><form onSubmit={save}><label>Product<select required value={selected} onChange={event=>{setSelected(event.target.value);setVariant('');}}><option value="">Select product</option>{products.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{variants.length>0&&<label>Stock item<select value={variant} onChange={event=>setVariant(event.target.value)}><option value="">Standard product</option>{variants.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>Change in units<input required type="number" min="-100000" max="100000" step="1" value={delta} onChange={event=>setDelta(event.target.value)} /></label><label>Reason<input required maxLength={250} value={reason} onChange={event=>setReason(event.target.value)} /></label>{error&&<p className="form-error">{error}</p>}<button className="button button-dark">Save adjustment</button></form></section><section className="admin-card"><h3>Recent stock movements</h3><div className="operations-table">{history.map(item=><div className="operations-row" key={String(item.id)}><strong>{String(item.product_name)}{item.variant_name?` · ${String(item.variant_name)}`:''}</strong><span>{Number(item.delta)>0?'+':''}{String(item.delta)} units</span><small>{String(item.reason)} · {String(item.actor)}</small></div>)}</div></section></div>;
}

function ReturnsWorkspace() {
  const [orders,setOrders]=useState<Record<string,unknown>[]>([]);
  const [orderId,setOrderId]=useState('');
  const [order,setOrder]=useState<Record<string,unknown>|null>(null);
  const [returns,setReturns]=useState<Record<string,unknown>[]>([]);
  const [reason,setReason]=useState('');
  const [selections,setSelections]=useState<Record<number,number>>({});
  const [selectedReturn,setSelectedReturn]=useState<Record<string,unknown>|null>(null);
  const [refund,setRefund]=useState('');
  const [reference,setReference]=useState('');
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{try{const [list,delivered]=await Promise.all([request<{items:Record<string,unknown>[]}>('/api/admin/returns?limit=100'),request<{items:Record<string,unknown>[]}>('/api/admin/order-search?status=delivered&limit=100')]);setReturns(list.items);setOrders(delivered.items);}catch(reason){setError(String(reason));}},[]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{if(!orderId){setOrder(null);return;}request<Record<string,unknown>>(`/api/admin/orders/${orderId}`).then(setOrder).catch(reason=>setError(String(reason)));},[orderId]);
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const items=Object.entries(selections).filter(([,quantity])=>quantity>0).map(([order_item_id,quantity])=>({order_item_id:Number(order_item_id),quantity}));try{await request('/api/admin/returns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:Number(orderId),reason,items})});setReason('');setSelections({});setError('');await reload();}catch(reason){setError(String(reason));}}
  async function openReturn(item:Record<string,unknown>){try{setSelectedReturn(await request(`/api/admin/returns/${item.id}`));}catch(reason){setError(String(reason));}}
  async function transition(status:string){if(!selectedReturn)return;try{await request(`/api/admin/returns/${selectedReturn.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});await openReturn(selectedReturn);await reload();}catch(reason){setError(String(reason));}}
  async function issueRefund(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selectedReturn)return;try{await request(`/api/admin/returns/${selectedReturn.id}/refunds`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:Math.round(Number(refund)*100),reference})});setRefund('');setReference('');await openReturn(selectedReturn);await reload();}catch(reason){setError(String(reason));}}
  const orderItems=(order?.items as (Record<string,unknown>[]|undefined))||[];
  return <div className="operations-grid"><section className="admin-card"><h3>Start return</h3><p className="fine-print">Only delivered orders are eligible. Staff decide approval; accepted goods are restocked when marked received. Return decisions follow your store policy.</p><form onSubmit={create}><label>Delivered order<select required value={orderId} onChange={event=>setOrderId(event.target.value)}><option value="">Choose order</option>{orders.map(item=><option key={String(item.id)} value={String(item.id)}>#{String(item.id)} · {String(item.customer_name)} · {String(item.created_at)}</option>)}</select></label>{order&&<div>{orderItems.map(item=><label className="return-line" key={String(item.id)}>{String(item.name)} · purchased {String(item.quantity)}<input type="number" min="0" max={Number(item.quantity)} value={selections[Number(item.id)]||0} onChange={event=>setSelections({...selections,[Number(item.id)]:Number(event.target.value)})} /></label>)}</div>}<label>Reason<input required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} /></label><button className="button button-dark" disabled={!order}>Create return request</button></form></section><section className="admin-card"><h3>Return requests</h3>{returns.map(item=><button className="inventory-product" key={String(item.id)} onClick={()=>void openReturn(item)}>Return #{String(item.id)} · Order #{String(item.order_id)} · {String(item.customer_name)} · {String(item.status)}</button>)}{selectedReturn&&<div className="return-detail"><h4>Return #{String(selectedReturn.id)} · {String(selectedReturn.status)}</h4><p>{String(selectedReturn.reason)}</p>{((selectedReturn.items as Record<string,unknown>[])||[]).map(item=><p key={String(item.id)}>{String(item.quantity)} × {String(item.name)} · MVR {(Number(item.unit_price)*Number(item.quantity)/100).toFixed(2)}</p>)}{selectedReturn.status==='requested'&&<div className="dashboard-actions"><button className="filter-button" onClick={()=>void transition('approved')}>Approve</button><button className="filter-button" onClick={()=>void transition('rejected')}>Reject</button></div>}{selectedReturn.status==='approved'&&<button className="filter-button" onClick={()=>void transition('received')}>Mark items received &amp; restock</button>}<h4>Manual bank refunds</h4>{((selectedReturn.refunds as Record<string,unknown>[])||[]).map(item=><p key={String(item.id)}>MVR {(Number(item.amount)/100).toFixed(2)} · {String(item.reference)}</p>)}<form onSubmit={issueRefund}><label>Refund amount (MVR)<input type="number" min="0.01" step="0.01" required value={refund} onChange={event=>setRefund(event.target.value)} /></label><label>Transfer reference<input required maxLength={120} value={reference} onChange={event=>setReference(event.target.value)} /></label><button className="filter-button" disabled={selectedReturn.status!=='received'}>Record refund handled outside the app</button></form></div>}</section>{error&&<p className="form-error">{error}</p>}</div>;
}

const container = document.getElementById('inventory-workspace');
if (container) createRoot(container).render(<Inventory />);
const operationsContainer = document.getElementById('operations-workspace');
if (operationsContainer) createRoot(operationsContainer).render(<Operations />);
