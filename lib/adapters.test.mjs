import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createAdapters, pageTokenVariable } from './adapters.mjs';
import { openEngine } from './engine.mjs';

const ok = data => ({ok:true,status:200,json:async()=>data});
const denied = code => ({ok:false,status:403,json:async()=>({error:{code,message:'Sensitive remote message must not be logged'}})});
const tenant = 'test-br_1', pageId = '101', postId = '101_700', targetId = '700_701', replyId = '700_702';
const link = 'https://www.facebook.com/101/posts/700';
const copy = 'Our new product note';
async function setup(t, handler) {
  const dataDir = await mkdtemp(join(tmpdir(),'fb-ops-adapter-'));
  const engine = openEngine(dataDir);
  t.after(async () => { engine.close(); await rm(dataDir,{recursive:true,force:true,maxRetries:5}); });
  const env = pageTokenVariable(tenant), previous = process.env[env];
  process.env[env] = 'synthetic-test-value';
  t.after(() => { if (previous !== undefined) process.env[env] = previous; else delete process.env[env]; });
  const metaCalls = [];
  const fetchImpl = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin,'https://graph.facebook.com');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(u.searchParams.has('access_token'),false);
    assert.equal(options.redirect, 'error');
    assert.match(u.pathname,/^\/v27\.0\//);
    const route = u.pathname.split('/').slice(2).join('/');
    const call = {route, method:options.method, params:u.searchParams, body:options.body && JSON.parse(options.body)};
    metaCalls.push(call);
    const override = handler && await handler(call);
    if (override) return override;
    if (route === 'me') return ok({id:pageId,name:'Test',category:'Business',can_post:true});
    if (route === pageId + '/feed' && options.method === 'POST') return ok({id:postId});
    if (route === postId) return ok({id:postId,from:{id:pageId},message:copy,permalink_url:link,created_time:new Date().toISOString()});
    if (route === postId + '/comments') return ok({data:[{id:targetId,from:{id:'204'},can_comment:true,message:'Please quote this.',created_time:'2026-01-01T12:00:00+0000'}]});
    if (route === targetId + '/comments' && options.method === 'POST') return ok({id:replyId});
    if (route === replyId) return ok({id:replyId,from:{id:pageId},message:copy,parent:{id:targetId},created_time:new Date().toISOString()});
    throw new Error('Unexpected fake Meta path: ' + route);
  };
  await engine.apply(tenant,'profile',{name:'Test business',pageId,graphVersion:'v27.0',pageAuthorized:true});
  const adapters = await createAdapters({dataDir,engine,fetchImpl});
  const run = (action,payload={}) => adapters.execute(tenant,action,payload);
  const draft = (extra={}) => engine.apply(tenant,'content',{id:'draft-1',surface:'page',kind:'post',pageId,body:copy,status:'approved',...extra});
  return {dataDir,engine,fetchImpl,metaCalls,run,draft};
}

test('concurrent Page sends produce one post and one verified receipt across reopen',async t => {
  const x = await setup(t);
  assert.notEqual(pageTokenVariable('a-b'),pageTokenVariable('a_b'));
  await x.draft();
  await Promise.allSettled([x.run('page-publish',{id:'draft-1'}),x.run('page-publish',{id:'draft-1'})]);
  const reopened = await createAdapters({dataDir:x.dataDir,engine:x.engine,fetchImpl:x.fetchImpl});
  assert.equal((await reopened.execute(tenant,'page-publish',{id:'draft-1'})).duplicate,true);
  assert.equal(x.metaCalls.filter(c=>c.method==='POST').length,1);
  assert.equal((await x.engine.snapshot(tenant)).content[0].receiptType,'graph_readback');
});

test('wrong token, denied Page, wrong tenant, early schedule and ad hoc content are blocked',async t => {
  let me = {id:'999',category:'Business',can_post:true};
  const x = await setup(t, call => call.route === 'me' ? ok(me) : undefined);
  await x.draft();
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/identity/);
  me = {id:pageId,category:'Business',can_post:false};
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/posting rights/);
  const api = await createAdapters({dataDir:x.dataDir,engine:x.engine,fetchImpl:x.fetchImpl});
  await assert.rejects(api.execute('other','page-publish',{id:'draft-1'}),/Record does not exist/);
  await assert.rejects(x.run('page-publish',{id:'draft-1',body:'override'}),/parameters/);
  await x.engine.apply(tenant,'content',{id:'draft-1',status:'scheduled',scheduledAt:new Date(Date.now()+3600000).toISOString()});
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/scheduled time/);
  assert.equal(x.metaCalls.some(c=>c.method==='POST'),false);
  me.can_post=true;
  await x.engine.apply(tenant,'content',{id:'draft-1',status:'scheduled',scheduledAt:new Date(Date.now()-1000).toISOString()});
  assert.equal((await x.run('page-publish',{id:'draft-1'})).remoteId,postId);
});

test('interrupted reservation resumes without resending; ambiguous POST only reconciles by readback',async t => {
  let simulateLostResponse = true;
  const x = await setup(t, c => { if(c.method==='POST' && simulateLostResponse) throw new Error('sensitive synthetic transport detail'); });
  await x.draft();
  const interrupted = {snapshot:x.engine.snapshot,async apply(...args) {
    const saved = await x.engine.apply(...args);
    if (args[1] === 'delivery' && args[2].decision === 'reserve') throw new Error('simulated shutdown after local reserve');
    return saved;
  }};
  const first = await createAdapters({dataDir:x.dataDir,engine:interrupted,fetchImpl:x.fetchImpl});
  await assert.rejects(first.execute(tenant,'page-publish',{id:'draft-1'}),/shutdown/);
  assert.equal(x.metaCalls.filter(c=>c.method==='POST').length,0);
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/uncertain/);
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/uncertain/);
  await assert.rejects(x.run('page-publish',{id:'draft-1',retryRejected:true}),/explicitly rejected/);
  simulateLostResponse = false;
  const recovered = await x.run('page-publish',{id:'draft-1',reconcileId:postId});
  assert.equal(recovered.remoteId,postId);
  assert.equal(x.metaCalls.filter(c=>c.method==='POST').length,1);
});

test('definite provider rejection releases copy and requires a deliberate retry',async t => {
  let rejectPost = true;
  const x = await setup(t,c => c.method==='POST' && rejectPost ? denied(200) : undefined);
  await x.draft();
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/rejected/);
  assert.equal((await x.engine.snapshot(tenant)).content[0].delivery.status,'released');
  rejectPost = false;
  await assert.rejects(x.run('page-publish',{id:'draft-1'}),/explicitly retrying/);
  assert.equal((await x.run('page-publish',{id:'draft-1',retryRejected:true})).remoteId,postId);
});

test('approved reply must target a comment on the bound Page post and read back the matching reply parent',async t => {
  let author='999', found=false, parent='900_800';
  const x = await setup(t,c => {
    if(c.route===postId) return ok({id:postId,from:{id:author},permalink_url:link});
    if(c.route===postId+'/comments') return ok({data:found ? [{id:targetId,can_comment:true}] : []});
    if(c.route===replyId) return ok({id:replyId,from:{id:pageId},message:copy,parent:{id:parent}});
  });
  await x.draft({kind:'reply',postId,targetId});
  await assert.rejects(x.run('page-reply',{id:'draft-1',targetId:'123'}),/parameters/);
  await assert.rejects(x.run('page-reply',{id:'draft-1'}),/ownership/);
  author=pageId;
  await assert.rejects(x.run('page-reply',{id:'draft-1'}),/could not be found/);
  found=true;
  await assert.rejects(x.run('page-reply',{id:'draft-1'}),/different comment/);
  parent=targetId;
  const res=await x.run('page-reply',{id:'draft-1'});
  assert.equal(res.remoteId,replyId);
  assert.equal(new URL(res.permalink).searchParams.get('reply_comment_id'),'702');
  assert.equal(x.metaCalls.filter(c=>c.method==='POST').length,1);
});

test('owned comments import once, preserve qualification, time and attribution, disregard paging URLs',async t => {
  const x = await setup(t,c => {
    if(c.route===postId+'/comments') return ok({data:[
      {id:targetId,from:{id:'204'},can_comment:true,message:'Please quote this.',created_time:'2026-01-01T12:00:00+0000'},
      {id:'700_799',from:{id:pageId},message:'Page response'},
    ],paging:{next:'https://untrusted.invalid',cursors:{after:'next-cursor'}}});
  });
  await x.draft();
  await x.run('page-publish',{id:'draft-1'});
  const imported = await x.run('page-comments',{postId});
  assert.equal(imported.after,'next-cursor');
  const saved = (await x.engine.snapshot(tenant)).interactions[0];
  assert.equal(saved.contentId,'draft-1');
  assert.equal(saved.occurredAt,'2026-01-01T12:00:00.000Z');
  assert.equal(saved.stage,'observed');
  await x.engine.apply(tenant,'interaction',{id:saved.id,stage:'inquiry',category:'quote_request'});
  await x.run('page-comments',{postId,after:'next-cursor'});
  assert.equal((await x.engine.snapshot(tenant)).interactions.length,1);
  assert.equal((await x.engine.snapshot(tenant)).interactions[0].category,'quote_request');
});

test('isolated real B2B server: bind correct sales profile, deduplicate buyer message and attribute a verified sale', {timeout:23000}, async t => {
  const script = process.env.B2B_WORKBENCH_DIR ? join(process.env.B2B_WORKBENCH_DIR,'run.mjs') :
    fileURLToPath(new URL('../../b2b-sales-workbench/run.mjs',import.meta.url));
  try { await access(script); } catch {
    if (process.env.B2B_WORKBENCH_DIR) throw new Error('B2B_WORKBENCH_DIR does not contain the specified sales workbench run.mjs');
    return t.skip('Optional B2B sales workbench was not found as a sibling; set B2B_WORKBENCH_DIR to test an installed copy');
  }
  const x = await setup(t);
  const salesData = await mkdtemp(join(tmpdir(),'fb-test-sales-'));
  const child = spawn(process.execPath,[script,'--data',salesData,'--port','0'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(async () => {
    if (child.exitCode===null && child.signalCode===null) { const done=once(child,'exit'); child.kill(); await done; }
    await rm(salesData,{recursive:true,force:true,maxRetries:5});
  });
  const origin = await new Promise((resolve,reject) => {
    let buf='';
    child.stdout.on('data',c => { buf+=c; const found=buf.match(/http:\/\/127\.0\.0\.1:\d+/); if(found) resolve(found[0]); });
    child.once('error',reject);
    child.once('exit',() => reject(new Error('Isolated sales server exited before starting')));
  });
  const remote = async (path,body) => {
    const res = await fetch(origin+path,body===undefined?{}:{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
    const result=await res.json(); assert.equal(res.status,200,JSON.stringify(result)); return result;
  };
  const api = await createAdapters({dataDir:x.dataDir,engine:x.engine});
  const run = (action,id) => api.execute(tenant,action,{id});
  await remote('/api/profile',{businessName:'Sales test'});
  await x.engine.apply(tenant,'profile',{salesUrl:origin,salesProfileName:'Wrong tenant'});
  const input={id:'lead-1',externalId:'private-ref-1',text:'Please quote 12 units.',companyKey:'test-buyer',companyName:'Test buyer',verifiedDomain:'WWW.BUYER.EXAMPLE',sourceUrl:link,category:'quote_request',stage:'inquiry',direction:'inbound'};
  await x.engine.apply(tenant,'interaction',input);
  await assert.rejects(run('sales-handoff',input.id),/does not match/);
  assert.equal((await remote('/api/state')).messages.length,0);
  await x.engine.apply(tenant,'profile',{salesProfileName:'Sales test'});
  const first=await run('sales-handoff',input.id);
  assert.ok(first.companyId);
  assert.deepEqual(await run('sales-handoff',input.id),first);
  assert.equal((await remote('/api/state')).messages.length,1);
  const deal=await remote('/api/opportunity',{companyId:first.companyId,title:'Requested units',stage:'inquiry',evidenceIds:[first.messageId]});
  const extra=await remote('/api/import',[{source:'orders',externalId:'confirmed-1',companyKey:'test-buyer',body:'Purchase order confirmed',direction:'inbound',event:'order_confirmed'}]);
  await remote('/api/opportunity',{id:deal.id,stage:'won',statusReason:'Purchase order',evidenceIds:[extra.messages[0].id]});
  const sync=await run('sales-sync',input.id);
  assert.equal(sync.confirmed.evidenceId,extra.messages[0].id);
  assert.equal((await x.engine.snapshot(tenant)).interactions[0].stage,'won');
  await x.engine.apply(tenant,'interaction',{...input,id:'blocked',externalId:'blocked',contactPermission:'opted_out'});
  await assert.rejects(run('sales-handoff','blocked'),/confirmed inbound/);
  await x.engine.apply('another','profile',{salesProfileName:'Sales test',salesUrl:origin});
  await x.engine.apply('another','interaction',input);
  await assert.rejects(api.execute('another','sales-handoff',{id:input.id}),/different tenant/);
  const awaiting = {...input,id:'lead-2',externalId:'private-ref-2',text:'Can I get a pilot?'};
  await x.engine.apply(tenant,'interaction',awaiting);
  let posts=0;
  const interrupted = await createAdapters({dataDir:x.dataDir,engine:x.engine,fetchImpl:async(url,options) => {
    const response = await fetch(url,options);
    if (options.method==='POST') { posts++; throw new Error('simulated lost receipt'); }
    return response;
  }});
  await assert.rejects(interrupted.execute(tenant,'sales-handoff',{id:awaiting.id}),/connection/);
  const recovered = await interrupted.execute(tenant,'sales-handoff',{id:awaiting.id});
  assert.ok(recovered.messageId);
  assert.equal(posts,1);
  await x.engine.apply(tenant,'profile',{salesUrl:'https://remote.invalid:4318'});
  await assert.rejects(run('sales-handoff',input.id),/127\.0\.0\.1/);
});
