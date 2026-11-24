import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {runtime,actions,dataHome,doctor} from './lib/runtime.mjs';
import {dispatchDue} from './lib/scheduler.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{port:{type:'string',default:'4335'},data:{type:'string'},tenant:{type:'string'},out:{type:'string'},open:{type:'boolean'},dispatch:{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('node run.mjs [--open] [--data 目录] [--port 4335] [--dispatch 客户代号]\nnode run.mjs doctor\nnode run.mjs call 客户代号 操作 [UTF-8 JSON 文件] [--data 目录]\nnode mcp.mjs [--data 目录]');process.exit(0)}
if(positionals[0]==='doctor'){console.log(JSON.stringify(await doctor(),null,2));process.exit(0)}
const call=await runtime(values.data || dataHome());
if(positionals[0]==='call'){
  const [,tenant,action,filename]=positionals;
  const payload=filename?JSON.parse((await readFile(filename,'utf8')).replace(/^\uFEFF/,'')):{};
  const result=await call(tenant,action,payload);
  if(values.out){const str=typeof result.markdown==='string'?result.markdown:JSON.stringify(result,null,2);await writeFile(values.out,str,'utf8');console.log(resolve(values.out))}
  else console.log(JSON.stringify(result,null,2));
  process.exit(0);
}
if(positionals.length)throw Error('未知命令，使用 --help 查看用法');
const port=Number(values.port);
if(!Number.isInteger(port)||port<0||port>65535)throw Error('端口无效');
const publicDir=fileURLToPath(new URL('public/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.png':'image/png'};
const local=createServer(async(req,res)=>{
  const json=(code,message)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(message))};
  try {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    const address=local.address(), hosts=['127.0.0.1:'+address.port,'localhost:'+address.port];
    if(!hosts.includes(req.headers.host)|| (req.headers.origin && !hosts.map(h=>'http://'+h).includes(req.headers.origin)))return json(403,{error:'请从本机工作台打开'});
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const match=pathname.match(/^\/api\/([a-z0-9][a-z0-9_-]{0,47})\/([a-z-]+)$/);
    if(match){
      const [,tenant,action]=match;
      if(!actions.includes(action))return json(404,{error:'找不到此操作'});
      if(req.method==='GET' && action==='state')return json(200,await call(tenant,action));
      if(req.method!=='POST')return json(405,{error:'需要 POST 请求'});
      if((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')return json(415,{error:'需要 JSON 数据'});
      let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024)return json(413,{error:'单次数据过大'});chunks.push(chunk)}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      return json(200,await call(tenant,action,body));
    }
    if(req.method!=='GET')return json(405,{error:'需要 GET 请求'});
    if(pathname==='/favicon.ico'){res.writeHead(204);return res.end()}
    const file=resolve(publicDir,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    const rel=relative(publicDir,file),type=types[extname(file)];
    if(!type||isAbsolute(rel)||rel.startsWith('..'+sep)||rel==='..')return json(404,{error:'资源不存在'});
    let content;try{content=await readFile(file)}catch{return json(404,{error:'资源不存在'})}
    res.writeHead(200,{'content-type':type,'cache-control':'no-cache'});res.end(content);
  }catch(e){if(!res.headersSent)json(400,{error:e.message});else res.end()}
});
local.on('error',e=>{console.error(e.message);process.exitCode=1});
local.listen(port,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+local.address().port+(values.tenant?'/?tenant='+encodeURIComponent(values.tenant):'');
  console.log('Facebook 工作台 '+url);
  if(values.open){
    const launcher=process.platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
    const child=spawn(launcher[0],launcher[1],{detached:true,stdio:'ignore'});child.on('error',()=>console.log(url));child.unref();
  }
  if(values.dispatch){const held=new Set();let busy=false;
    const tick=async()=>{if(busy)return;busy=true;try{await dispatchDue(call,values.dispatch,{held,onError:(id,msg)=>console.error('排期待核',id,msg)})}catch(e){console.error('排期检查',e.message)}finally{busy=false}};
    void tick();setInterval(tick,30000).unref();
  }
});

