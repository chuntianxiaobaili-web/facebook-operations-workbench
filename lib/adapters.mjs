import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { domainToASCII } from 'node:url';
import http from 'node:http';
import https from 'node:https';

function requireValue(ok, message) { if (!ok) throw new Error(message); }
function tenantKey(tenant) {
  requireValue(typeof tenant === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(tenant), 'Invalid tenant');
  return tenant;
}
export function pageTokenVariable(tenant) {
  return 'FBOPS_' + tenantKey(tenant).toUpperCase().replace(/[-_]/g, c => c === '-' ? '_H' : '_U') + '_PAGE_TOKEN';
}
function graphId(id) {
  requireValue(typeof id === 'string' && /^\d{1,40}(?:_\d{1,40}){0,2}$/.test(id), 'Invalid Meta object ID');
  return id;
}
function objectKey(id) {
  requireValue(typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id), 'Invalid local record ID');
  return id;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function fieldsOnly(input, fields) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => fields.includes(k)), 'Unsupported action parameters');
}
function safeFacebookUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && /^(?:[a-z0-9-]+\.)*facebook\.com$/.test(u.hostname) && !u.username && !u.password && !u.port && u.pathname !== '/' && !u.searchParams.has('access_token') ? u : undefined;
  } catch { return undefined; }
}

// Use a direct connection to the fixed Meta host or the configured loopback server.
// Node versions may enable environment proxies for the global fetch dispatcher.
async function directRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(parsed, {
      method: options.method, headers: options.headers, agent: false, signal: options.signal,
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('error', reject);
      res.on('data', part => {
        size += part.length;
        if (size > 32 * 1024 * 1024) return res.destroy(new Error('Response limit'));
        chunks.push(part);
      });
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    req.once('error', reject);
    req.end(options.body);
  });
}
async function request(fetchImpl, url, options, service) {
  let response;
  try {
    response = await fetchImpl(url.href, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new Error(service + ' connection failed or timed out'); }
  let data;
  try { data = await response.json(); } catch { throw new Error(service + ' response could not be verified'); }
  if (!response.ok || data?.error) {
    const code = data?.error?.code;
    const error = new Error(service + ' returned HTTP ' + response.status + (Number.isInteger(code) ? ' (code ' + code + ')' : ''));
    // Only documented invalid-request / permission / authentication denials establish
    // non-delivery. An HTTP 400 can also wrap an unknown or transient Graph error.
    error.definiteRejection = response.status >= 400 && response.status < 500 && ![408,425,429].includes(response.status)
      && (service === 'Sales' || [10,100,190,200,283,368,459].includes(code));
    throw error;
  }
  return data;
}
async function connectPage({tenant, profile, fetchImpl = directRequest}) {
  requireValue(/^\d{1,40}$/.test(profile.pageId || ''), 'Set a numeric Page ID in the tenant profile');
  requireValue(/^v[1-9]\d*\.\d+$/.test(profile.graphVersion || ''), 'Set an explicit Meta Graph version such as v27.0');
  const envKey = pageTokenVariable(tenant);
  const token = process.env[envKey];
  requireValue(token && !/\s/.test(token), 'Set the Page access token in ' + envKey);
  async function graph(method, route, params = {}) {
    requireValue(/^[a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_]+)?$/.test(route), 'Invalid Meta route');
    requireValue(!Object.keys(params).some(k => /token|secret|url|redirect/i.test(k)), 'Unsupported Meta query parameter');
    const url = new URL('/' + profile.graphVersion + '/' + route, 'https://graph.facebook.com');
    const headers = { Authorization: 'Bearer ' + token };
    const options = { method, headers };
    if (method === 'GET') url.search = new URLSearchParams(params).toString();
    else {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(params);
    }
    return request(fetchImpl, url, options, 'Meta');
  }
  const get = (path, params) => graph('GET', path, params);
  const me = await get('me', {fields:'id,name,category,can_post'});
  requireValue(me.id === profile.pageId && typeof me.category === 'string' && me.category.trim(), 'Page token identity does not match the tenant Page');
  return {me: {id:me.id, name:me.name, can_post:me.can_post === true}, get, post:(path, params) => graph('POST', path, params)};
}
export async function verifiedPageClient(options) {
  const {me, get} = await connectPage(options);
  return {me, get};
}

function ledger(dataDir) {
  mkdirSync(dataDir, {recursive:true, mode:0o700});
  const dbPath = join(dataDir, 'facebook-deliveries.sqlite');
  function use(callback) {
    requireValue(!lstatSync(dataDir).isSymbolicLink() && (!existsSync(dbPath) || !lstatSync(dbPath).isSymbolicLink()), 'Refusing linked delivery ledger');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
      return callback(db);
    } finally { db.close(); }
  }
  use(db => db.exec(`
    CREATE TABLE IF NOT EXISTS claim(
      tenant TEXT NOT NULL, action TEXT NOT NULL, localId TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (tenant,action,localId)
    );
    CREATE TABLE IF NOT EXISTS sales_binding(
      origin TEXT NOT NULL, business TEXT NOT NULL, tenant TEXT NOT NULL,
      PRIMARY KEY(origin,business)
    );
  `));
  return {
    get(key) {
      const row = use(db => db.prepare('SELECT value FROM claim WHERE tenant=? AND action=? AND localId=?').get(...key));
      return row && JSON.parse(row.value);
    },
    insert(key, value) {
      const result = use(db => db.prepare('INSERT OR IGNORE INTO claim VALUES(?,?,?,?)').run(...key, JSON.stringify(value)));
      requireValue(result.changes === 1, 'Delivery already claimed; check the recorded outcome');
    },
    put(key, value) {
      use(db => db.prepare('UPDATE claim SET value=? WHERE tenant=? AND action=? AND localId=?').run(JSON.stringify(value), ...key));
    },
    start(key, prepared, sending) {
      const result = use(db => db.prepare('UPDATE claim SET value=? WHERE tenant=? AND action=? AND localId=? AND value=?')
        .run(JSON.stringify(sending), ...key,JSON.stringify(prepared)));
      requireValue(result.changes === 1, 'Delivery is already being dispatched or the prior preparation has changed');
    },
    cancelPreparation(key, prepared) {
      requireValue(prepared.phase === 'prepared', 'Only an unsubmitted preparation can be replaced');
      const result = use(db => db.prepare('DELETE FROM claim WHERE tenant=? AND action=? AND localId=? AND value=?').run(...key,JSON.stringify(prepared)));
      requireValue(result.changes === 1, 'Delivery preparation has changed');
    },
    clearRejected(key) {
      const result = use(db => db.prepare("DELETE FROM claim WHERE tenant=? AND action=? AND localId=? AND json_extract(value,'$.rejected')=1").run(...key));
      requireValue(result.changes === 1, 'Another operator has already handled this rejection');
    },
    bind(origin, business, tenant) {
      use(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          requireValue(!db.prepare('SELECT tenant FROM sales_binding WHERE business=? AND tenant<>? LIMIT 1').get(business,tenant), 'Sales profile is already bound to a different tenant');
          db.prepare('INSERT OR IGNORE INTO sales_binding VALUES(?,?,?)').run(origin, business, tenant);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
    },
  };
}
function localRecord(rows, id) {
  const row = rows.find(x => x.id === objectKey(id));
  requireValue(row, 'Record does not exist in this tenant');
  return row;
}
async function ownedPost(client, pageId, id) {
  const post = await client.get(graphId(id), {fields:'id,from,permalink_url'});
  requireValue(post.id === id && post.from?.id === pageId, 'Post ownership could not be verified for this Page');
  return post;
}
function nextCursor(page) {
  const cursor = page.paging?.next && page.paging.cursors?.after;
  if (!cursor) return undefined;
  requireValue(typeof cursor === 'string' && cursor.length <= 4096, 'Invalid Meta paging cursor');
  return cursor;
}
async function commentsPage(client, postId, after) {
  if (after !== undefined) requireValue(typeof after === 'string' && after.length > 0 && after.length <= 4096, 'Invalid Meta paging cursor');
  const page = await client.get(graphId(postId) + '/comments', {fields:'id,from,message,created_time,can_comment', filter:'stream', limit:'100', ...(after ? {after} : {})});
  requireValue(Array.isArray(page.data), 'Invalid comments response');
  return page;
}
async function ownedComment(client, draft, pageId) {
  graphId(draft.targetId);
  const post = await ownedPost(client, pageId, draft.postId);
  let after;
  const visited = new Set();
  for (let i = 0; i < 20; i++) {
    const page = await commentsPage(client, post.id, after);
    const target = page.data.find(row => row.id === draft.targetId);
    if (target) {
      requireValue(target.can_comment === true, 'The Page cannot reply to this comment');
      return post;
    }
    after = nextCursor(page);
    if (!after || visited.has(after)) break;
    visited.add(after);
  }
  throw new Error('Target comment could not be found on the approved Page post');
}
function deliveryFingerprint(draft, profile) {
  return digest([profile.pageId, draft.kind, draft.id, draft.body, draft.pageId, draft.postId || '', draft.targetId || '', draft.approvedAt, draft.assetUrl || '']);
}
async function checkGraphReceipt(client, draft, pageId, id, manualSince) {
  const reply = draft.kind === 'reply';
  const obj = await client.get(graphId(id), {fields: (reply ? 'id,from,message,parent' : 'id,from,message,permalink_url') + (manualSince ? ',created_time' : '')});
  requireValue(obj.id === id && obj.from?.id === pageId && obj.message === draft.body, 'Remote author or text does not match the approved item');
  if (manualSince) {
    const at = Date.parse(obj.created_time);
    requireValue(Number.isFinite(at) && at >= Date.parse(manualSince) - 60000 && at <= Date.now() + 60000, 'Remote creation time does not match the recorded delivery');
  }
  let permalink;
  if (reply) {
    requireValue(obj.parent?.id === draft.targetId, 'Remote reply belongs to a different comment');
    const post = await ownedPost(client, pageId, draft.postId);
    const url = safeFacebookUrl(post.permalink_url) || new URL('https://www.facebook.com/' + post.id);
    url.searchParams.set('comment_id', graphId(draft.targetId).split('_').at(-1));
    url.searchParams.set('reply_comment_id', id.split('_').at(-1));
    permalink = url.href;
  } else permalink = safeFacebookUrl(obj.permalink_url)?.href || 'https://www.facebook.com/' + id;
  return {remoteId:id, permalink, receiptAt:new Date().toISOString()};
}
function salesConnection(profile, fetchImpl) {
  requireValue(typeof profile.salesUrl === 'string' && /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(profile.salesUrl), 'Bind the sales workbench to an explicit http://127.0.0.1:PORT');
  const base = new URL(profile.salesUrl);
  const business = profile.salesProfileName || profile.name;
  requireValue(typeof business === 'string' && business.trim(), 'Set the tenant sales business name');
  const call = (path, body) => request(fetchImpl, new URL(path, base), body === undefined ? {method:'GET'} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  }, 'Sales');
  return {origin:base.origin, business, call};
}
function salesMessage(tenant, incoming) {
  requireValue(incoming.direction === 'inbound' && incoming.contactPermission !== 'opted_out', 'Sales handoff requires a confirmed inbound buyer message');
  requireValue(['inquiry','handed_off','quoted','won'].includes(incoming.stage) || ['inquiry','quote_request','sample_request'].includes(incoming.category), 'Record the buyer inquiry before sales handoff');
  requireValue(incoming.externalId && incoming.text?.trim() && incoming.sourceUrl, 'Original buyer text, source and external ID are required');
  requireValue(incoming.externalId.length <= 240 && incoming.sourceUrl.length <= 490 && incoming.text.length <= 50000, 'Sales handoff fields exceed the sales workbench limits');
  requireValue((incoming.companyName || '').length <= 240 && (incoming.companyKey || '').length <= 240, 'Sales company identity exceeds workbench limits');
  let domain;
  if (incoming.verifiedDomain) {
    domain = domainToASCII(incoming.verifiedDomain.toLowerCase().replace(/\.$/,'')).replace(/^www\./,'');
    requireValue(domain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(domain), 'Verified company domain must be a bare DNS name');
  }
  return {
    source:'facebook-' + tenant, externalId:incoming.externalId, body:incoming.text,
    subject:'Facebook ' + incoming.sourceUrl, direction:'inbound',
    ...(incoming.companyName ? {companyName:incoming.companyName} : {}),
    ...(incoming.companyKey ? {companyKey:incoming.companyKey} : {}),
    ...(domain ? {verifiedDomain:domain} : {}),
    ...(incoming.occurredAt ? {occurredAt:incoming.occurredAt} : {}),
  };
}
function salesMatch(row, msg) {
  return row.source === msg.source && row.externalId === msg.externalId && row.body === msg.body &&
    row.direction === msg.direction && row.subject === msg.subject && (!msg.occurredAt || row.occurredAt === msg.occurredAt) && typeof row.id === 'string' && row.id.length > 0 &&
    ['companyKey','verifiedDomain','companyName'].every(k => !msg[k] || (row.identityResolution?.[k] || row[k]) === msg[k]);
}

export async function createAdapters({dataDir, engine, fetchImpl = directRequest}) {
  const receipts = ledger(dataDir);

  async function deliver(tenant, action, p, snapshot) {
    fieldsOnly(p, ['id','reconcileId','retryRejected']);
    const {profile} = snapshot;
    const draft = localRecord(snapshot.content,p.id);
    const reply = action === 'page-reply';
    requireValue(profile.pageAuthorized === true && draft.surface === 'page' && draft.pageId === profile.pageId &&
      draft.kind === (reply ? 'reply' : 'post') && !draft.assetUrl && (!draft.identity || !profile.identity || draft.identity === profile.identity), 'An authorized Page and an approved text item bound to that Page are required');
    const key = [tenant, action, draft.id], fp = deliveryFingerprint(draft, profile);
    let claim = receipts.get(key);
    if (claim?.phase === 'prepared' && claim.expectedUpdatedAt !== draft.updatedAt && !['reserved','uncertain'].includes(draft.delivery?.status)) {
      receipts.cancelPreparation(key,claim);
      claim = undefined;
    }
    if (claim?.rejected) {
      requireValue(p.retryRejected === true && !p.reconcileId, 'Meta rejected this delivery; resolve the reported issue before explicitly retrying with retryRejected');
      if (draft.delivery?.status !== 'released') await engine.apply(tenant,'delivery',{id:draft.id,decision:'release',token:claim.token,reason:'Meta rejected the prior submission'});
      receipts.clearRejected(key);
      claim = undefined;
    } else requireValue(p.retryRejected === undefined || p.retryRejected === false, 'Only an explicitly rejected delivery may be retried');
    if (claim && claim.phase !== 'prepared') {
      requireValue(claim.fingerprint === fp, 'Delivery does not match the recorded approved version');
      if (claim.receipt && draft.status === 'published') {
        requireValue(draft.remoteId === claim.receipt.remoteId, 'Different local publication receipt');
        return {...claim.receipt, duplicate:true};
      }
      requireValue(claim.remoteId || p.reconcileId || claim.receipt, 'Delivery pending or uncertain; verify the remote object before reconciling');
      if (p.reconcileId && claim.remoteId) requireValue(p.reconcileId === claim.remoteId, 'Conflicting remote receipt');
    } else {
      requireValue(!p.reconcileId, 'There is no claimed delivery to reconcile');
      requireValue(draft.status === 'approved' || (!reply && draft.status === 'scheduled' && Date.parse(draft.scheduledAt) <= Date.now()), 'Exact Page item must be approved or its scheduled time must have arrived');
    }
    if (!claim?.receipt) {
      const client = await connectPage({tenant, profile, fetchImpl});
      if (!claim || claim.phase === 'prepared') {
        if (reply) await ownedComment(client,draft,profile.pageId);
        else requireValue(client.me.can_post, 'Meta did not grant posting rights for this Page');
        if (!claim) {
          claim = {fingerprint:fp, phase:'prepared', expectedUpdatedAt:draft.updatedAt, requestId:'delivery-' + randomUUID()};
          receipts.insert(key,claim);
        }
        requireValue(claim.fingerprint === fp, 'Content changed since delivery preparation');
        const reserved = await engine.apply(tenant,'delivery',{id:draft.id, decision:'reserve', requestId:claim.requestId, expectedUpdatedAt:claim.expectedUpdatedAt, expectedPageId:profile.pageId, expectedBody:draft.body,
          ...(reply ? {expectedTargetId:draft.targetId,expectedPostId:draft.postId} : {})});
        const token = reserved?.delivery?.token;
        requireValue(token, 'Could not reserve the approved item');
        const sending = {fingerprint:fp, phase:'dispatching', token, startedAt:new Date().toISOString()};
        receipts.start(key,claim,sending);
        claim = sending;
        try {
          const result = await client.post(reply ? draft.targetId + '/comments' : profile.pageId + '/feed', {message:draft.body});
          claim.remoteId = graphId(result?.id);
          receipts.put(key,claim);
        } catch (error) {
          if (error.definiteRejection) {
            claim.rejected = true;
            receipts.put(key,claim);
          }
          await engine.apply(tenant,'delivery',{id:draft.id, decision:claim.rejected ? 'release' : 'uncertain', token, reason:claim.rejected ? 'Meta rejected the submission' : 'Awaiting a verified Meta receipt'}).catch(() => {});
          throw new Error(error.message + (claim.rejected ? '; Meta rejected this submission' : '; delivery outcome uncertain, verify the Page before reconciliation'));
        }
      }
      try {
        claim.receipt = await checkGraphReceipt(client,draft,profile.pageId,claim.remoteId || graphId(p.reconcileId),claim.remoteId ? undefined : claim.startedAt);
        receipts.put(key,claim);
      } catch (error) {
        await engine.apply(tenant,'delivery',{id:draft.id,decision:'uncertain',token:claim.token}).catch(() => {});
        throw new Error(error.message + '; publication readback pending');
      }
    }
    await engine.apply(tenant,'content',{id:draft.id, status:'published', deliveryToken:claim.token, ...claim.receipt});
    return claim.receipt;
  }

  async function importComments(tenant, snapshot, p) {
    const {profile} = snapshot;
    fieldsOnly(p, ['postId','after']);
    requireValue(profile.pageAuthorized === true, 'Authorize this tenant Page before importing');
    const client = await verifiedPageClient({tenant,profile,fetchImpl});
    const post = await ownedPost(client,profile.pageId,p.postId);
    const page = await commentsPage(client,post.id,p.after);
    const ids = [], skipped = [];
    const known = new Map(snapshot.interactions.map(row => [row.externalId,row]));
    const content = snapshot.content.find(row => row.surface === 'page' && row.remoteId === post.id && row.pageId === profile.pageId);
    for (const item of page.data) {
      if (!item.from?.id || item.from.id === profile.pageId || !item.message?.trim()) { skipped.push('No identifiable inbound text'); continue; }
      const id = graphId(item.id);
      const url = safeFacebookUrl(post.permalink_url) || new URL('https://www.facebook.com/' + post.id);
      url.searchParams.set('comment_id', id.split('_').at(-1));
      const input = {id:'comment-' + digest([profile.pageId, id]).slice(0,32), externalId:id, surface:'page', channel:'page_comment',
        direction:'inbound', sourceUrl:url.href, text:item.message, category:'comment', origin:'unknown',
        ...(content ? {contentId:content.id} : {}), ...(Number.isFinite(Date.parse(item.created_time)) ? {occurredAt:new Date(item.created_time).toISOString()} : {})};
      const prior = known.get(id);
      if (prior) {
        if (prior.text !== item.message.trim() || prior.sourceUrl !== url.href || prior.direction !== 'inbound') skipped.push('Existing comment needs review: ' + id);
        else ids.push(prior.id);
        continue;
      }
      const row = await engine.apply(tenant,'interaction',{...input, requestId:'comment-' + digest(input).slice(0,48)});
      known.set(id,row);
      ids.push(row.id);
    }
    return {ids, processed:ids.length, skipped, after:nextCursor(page) || null};
  }

  async function sales(tenant, action, p, snapshot) {
    fieldsOnly(p,action === 'sales-handoff' ? ['id','retryUnreceived'] : ['id']);
    const incoming = localRecord(snapshot.interactions,p.id);
    const connection = salesConnection(snapshot.profile,fetchImpl);
    const profile = await connection.call('/api/profile');
    requireValue(profile?.businessName === connection.business, 'Sales profile does not match the configured tenant business');
    receipts.bind(connection.origin,connection.business,tenant);
    const msg = salesMessage(tenant,incoming);
    const key = [tenant,'sales-handoff',incoming.id];
    let claim = receipts.get(key);
    if (claim) requireValue(claim.fingerprint === digest(msg) && claim.origin === connection.origin && claim.business === connection.business, 'The bound sales identity or original handoff changed');
    if (!claim && action === 'sales-sync') throw new Error('No sales handoff to synchronize');
    async function loadState() {
      const state = await connection.call('/api/state');
      requireValue(state.profile?.businessName === connection.business && Array.isArray(state.messages) && Array.isArray(state.opportunities), 'Sales state does not match the bound tenant');
      return state;
    }
    const state = await loadState();
    const matches = state.messages.filter(row => row.source === msg.source && row.externalId === msg.externalId);
    requireValue(matches.length < 2 && (!matches.length || salesMatch(matches[0],msg)), 'Conflicting sales message source; review the existing sales record');
    let message = matches[0];
    if (incoming.salesReceipt) requireValue(message && incoming.salesReceipt === message.id, 'Existing sales receipt requires the matching original message');
    if (claim && message) requireValue(!claim.messageId || message.id === claim.messageId, 'Conflicting sales receipt');
    if (!claim || !message) {
      const current = await engine.snapshot(tenant);
      const currentBinding = salesConnection(current.profile,fetchImpl);
      requireValue(currentBinding.origin === connection.origin && currentBinding.business === connection.business &&
        digest(salesMessage(tenant,localRecord(current.interactions,p.id))) === digest(msg), 'Tenant binding or buyer record changed before sales handoff');
      const sending = {fingerprint:digest(msg),origin:connection.origin,business:connection.business,startedAt:new Date().toISOString()};
      if (claim) {
        requireValue(action === 'sales-handoff' && p.retryUnreceived === true && !claim.messageId && Date.now()-Date.parse(claim.startedAt) >= 30000,
          'Sales has no matching record yet. Check the original workbench, then use retryUnreceived after 30 seconds for this same unacknowledged import');
        receipts.start(key,claim,sending);
      } else receipts.insert(key,sending);
      claim = sending;
      if (!message) {
        const result = await connection.call('/api/import',[msg]);
        requireValue(result.messages?.length === 1 && salesMatch(result.messages[0],msg), 'Sales import receipt did not match the handed-off message');
        message = result.messages[0];
      }
    }
    const receipt = {messageId:message.id, companyId:message.companyId || null, linked:Boolean(message.companyId)};
    claim.messageId = message.id;
    receipts.put(key,claim);
    if (incoming.salesReceipt) requireValue(incoming.salesReceipt === message.id, 'Sales message differs from the existing handoff receipt');
    else if (!['quoted','won'].includes(incoming.stage)) {
      await engine.apply(tenant,'interaction',{id:incoming.id,stage:'handed_off',salesReceipt:message.id});
    }
    if (action === 'sales-sync') {
      const linked = state.opportunities.filter(row => message.companyId && row.companyId === message.companyId &&
        (row.evidenceIds?.includes(message.id) || row.history?.some(event => event.evidenceIds?.includes(message.id))));
      const opportunities = linked.map(row => ({id:row.id,stage:row.stage,updatedAt:row.updatedAt}));
      const byId = new Map(state.messages.map(row => [row.id,row]));
      let confirmed;
      for (const stage of ['won','quoted']) {
        for (const deal of linked) {
          if (deal.stage !== stage) continue;
          const transition = deal.history?.filter(h => h.stage === stage).at(-1);
          const proof = transition?.evidenceIds?.map(id => byId.get(id)).find(row => row && row.companyId === message.companyId &&
            (stage === 'won' ? row.event === 'order_confirmed' : ((row.event === 'quote_sent' && row.direction === 'outbound') || (row.event === 'quote_acknowledged' && row.direction === 'inbound'))));
          if (proof) { confirmed = {stage,opportunityId:deal.id,evidenceId:proof.id}; break; }
        }
        if (confirmed) break;
      }
      if (confirmed && incoming.stage !== 'won' && incoming.stage !== confirmed.stage) {
        await engine.apply(tenant,'interaction',{id:incoming.id,stage:confirmed.stage,salesReceipt:message.id,
          outcomeEvidence:'B2B Sales ' + connection.business + ' / ' + confirmed.opportunityId + ' / ' + confirmed.evidenceId});
      }
      return {...receipt,opportunities,confirmed:confirmed || null};
    }
    return receipt;
  }

  return { async execute(tenant, action, payload = {}) {
    tenantKey(tenant);
    const snapshot = await engine.snapshot(tenant);
    requireValue(snapshot?.tenant === tenant, 'Tenant not found or tenant scope mismatch');
    if (action === 'meta-check') {
      fieldsOnly(payload,[]);
      const {me} = await verifiedPageClient({tenant,profile:snapshot.profile,fetchImpl});
      return {pageId:me.id, name:me.name, canPost:me.can_post, pageAuthorized:snapshot.profile.pageAuthorized === true, graphVersion:snapshot.profile.graphVersion};
    }
    if (action === 'page-publish' || action === 'page-reply') return deliver(tenant,action,payload,snapshot);
    if (action === 'page-comments') return importComments(tenant,snapshot,payload);
    if (action === 'sales-handoff' || action === 'sales-sync') return sales(tenant,action,payload,snapshot);
    throw new Error('Unknown adapter action');
  }};
}
