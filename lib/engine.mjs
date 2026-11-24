import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, renameSync, copyFileSync, lstatSync, readdirSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const stages = ['observed', 'inquiry', 'handed_off', 'quoted', 'won'];
const surfaces = ['page', 'profile', 'group'];
const statuses = ['draft', 'approved', 'scheduled', 'published'];
const sources = ['organic', 'paid', 'unknown'];
const vaultTemplate = fileURLToPath(new URL('../vault-seed/', import.meta.url));
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function check(ok, message) { if (!ok) throw new Error(message); }
function key(value, label = 'ID') {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) && !reserved.test(value), 'Invalid ' + label);
  return value;
}
function tenantKey(value) {
  check(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(value), 'Invalid tenant; use a lowercase ASCII identifier');
  return key(value, 'tenant');
}
function str(value, label, max = 12000) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), 'Invalid ' + label);
  return value.trim();
}
function option(value, choices, label) { check(choices.includes(value), 'Invalid ' + label); return value; }
function http(value, facebook = false) {
  let u;
  try { u = new URL(str(value, 'URL', 3000)); } catch { throw new Error('Invalid URL'); }
  check(u.protocol === 'https:' && !u.username && !u.password, 'Expected https URL');
  if (facebook) check((u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com') || u.hostname === 'fb.watch') && u.pathname !== '/' && !u.port, 'Expected Facebook object permalink');
  return u.href;
}
function publicationUrl(value) {
  const u = new URL(http(value,true));
  const direct = /^\/(\d+(?:_\d+)?|pfbid[A-Za-z0-9]+)\/?$/.test(u.pathname);
  const object = /\/(posts|permalink|videos|reel|photos)\/[^/]+/.test(u.pathname) ||
    (/^\/(photo|story|permalink)(?:\.php)?\/?$/.test(u.pathname) && (u.searchParams.has('fbid') || u.searchParams.has('story_fbid'))) ||
    (u.pathname === '/watch/' && u.searchParams.has('v'));
  check(direct || object || u.hostname === 'fb.watch', 'Expected link to published Facebook object');
  return u.href;
}
function date(value) { check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'Expected date with timezone'); return new Date(value).toISOString(); }
function ownStrings(target, payload, fields) {
  for (const field of fields) if (Object.hasOwn(payload, field)) {
    check(typeof payload[field] === 'string' && payload[field].length <= 20000 && !payload[field].includes('\0'), 'Invalid ' + field);
    target[field] = payload[field].trim();
  }
  return target;
}
function external(row) { return structuredClone(row); }
function nonlink(dir) { check(!lstatSync(dir).isSymbolicLink(), 'Refusing linked workbench path'); }
function ensureDir(dir) { mkdirSync(dir, {recursive:true, mode:0o700}); nonlink(dir); }
function seed(src, dest) {
  if (!existsSync(src)) return;
  for (const entry of readdirSync(src, {withFileTypes:true})) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const input = join(src,entry.name), output = join(dest,entry.name);
    if (entry.isDirectory()) { ensureDir(output); seed(input, output); }
    else if (entry.isFile() && entry.name.endsWith('.md') && !existsSync(output)) copyFileSync(input, output);
  }
}
const blank = tenant => ({tenant, profile:{}, content:[], interactions:[], groups:[], learning:[], requests:{}});
function record(list, id, label) {
  const value = list.find(r => r.id === id);
  check(value, 'Unknown ' + label + ' ID'); return value;
}
function objectId(list, p, prefix) { return p.id ? key(p.id) : prefix + '-' + randomUUID(); }
function upsert(list, obj) {
  const n = list.findIndex(r => r.id === obj.id);
  if (n < 0) list.push(obj); else list[n] = obj;
  return obj;
}
function profile(s,p) {
  const next = ownStrings({...s.profile},p,['name','industry','audience','offer','market','language','voice','tone','goal','pageId','identity','graphVersion','salesUrl','salesProfileName','marketSegment','brand','audienceType','product','proof','brandVoice','timezone','objective','approver','assetPolicy','publicContact']);
  if (next.pageId) check(/^\d+$/.test(next.pageId), 'Invalid Facebook Page ID');
  if (Object.hasOwn(p,'pageAuthorized')) { check(typeof p.pageAuthorized === 'boolean','Invalid Page authorization'); next.pageAuthorized = p.pageAuthorized; }
  if (s.profile.pageId !== next.pageId) {
    check(!s.content.some(r => ['reserved','uncertain'].includes(r.delivery?.status)),'Resolve pending publication before changing Page');
    if (s.profile.pageId && !Object.hasOwn(p,'pageAuthorized')) next.pageAuthorized = false;
  }
  s.profile = next; return next;
}
function group(s,p,now) {
  const id = objectId(s.groups,p,'group'), old = s.groups.find(r => r.id === id);
  const next = ownStrings({...old,id},p,['name','url','kind','rules','status','identity','postingRules','linksRule','moderator','notes','joinedAt','audience','rulesCheckedAt']);
  next.name = str(next.name,'group name'); next.url = http(next.url,true);
  check(/^\/groups\/[^/]+\/?$/.test(new URL(next.url).pathname), 'Expected group homepage');
  next.kind = option(next.kind || 'third_party',['own','third_party'],'group kind');
  next.status ||= 'researching'; next.updatedAt = now; next.createdAt ||= now;
  return upsert(s.groups,next);
}
const copyFields = ['surface','channel','title','body','intent','identity','pageId','assetRights','kind','targetId','postId','groupId','sourceInteractionId','origin','audience','objective','format','cta','owner','campaign','campaignId','notes','assetUrl','utmCampaign','rightsEvidence','approver'];
function content(s,p,now) {
  const id = objectId(s.content,p,'content'), old = s.content.find(r => r.id === id);
  if (old && now <= old.updatedAt) now = new Date(Date.parse(old.updatedAt) + 1).toISOString();
  const next = ownStrings({...old,id},p,copyFields);
  next.surface = option(p.surface || p.channel || next.surface || 'page',surfaces,'surface'); next.channel = next.surface;
  next.kind = option(next.kind || 'post',['post','reply','comment','reel','story','live'],'content kind');
  next.title = str(next.title || next.body?.slice(0,80),'title',500); next.body = str(next.body,'content body',20000);
  if (next.origin) option(next.origin,sources,'origin');
  if (next.sourceInteractionId) record(s.interactions,key(next.sourceInteractionId),'interaction');
  if (next.groupId) record(s.groups,key(next.groupId),'group');
  let changed = old && copyFields.some(k => (old[k] || '') !== (next[k] || ''));
  const prior = old?.status || 'draft';
  let status = option(p.status || (changed ? 'draft' : prior),statuses,'content status');
  if (old?.status === 'published') {
    check(!changed && status === 'published' && (!p.remoteId || p.remoteId === old.remoteId) && (!p.permalink || http(p.permalink,true) === old.permalink), 'Published record is immutable');
    return old;
  }
  if (['reserved','uncertain'].includes(old?.delivery?.status)) {
    check(status === 'published' && !changed && p.deliveryToken === old.delivery.token, 'Delivery in progress; reconcile original receipt');
  }
  if (changed && ['approved','scheduled'].includes(prior)) {
    check(!p.status || p.status === 'draft', 'Changed copy requires new approval');
    status = 'draft';
  }
  if (status === 'approved') {
    check(next.surface !== 'group' || (next.groupId && record(s.groups,next.groupId,'group').rules?.trim()),'Group posting rules required');
    next.approvedAt = old?.approvedAt || now;
  }
  if (status === 'scheduled') {
    check(['approved','scheduled'].includes(prior), 'Approval required before scheduling');
    next.scheduledAt = date(p.scheduledAt || next.scheduledAt);
  }
  if (status === 'published') {
    check(['approved','scheduled'].includes(prior) && !changed,'Approval required before recording publication');
    next.permalink = publicationUrl(p.permalink); next.remoteId = str(p.remoteId,'remote ID',300);
    const sourcePath = new URL(next.permalink).pathname;
    const linkedGroup = /^\/groups\/([^/]+)\//.exec(sourcePath)?.[1];
    if (next.surface === 'group' && linkedGroup) {
      const groupPath = new URL(record(s.groups,next.groupId,'group').url).pathname;
      check(groupPath.split('/')[2].toLowerCase() === linkedGroup.toLowerCase(),'Receipt points to another group');
    }
    const linkedPage = /^\/(\d+)\/(?:posts|videos)\//.exec(sourcePath)?.[1];
    if (next.surface === 'page' && linkedPage && next.pageId) check(linkedPage === next.pageId,'Receipt points to another Page');
    const graph = ['reserved','uncertain'].includes(old?.delivery?.status) && p.deliveryToken === old.delivery.token;
    check((!p.deliveryToken || graph) && (!p.receiptType || p.receiptType === (graph ? 'graph_readback' : 'native_readback')), 'Receipt type requires matching delivery evidence');
    next.receiptType = graph ? 'graph_readback' : 'native_readback';
    check(!s.content.some(r => r.id !== id && r.status === 'published' && (r.remoteId === next.remoteId || r.permalink === next.permalink)), 'Receipt already assigned');
    next.receiptAt = p.receiptAt ? date(p.receiptAt) : now;
    if (next.delivery) next.delivery = {...next.delivery,status:'confirmed'};
  } else {
    check(!p.permalink && !p.remoteId && !p.receiptAt,'Publication receipts require published status');
  }
  if (status === 'draft') { delete next.approvedAt; delete next.scheduledAt; }
  if (status === 'approved') delete next.scheduledAt;
  next.status = status; next.updatedAt = now; next.createdAt ||= now;
  return upsert(s.content,next);
}

function delivery(s,p,now) {
  const row = record(s.content,key(p.id),'content');
  if (now <= row.updatedAt) now = new Date(Date.parse(row.updatedAt) + 1).toISOString();
  check(['approved','scheduled'].includes(row.status), 'Approved content required');
  if (p.decision === 'reserve') {
    check(!row.delivery || row.delivery.status === 'released','Delivery already claimed');
    check(p.expectedUpdatedAt === row.updatedAt && p.expectedBody === row.body, 'Content revision changed');
    if (p.expectedPageId) check(s.profile.pageAuthorized === true && p.expectedPageId === s.profile.pageId && p.expectedPageId === row.pageId,'Page identity or authorization changed');
    if (Object.hasOwn(p,'expectedTargetId')) check((p.expectedTargetId || '') === (row.targetId || ''),'Reply target changed');
    if (Object.hasOwn(p,'expectedPostId')) check((p.expectedPostId || '') === (row.postId || ''),'Parent post changed');
    row.delivery = {status:'reserved',token:randomUUID(),at:now};
  } else {
    check(['release','uncertain'].includes(p.decision) && ['reserved','uncertain'].includes(row.delivery?.status) && row.delivery.token === p.token, 'Invalid delivery claim');
    row.delivery = {...row.delivery,status:p.decision === 'release' ? 'released' : 'uncertain',at:now,reason:str(p.reason || (p.decision === 'uncertain' ? 'Awaiting remote receipt' : ''),'delivery reason')};
  }
  row.updatedAt = now; return row;
}
function interaction(s,p,now) {
  const externalId = p.externalId ? str(p.externalId,'external ID',500) : undefined;
  const previous = externalId && s.interactions.find(r => r.externalId === externalId);
  const id = p.id ? key(p.id) : previous?.id || objectId(s.interactions,p,'signal');
  check(!previous || previous.id === id, 'External interaction already belongs to a different row');
  const old = s.interactions.find(r => r.id === id);
  if (old?.externalId && externalId) check(old.externalId === externalId,'External ID is immutable');
  const next = ownStrings({...old,id},p,['externalId','text','sourceUrl','category','signal','evidence','channel','surface','origin','companyName','companyKey','contentId','nextAction','followupAt','stage','outcomeEvidence','salesReceipt','contactPermission','groupId','owner','attribution','campaign','campaignId','customerId','contactName','intent','notes','permalink','occurredAt','replyUrl','threadId','contact','note','language','market','product','dealValue','consentEvidence','contactChannel','verifiedDomain']);
  if (next.verifiedDomain) {
    next.verifiedDomain = next.verifiedDomain.toLowerCase();
    check(next.verifiedDomain.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(next.verifiedDomain),'Invalid verified domain');
  }
  next.text = str(next.text,'interaction text');
  next.direction = option(p.direction || old?.direction || 'observation',['inbound','outbound','observation'],'interaction direction');
  if (next.sourceUrl) next.sourceUrl = http(next.sourceUrl);
  if (old?.direction === 'inbound') check(next.direction === 'inbound' && next.text === old.text && next.sourceUrl === old.sourceUrl, 'Inbound source is immutable');
  next.signal = option(next.signal || 'weak',['weak','strong'],'signal');
  next.origin = option(next.origin || 'unknown',sources,'origin');
  next.stage = option(next.stage || 'observed',stages,'sales stage');
  next.category ||= 'observation'; next.contactPermission = option(next.contactPermission || 'unknown',['unknown','requested','consented','opted_out'],'contact permission');
  if (old?.contactPermission === 'opted_out' && next.contactPermission !== 'opted_out') check(p.consentEvidence && ['requested','consented'].includes(next.contactPermission),'Fresh consent evidence required');
  if (next.signal === 'strong') check(next.sourceUrl && next.evidence,'Strong signals require source URL and observed evidence');
  if (next.stage === 'handed_off') check(next.salesReceipt && next.contactPermission !== 'opted_out','Sales handoff needs receipt and active contact');
  if (['quoted','won'].includes(next.stage)) check(next.outcomeEvidence,'Commercial outcome requires downstream evidence');
  if (old) check(stages.indexOf(next.stage) >= stages.indexOf(old.stage),'Sales stage regression');
  if (next.followupAt) next.followupAt = date(next.followupAt);
  if (next.occurredAt) next.occurredAt = date(next.occurredAt);
  if (next.contentId) record(s.content,key(next.contentId),'content');
  if (next.groupId) record(s.groups,key(next.groupId),'group');
  next.createdAt ||= now; next.updatedAt = now;
  return upsert(s.interactions,next);
}
function learning(s,p,now) {
  const id = objectId(s.learning,p,'method'), old = s.learning.find(r => r.id === id);
  check(!old || old.status === 'pending','Reviewed method is immutable; create a new candidate');
  const next = ownStrings({...old,id},p,['title','method','scope','hypothesis','limits','owner','metric','counterexample','testMethod']);
  for (const k of ['title','method','scope']) next[k] = str(next[k],k);
  const input = p.evidence ?? next.evidence;
  const evidence = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,，]+/).filter(Boolean) : [];
  check(evidence.length > 0 && evidence.length <= 100,'Provide local evidence IDs');
  const known = new Set([...s.content,...s.interactions].map(r => r.id));
  next.evidence = [...new Set(evidence.map(x => key(x)))];
  check(next.evidence.every(x => known.has(x)),'Unknown evidence in this tenant');
  check(!p.status || p.status === 'pending','New methods require review');
  next.status = 'pending'; next.createdAt ||= now; next.updatedAt = now;
  return upsert(s.learning,next);
}
function review(s,p,now) {
  const row = record(s.learning,key(p.id),'method');
  const status = {accept:'accepted',retire:'retired',reject:'rejected'}[p.decision];
  check(['accepted','retired','rejected'].includes(status),'Invalid review decision');
  if (row.status === status) return row;
  check(status === 'retired' ? row.status === 'accepted' : row.status === 'pending','Invalid review transition');
  row.status = status; row.reviewedAt = now; row.updatedAt = now;
  if (status === 'accepted') row.acceptedAt = now;
  if (status === 'retired') row.retiredAt = now;
  if (p.reason) row.reviewReason = str(p.reason,'review reason'); return row;
}
function makeReport(s) {
  const funnel = Object.fromEntries(stages.map(x => [x,0]));
  const attribution = Object.fromEntries(sources.map(x => [x,{interactions:0,strong:0,...Object.fromEntries(stages.map(y => [y,0]))}]));
  const byStage = new Map(), ideas = [], followups = [];
  for (const r of s.interactions) {
    attribution[r.origin].interactions++;
    if (r.signal === 'strong') attribution[r.origin].strong++;
    const account = (r.companyKey || r.companyName)?.trim().toLowerCase();
    if (account) {
      const prior = byStage.get(account);
      if (!prior || stages.indexOf(r.stage) > stages.indexOf(prior.stage) || (r.stage === prior.stage && r.createdAt < prior.createdAt)) byStage.set(account,r);
    }
    if (r.contactPermission !== 'opted_out' && r.nextAction && r.stage !== 'won') followups.push({id:r.id,company:r.companyName || '',nextAction:r.nextAction,followupAt:r.followupAt || '',stage:r.stage,owner:r.owner || '',sourceUrl:r.sourceUrl || ''});
    if (r.sourceUrl && (['question','objection','faq','request','complaint','feedback','inquiry'].includes(r.category) || r.text.includes('?') || r.text.includes('？'))) {
      ideas.push({interactionId:r.id,sourceUrl:r.sourceUrl,topic:r.text.slice(0,250),suggestion:'围绕这条具体问题撰写一则答疑，结合本客户已核实的产品或服务事实。',category:r.category});
    }
  }
  for (const r of byStage.values()) { funnel[r.stage]++; attribution[r.origin][r.stage]++; }
  followups.sort((a,b) => (a.followupAt || 'z').localeCompare(b.followupAt || 'z'));
  const byStatus = Object.fromEntries(statuses.map(x => [x,s.content.filter(r => r.status === x).length]));
  return {
    counts:{content:s.content.length,interactions:s.interactions.length,strong:s.interactions.filter(r => r.signal === 'strong').length,groups:s.groups.length,learning:s.learning.length,companies:byStage.size,unidentified:s.interactions.filter(r => !(r.companyKey || r.companyName)).length, ...byStatus},
    funnel,attribution,ideas,followups,
    receipts:s.content.filter(r => r.status === 'published').map(({id,title,surface,remoteId,permalink,receiptAt,receiptType}) => ({id,title,surface,remoteId,permalink,receiptAt,receiptType})),
    signals:s.interactions.filter(r => r.signal === 'strong').map(({id,companyName,evidence,sourceUrl,stage}) => ({id,companyName,evidence,sourceUrl,stage})),
    calendar:s.content.filter(r => r.status === 'scheduled').map(({id,title,surface,scheduledAt}) => ({id,title,surface,scheduledAt})).sort((a,b) => a.scheduledAt.localeCompare(b.scheduledAt))
  };
}

function literal(text) { return String(text).replace(/\r\n?/g,'\n').split('\n').map(line => '    ' + line).join('\n'); }
function note(row) {
  const lines = ['# 已审核运营方法','','## 标题','',literal(row.title),'','## 方法','',literal(row.method),'','## 适用范围','',literal(row.scope)];
  const fields = {hypothesis:'待验证的假设',limits:'适用限制',counterexample:'反例',testMethod:'验证方法',metric:'判断指标',owner:'负责人',reviewReason:'审核说明'};
  for (const [k,title] of Object.entries(fields)) if (row[k]) lines.push('','## ' + title,'',literal(row[k]));
  return [...lines,'','## 本客户证据编号','',...row.evidence.map(id => '- ' + id),'','## 审核记录','',literal(row.acceptedAt || row.reviewedAt),''].join('\n');
}
function createNote(file, body) {
  if (existsSync(file)) { nonlink(file); return; }
  const temp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temp,body,{flag:'wx',mode:0o600});
  try { linkSync(temp,file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { unlinkSync(temp); }
}
function projectVault(s,vault) {
  ensureDir(vault);
  seed(vaultTemplate,vault);
  const active = join(vault,'工作台-已采纳'), archive = join(vault,'工作台-已停用');
  ensureDir(active); ensureDir(archive);
  for (const r of s.learning) {
    if (!['accepted','retired'].includes(r.status)) continue;
    const file = createHash('sha256').update(r.id).digest('hex').slice(0,20) + '.md';
    const current = join(active,file), retired = join(archive,file);
    if (r.status === 'accepted') createNote(current,note(r));
    else if (existsSync(current)) {
      nonlink(current);
      if (existsSync(retired)) {
        nonlink(retired);
        renameSync(current,join(archive,file.slice(0,-3) + '-' + randomUUID() + '.md'));
      } else renameSync(current,retired);
    } else createNote(retired,note(r));
  }
}
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k,canonical(x[k])]));
  return x;
}
const actions = {profile,content,group,interaction,learning,review,delivery};
function apiSnapshot(s,vaultPath) {
  const {requests,...rest} = s;
  return external({...rest,engagements:s.interactions,report:makeReport(s),vaultPath});
}
export function openEngine(dataDir) {
  const root = resolve(str(dataDir,'data directory',4000));
  ensureDir(root);
  const dbFile = join(root,'facebook-workbench.sqlite');
  if (existsSync(dbFile)) nonlink(dbFile);
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA busy_timeout=15000; CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS tenant_page ON tenants(json_extract(state, '$.profile.pageId')) WHERE length(json_extract(state, '$.profile.pageId')) > 0;");
  const find = db.prepare('SELECT state FROM tenants WHERE id = ?');
  const save = db.prepare('INSERT INTO tenants(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state');
  function transaction(tenant,work) {
    tenantKey(tenant);
    const tenants = join(root,'tenants'), dir = join(tenants,tenant), vault = join(dir,'vault');
    ensureDir(tenants); ensureDir(dir);
    db.exec('BEGIN IMMEDIATE');
    let result;
    try {
      const row = find.get(tenant), s = row ? JSON.parse(row.state) : blank(tenant);
      result = work(s,vault);
      save.run(tenant,JSON.stringify(s));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error.message).includes('tenant_page')) throw new Error('Facebook Page already belongs to another tenant');
      throw error;
    }
    // Mirror only committed methods. A stopped process is repaired by the next open or retry.
    db.exec('BEGIN IMMEDIATE');
    try {
      projectVault(JSON.parse(find.get(tenant).state),vault);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error('Ledger saved; vault projection needs retry: ' + error.message);
    }
    return result;
  }
  return {
    async snapshot(tenant) { return transaction(tenant,(s,vault) => apiSnapshot(s,vault)); },
    async apply(tenant,action,payload = {}) {
      check(payload && typeof payload === 'object' && !Array.isArray(payload),'Expected object payload');
      check(JSON.stringify(payload).length <= 150000,'Payload too large');
      return transaction(tenant,s => {
        if (action === 'report') return makeReport(s);
        check(Object.hasOwn(actions,action),'Unknown action');
        const requestId = payload.requestId ? key(payload.requestId,'request ID') : '';
        const digest = requestId ? createHash('sha256').update(JSON.stringify(canonical([action,payload]))).digest('hex') : '';
        if (requestId && Object.hasOwn(s.requests,requestId)) {
          check(s.requests[requestId].digest === digest,'Request ID was reused with different input');
          return external(s.requests[requestId].result);
        }
        const result = actions[action](s,payload,new Date().toISOString());
        if (requestId) Object.defineProperty(s.requests,requestId,{value:{digest,result:external(result)},enumerable:true});
        return external(result);
      });
    },
    close() { db.close(); }
  };
}
