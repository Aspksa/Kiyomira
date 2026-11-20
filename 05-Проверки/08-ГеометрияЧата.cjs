'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,existsSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {создатьВебСервер}=require('../08-Запуск/04-ВебСервер.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('real Chrome: send stays visible with scrollable long history at desktop and phone sizes',async()=>{
  const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
  assert.ok(chrome,'Chrome/Chromium required on Ubuntu CI');
  const dir=mkdtempSync(join(tmpdir(),'kiyomira-layout-'));
  const oldDb=process.env.KIYOMIRA_DB_PATH,oldKey=process.env.CLOUD_RU_API_KEY,
    oldModel=process.env.CLOUD_RU_MODEL;
  process.env.KIYOMIRA_DB_PATH=join(dir,'память.sqlite');
  delete process.env.CLOUD_RU_API_KEY;delete process.env.CLOUD_RU_MODEL;
  let server,child,socket;
  let seq=0;const pending=new Map();
  function command(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},8000);
      pending.set(id,{resolve,reject,timeout});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression){
    const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error('Browser JS error '+JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  try{
    server=await создатьВебСервер();
    const profile=join(dir,'chrome');
    child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--no-first-run','--disable-background-networking',
      '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],
      {stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',v=>{stderr+=String(v).slice(-500);});
    const portFile=join(profile,'DevToolsActivePort');
    let port=0;
    for(let i=0;i<100;i++){
      if(existsSync(portFile)){port=Number(readFileSync(portFile,'utf8').split('\n')[0]);break;}
      if(child.exitCode!==null)throw Error('Chrome exited '+stderr.slice(-800));
      await sleep(80);
    }
    assert.ok(port,'Chrome debug port unavailable: '+stderr.slice(-800));
    const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const page=tabs.find(t=>t.type==='page');
    assert.ok(page,'No page in Chrome');
    socket=new WebSocket(page.webSocketDebuggerUrl);
    socket.addEventListener('message',event=>{
      const m=JSON.parse(String(event.data));
      if(!m.id||!pending.has(m.id))return;
      const task=pending.get(m.id);pending.delete(m.id);clearTimeout(task.timeout);
      if(m.error)task.reject(Error(JSON.stringify(m.error)));
      else task.resolve(m.result||{});
    });
    await new Promise((resolve,reject)=>{
      socket.addEventListener('open',resolve,{once:true});
      socket.addEventListener('error',reject,{once:true});
    });
    await command('Page.enable');await command('Runtime.enable');
    const probe="(()=>{"+
      "const msg=document.getElementById('messages');"+
      "if(!msg)return {error:'missing messages'};"+
      "for(let i=0;i<90;i++){const e=document.createElement('div');"+
      "e.className='message assistant';e.textContent='Message '+i+' long test text';msg.append(e);}"+
      "const names=['send','chat-input','chat-view','messages','workspace'];"+
      "const out={};for(const id of names){const e=document.getElementById(id);"+
      "if(!e)return {error:'missing '+id};const r=e.getBoundingClientRect();"+
      "out[id]={top:r.top,bottom:r.bottom,left:r.left,right:r.right,"+
      "width:r.width,height:r.height,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,"+
      "display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility};}"+
      "const c=document.querySelector('.composer-wrap').getBoundingClientRect();"+
      "out.composer={top:c.top,bottom:c.bottom};"+
      "return {out,viewport:{width:innerWidth,height:innerHeight}};})()";
    for(const [width,height] of [[1280,800],[900,600],[800,430],[390,740],[360,600]]){
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});
      await command('Page.navigate',{url:server.url+'/'});
      for(let tries=0;tries<40;tries++){
        if(await evaluate("document.readyState==='complete'&&!!document.getElementById('send')"))break;
        await sleep(80);
      }
      const geometry=await evaluate(probe);
      assert.ok(geometry&&!geometry.error,JSON.stringify(geometry));
      const {out,viewport}=geometry,send=out.send,composer=out.composer,history=out.messages;
      assert.ok(send.width>=30&&send.height>=30,'send size '+width+'x'+height+JSON.stringify(send));
      assert.ok(send.top>=0&&send.bottom<=viewport.height+1,
        'send outside viewport '+width+'x'+height+JSON.stringify({send,composer}));
      assert.ok(send.left>=0&&send.right<=viewport.width+1,
        'send outside horizontal viewport '+width+'x'+height+JSON.stringify(send));
      assert.ok(composer.bottom<=viewport.height+1,
        'composer below screen '+width+'x'+height+JSON.stringify(composer));
      assert.ok(history.scrollHeight>history.clientHeight,
        'long history must scroll '+width+'x'+height+JSON.stringify(history));
      assert.equal(send.display,'grid');
      assert.notEqual(send.visibility,'hidden');
      const balance=await evaluate(`(()=>{
        const manager=window.KiyomiraLayout,brain=window.KiyomiraBrain;
        const auto=document.getElementById('brain-auto-layout');
        if(!manager||!brain?.getViewportStats)return {error:'Missing Kiyomira 6 controls'};
        const initial=manager.getState();
        manager.focus('brain');const brainFocused=manager.getState();
        manager.focus('chat');const chatFocused=manager.getState();
        const fit=brain.getViewportStats().fit;
        const before=manager.getState();
        auto.click();manager.focus('brain');const manual=manager.getState();
        auto.click();
        return {initial,brainFocused,chatFocused,manual,before,fit,savedManual:Number(localStorage.getItem('kiyomira.workspace.chatPercent'))||35};
      })()`);
      assert.ok(!balance.error,JSON.stringify(balance));
      assert.ok(balance.fit>0&&balance.fit<=1,'Graph must fit inside narrow viewport');
      if(width>=701){
        assert.equal(balance.brainFocused.percent,30);
        assert.equal(balance.chatFocused.percent,45);
        assert.equal(balance.manual.percent,balance.savedManual,'manual mode must restore explicitly saved width, not auto focus width');
      }

      const unity=await evaluate(`(()=>{
        const host=document.getElementById('workspace');
        const flow=document.getElementById('cognitive-flow');
        const divider=document.getElementById('workspace-divider');
        if(!window.KiyomiraUnity||!window.KiyomiraBrain?.getCorePosition)
          return {error:'Unity or brain API missing'};
        window.KiyomiraUnity.signal('send');
        const d=document.getElementById('cognitive-flow-path').getAttribute('d');
        const computed=getComputedStyle(flow);
        const border=getComputedStyle(divider).borderLeftWidth;
        const active=host.classList.contains('flow-to-brain');
        window.KiyomiraUnity.signal('answer');
        return {active,answer:host.classList.contains('flow-to-chat'),
          hasPath:typeof d==='string'&&d.startsWith('M '),flowDisplay:computed.display,
          dividerBorder:border};
      })()`);
      assert.ok(!unity.error,JSON.stringify(unity));
      if(width>=701){
        assert.equal(unity.hasPath,true,'missing unified animation route');
        assert.equal(unity.active,true,'send must flow to brain');
        assert.equal(unity.answer,true,'response must flow to chat');
        assert.equal(unity.dividerBorder,'0px','divider must not visually split workspace');
      }else assert.equal(unity.flowDisplay,'none','mobile should hide decorative route');

    }
  }finally{
    if(socket&&socket.readyState===WebSocket.OPEN)socket.close();
    if(child&&!child.killed)child.kill('SIGKILL');
    if(server)await server.close();
    if(oldDb===undefined)delete process.env.KIYOMIRA_DB_PATH;else process.env.KIYOMIRA_DB_PATH=oldDb;
    if(oldKey===undefined)delete process.env.CLOUD_RU_API_KEY;else process.env.CLOUD_RU_API_KEY=oldKey;
    if(oldModel===undefined)delete process.env.CLOUD_RU_MODEL;else process.env.CLOUD_RU_MODEL=oldModel;
    rmSync(dir,{recursive:true,force:true});
  }
});
