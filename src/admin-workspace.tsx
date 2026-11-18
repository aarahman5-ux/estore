import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';

type Product = { id: number; name: string; category: string; stock: number };
type ProductPage = { items: Product[]; total: number };
type Variant = { id: number; name: string; price: number; stock: number; version: number };
type LowVariant = { id: number; name: string; product_name: string; stock: number };

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

const contentModules = [
  'pages', 'blog_posts', 'blog_categories', 'faqs', 'navigation', 'popups',
  'testimonials', 'testimonial_categories', 'brands', 'collections', 'attributes',
  'tags', 'reviews', 'coupons', 'promotions', 'gift_cards', 'campaigns',
  'email_templates', 'email_drafts', 'notifications', 'media', 'teams',
  'roles', 'permissions', 'integrations', 'webhooks', 'settings'
];
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
  useEffect(()=>{request<{items:Record<string,unknown>[]}>('/api/admin/customers?limit=100').then(data=>setItems(data.items)).catch(reason=>setError(String(reason)));},[]);
  return <section className="admin-card"><h3>Guest customer history</h3><p className="fine-print">Customers are grouped by phone number. This is not a customer login or profile system.</p>{error&&<p className="form-error">{error}</p>}<div className="operations-table">{items.map((item,index)=><div className="operations-row" key={`${String(item.phone)}-${index}`}><strong>{String(item.customer_name)}</strong><span>{String(item.phone)}</span><span>{String(item.order_count)} orders · {String(item.delivered_count)} delivered</span><small>Last order {String(item.last_order)}</small></div>)}</div></section>;
}

function ReportsWorkspace() {
  const [type,setType]=useState('sales');
  const [report,setReport]=useState<unknown>(null);
  const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();request(`/api/admin/reports?type=${type}`,{signal:controller.signal}).then(setReport).catch(reason=>{if(!controller.signal.aborted)setError(String(reason));});return()=>controller.abort();},[type]);
  return <section className="admin-card"><label>Report<select value={type} onChange={event=>setType(event.target.value)}>{['sales','orders','products','inventory','customers','returns','payments'].map(name=><option key={name}>{name}</option>)}</select></label>{error&&<p className="form-error">{error}</p>}<pre className="report-data">{JSON.stringify(report,null,2)}</pre><p className="fine-print">Figures are calculated from local order and inventory records; ordered subtotals are not bank reconciliation.</p></section>;
}

function ContentWorkspace() {
  const [module,setModule]=useState('pages');
  const [items,setItems]=useState<Record<string,unknown>[]>([]);
  const [editing,setEditing]=useState<Record<string,unknown>|null>(null);
  const [title,setTitle]=useState('');
  const [status,setStatus]=useState('draft');
  const [raw,setRaw]=useState('{\n  "slug": ""\n}');
  const [error,setError]=useState('');
  const reload=useCallback(()=>request<{items:Record<string,unknown>[]}>(`/api/admin/workspace/${module}?limit=100`).then(data=>setItems(data.items)).catch(reason=>setError(String(reason))),[module]);
  useEffect(()=>{setEditing(null);setTitle('');setStatus('draft');setRaw('{\n  "slug": ""\n}');setError('');void reload();},[module,reload]);
  function edit(item:Record<string,unknown>){setEditing(item);setTitle(String(item.title));setStatus(String(item.status));setRaw(JSON.stringify(item.data,null,2));}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    let data:Record<string,unknown>;
    try{data=JSON.parse(raw) as Record<string,unknown>;if(!data||Array.isArray(data)||typeof data!=='object')throw new Error('Details must be a JSON object.');}
    catch(reason){setError(reason instanceof Error?reason.message:'Invalid JSON.');return;}
    try{
      await request(`/api/admin/workspace/${module}${editing?`/${editing.id}`:''}`,{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,status,data:{...data,...(editing?{version:editing.version}:{})}})});
      setEditing(null);setTitle('');setStatus('draft');setRaw('{\n  "slug": ""\n}');await reload();
    }catch(reason){setError(String(reason));}
  }
  async function remove(item:Record<string,unknown>){if(!confirm(`Delete “${String(item.title)}”?`))return;try{await request(`/api/admin/workspace/${module}/${item.id}`,{method:'DELETE'});await reload();}catch(reason){setError(String(reason));}}
  return <div className="operations-grid"><section className="admin-card"><label>Content module<select value={module} onChange={event=>setModule(event.target.value)}>{contentModules.map(name=><option key={name} value={name}>{name.replaceAll('_',' ')}</option>)}</select></label><div className="operations-table">{items.map(item=><div className="operations-row" key={String(item.id)}><strong>{String(item.title)}</strong><span>{String(item.status)}</span><button className="filter-button" onClick={()=>edit(item)}>Edit</button><button className="filter-button" onClick={()=>void remove(item)}>Delete</button></div>)}</div></section><section className="admin-card"><h3>{editing?'Edit record':`Create ${module.replaceAll('_',' ')}`}</h3><form onSubmit={save}><label>Title<input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)} /></label><label>Status<select value={status} onChange={event=>setStatus(event.target.value)}>{['draft','published','active','inactive','archived','scheduled'].map(value=><option key={value}>{value}</option>)}</select></label><label>Details (JSON)<textarea className="json-editor" rows={12} value={raw} onChange={event=>setRaw(event.target.value)} /></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-dark" type="submit">Save</button>{editing&&<button className="filter-button" type="button" onClick={()=>{setEditing(null);setTitle('');setStatus('draft');}}>Cancel</button>}</form><p className="fine-print">Pages, posts and FAQs marked published are served through the public content API. Other module records are administrative data and are not automatically wired into checkout or storefront components.</p></section></div>;
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
