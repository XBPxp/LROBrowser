// Isolated preview of the packaged installer with the real local map/mob/item data.
// No server connection, credentials, travel packets, or invented item descriptions.
import { readFile, writeFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import console from 'node:console';
import { extractWorldMapFixture } from './extract-worldmap-fixture.mjs';
import { WORLD_MAP_CSS, WORLD_MAP_HTML, installLastroWorldMap } from './lastro-worldmap.mjs';

const fixture = extractWorldMapFixture(await readFile('generated/runtime/Online.js', 'utf8'));
fixture.css = WORLD_MAP_CSS; fixture.html = WORLD_MAP_HTML;
fixture.installLastroWorldMap = installLastroWorldMap.toString();
const items = {};
const lua = new TextDecoder('gb18030').decode(await readFile('vendor/core/System/itemInfo_re_61.lua'));
for (const match of lua.matchAll(/^\s*\[(\d+)\]\s*=\s*\{([\s\S]*?)(?=^\s*\[\d+\]\s*=|^\})/gm)) {
  const block = match[2];
  const name = block.match(/\bidentifiedDiSPlayName\s*=\s*"([^"\n]*)"/i)?.[1];
  const description = block.match(/\bidentifiedDescriptionName\s*=\s*\{([\s\S]*?)\}/)?.[1];
  if (name) items[match[1]] = { identifiedDisplayName: name, identifiedResourceName: block.match(/\bidentifiedResourceName\s*=\s*"([^"\n]*)"/)?.[1], identifiedDescriptionName: [...(description || '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"')), slotCount: Number(block.match(/slotCount\s*=\s*(\d+)/)?.[1] || 0) };
}
let itemIcons = {}; try { itemIcons = JSON.parse(await readFile('generated/worldmap-item-icons/index.json', 'utf8')); } catch { /* optional imported preview assets */ }
let windowAssets = {}; try { windowAssets = JSON.parse(await readFile('generated/worldmap-window-assets/index.json', 'utf8')); } catch { /* optional native skin/artwork samples */ }
await writeFile('generated/worldmap-preview.js', `
import { setLastROInnerHTML } from '/src/runtime/lastro-trusted-dom.mjs';
const host=document.getElementById('map');
const root=host.attachShadow({mode:'open'});
setLastROInnerHTML(root,${JSON.stringify(fixture.html)});
const style=document.createElement('style');style.textContent=${JSON.stringify(fixture.css)};root.prepend(style);
const items=${JSON.stringify(items)};
const component={_host:host,getRoot:()=>root,focus:()=>{},append(){document.body.append(host);this.__active=true;this.onAppend()},remove(){this.__active=false;this.onRemove();host.remove()}};
const itemIcons=${JSON.stringify(itemIcons)}, decodedIcons=new Map();
const windowAssets=${JSON.stringify(windowAssets)};
function decodeIcon(url){
  if(!decodedIcons.has(url))decodedIcons.set(url,new Promise((resolve,reject)=>{
    const img=new Image();img.onerror=reject;img.onload=()=>{
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,img.width,img.height);
      for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i]===255&&pixels.data[i+1]===0&&pixels.data[i+2]===255)pixels.data[i+3]=0;
      ctx.putImageData(pixels,0,0);resolve(canvas.toDataURL());
    };img.src=url;
  }));
  return decodedIcons.get(url);
}
const spriteFiles=new Map();
const portraits=(${fixture.createMonsterPortraitLoader})({loadFile:(path,done,fail)=>{
  const id=path.split('.')[0];
  if(!spriteFiles.has(id))spriteFiles.set(id,fetch('./worldmap-sprites/'+id+'.json').then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}));
  spriteFiles.get(id).then(data=>done(data[path.endsWith('.spr')?'spr':'act']),fail);
}},id=>String(id),document);
(${fixture.installLastroWorldMap})(component,{
  monsterPortrait:portraits,
  DB:{INTERFACE_PATH:'',getItemInfo:id=>items[id]||{}},
  Client:{loadFile:(path,done,fail)=>{
    if(windowAssets[path]){decodeIcon('/generated/worldmap-window-assets/'+windowAssets[path]).then(done,fail);return;}
    if(path.startsWith('item/')){
      const file=itemIcons[path.slice(5,-4)];
      if(file)decodeIcon('/generated/worldmap-item-icons/'+file).then(done,fail);else fail?.();return;
    }
    const map=['prt_fild08','prontera','prt_maze01'].find(id=>path==='map/'+id+'.bmp');
    if(!path.endsWith('boss_1.bmp')){if(map)done('/generated/worldmap-sprites/'+map+'.bmp');else fail?.();return;}
    const img=new Image();img.onload=()=>{
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,img.width,img.height);
      for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i]===255&&pixels.data[i+1]===0&&pixels.data[i+2]===255)pixels.data[i+3]=0;
      ctx.putImageData(pixels,0,0);done(canvas.toDataURL());
    };img.src='/worldmap/boss_1.bmp';
  }},
  itemTable:()=>items,currentMap:()=>'',
  loadData:async()=>{const [worldData,mobData]=await Promise.all(['world-data','mob-data'].map(async name=>{const r=await fetch('/core/data/world/'+name+'.json');if(!r.ok)throw new Error(r.status);return r.json()}));return {worldData,mobData}}
},${JSON.stringify(fixture.regions)},${fixture.createWorldMapIndex});
component.init();component.onAppend();component.toggle();
document.getElementById('reopen').onclick=()=>{if(host.style.display==='none')component.toggle()};
`);
await writeFile('generated/worldmap-preview.html', '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LASTRO 世界地图预览</title><body style="margin:0;background:#15201e;color:white"><p>世界地图独立预览：真实本地查询资料、物品缩略图与部分真实怪物外貌样本；无游戏连接、传送或寻路。游戏内图像通过客户端资源加载，不限于预览已导入资源。</p><button id="reopen">重新打开世界地图</button><div id="map"></div><script type="module" src="./worldmap-preview.js"></script></body></html>');
console.log(`World map preview: ${Object.keys(items).length} real item records`);
