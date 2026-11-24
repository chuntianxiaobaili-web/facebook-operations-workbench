export async function dispatchDue(call,tenant,{now=Date.now(),onError=()=>{},held=new Set()}={}) {
  const s=await call(tenant,'state');
  const results=[];
  for(const c of s.content){
    if(c.surface!=='page'||c.kind!=='post'||c.assetUrl||c.status!=='scheduled'||!c.scheduledAt||Date.parse(c.scheduledAt)>now||!Number.isFinite(Date.parse(c.scheduledAt))) continue;
    const key=JSON.stringify([c.id,c.updatedAt,c.scheduledAt]);
    if(held.has(key))continue;
    try {const result=await call(tenant,'page-publish',{id:c.id});results.push({id:c.id,result})}
    catch(e){held.add(key);onError(c.id,e.message)}
  }
  return results;
}

