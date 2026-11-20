'use strict';
// Windows CI: launch the real BAT from a path with Cyrillic and CMD metacharacters.
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');

async function smoke() {
  if (process.platform !== 'win32') return;
  const cwd=resolve(process.argv[2]||resolve(__dirname,'..'));
  const env={...process.env,KIYOMIRA_MODE:'web',KIYOMIRA_NO_BROWSER:'1',
    KIYOMIRA_OFFLINE:'1',KIYOMIRA_SKIP_PYTHON:'1'};
  delete env.CLOUD_RU_API_KEY;
  delete env.CLOUD_RU_MODEL;
  const child=spawn('cmd.exe',['/d','/c','Kiyomira.bat'],{cwd,env,stdio:['ignore','pipe','pipe']});
  let output='',portUrl='',exited=false,exitCode=null;
  const exitPromise=new Promise((res,rej)=>{
    child.once('error',rej);
    child.once('exit',(code)=>{exited=true;exitCode=code;res(code);});
  });
  const readyPromise=new Promise((res,rej)=>{
    const processOutput=chunk=>{
      output+=chunk.toString('utf8');
      if(output.length>40000)output=output.slice(-40000);
      const found=/http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if(found && !portUrl){portUrl=found[0];res(portUrl);}
    };
    child.stdout.on('data',processOutput);
    child.stderr.on('data',processOutput);
    child.once('error',rej);
    child.once('exit',()=>{if(!portUrl)rej(new Error('BAT terminated before readiness: '+output.slice(-1200)));});
  });
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('BAT web startup timed out: '+output.slice(-1200))),60000);});
  try {
    const url=await Promise.race([readyPromise,timeout]);
    assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
    const home=await fetch(url+'/');
    assert.equal(home.status,200,'Browser page available');
    const cookie=home.headers.get('set-cookie').split(';')[0];
    const headers={Cookie:cookie,'X-Kiyomira-Request':'1'};
    const status=await fetch(url+'/api/status',{headers});
    assert.equal(status.status,200);
    assert.equal((await status.json()).provider,'demo');
    const created=await fetch(url+'/api/chats',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{"title":"Тест BAT"}'});
    assert.equal(created.status,201);
    const {id}=await created.json();
    const send=await fetch(url+'/api/chats/'+id+'/message',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{"text":"Проверка BAT"}'});
    assert.equal(send.status,200);
    assert.match((await send.json()).reply,/Проверка BAT/);
    const quit=await fetch(url+'/api/quit',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
    assert.equal(quit.status,200);
    const result=await Promise.race([exitPromise,timeout]);
    assert.equal(result,0,'BAT must exit cleanly');
    console.log('BAT WEB SMOKE OK',url);
  } finally {
    clearTimeout(timer);
    if(!exited)child.kill();
  }
}
smoke().catch(err=>{console.error('BAT WEB SMOKE FAILED:',err.message);process.exitCode=1;});
