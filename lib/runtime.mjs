import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openEngine} from './engine.mjs';
import {createAdapters} from './adapters.mjs';
import {weekly,deliveryReport} from './weekly.mjs';
import {readInbox} from './inbox.mjs';

export const localActions = ['profile','content','interaction','group','learning','review','report'];
export const connectedActions = ['meta-check','page-publish','page-reply','page-comments','sales-handoff','sales-sync'];
export const actions = ['state', ...localActions, ...connectedActions, 'messenger-inbox', 'weekly', 'delivery-report'];
export const dataHome = () => resolve(process.env.FBOPS_DATA || join(homedir(),'.facebook-operations-workbench'));
export async function runtime(dataDir=dataHome()) {
  const engine=await openEngine(resolve(dataDir));
  const adapters=await createAdapters({dataDir:resolve(dataDir),engine});
  return async function call(tenant,action,payload={}) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(tenant) || ['con','prn','aux','nul','clock$'].includes(tenant) || /^(com|lpt)[0-9]$/.test(tenant)) throw Error('客户代号需要 1–48 位小写字母、数字、下划线或连字符');
    if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw Error('需要 JSON 对象');
    if(action==='state') return engine.snapshot(tenant);
    if(action==='messenger-inbox') return readInbox(engine,tenant,payload);
    if(action==='weekly') return weekly(await engine.snapshot(tenant),payload);
    if(action==='delivery-report') return deliveryReport(await engine.snapshot(tenant),payload);
    if(action==='content' && ('deliveryToken' in payload || payload.receiptType==='graph_readback')) throw Error('接口回执由发布程序登记');
    if(localActions.includes(action)) return engine.apply(tenant,action,payload);
    if(connectedActions.includes(action)) return adapters.execute(tenant,action,payload);
    throw Error('未知操作 '+action);
  };
}
export async function doctor() {
  const env=process.env, home=homedir();
  const locations = process.platform==='win32' ?
    [env.LOCALAPPDATA && join(env.LOCALAPPDATA,'Obsidian','Obsidian.exe'),env.LOCALAPPDATA && join(env.LOCALAPPDATA,'Programs','Obsidian','Obsidian.exe'),env.ProgramFiles && join(env.ProgramFiles,'Obsidian','Obsidian.exe')] :
    ['/Applications/Obsidian.app',join(home,'Applications','Obsidian.app'),'/usr/bin/obsidian','/snap/bin/obsidian','/opt/Obsidian/obsidian',join(home,'.local/share/flatpak/app/md.obsidian.Obsidian'),'/var/lib/flatpak/app/md.obsidian.Obsidian'];
  let obsidianPath=null;
  if(process.platform==='win32'){
    try{
      const {stdout}=await promisify(execFile)('reg.exe',['query','HKCR\\obsidian\\shell\\open\\command','/ve'],{windowsHide:true,timeout:2500});
      const match=stdout.match(/REG_(?:EXPAND_)?SZ\s+(?:"([^"]+\.exe)"|([^"\r\n]+?\.exe)(?:\s|$))/i);
      if(match)locations.unshift(match[1]||match[2]);
    }catch{}
  }
  for(const p of locations.filter(Boolean)){try{await access(p);obsidianPath=p;break}catch{}}
  return {node:process.versions.node,dataDir:dataHome(),obsidianPath,obsidian:obsidianPath?'已发现 Obsidian，可把客户的 vaultPath 作为仓库打开':'常见安装位置未检测到 Obsidian，可安装后选择“打开本地仓库”。Markdown 现在即可读写。',download:'https://obsidian.md/download'};
}

