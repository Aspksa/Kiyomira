'use strict';
// Real browser smoke: start localhost Kiyomira and load its real UI in installed
// Chrome. Uses no additional npm packages or Cloud.ru credentials.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {existsSync,mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {создатьВебСервер}=require('../08-Запуск/04-ВебСервер.cjs');

test('headless Chrome opens localhost chat and initializes SQLite brain graph',async()=>{
  const candidates=[process.env.CHROME_BIN,
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
    '/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
  const chrome=candidates.find(existsSync);
  assert.ok(chrome,'Chrome/Chromium is required on the Ubuntu CI runner');
  const temp=mkdtempSync(join(tmpdir(),'kiyomira-browser-'));
  const previous=process.env.KIYOMIRA_DB_PATH;
  const previousKey=process.env.CLOUD_RU_API_KEY;
  const previousModel=process.env.CLOUD_RU_MODEL;
  process.env.KIYOMIRA_DB_PATH=join(temp,'память.sqlite');
  delete process.env.CLOUD_RU_API_KEY;delete process.env.CLOUD_RU_MODEL;
  let server;
  try{
    server=await создатьВебСервер();
    const args=['--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--virtual-time-budget=6500',
      '--user-data-dir='+join(temp,'chrome'),'--dump-dom',server.url+'/'];
    const {code,html,stderr}=await new Promise((resolve,reject)=>{
      const child=spawn(chrome,args,{stdio:['ignore','pipe','pipe']});
      let html='',stderr='',timedOut=false;
      const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},25000);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk=>{html+=chunk;});
      child.stderr.on('data',chunk=>{stderr+=chunk.slice(-10000);});
      child.on('error',err=>{clearTimeout(timeout);reject(err);});
      child.on('close',code=>{
        clearTimeout(timeout);
        if(timedOut)return reject(new Error('Chrome timeout; '+stderr.slice(-800)));
        resolve({code,html,stderr});
      });
    });
    assert.equal(code,0,stderr.slice(-1400));
    assert.match(html,/id="chat-form"/,'real chat composer present');
    assert.match(html,/id="brain-canvas"/,'real Canvas brain present');
    assert.match(html,/id="send"[^>]*class="primary send-compact"/,'send is compact');
    assert.doesNotMatch(html,/class="rail-logo"/,'upper-left logo removed');
    assert.match(html,/id="brain-count"[^>]*>0 сообщений/,'brain loaded data from SQLite API');
  }finally{
    if(server)await server.close();
    if(previous===undefined)delete process.env.KIYOMIRA_DB_PATH;
    else process.env.KIYOMIRA_DB_PATH=previous;
    if(previousKey===undefined)delete process.env.CLOUD_RU_API_KEY;
    else process.env.CLOUD_RU_API_KEY=previousKey;
    if(previousModel===undefined)delete process.env.CLOUD_RU_MODEL;
    else process.env.CLOUD_RU_MODEL=previousModel;
    rmSync(temp,{recursive:true,force:true});
  }
});
