import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';
import {runtime,dataHome,actions} from './lib/runtime.mjs';
const {values}=parseArgs({options:{data:{type:'string'}}});
const call=await runtime(values.data || dataHome());
const versions=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const help={
  state:'读取一个客户的工作台和 Obsidian 路径。',profile:'建立或编辑客户品牌和资产资料。如 name,industry,audience,offer,identity,pageId,graphVersion,salesUrl,salesProfileName。',
  content:'保存内容或推进审批和排期。如 id,title,body,surface(page/profile/group),status,identity,pageId,intent,assetRights,scheduledAt,groupId。',
  interaction:'按 externalId 记录互动、来源与跟进。字段有 text,sourceUrl,channel,category,signal,evidence,contentId,origin,companyName,direction,stage,nextAction。',
  group:'登记群组。字段有 name,url,rules,kind(own/third_party),status。',learning:'提出经验，需 title,method,scope,evidence（本客户业务记录的 ID）。',
  review:'审核经验，用 id,decision(accept/retire/reject)。',report:'获取所有记录的交付与归因统计。',weekly:'按时间段统计入站线索和内容。可传含时区的 from,to。',
  'delivery-report':'生成给当前客户的简体中文 Markdown 交付周报，与 weekly 使用相同起止时间。',
  'meta-check':'只读检查本客户的 Meta 主页身份。','page-comments':'读取已授权主页一个贴文的一页评论并登记，传 postId 和可选 after。','messenger-inbox':'读取本客户已授权主页一页会话中的最近入站文本，允许 after 游标。返回各页覆盖情况。',
  'page-publish':'对 Meta 产生实际发布。仅在明确授权下对已批主页稿传 id。可用 reconcileId 核对结果不明的操作。',
  'page-reply':'对 Meta 产生实际公开回复。仅对已绑定具体评论与主页的已批回复稿传 id。','sales-handoff':'将已核实的入站询盘交给本客户绑定的智能销售工作台，传互动 id。','sales-sync':'读取有同一条证据的销售进度，传互动 id。'
};
const defs=actions.map(a=>({name:'fb_'+a.replaceAll('-','_'),description:help[a],inputSchema:{type:'object',properties:{tenant:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,47}$'},payload:{type:'object',description:'操作数据，字段见工具说明与包内接口手册。'}},required:['tenant'],additionalProperties:false}}));
const byName=new Map(defs.map((d,i)=>[d.name,actions[i]]));
const send=(obj)=>process.stdout.write(JSON.stringify(obj)+'\n');
const err=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
let initialized=false;
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  let req;try{req=JSON.parse(line)}catch{err(null,-32700,'Invalid JSON');continue}
  if(!req||req.jsonrpc!=='2.0'||typeof req.method!=='string'){err(null,-32600,'Invalid JSON-RPC request');continue}
  if(req.id===undefined)continue;
  const {method,params={},id}=req;
  try{
    let result;
    if(method==='initialize'){
      if(!params||typeof params.protocolVersion!=='string'){err(id,-32602,'Missing protocolVersion');continue}
      initialized=true;result={protocolVersion:versions.includes(params.protocolVersion)?params.protocolVersion:versions[0],serverInfo:{name:'facebook-operations-workbench',version:'1.0.0'},capabilities:{tools:{}}};
    }else if(method==='ping')result={};
    else if(!initialized){err(id,-32002,'Initialize first');continue}
    else if(method==='tools/list')result={tools:defs};
    else if(method==='tools/call'){
      const action=byName.get(params?.name),args=params?.arguments;
      if(!action||!args||typeof args.tenant!=='string'||Object.keys(args).some(k=>!['tenant','payload'].includes(k))){err(id,-32602,'Unknown tool or invalid arguments');continue}
      try{const value=await call(args.tenant,action,args.payload);result={content:[{type:'text',text:JSON.stringify(value)}]}}
      catch(e){result={isError:true,content:[{type:'text',text:e.message}]}}
    }else{err(id,-32601,'Method not found');continue}
    send({jsonrpc:'2.0',id,result});
  }catch(e){err(id,-32603,'Request could not be processed')}
}

