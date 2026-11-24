import {createHash} from 'node:crypto';
import {verifiedPageClient} from './adapters.mjs';
export async function readInbox(engine,tenant,p,connect=verifiedPageClient){
  if(Object.keys(p).some(k=>k!=='after') || (p.after!==undefined && (typeof p.after!=='string'||!p.after.length||p.after.length>4096)))throw Error('仅接受会话分页游标 after');
  const s=await engine.snapshot(tenant),profile=s.profile;
  if(profile.pageAuthorized!==true)throw Error('需要绑定已授权的公共主页');
  const client=await connect({tenant,profile}),pageId=client.me.id;
  if(pageId!==profile.pageId)throw Error('主页身份不一致');
  const query={platform:'messenger',fields:'id,messages.limit(10){id,from,to,message,created_time}',limit:'10'};
  if(p.after)query.after=p.after;
  const page=await client.get(pageId+'/conversations',query);
  if(!Array.isArray(page.data))throw Error('Meta 未返回本页会话');
  const existing=new Map(s.interactions.map(i=>[i.externalId,i])),needReview=[],partialThreads=[];
  let added=0,duplicates=0,skipped=0;
  for(const thread of page.data){
    if(!thread.id||!Array.isArray(thread.messages?.data)){skipped++;continue}
    if(thread.messages.paging?.next) partialThreads.push(String(thread.id));
    for(const m of thread.messages.data){
      if(!m.id||typeof m.message!=='string'||!m.message.trim()||!m.from?.id||m.from.id===pageId||!m.to?.data?.some(r=>r.id===pageId)){skipped++;continue}
      const externalId='messenger:'+pageId+':'+m.id,text=m.message.trim();
      if(existing.has(externalId)){if(existing.get(externalId).text===text)duplicates++;else needReview.push(externalId);continue}
      const input={id:'inbox-'+createHash('sha256').update(externalId).digest('hex').slice(0,32),externalId,direction:'inbound',text,
        category:'message',signal:'weak',channel:'messenger',threadId:String(thread.id),sourceUrl:'https://business.facebook.com/latest/inbox/all?asset_id='+pageId};
      if(typeof m.created_time==='string' && Number.isFinite(Date.parse(m.created_time)))input.occurredAt=new Date(m.created_time).toISOString();
      const record=await engine.apply(tenant,'interaction',input);
      existing.set(externalId,record);added++;
    }
  }
  const after=page.paging?.next ? page.paging.cursors?.after : null;
  return {added,duplicates,skipped,needReview,threads:page.data.length,partialThreads,after:typeof after==='string'?after:null,coverage:'每页至多 10 个会话，各取最近 10 条消息中的入站文本。partialThreads 表示更早内容未读取。'};
}

