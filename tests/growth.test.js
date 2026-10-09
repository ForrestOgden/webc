'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {setTimeout:sleep}=require('node:timers/promises');
const crypto=require('node:crypto');
const path=require('node:path');
let port,origin,proc;const clients=[];
function connect() {
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);const messages=[];
  ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
  const obj={ws,messages,send(type,data={}){ws.send(JSON.stringify({type,...data}));},async wait(type,timeout=2500){for(let i=0;i<timeout/25;i++){const msg=messages.find(x=>x.type===type);if(msg)return msg;await sleep(25);}throw Error('Timed out waiting for '+type);},
    async hello(region,target){if(ws.readyState!==1)await new Promise(res=>ws.addEventListener('open',res,{once:true}));obj.send('hello',{adult:true,session:crypto.randomUUID(),region,target});await obj.wait('ready');},close(){ws.close()}};
  clients.push(obj);return obj;
}
before(async()=>{
  port=await new Promise(resolve=>{const sock=net.createServer();sock.listen(0,'127.0.0.1',()=>{const p=sock.address().port;sock.close(()=>resolve(p));});});
  origin=`http://127.0.0.1:${port}`;
  proc=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,MATCH_EXPAND_MS:'650'},stdio:'ignore'});
  for(let i=0;i<50;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await sleep(80);}throw Error('Server startup failed');
});
after(()=>{for(const c of clients)c.close();proc.kill();});
test('invite landing, share toolkit, CSS/JS and robots sitemap are all served',async()=>{
  for(const route of ['/', '/share','/growth.css','/growth.js']){const response=await fetch(origin+route);assert.equal(response.status,200,route);}
  const home=await fetch(origin).then(r=>r.text());assert.match(home,/growth-searching/);assert.match(home,/fallback-toggle/);
  const share=await fetch(origin+'/share').then(r=>r.text());assert.match(share,/Creator|creator/);assert.match(share,new RegExp(origin.replace(/\./g,'\.')));
  const sitemap=await fetch(origin+'/sitemap.xml').then(r=>r.text());assert.match(sitemap,/\/share/);
});
test('no target broadening without explicit consent',async()=>{
  const a=connect(),b=connect();await Promise.all([a.hello('asia','asia'),b.hello('africa','africa')]);a.send('find',{target:'asia'});b.send('find',{target:'africa'});
  await Promise.all([a.wait('searching'),b.wait('searching')]);await sleep(850);
  assert.equal(a.messages.some(x=>x.type==='matched'),false);
  assert.equal(b.messages.some(x=>x.type==='matched'),false);
  a.close();b.close();
});
test('opted-in regional searches expand after waiting and can match',async()=>{
  const a=connect(),b=connect();await Promise.all([a.hello('asia','asia'),b.hello('africa','africa')]);
  a.send('find',{target:'asia',allowWorldwideFallback:true});b.send('find',{target:'africa',allowWorldwideFallback:true});
  await Promise.all([a.wait('searching'),b.wait('searching')]);await Promise.all([a.wait('search-expanded'),b.wait('search-expanded')]);
  const [am,bm]=await Promise.all([a.wait('matched'),b.wait('matched')]);assert.equal(am.matchId,bm.matchId);
  a.close();b.close();
});
