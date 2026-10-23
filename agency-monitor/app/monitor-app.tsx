'use client'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '../src/supabase'

type Agency = { name: string; short_name: string; postal_address: string; physical_address:string; logo_path:string|null; phone: string; email: string; duplicate_window_days: number }
type Item = { id: string; code: string; name: string; unit: string; category_id:string|null; is_active: boolean }
type Category = {id:string;code:string;name:string}
type ReportItem = {item_id:string;item_code:string;item_name:string;purchase_lines:number;ordered_quantity:number;order_value:number}
type ReportSection = {section_id:string;section_name:string;division_name:string;purchase_lines:number;ordered_quantity:number;order_value:number}
type ExpenseStatus = {status:string;evidence_count:number;reported_amount:number}
type CategoryReport = {category_code:string;category_name:string;purchase_lines:number;order_value:number}
type SupplierReport = {supplier_name:string;purchase_lines:number;order_value:number}
type Section = { id: string; code: string; name: string; division_id: string }
type Division = { id: string; code: string; name: string }
type Supplier = { id: string; name: string }
type Requisition = { id: string; reference: string; purpose: string; status: string; requester_id: string; section_id: string; created_at: string }
type Purchase = { id: string; purchase_reference: string; ordered_at: string; requisition_id: string | null; section_id:string }
type PurchaseLine = { id: string; purchase_id: string; item_id: string; quantity: number; unit_price: number }
type Expense = { id: string; purchase_line_id: string; reported_amount: number; status: string; recorded_by:string }
type Match = { source_type: string; source_id: string; reference: string; section: string | null; event_date: string; quantity: number; unit_price: number }
type ReqLine = {id:string;requisition_id:string;item_id:string}
type Duplicate = {id:string;requisition_line_id:string;source_type:string;source_id:string;disposition:string|null;explanation:string|null}
type Tab = 'overview'|'requests'|'purchases'|'catalogue'|'reports'|'documents'|'settings'
type AgencyDocument = {id:string;original_name:string;mime_type:string;file_size:number;created_at:string;uploaded_by:string}

const money = (n: number) => `K ${Number(n || 0).toLocaleString('en-PG',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const errorText = (err: unknown) => err instanceof Error ? err.message : String(err)
const today = () => new Date().toISOString().slice(0,10)

export default function MonitorApp() {
  const [user,setUser] = useState<User|null>(null)
  const [loading,setLoading] = useState(true)
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [tab,setTab] = useState<Tab>('overview')
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const [role,setRole] = useState('')
  const [agency,setAgency] = useState<Agency|null>(null)
  const [items,setItems] = useState<Item[]>([])
  const [categories,setCategories] = useState<Category[]>([])
  const [spendingByItem,setSpendingByItem] = useState<ReportItem[]>([])
  const [spendingBySection,setSpendingBySection] = useState<ReportSection[]>([])
  const [expenseStatus,setExpenseStatus] = useState<ExpenseStatus[]>([])
  const [categoryReport,setCategoryReport] = useState<CategoryReport[]>([])
  const [supplierReport,setSupplierReport] = useState<SupplierReport[]>([])
  const [sections,setSections] = useState<Section[]>([])
  const [divisions,setDivisions] = useState<Division[]>([])
  const [suppliers,setSuppliers] = useState<Supplier[]>([])
  const [requests,setRequests] = useState<Requisition[]>([])
  const [purchases,setPurchases] = useState<Purchase[]>([])
  const [lines,setLines] = useState<PurchaseLine[]>([])
  const [expenses,setExpenses] = useState<Expense[]>([])
  const [requestLines,setRequestLines] = useState<ReqLine[]>([])
  const [duplicateReviews,setDuplicateReviews] = useState<Duplicate[]>([])
  const [purchaseSection,setPurchaseSection] = useState('')
  const [verifyReason,setVerifyReason] = useState('')
  const [aliasItem,setAliasItem] = useState('')
  const [aliasText,setAliasText] = useState('')
  const [matches,setMatches] = useState<Match[]>([])
  const [requestSection,setRequestSection] = useState('')
  const [requestItem,setRequestItem] = useState('')
  const [requestQty,setRequestQty] = useState('1')
  const [requestPrice,setRequestPrice] = useState('0')
  const [requestPurpose,setRequestPurpose] = useState('')
  const [reviewReason,setReviewReason] = useState('')
  const [purchaseRef,setPurchaseRef] = useState('')
  const [purchaseReq,setPurchaseReq] = useState('')
  const [purchaseSupplier,setPurchaseSupplier] = useState('')
  const [purchaseDate,setPurchaseDate] = useState(today())
  const [receiptLine,setReceiptLine] = useState('')
  const [receiptQty,setReceiptQty] = useState('1')
  const [expenseLine,setExpenseLine] = useState('')
  const [expenseAmount,setExpenseAmount] = useState('0')
  const [expenseRef,setExpenseRef] = useState('')
  const [adminMode,setAdminMode] = useState<'agency'|'division'|'section'|'item'|'supplier'|'category'|'staff'>('agency')
  const [code,setCode] = useState('')
  const [label,setLabel] = useState('')
  const [unit,setUnit] = useState('each')
  const [chosenDivision,setChosenDivision] = useState('')
  const [itemCategory,setItemCategory] = useState('')
  const [staffId,setStaffId] = useState('')
  const [staffName,setStaffName] = useState('')
  const [staffRole,setStaffRole] = useState('requester')
  const [staffSection,setStaffSection] = useState('')
  const [catalogueSearch,setCatalogueSearch] = useState('')
  const [documentEntity,setDocumentEntity] = useState<'requisition'|'purchase'|'expense'>('requisition')
  const [documentId,setDocumentId] = useState('')
  const [documentFile,setDocumentFile] = useState<File|null>(null)
  const [documents,setDocuments] = useState<AgencyDocument[]>([])
  const [logoFile,setLogoFile] = useState<File|null>(null)
  const [agencyName,setAgencyName] = useState('')
  const [agencyShort,setAgencyShort] = useState('')
  const [agencyAddress,setAgencyAddress] = useState('')
  const [agencyPhone,setAgencyPhone] = useState('')
  const [agencyEmail,setAgencyEmail] = useState('')
  const [agencyPhysical,setAgencyPhysical] = useState('')
  const [agencyLogo,setAgencyLogo] = useState('')
  const [agencyDays,setAgencyDays] = useState('90')

  const refresh = useCallback(async () => {
    const db = getSupabase()
    const [a,u,it,se,di,su,re,pu,li,ex,rl,du,ca,ri,rs,es,cr,sr] = await Promise.all([
      db.from('monitor_agency').select('name,short_name,postal_address,physical_address,logo_path,phone,email,duplicate_window_days').eq('id',1).maybeSingle(),
      db.from('monitor_users').select('role').eq('auth_user_id',(await db.auth.getUser()).data.user?.id ?? '').maybeSingle(),
      db.from('monitor_items').select('id,code,name,unit,category_id,is_active').order('name'),
      db.from('monitor_sections').select('id,code,name,division_id').order('name'),
      db.from('monitor_divisions').select('id,code,name').order('name'),
      db.from('monitor_suppliers').select('id,name').order('name'),
      db.from('monitor_requisitions').select('id,reference,purpose,status,requester_id,section_id,created_at').order('created_at',{ascending:false}).limit(100),
      db.from('monitor_purchases').select('id,purchase_reference,ordered_at,requisition_id,section_id').order('ordered_at',{ascending:false}).limit(100),
      db.from('monitor_purchase_lines').select('id,purchase_id,item_id,quantity,unit_price').limit(500),
      db.from('monitor_expense_evidence').select('id,purchase_line_id,reported_amount,status,recorded_by').limit(500),
      db.from('monitor_requisition_lines').select('id,requisition_id,item_id').limit(500),
      db.from('monitor_duplicate_reviews').select('id,requisition_line_id,source_type,source_id,disposition,explanation').limit(500),
      db.from('monitor_categories').select('id,code,name').order('name'),
      db.from('monitor_report_spend_by_item').select('item_id,item_code,item_name,purchase_lines,ordered_quantity,order_value').order('order_value',{ascending:false}),
      db.from('monitor_report_spend_by_section').select('section_id,section_name,division_name,purchase_lines,ordered_quantity,order_value').order('order_value',{ascending:false}),
      db.from('monitor_report_expense_status').select('status,evidence_count,reported_amount'),
      db.from('monitor_report_spend_by_category').select('category_code,category_name,purchase_lines,order_value').order('order_value',{ascending:false}),
      db.from('monitor_report_spend_by_supplier').select('supplier_name,purchase_lines,order_value').order('order_value',{ascending:false}),
    ])
    const firstError = [a,u,it,se,di,su,re,pu,li,ex,rl,du,ca,ri,rs,es,cr,sr].find(x=>x.error)?.error
    if(firstError) throw new Error(firstError.message)
    setAgency(a.data as Agency|null)
    setRole(String(u.data?.role || ''))
    setCategoryReport((cr.data||[]) as CategoryReport[]);setSupplierReport((sr.data||[]) as SupplierReport[]);setSpendingByItem((ri.data||[]) as ReportItem[]);setSpendingBySection((rs.data||[]) as ReportSection[]);setExpenseStatus((es.data||[]) as ExpenseStatus[]);setCategories((ca.data||[]) as Category[]);setItems((it.data||[]) as Item[]); setSections((se.data||[]) as Section[])
    setDivisions((di.data||[]) as Division[]); setSuppliers((su.data||[]) as Supplier[])
    setRequests((re.data||[]) as Requisition[]); setPurchases((pu.data||[]) as Purchase[])
    setLines((li.data||[]) as PurchaseLine[]); setExpenses((ex.data||[]) as Expense[])
    setRequestLines((rl.data||[]) as ReqLine[]);setDuplicateReviews((du.data||[]) as Duplicate[])
  },[])

  useEffect(()=>{
    let live=true
    let subscription: {unsubscribe:()=>void}|null=null
    try {
      const db=getSupabase()
      db.auth.getUser().then(async ({data,error})=>{
        if(!live)return
        if(error && error.name!=='AuthSessionMissingError')setNotice(error.message)
        setUser(data.user||null)
        if(data.user)try{await refresh()}catch(e){setNotice(errorText(e))}
      }).catch(e=>{if(live)setNotice(errorText(e))}).finally(()=>{if(live)setLoading(false)})
      const {data}=db.auth.onAuthStateChange((_event,session)=>{
        if(!live)return
        setUser(session?.user||null)
      })
      subscription=data.subscription
    } catch(e){setNotice(errorText(e));setLoading(false)}
    return()=>{live=false;subscription?.unsubscribe()}
  },[refresh])

  async function run(operation:()=>Promise<unknown>, success:string) {
    setBusy(true);setNotice('')
    try { await operation(); await refresh(); setNotice(success) }
    catch(e){setNotice('Error: '+errorText(e))}
    finally{setBusy(false)}
  }
  async function rpc(name:string,args:Record<string,unknown>) {
    const {data,error}=await getSupabase().rpc(name,args)
    if(error)throw new Error(error.message)
    return data
  }
  async function signIn(e:FormEvent) {
    e.preventDefault();setBusy(true);setNotice('')
    try{
      const {data,error}=await getSupabase().auth.signInWithPassword({email,password})
      if(error)throw error
      if(!data.user)throw new Error('Login did not return a user')
      setUser(data.user);await refresh()
    }catch(err){setNotice('Error: '+errorText(err))}finally{setBusy(false)}
  }
  async function signOut(){await getSupabase().auth.signOut();setUser(null);setRole('');setNotice('')}

  async function preview(itemId:string) {
    setRequestItem(itemId);setMatches([])
    if(!itemId)return
    try{
      const d=await rpc('monitor_find_duplicates',{p_item_id:itemId,p_days:agency?.duplicate_window_days||90})
      setMatches((d||[]) as Match[])
    }catch(e){setNotice('Error: '+errorText(e))}
  }
  async function submitRequest(e:FormEvent) {
    e.preventDefault()
    await run(async()=>{
      const id=await rpc('monitor_create_requisition',{
        p_section_id:requestSection,p_item_id:requestItem,p_quantity:Number(requestQty),
        p_unit_price:Number(requestPrice),p_purpose:requestPurpose,p_idempotency_key:crypto.randomUUID(),
      }) as string
      const status=await rpc('monitor_submit_requisition',{p_requisition_id:id})
      setRequestPurpose('');setMatches([])
      return status
    },'Request saved and submitted. If repeat-purchase matches exist, review is required before approval.')
  }
  async function review(id:string, decision:'APPROVE'|'REJECT') {
    await run(()=>rpc('monitor_review_requisition',{p_requisition_id:id,p_decision:decision,p_reason:reviewReason}),`Requisition ${decision.toLowerCase()}d and audit recorded.`)
  }
  async function recordPurchase(e:FormEvent) {
    e.preventDefault()
    await run(()=>rpc('monitor_record_purchase',{
      p_reference:purchaseRef,p_requisition_id:purchaseReq||null,p_supplier_id:purchaseSupplier||null,
      p_item_id:requestItem,p_quantity:Number(requestQty),p_price:Number(requestPrice),p_ordered_at:purchaseDate,p_section_id:purchaseSection||null,
    }), 'Purchase registered for internal monitoring (not a payment transaction).')
  }
  async function recordReceipt(e:FormEvent) {
    e.preventDefault()
    await run(()=>rpc('monitor_record_receipt',{p_purchase_line_id:receiptLine,p_quantity:Number(receiptQty),p_received_at:today()}),'Goods receipt recorded.')
  }
  async function recordExpense(e:FormEvent) {
    e.preventDefault()
    await run(()=>rpc('monitor_record_expense_evidence',{p_purchase_line_id:expenseLine,p_amount:Number(expenseAmount),p_reference:expenseRef,p_note:'Agency-reported internal expenditure evidence'}),'Internal expense evidence recorded; no bank payment was performed.')
  }
  async function saveSetup(e:FormEvent) {
    e.preventDefault()
    const args:Record<string,unknown> = adminMode==='agency'
      ? {p_name:agencyName||agency?.name,p_short_name:agencyShort||agency?.short_name,p_address:agencyAddress,p_phone:agencyPhone,p_email:agencyEmail,p_window_days:Number(agencyDays),p_physical_address:agencyPhysical,p_logo_path:agencyLogo||null}
      : adminMode==='division'?{p_code:code,p_name:label}
      : adminMode==='section'?{p_division_id:chosenDivision,p_code:code,p_name:label}
      : adminMode==='item'?{p_code:code,p_name:label,p_unit:unit,p_category_id:itemCategory||null}
      : adminMode==='category'?{p_code:code,p_name:label}
      : adminMode==='staff'?{p_auth_user_id:staffId,p_full_name:staffName,p_role:staffRole,p_section_id:staffSection||null}
      : {p_name:label,p_contact:''}
    await run(()=>rpc('monitor_admin_'+(adminMode==='agency'?'configure_agency':(adminMode==='staff'?'assign_staff':'create_'+adminMode)),args),'Agency configuration saved.')
    setCode('');setLabel('');setStaffId('');setStaffName('')
  }
  async function verifyEvidence(id:string,accept:boolean) {
    await run(()=>rpc('monitor_verify_expense_evidence',{p_evidence_id:id,p_accept:accept,p_reason:verifyReason}),
      accept?'Evidence independently verified.':'Evidence disputed for investigation.')
    setVerifyReason('')
  }
  async function addAlias(e:FormEvent) {
    e.preventDefault()
    await run(()=>rpc('monitor_admin_add_item_alias',{p_item_id:aliasItem,p_alias:aliasText}),
      'Item synonym saved. The duplicate checker will compare it to other item names and aliases.')
    setAliasText('')
  }
  async function secureRequest(path:string, options:RequestInit={}) {
    const {data:{session}} = await getSupabase().auth.getSession()
    if(!session?.access_token) throw new Error('Sign in again before accessing documents')
    const response = await fetch(path, {...options,headers:{...options.headers,Authorization:`Bearer ${session.access_token}`}})
    const body = await response.json()
    if(!response.ok) throw new Error(String(body?.error||'Document request failed'))
    return body
  }
  async function loadDocuments() {
    if(!documentId) return setDocuments([])
    await run(async()=>{
      const result=await secureRequest(`/api/attachments?entity=${encodeURIComponent(documentEntity)}&entityId=${encodeURIComponent(documentId)}`)
      setDocuments((result.documents||[]) as AgencyDocument[])
    },'Document records refreshed.')
  }
  async function uploadDocument(e:FormEvent) {
    e.preventDefault()
    if(!documentId || !documentFile){setNotice('Choose a record and a file');return}
    await run(async()=>{
      const form=new FormData()
      form.set('entity',documentEntity)
      form.set('entityId',documentId)
      form.set('file',documentFile)
      await secureRequest('/api/attachments',{method:'POST',body:form})
      setDocumentFile(null)
      const result=await secureRequest(`/api/attachments?entity=${encodeURIComponent(documentEntity)}&entityId=${encodeURIComponent(documentId)}`)
      setDocuments((result.documents||[]) as AgencyDocument[])
    },'Private attachment uploaded and linked to this agency record.')
  }
  async function openDocument(id:string){
    try {
      const result=await secureRequest(`/api/attachments/${id}`)
      window.open(result.url,'_blank','noopener,noreferrer')
    }catch(err){setNotice('Error: '+errorText(err))}
  }
  async function uploadLogo() {
    if(!logoFile){setNotice('Choose a PNG or JPEG agency logo');return}
    await run(async()=>{
      const form=new FormData();form.set('file',logoFile)
      const result=await secureRequest('/api/branding',{method:'POST',body:form})
      setAgencyLogo(String(result.url))
      setLogoFile(null)
    },'Logo uploaded. Save agency settings to apply the new logo.')
  }
  const warningsFor=(reqId:string)=>{
    const reqLineIds=new Set(requestLines.filter(l=>l.requisition_id===reqId).map(l=>l.id))
    return duplicateReviews.filter(d=>reqLineIds.has(d.requisition_line_id))
  }
  const itemName=(id:string)=>items.find(x=>x.id===id)?.name||'Unknown item'
  const sectionName=(id:string)=>sections.find(x=>x.id===id)?.name||'Unassigned section'
  const approvedRequests=requests.filter(x=>x.status==='APPROVED')
  useEffect(()=>{
    if(!agency)return
    setAgencyName(agency.name);setAgencyShort(agency.short_name)
    setAgencyAddress(agency.postal_address||'');setAgencyPhone(agency.phone||'')
    setAgencyEmail(agency.email||'');setAgencyPhysical(agency.physical_address||'');setAgencyLogo(agency.logo_path||'');setAgencyDays(String(agency.duplicate_window_days||90))
  },[agency])
  const report=useMemo(()=>({
    total:spendingByItem.reduce((n,x)=>n+Number(x.order_value),0),
    evidence:expenseStatus.reduce((n,x)=>n+Number(x.reported_amount),0),
    verified:expenseStatus.filter(x=>x.status==='VERIFIED').reduce((n,x)=>n+Number(x.reported_amount),0),
    items:spendingByItem.map(x=>({item:x.item_name,qty:Number(x.ordered_quantity),value:Number(x.order_value),count:Number(x.purchase_lines)})),
    sections:spendingBySection.map(x=>({section:x.division_name+' / '+x.section_name,qty:Number(x.ordered_quantity),value:Number(x.order_value),count:Number(x.purchase_lines)})),
  }),[spendingByItem,spendingBySection,expenseStatus])
  if(loading)return <main className="center"><div className="spinner"/>Loading agency monitor...</main>
  if(!user)return <main className="loginPage"><div className="loginCard"><div className="eyebrow">INDEPENDENT GOVERNMENT AGENCY SYSTEM</div><h1>Requisitions & Expenditure Monitor</h1><p className="muted">Sign in to your agency's own installation. No agency database is shared.</p><form onSubmit={signIn}><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label><button disabled={busy}>Sign in</button></form>{notice&&<p className="notice">{notice}</p>}<p className="footnote">Your agency administrator must create your account and assign your institutional role.</p></div></main>
  if(!role)return <main className="center"><div className="panel"><h2>Account not provisioned</h2><p>You have authenticated, but your agency administrator has not yet assigned an active role in this independent installation.</p><button onClick={signOut}>Sign out</button></div></main>
  const tabs:[Tab,string][]=[['overview','Overview'],['requests','Requisitions'],['purchases','Purchases & Receipts'],['catalogue','Item Catalogue'],['reports','Reports'],['documents','Documents'],['settings','Agency Setup']]
  return <div className="shell">
    <aside className="sidebar">{agency?.logo_path?<img className="agencyLogo" src={agency.logo_path} alt={`${agency.short_name} official logo`}/>:<div className="brandmark">◎</div>}<div className="agencyTitle">{agency?.short_name||'New agency'}<small>Internal Monitoring</small></div><div className="sideLabel">WORKSPACE</div><nav>{tabs.filter(([id])=>id!=='settings'||role==='administrator').map(([id,label])=><button className={id===tab?'active':''} key={id} onClick={()=>{setTab(id);setNotice('')}}>{label}</button>)}</nav><div className="sidebarEnd"><div className="mutedLight">{role.toUpperCase()}</div><span>{user.email}</span><button className="signOut" onClick={signOut}>Sign out</button></div></aside>
    <main className="main"><header><div><span className="eyebrow">{agency?.name||'UNCONFIGURED AGENCY'} / WORKSPACE</span><h1>{tabs.find(x=>x[0]===tab)?.[1]}</h1></div><button className="outline" disabled={busy} onClick={()=>void run(async()=>{},'Latest agency records loaded.')}>Refresh records</button></header>
    {notice&&<div className="notice">{notice}</div>}
    {tab==='overview'&&<><div className="metrics"><div className="metric"><small>Requisitions</small><b>{requests.length}</b><span>Recent activity</span></div><div className="metric"><small>Awaiting approval</small><b>{requests.filter(x=>x.status==='SUBMITTED'||x.status==='NEEDS_REVIEW').length}</b><span>Officer action required</span></div><div className="metric"><small>Purchase orders recorded</small><b>{purchases.length}</b><span>Not equivalent to payment</span></div><div className="metric"><small>Purchase value recorded</small><b>{money(report.total)}</b><span>Item quantity × unit cost</span></div></div><div className="two"><section className="panel"><h2>Requests requiring attention</h2>{requests.filter(x=>x.status==='NEEDS_REVIEW'||x.status==='SUBMITTED').length===0?<p className="muted">No pending requisitions in the current view.</p>:<div className="tablewrap"><table><thead><tr><th>Reference</th><th>Division / Section</th><th>Status</th></tr></thead><tbody>{requests.filter(x=>['NEEDS_REVIEW','SUBMITTED'].includes(x.status)).slice(0,12).map(x=><tr key={x.id}><td>{x.reference}</td><td>{sectionName(x.section_id)}</td><td><span className="chip">{x.status.replaceAll('_',' ')}</span></td></tr>)}</tbody></table></div>}</section><section className="panel"><h2>Why monitor purchasing?</h2><p>Before an officer approves another requisition, the application searches previous purchase records and pending requests for the same catalogue item. Possible repeat buying is flagged for human review, not treated as proven waste.</p><p className="muted">The figures here are internal monitoring records only. They are not official accounting balances or IFMS transactions.</p></section></div></>}
    {tab==='requests'&&<><section className="panel"><h2>Create internal requisition</h2><p className="muted">Request a catalogue item. Matching previous purchases or pending requests are shown before you submit.</p><form className="formGrid" onSubmit={submitRequest}><label>Requesting section<select required value={requestSection} onChange={e=>setRequestSection(e.target.value)}><option value="">Select section</option>{sections.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Catalogue item<select required value={requestItem} onChange={e=>void preview(e.target.value)}><option value="">Select item</option>{items.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name} ({x.unit})</option>)}</select></label><label>Quantity<input type="number" min="0.001" step="0.001" required value={requestQty} onChange={e=>setRequestQty(e.target.value)}/></label><label>Estimated unit price (PGK)<input type="number" min="0" step="0.01" required value={requestPrice} onChange={e=>setRequestPrice(e.target.value)}/></label><label className="wide">Purpose / justification<textarea required minLength={5} value={requestPurpose} onChange={e=>setRequestPurpose(e.target.value)} rows={3} placeholder="Why do you need these goods or services?"/></label><div className="wide"><button disabled={busy||!(role==='requester'||role==='administrator')}>Submit requisition</button></div></form>{matches.length>0&&<div className="alert"><b>Potential repeated purchase — {matches.length} matching record(s)</b><p>Check the previous request or purchase before approval. Similar items may be legitimate repeat supplies.</p><ul>{matches.slice(0,5).map((m,i)=><li key={m.source_id+'-'+i}>{m.reference} · {m.event_date} · {m.quantity} units · {money(m.unit_price)} each · {m.section||'agency-wide'}</li>)}</ul></div>}</section><section className="panel"><h2>Requisition register</h2><div className="tablewrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Section</th><th>Status</th><th>Review</th></tr></thead><tbody>{requests.map(x=><tr key={x.id}><td>{x.reference}</td><td>{x.created_at.slice(0,10)}</td><td>{sectionName(x.section_id)}{warningsFor(x.id).length>0&&<div className="alert"><strong>{warningsFor(x.id).length} possible repeat purchase(s)</strong><ul>{warningsFor(x.id).slice(0,4).map(w=><li key={w.id}>{w.source_type} {(w.source_type==='PURCHASE'?purchases.find(p=>p.id===w.source_id)?.purchase_reference:requests.find(r=>r.id===w.source_id)?.reference)||w.source_id.slice(0,8)} — {w.disposition||'Needs review'}</li>)}</ul></div>}</td><td><span className="chip">{x.status.replaceAll('_',' ')}</span></td><td>{['SUBMITTED','NEEDS_REVIEW'].includes(x.status)&&(role==='reviewer'||role==='administrator')?<div className="actions"><button className="small" disabled={busy||x.requester_id===user.id} onClick={()=>void review(x.id,'APPROVE')}>Approve</button><button className="small ghost" disabled={busy||x.requester_id===user.id} onClick={()=>void review(x.id,'REJECT')}>Reject</button></div>:'—'}</td></tr>)}</tbody></table></div>{(role==='reviewer'||role==='administrator')&&<label>Approval/rejection rationale (at least 15 characters when repeat purchases are flagged)<textarea value={reviewReason} onChange={e=>setReviewReason(e.target.value)} rows={2} placeholder="Explain whether a repeat purchase is justified"/></label>}</section></>}
    {tab==='purchases'&&<><section className="panel"><h2>Record purchase</h2><p className="muted">Record actual purchasing activity. This does not execute a payment.</p><form className="formGrid" onSubmit={recordPurchase}><label>Purchase reference<input value={purchaseRef} required onChange={e=>setPurchaseRef(e.target.value)} placeholder="PO-2026-001"/></label><label>Linked approved requisition (optional)<select value={purchaseReq} onChange={e=>setPurchaseReq(e.target.value)}><option value="">Historical / externally authorised</option>{approvedRequests.map(x=><option key={x.id} value={x.id}>{x.reference}</option>)}</select></label><label>Purchasing section<select required={!purchaseReq} value={purchaseSection} onChange={e=>setPurchaseSection(e.target.value)}><option value="">Use linked requisition section</option>{sections.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Supplier<select value={purchaseSupplier} onChange={e=>setPurchaseSupplier(e.target.value)}><option value="">Not specified</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Item<select required value={requestItem} onChange={e=>setRequestItem(e.target.value)}><option value="">Choose item</option>{items.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Quantity<input type="number" min="0.001" step="0.001" value={requestQty} onChange={e=>setRequestQty(e.target.value)}/></label><label>Actual unit price (PGK)<input type="number" min="0" step="0.01" value={requestPrice} onChange={e=>setRequestPrice(e.target.value)}/></label><label>Purchase date<input type="date" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)}/></label><div className="wide"><button disabled={busy||!(role==='purchaser'||role==='administrator')}>Record purchase</button></div></form></section><div className="two"><section className="panel"><h2>Record goods receipt</h2><form onSubmit={recordReceipt}><label>Purchase line<select value={receiptLine} onChange={e=>setReceiptLine(e.target.value)} required><option value="">Choose purchase line</option>{lines.map(l=><option key={l.id} value={l.id}>{purchases.find(p=>p.id===l.purchase_id)?.purchase_reference}: {itemName(l.item_id)}</option>)}</select></label><label>Quantity received<input type="number" min="0.001" step="0.001" value={receiptQty} onChange={e=>setReceiptQty(e.target.value)}/></label><button disabled={busy||!(role==='receiver'||role==='administrator')}>Record receipt</button></form></section><section className="panel"><h2>Record reported expenditure</h2><form onSubmit={recordExpense}><label>Purchase line<select value={expenseLine} onChange={e=>setExpenseLine(e.target.value)} required><option value="">Choose purchase line</option>{lines.map(l=><option key={l.id} value={l.id}>{purchases.find(p=>p.id===l.purchase_id)?.purchase_reference}: {itemName(l.item_id)}</option>)}</select></label><label>Reported amount (PGK)<input type="number" min="0.01" step="0.01" value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)}/></label><label>Evidence reference<input value={expenseRef} onChange={e=>setExpenseRef(e.target.value)} required placeholder="Receipt / invoice number"/></label><button disabled={busy||!(role==='purchaser'||role==='administrator')}>Record evidence</button></form></section></div><section className="panel"><h2>Independent expense evidence verification</h2><p className="muted">Reported expense evidence is not verified until reviewed by a second authorised officer. This is not a bank payment confirmation.</p><label>Verification note<textarea value={verifyReason} onChange={e=>setVerifyReason(e.target.value)} rows={2} placeholder="Evidence checked against purchase records and documents"/></label><div className="tablewrap"><table><thead><tr><th>Reported amount</th><th>Purchase</th><th>Status</th><th>Action</th></tr></thead><tbody>{expenses.map(x=><tr key={x.id}><td>{money(x.reported_amount)}</td><td>{itemName(lines.find(l=>l.id===x.purchase_line_id)?.item_id||'')}</td><td>{x.status}</td><td>{x.status==='REPORTED'&&(role==='reviewer'||role==='administrator')&&x.recorded_by!==user.id?<div className="actions"><button className="small" disabled={busy||verifyReason.trim().length<8} onClick={()=>void verifyEvidence(x.id,true)}>Verify</button><button className="small ghost" disabled={busy||verifyReason.trim().length<8} onClick={()=>void verifyEvidence(x.id,false)}>Dispute</button></div>:'—'}</td></tr>)}</tbody></table></div></section></>}
    {tab==='catalogue'&&<section className="panel"><h2>Standard item catalogue</h2><label>Search items and codes<input value={catalogueSearch} onChange={e=>setCatalogueSearch(e.target.value)} placeholder="Search printer cartridges, paper, fuel..."/></label><p className="muted">Use consistent item codes across divisions to improve purchasing-history searches and possible duplicate detection.</p><div className="tablewrap"><table><thead><tr><th>Item code</th><th>Description</th><th>Unit</th><th>Internal category</th><th>Purchase entries</th></tr></thead><tbody>{items.filter(it=>(it.code+' '+it.name).toLowerCase().includes(catalogueSearch.toLowerCase())).map(it=><tr key={it.id}><td>{it.code}</td><td>{it.name}</td><td>{it.unit}</td><td>{categories.find(c=>c.id===it.category_id)?.name||'Unclassified'}</td><td>{lines.filter(l=>l.item_id===it.id).length}</td></tr>)}</tbody></table></div>{role==='administrator'&&<form className="formGrid" onSubmit={addAlias}><h3 className="wide">Add an item synonym for repeat-purchase checks</h3><label>Catalogue item<select required value={aliasItem} onChange={e=>setAliasItem(e.target.value)}><option value="">Choose item</option>{items.map(it=><option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}</select></label><label>Alternative name or purchasing description<input required minLength={3} value={aliasText} onChange={e=>setAliasText(e.target.value)} placeholder="e.g. LaserJet toner black"/></label><div className="wide"><button disabled={busy}>Save synonym</button></div></form>}</section>}
    {tab==='reports'&&<><div className="metrics"><div className="metric"><small>Purchase value registered</small><b>{money(report.total)}</b><span>Order-level internal amounts</span></div><div className="metric"><small>Expenditure evidence reported</small><b>{money(report.evidence)}</b><span>Internal evidence — verified {money(report.verified)}</span></div><div className="metric"><small>Item types purchased</small><b>{report.items.length}</b><span>Item-level monitoring</span></div></div><section className="panel"><h2>Item-wise purchasing history</h2><div className="tablewrap"><table><thead><tr><th>Catalogue item</th><th>Quantity ordered</th><th>Entries</th><th>Total purchase value</th></tr></thead><tbody>{report.items.map(x=><tr key={x.item}><td>{x.item}</td><td>{x.qty}</td><td>{x.count}</td><td>{money(x.value)}</td></tr>)}</tbody></table></div><p className="muted">Purchase totals and expenditure evidence represent different transaction stages; they must not be added together as one total.</p></section><section className="panel"><h2>Purchasing by section</h2><div className="tablewrap"><table><thead><tr><th>Section</th><th>Items ordered</th><th>Purchase lines</th><th>Internal value</th></tr></thead><tbody>{report.sections.map(x=><tr key={x.section}><td>{x.section}</td><td>{x.qty}</td><td>{x.count}</td><td>{money(x.value)}</td></tr>)}</tbody></table></div></section><div className="two"><section className="panel"><h2>Purchasing by internal expense category</h2><div className="tablewrap"><table><thead><tr><th>Category</th><th>Purchase lines</th><th>Recorded value</th></tr></thead><tbody>{categoryReport.map(x=><tr key={x.category_code}><td>{x.category_name}</td><td>{x.purchase_lines}</td><td>{money(x.order_value)}</td></tr>)}</tbody></table></div></section><section className="panel"><h2>Purchasing by supplier</h2><div className="tablewrap"><table><thead><tr><th>Supplier</th><th>Purchase lines</th><th>Recorded value</th></tr></thead><tbody>{supplierReport.map(x=><tr key={x.supplier_name}><td>{x.supplier_name}</td><td>{x.purchase_lines}</td><td>{money(x.order_value)}</td></tr>)}</tbody></table></div></section></div></>}
    {tab==='documents'&&<section className="panel"><h2>Private supporting evidence</h2><p className="muted">PDF, PNG or JPEG up to 8 MB. Documents are stored in this agency's private bucket. Access requires record-specific authorisation and expires after 60 seconds.</p><form className="formGrid" onSubmit={uploadDocument}><label>Record type<select value={documentEntity} onChange={e=>{setDocumentEntity(e.target.value as typeof documentEntity);setDocumentId('');setDocuments([])}}><option value="requisition">Requisition</option><option value="purchase">Purchase</option><option value="expense">Reported expenditure</option></select></label><label>Record<select value={documentId} onChange={e=>{setDocumentId(e.target.value);setDocuments([])}} required><option value="">Choose authorised record</option>{documentEntity==='requisition'?requests.map(r=><option value={r.id} key={r.id}>{r.reference}</option>):documentEntity==='purchase'?purchases.map(p=><option value={p.id} key={p.id}>{p.purchase_reference}</option>):expenses.map(x=><option value={x.id} key={x.id}>{x.id.slice(0,12)} — {x.status}</option>)}</select></label><label>Upload a supporting document<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>setDocumentFile(e.target.files?.[0]||null)}/></label><div className="wide actions"><button type="submit" disabled={busy||!documentFile||!documentId}>Upload privately</button><button type="button" className="outline" disabled={busy||!documentId} onClick={()=>void loadDocuments()}>View stored documents</button></div></form><div className="tablewrap"><table><thead><tr><th>Document</th><th>Type</th><th>Uploaded</th><th>Access</th></tr></thead><tbody>{documents.map(x=><tr key={x.id}><td>{x.original_name}</td><td>{x.mime_type}</td><td>{new Date(x.created_at).toLocaleDateString('en-PG')}</td><td><button className="small" onClick={()=>void openDocument(x.id)}>Open securely</button></td></tr>)}</tbody></table></div></section>}
    {tab==='settings'&&role==='administrator'&&<section className="panel"><h2>Configure this agency</h2><p className="muted">Each agency has its own database. Changes here affect only this deployment.</p><div className="inlineTabs">{(['agency','division','section','category','item','supplier','staff'] as const).map(x=><button className={x===adminMode?'chosen':'ghost'} key={x} onClick={()=>setAdminMode(x)}>{x}</button>)}</div><form className="formGrid" onSubmit={saveSetup}>{adminMode==='agency'?<><label>Official institution name<input required value={agencyName} placeholder={agency?.name||'Name'} onChange={e=>setAgencyName(e.target.value)}/></label><label>Abbreviation<input required value={agencyShort} placeholder={agency?.short_name||'Short name'} onChange={e=>setAgencyShort(e.target.value)}/></label><label>Postal / street address<input value={agencyAddress} onChange={e=>setAgencyAddress(e.target.value)}/></label><label>Phone<input value={agencyPhone} onChange={e=>setAgencyPhone(e.target.value)}/></label><label>Contact email<input type="email" value={agencyEmail} onChange={e=>setAgencyEmail(e.target.value)}/></label><label>Physical address<input value={agencyPhysical} onChange={e=>setAgencyPhysical(e.target.value)}/></label><label>Upload logo (PNG/JPEG)<input type="file" accept="image/png,image/jpeg" onChange={e=>setLogoFile(e.target.files?.[0]||null)}/><button className="small" type="button" disabled={busy||!logoFile} onClick={()=>void uploadLogo()}>Upload logo to agency project</button></label><label>Logo HTTPS URL<input type="url" value={agencyLogo} onChange={e=>setAgencyLogo(e.target.value)} placeholder="https://agency.example.gov.pg/logo.png"/></label><label>Duplicate warning lookback (days)<input type="number" min="7" max="1095" value={agencyDays} onChange={e=>setAgencyDays(e.target.value)}/></label></>:adminMode==='staff'?<><label>Verified Supabase Auth User UUID<input required value={staffId} onChange={e=>setStaffId(e.target.value)} placeholder="Invite staff in this agency Auth project first"/></label><label>Officer name<input required value={staffName} onChange={e=>setStaffName(e.target.value)}/></label><label>Role<select value={staffRole} onChange={e=>setStaffRole(e.target.value)}>{['requester','reviewer','purchaser','receiver','auditor','administrator'].map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>Staff section<select value={staffSection} onChange={e=>setStaffSection(e.target.value)} required={staffRole==='requester'}><option value="">No section assignment</option>{sections.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></>:<>{adminMode==='section'&&<label>Division<select required value={chosenDivision} onChange={e=>setChosenDivision(e.target.value)}><option value="">Choose division</option>{divisions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}{adminMode!=='supplier'&&<label>Reference code<input required value={code} onChange={e=>setCode(e.target.value)}/></label>}<label>{adminMode==='item'?'Item description':'Name'}<input required value={label} onChange={e=>setLabel(e.target.value)}/></label>{adminMode==='item'&&<><label>Standard unit<input value={unit} onChange={e=>setUnit(e.target.value)}/></label><label>Internal expense category<select value={itemCategory} onChange={e=>setItemCategory(e.target.value)}><option value="">Unclassified</option>{categories.map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></label></>}</>}<div className="wide"><button disabled={busy}>Save {adminMode}</button></div></form><p className="footnote">Staff login identities must first be invited and verified in this agency’s own Supabase Auth project. This screen assigns only the internal role and section for an existing account.</p></section>}
    <footer>INDEPENDENT INTERNAL CONTROLS • No IFMS integration • No bank payment execution • Agency-specific private database</footer>
    </main>
  </div>
}
