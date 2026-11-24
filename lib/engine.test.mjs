import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, readdir, readFile, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openEngine } from './engine.mjs';

async function context(t) {
  const dir = await mkdtemp(join(tmpdir(),'facebook-engine-')), e = openEngine(dir);
  t.after(async () => { e.close(); await rm(dir,{recursive:true,force:true}); });
  return {dir,e,act:(action,p) => e.apply('testco',action,p)};
}

test('client identity, request replay and exclusive Page bindings survive reopening', async t => {
  const {dir,e,act} = await context(t);
  for (const bad of ['../x','A','con','lpt1','a/b','']) await assert.rejects(e.snapshot(bad));
  await act('profile',{name:'测试公司',industry:'工业服务',pageId:'123',pageAuthorized:true});
  await assert.rejects(e.apply('other','profile',{pageId:'123'}),/another tenant/);
  const original = {body:'A factual answer',requestId:'draft-request'};
  const a = await act('content',original);
  const second = openEngine(dir);
  try {
    const replay = await second.apply('testco','content',original);
    assert.deepEqual(a,replay);
    await assert.rejects(second.apply('testco','content',{...original,body:'new'}),/reused/);
    assert.equal((await second.snapshot('other')).content.length,0);
    await assert.rejects(second.apply('other','learning',{title:'method',scope:'example',method:'do x',evidence:a.id}),/tenant/);
  } finally { second.close(); }
});

test('calendar, approval edits, delivery claims and verified immutable publication', async t => {
  const {act,e} = await context(t);
  await act('profile',{pageId:'123',pageAuthorized:true});
  const p = await act('content',{body:'text',pageId:'123'});
  const receipt = {id:p.id,status:'published',permalink:'https://www.facebook.com/123/posts/456',remoteId:'123_456'};
  await assert.rejects(act('content',receipt),/Approval/);
  await assert.rejects(act('content',{id:p.id,status:'scheduled',scheduledAt:'2026-01-02T00:00:00Z'}),/Approval/);
  await act('content',{id:p.id,status:'approved'});
  assert.equal((await act('content',{id:p.id,body:'edited'})).status,'draft');
  await act('content',{id:p.id,status:'approved'});
  const scheduled = await act('content',{id:p.id,status:'scheduled',scheduledAt:'2026-12-01T00:00:00Z'});
  assert.equal((await act('report')).calendar[0].id,p.id);
  const claim = await act('delivery',{id:p.id,decision:'reserve',expectedUpdatedAt:scheduled.updatedAt,expectedBody:'edited',expectedPageId:'123'});
  await assert.rejects(act('delivery',{id:p.id,decision:'reserve',expectedUpdatedAt:claim.updatedAt,expectedBody:'edited'}),/claimed/);
  await assert.rejects(act('content',{id:p.id,body:'changed'}),/progress/);
  await assert.rejects(act('profile',{pageId:'456'}),/pending/);
  await act('delivery',{id:p.id,decision:'uncertain',token:claim.delivery.token});
  await assert.rejects(act('content',receipt),/progress/);
  const payload = {...receipt,deliveryToken:claim.delivery.token};
  await assert.rejects(act('content',{...payload,permalink:'https://www.facebook.com/mypage'}),/published Facebook object/);
  const confirmed = await act('content',payload);
  assert.equal(confirmed.delivery.status,'confirmed');
  assert.equal(confirmed.receiptType,'graph_readback');
  assert.deepEqual(await act('content',payload),confirmed);
  await assert.rejects(act('content',{...payload,body:'different'}),/immutable/);
  assert.equal((await e.snapshot('testco')).report.receipts.length,1);
});

test('group publishing requires registered rules; native publication retains provenance', async t => {
  const {act} = await context(t);
  const g = await act('group',{name:'Independent design community',url:'https://www.facebook.com/groups/designcommunity/'});
  const post = await act('content',{surface:'group',groupId:g.id,body:'Here is a method.'});
  await assert.rejects(act('content',{id:post.id,status:'approved'}),/rules/);
  await act('group',{id:g.id,rules:'Educational posts. No links.'});
  await act('content',{id:post.id,status:'approved'});
  await assert.rejects(act('content',{id:post.id,status:'published',receiptType:'graph_readback',permalink:'https://www.facebook.com/groups/designcommunity/permalink/123/',remoteId:'123'}),/matching delivery evidence/);
  const result = await act('content',{id:post.id,status:'published',permalink:'https://www.facebook.com/groups/designcommunity/permalink/123/',remoteId:'123'});
  assert.equal(result.receiptType,'native_readback');
});

test('fictional service client completes Page planning, native receipts and Obsidian review from the documented CLI', async t => {
  const dir = await mkdtemp(join(tmpdir(),'facebook-cli-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const entry = fileURLToPath(new URL('../run.mjs',import.meta.url)), file = join(dir,'payload.json');
  async function run(action,p={}) {
    await writeFile(file,JSON.stringify(p),'utf8');
    const res = await promisify(execFile)(process.execPath,[entry,'call','fictional-museum',action,file,'--data',dir]);
    return JSON.parse(res.stdout);
  }
  const s = await run('state'), notes = await readdir(s.vaultPath);
  assert.ok(notes.some(f => f.endsWith('.md')));
  const account = await run('profile',{name:'Fictional conservation service',industry:'Museum HVAC',approver:'Project lead',assetPolicy:'Own diagrams',publicContact:'Office'});
  assert.equal(account.assetPolicy,'Own diagrams');
  const g = await run('group',{name:'Museum Facilities Forum (fictional)',url:'https://www.facebook.com/groups/fictionalmuseumforum',rules:'Evidence-based answers only',kind:'third_party'});
  const i = await run('interaction',{externalId:'case-question-1',text:'Can you sample relative humidity in six display cases?',companyName:'Example Museum',verifiedDomain:'EXAMPLE.ORG',category:'quote_request',signal:'strong',stage:'inquiry',direction:'inbound',channel:'messenger',origin:'unknown',sourceUrl:'https://www.facebook.com/messages/t/123',evidence:'Buyer asks for sample monitoring in six cases.',nextAction:'Discuss sampling on the original thread.'});
  assert.equal(i.verifiedDomain,'example.org');
  const page = await run('content',{surface:'page',title:'Measuring case humidity',body:'What to record in a display-case humidity log.',approver:'Project lead',sourceInteractionId:i.id});
  await run('content',{id:page.id,status:'approved'});
  await run('content',{id:page.id,status:'scheduled',scheduledAt:'2027-01-08T08:00:00Z'});
  for (const [surface,id,permalink] of [['profile','321','https://www.facebook.com/10/posts/321'],['group','123','https://www.facebook.com/groups/fictionalmuseumforum/posts/123']]) {
    const c = await run('content',{surface,groupId:surface==='group'?g.id:'',title:'Field note (fixture)',body:'Observation notes from a fictional exercise.',identity:'Project lead'});
    await run('content',{id:c.id,status:'approved'});
    assert.equal((await run('content',{id:c.id,status:'published',remoteId:id,permalink})).receiptType,'native_readback');
  }
  const lesson = await run('learning',{title:'Ask about zone count',scope:'Museum engineers',method:'Discuss each display case separately',hypothesis:'Zone count changes the proposal',counterexample:'A shared enclosure',testMethod:'Review next three requests',metric:'Complete inputs',evidence:[i.id,page.id]});
  await run('review',{id:lesson.id,decision:'accept',reason:'Approved in fixture review'});
  const active = join(s.vaultPath,'工作台-已采纳'), [f] = await readdir(active);
  const markdown = await readFile(join(active,f),'utf8');
  for (const phrase of ['Museum engineers','A shared enclosure','Review next three requests','Approved in fixture review']) assert.ok(markdown.includes(phrase));
  const report = await run('report');
  assert.equal(report.receipts.length,2); assert.equal(report.calendar[0].id,page.id);
  assert.equal(report.signals[0].id,i.id); assert.equal(report.ideas[0].interactionId,i.id);
  const weekly = await run('weekly');
  assert.equal(weekly.tenant,'fictional-museum');
});

test('source deduplication, company-level stage attribution and suppression', async t => {
  const {act} = await context(t);
  const src = {externalId:'comment:45',direction:'inbound',text:'What options can you quote?',sourceUrl:'https://www.facebook.com/123/posts/2?comment_id=45',signal:'strong',category:'question',origin:'organic',companyName:'One Ltd',evidence:'Asked for a quote',stage:'inquiry',nextAction:'Answer on the original thread'};
  await assert.rejects(act('interaction',{...src,evidence:''}),/source URL/);
  const a = await act('interaction',src);
  assert.equal((await act('interaction',src)).id,a.id);
  await assert.rejects(act('interaction',{id:a.id,text:'changed'}),/immutable/);
  await assert.rejects(act('interaction',{id:a.id,stage:'won'}),/evidence/);
  await act('interaction',{text:'Follow up on existing quote',externalId:'event-2',companyName:'one ltd',origin:'paid',stage:'quoted',outcomeEvidence:'CRM quote 15'});
  const report = await act('report');
  assert.equal(report.counts.companies,1); assert.equal(report.counts.interactions,2);
  assert.equal(report.attribution.paid.quoted,1); assert.equal(report.funnel.inquiry,0);
  assert.equal(report.ideas[0].interactionId,a.id); assert.equal(report.followups.length,1);
  await act('interaction',{id:a.id,contactPermission:'opted_out'});
  assert.equal((await act('report')).followups.length,0);
  await assert.rejects(act('interaction',{id:a.id,contactPermission:'consented'}),/evidence/);
});

test('private notes project approved learning and preserve edits through retirement', async t => {
  const {act,e} = await context(t), snap = await e.snapshot('testco');
  const c = await act('content',{body:'Demo'});
  const m = await act('learning',{title:'Q&A',method:'Focus on one question',scope:'Technical buyers',evidence:[c.id]});
  const active = join(snap.vaultPath,'工作台-已采纳'), archive = join(snap.vaultPath,'工作台-已停用');
  assert.equal((await readdir(active)).length,0);
  await act('review',{id:m.id,decision:'accept'});
  const [name] = await readdir(active);
  assert.match(await readFile(join(active,name),'utf8'),/Focus on one question/);
  await appendFile(join(active,name),'Human editorial note');
  await act('review',{id:m.id,decision:'retire'});
  assert.equal((await readdir(active)).length,0);
  assert.match(await readFile(join(archive,name),'utf8'),/Human editorial note/);
  await assert.rejects(act('review',{id:m.id,decision:'accept'}),/transition/);
  assert.notEqual(snap.vaultPath,(await e.snapshot('other')).vaultPath);
});

test('independent processes can add concurrent rows without losing updates', async t => {
  const {dir,e} = await context(t);
  const entry = new URL('./engine.mjs',import.meta.url).href;
  const src = 'import {openEngine} from ' + JSON.stringify(entry) + ';const [dir,n]=process.argv.slice(1);const e=openEngine(dir);for(let i=0;i<4;i++)await e.apply("testco","content",{id:"w"+n+"-"+i,body:"text"});e.close()';
  await Promise.all(['1','2','3','4'].map(n => promisify(execFile)(process.execPath,['--input-type=module','-e',src,dir,n])));
  assert.equal((await e.snapshot('testco')).content.length,16);
});
