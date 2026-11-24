import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {openEngine} from './engine.mjs';
import {readInbox} from './inbox.mjs';
import {weekly,deliveryReport} from './weekly.mjs';
import {dispatchDue} from './scheduler.mjs';
const main=fileURLToPath(new URL('../',import.meta.url));
async function dir(){return mkdtemp(join(tmpdir(),'fbops-spec-'))}
const cleanup=path=>rm(path,{recursive:true,force:true,maxRetries:3,retryDelay:100});
function child(script,args){return spawn(process.execPath,[script,...args],{cwd:main,stdio:['pipe','pipe','pipe'],windowsHide:true})}
test('MCP stdio starts, negotiates, enumerates and performs tenant-bound actions', async t=>{
  const temp=await dir(),p=child('mcp.mjs',['--data',temp]),exited=once(p,'exit');
  t.after(async()=>{p.stdin.end();await exited;await cleanup(temp)});
  const lines=createInterface({input:p.stdout})[Symbol.asyncIterator]();let id=0;
  const req=async(method,params)=>{p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');const line=await lines.next();assert.ok(!line.done);return JSON.parse(line.value)};
  assert.equal((await req('tools/list')).error.code,-32002);
  assert.equal((await req('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'smoke',version:'1'}})).result.protocolVersion,'2025-11-25');
  p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const names=(await req('tools/list')).result.tools.map(t=>t.name);
  assert.ok(names.includes('fb_delivery_report')&&names.includes('fb_sales_handoff')&&names.includes('fb_messenger_inbox'));
  await req('tools/call',{name:'fb_profile',arguments:{tenant:'sample',payload:{name:'Example only'}}});
  const state=await req('tools/call',{name:'fb_state',arguments:{tenant:'sample'}});
  assert.equal(JSON.parse(state.result.content[0].text).profile.name,'Example only');
  const invalid=await req('tools/call',{name:'fb_state',arguments:{tenant:'../sample'}});
  assert.equal(invalid.result.isError,true);
  assert.equal((await req('tools/call',{name:'unknown',arguments:{}})).error.code,-32602);
});
test('HTTP dashboard assets, origin, JSON writes, isolation and sales receipt forgery rejection',async t=>{
  const temp=await dir(),p=child('run.mjs',['--data',temp,'--port','0']),exited=once(p,'exit');
  t.after(async()=>{p.kill();await exited;await cleanup(temp)});
  const [line]=await once(createInterface({input:p.stdout}),'line'),url=line.match(/http:\/\/[^ ]+/)[0];
  assert.equal((await fetch(url)).status,200);
  assert.match(await (await fetch(url)).text(),/<html/i);
  const send=(action,body,extra={})=>fetch(url+'/api/client/'+action,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await send('profile',{name:'A'})).status,200);
  assert.equal((await send('profile',{name:'B'},{origin:'https://example.org'})).status,403);
  assert.equal((await send('profile',{name:'B'},{'content-type':'text/plain'})).status,415);
  assert.equal((await send('content',{receiptType:'graph_readback'})).status,400);
  const snapshot=await (await fetch(url+'/api/other/state')).json();assert.equal(snapshot.profile.name,undefined);
});
test('Messenger only imports inbound Page text and makes repeats and partial coverage visible',async t=>{
  const temp=await dir(),engine=openEngine(temp);t.after(async()=>{engine.close();await cleanup(temp)});
  await engine.apply('t','profile',{pageId:'123',pageAuthorized:true});
  const msg={id:'mid.x',message:'Is a signed spec available?',created_time:'2026-10-01T11:30:00+0000',from:{id:'55'},to:{data:[{id:'123'}]}};
  const messages={data:[msg,{...msg,id:'other',to:{data:[{id:'999'}]}},{...msg,id:'self',from:{id:'123'}}],paging:{next:'opaque'}};
  const connect=async()=>({me:{id:'123'},get:async(route,query)=>{assert.equal(route,'123/conversations');assert.equal(query.platform,'messenger');return {data:[{id:'thread-01',messages}],paging:{next:'x',cursors:{after:'next'}}}}});
  const a=await readInbox(engine,'t',{},connect);assert.deepEqual([a.added,a.duplicates,a.skipped,a.after],[1,0,2,'next']);assert.deepEqual(a.partialThreads,['thread-01']);
  const b=await readInbox(engine,'t',{after:'next'},connect);assert.equal(b.duplicates,1);
  const record=(await engine.snapshot('t')).interactions[0];assert.equal(record.occurredAt,'2026-10-01T11:30:00.000Z');assert.equal(record.stage,'observed');
  await assert.rejects(readInbox(engine,'t',{},async()=>({me:{id:'456'}})),/身份/);
});
test('weekly uses inbound cohort and verified publication time with exclusive close',()=>{
  const t='2026-09-01T00:00:00Z',end='2026-09-08T00:00:00Z',i={direction:'inbound',occurredAt:t,origin:'organic',signal:'strong',stage:'quoted'};
  const s={tenant:'demo',profile:{},report:{followups:[]},content:[{status:'published',receiptAt:t,updatedAt:end}],interactions:[i,{...i,direction:'observation'},{...i,occurredAt:end}]};
  const data=weekly(s,{from:t,to:end});
  assert.equal(data.published.length,1);assert.equal(data.interactions,1);assert.equal(data.stages.quoted,1);
  assert.match(deliveryReport(s,{from:t,to:end}).markdown,/已报价 1 条/);
  assert.throws(()=>weekly(s,{from:'2026-09-01',to:end}),/区间/);
});
test('scheduler selects only due authorized-mode Page text posts and holds a failed revision',async()=>{
  const records=[{id:'p',scheduledAt:'2026-09-01T00:00:00Z',status:'scheduled',surface:'page',kind:'post'}];
  records.push({...records[0],id:'manual',surface:'profile'},{...records[0],id:'future',scheduledAt:'2099-01-01T00:00:00Z'},{...records[0],id:'draft',status:'draft'},{...records[0],id:'image',assetUrl:'file'},{...records[0],id:'reply',kind:'reply'});
  const events=[],held=new Set(),call=async(t,a,p)=>{if(a==='state')return {content:records};events.push(p.id);throw Error('preflight')};
  const opts={held,now:Date.parse('2026-09-02T00:00:00Z')};await dispatchDue(call,'t',opts);await dispatchDue(call,'t',opts);assert.deepEqual(events,['p']);
});

