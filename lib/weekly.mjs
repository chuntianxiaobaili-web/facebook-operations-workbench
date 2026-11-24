const DAY=86400000;
function dateValue(value){if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value))return null;const n=Date.parse(value);return Number.isFinite(n)?n:null}
function summarize(records,pick){const values={};for(const r of records){const k=pick(r) || 'unknown';values[k]=(values[k] || 0)+1}return values}
export function weekly(s,opts={},now=Date.now()){
  const to=opts.to?dateValue(opts.to):now;
  const from=opts.from?dateValue(opts.from):to-7*DAY;
  if(to===null||from===null||from>=to)throw Error('统计区间需要有效的起止时间和时区');
  const within=v=>{const n=dateValue(v);return n!==null && n>=from && n<to};
  const items=s.content.filter(c=>c.status==='published' && within(c.receiptAt || c.updatedAt));
  const inbound=s.interactions.filter(i=>i.direction==='inbound' && within(i.occurredAt || i.createdAt));
  const strong=inbound.filter(i=>i.signal==='strong');
  return {tenant:s.tenant,from:new Date(from).toISOString(),toExclusive:new Date(to).toISOString(),
    basis:'本期入站按发生时间（缺省为登记时间）入组。报价与成交为这组线索截至查看时的阶段。每条互动单独统计，渠道未知保留未知。',
    published:items.map(c=>({id:c.id,title:c.title,surface:c.surface,url:c.permalink})),
    interactions:inbound.length,strongSignals:strong.length,channels:summarize(inbound,i=>i.channel),origins:summarize(inbound,i=>i.origin),
    stages:summarize(strong,i=>i.stage), opportunities:strong.map(i=>({id:i.id,company:i.companyName||null,source:i.sourceUrl,contentId:i.contentId||null,stage:i.stage,origin:i.origin,nextAction:i.nextAction||null})),
    pendingContent:s.content.filter(c=>c.status==='draft').length};
}

export function deliveryReport(s,opts){
  const w=weekly(s,opts);
  const plain=v=>String(v??'').replace(/[\r\n<>\[\]*_\x60]/g,' ').slice(0,220);
  const lines=['# '+plain(s.profile.name||s.tenant)+' · Facebook 运营交付','',
    '报告区间为 '+w.from+' 至 '+w.toExclusive+'（不含截止时点）。','',
    '## 已完成的发布','',...w.published.map(i=>'- '+plain(i.title)+' · '+plain(i.surface)+' · '+i.url)];
  if(!w.published.length)lines.push('本期已登记的发布回执为 0 条。');
  lines.push('','## 互动与询盘','',
    '本期登记入站互动 '+w.interactions+' 条，有具体需求证据的互动 '+w.strongSignals+' 条。当前待审核稿件 '+w.pendingContent+' 份。',
    '自然来源 '+(w.origins.organic||0)+' 条，付费来源 '+(w.origins.paid||0)+' 条，未知来源 '+(w.origins.unknown||0)+' 条。',
    '上述有需求证据的互动中，当前阶段为已报价 '+(w.stages.quoted||0)+' 条，已成交 '+(w.stages.won||0)+' 条。',
    '','## 下一步','');
  const follow=s.report.followups.filter(f=>w.opportunities.some(i=>i.id===f.id)).slice(0,10);
  lines.push(...(follow.length?follow.map(f=>'- '+plain(f.company||'待核实企业')+' · '+plain(f.nextAction)):['本期线索暂无已登记的跟进动作。']));
  lines.push('',w.basis,'');
  return {markdown:lines.join('\n')};
}

