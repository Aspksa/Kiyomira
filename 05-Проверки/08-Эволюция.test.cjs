'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

test('Ascension is source-backed, separate from brain, visible and motion-bounded',()=>{
  const source=readFileSync(join(__dirname,'../10-Веб/08-Эволюция.js'),'utf8');
  const requests=[],listeners={};
  const gradient={addColorStop(){}};
  const context=new Proxy({
    createRadialGradient(){return gradient;},
    createLinearGradient(){return gradient;}
  },{get(o,k){return Object.hasOwn(o,k)?o[k]:(()=>{});},
     set(o,k,v){o[k]=v;return true;}});
  const panel={getBoundingClientRect:()=>({left:0,top:0,width:520,height:780})};
  const canvas={parentElement:panel,width:0,height:0,
    getContext(name){assert.equal(name,'2d');return context;}};
  const stage={getBoundingClientRect:()=>({left:0,top:55,right:520,bottom:305,width:520,height:250})};
  const brain={getBoundingClientRect:()=>({left:0,top:305,right:520,bottom:700,width:520,height:395})};
  const caption={textContent:''};
  const document={
    hidden:false,
    getElementById(id){return {'persona-evolution-canvas':canvas,
      'persona-evolution-stage':stage,'persona-evolution-caption':caption,
      'brain-canvas':brain}[id]||null;},
    addEventListener(name,fn){listeners[name]=fn;}
  };
  const media={matches:false,addEventListener(){}};
  const window={
    devicePixelRatio:1.7,matchMedia:()=>media,
    KiyomiraBrain:{getCorePosition:()=>({x:270,y:510})},
    addEventListener(name,fn){listeners[name]=fn;}
  };
  const timers=[];
  const runtime={document,window,performance:{now:()=>1200},
    requestAnimationFrame(fn){requests.push(fn);return requests.length;},
    cancelAnimationFrame(){},
    setInterval(fn){timers.push(fn);return timers.length;},
    clearInterval(){},
    ResizeObserver:class{observe(){}disconnect(){}},
    Math,Number,Array,Set,Object,String
  };
  vm.runInNewContext(source,runtime,{filename:'08-Эволюция.js',timeout:2500});
  const evolution=window.KiyomiraEvolution;
  assert.ok(evolution);
  let first=evolution.getState();
  assert.equal(first.experience,0);
  assert.equal(first.experiments,0);
  assert.equal(first.levels[2].value,0);
  assert.equal(first.levels[4].value,0);
  assert.equal(canvas.width,884);
  evolution.eventActivity({type:'контекст'});
  evolution.eventActivity({type:'генерация'});
  first=evolution.getState();
  // A user request may animate, but it cannot create an achievement.
  assert.equal(first.levels[2].value,0);
  assert.equal(first.levels[4].value,0);
  evolution.update({опыта:7,экспериментов_всего:2,
    улучшений_на_образцах:1,цели:[],навыки:[],развитие_включено:true});
  const grown=evolution.getState();
  assert.equal(grown.experience,7);
  assert.equal(grown.experiments,2);
  assert.ok(grown.levels[2].value>0);
  assert.ok(grown.levels[4].value>0);
  assert.equal(grown.levels[5].value,0,'Search candidate is not a validated deployed skill');
  assert.match(caption.textContent,/кандидатов лучше только на тестах/);
  const signature=grown.levels.map(x=>x.value).join(',');
  evolution.eventActivity({type:'ответ'});
  assert.equal(evolution.getState().levels.map(x=>x.value).join(','),signature);
  evolution.update({опыта:7,экспериментов_всего:2,
    улучшений_на_образцах:1,цели:[],навыки:[],развитие_включено:false});
  assert.equal(evolution.getState().enabled,false);
  assert.equal(evolution.getState().levels.map(x=>x.value).join(','),signature);
  // A deleted source must also disappear from the projection.
  evolution.update({опыта:0,экспериментов_всего:0,цели:[],навыки:[]});
  assert.equal(evolution.getState().levels[2].value,0);
  assert.equal(evolution.getState().levels[4].value,0);
  document.hidden=true;listeners.visibilitychange();
  assert.equal(evolution.getState().activePulse,false);
  assert.equal(timers.length,1,'One low-frequency idle timer, no second scheduler');
});

test('Ascension respects reduced-motion preference and zero sized panels',()=>{
  const source=readFileSync(join(__dirname,'../10-Веб/08-Эволюция.js'),'utf8');
  let frameCount=0;
  const c={parentElement:{getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})},
    getContext:()=>({})};
  const nodes={'persona-evolution-canvas':c,
    'persona-evolution-stage':{getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})},
    'persona-evolution-caption':{textContent:''},
    'brain-canvas':{getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})}};
  const window={devicePixelRatio:2,
    matchMedia:()=>({matches:true,addEventListener(){}}),
    addEventListener(){}};
  const runtime={window,document:{hidden:false,getElementById:id=>nodes[id],addEventListener(){}},
    performance:{now:()=>10},requestAnimationFrame(){frameCount++;return 1;},
    cancelAnimationFrame(){},setInterval:()=>1,clearInterval(){},
    ResizeObserver:class{observe(){}disconnect(){}},Math,Number,Array,Set,Object,String};
  vm.runInNewContext(source,runtime,{filename:'08-Эволюция.js',timeout:2500});
  window.KiyomiraEvolution.eventActivity({type:'генерация'});
  assert.equal(frameCount,0);
});

test('Unified personality overlays the brain without replacing its interactive Canvas',()=>{
  const source=readFileSync(join(__dirname,'../10-Веб/08-Эволюция.js'),'utf8');
  const css=readFileSync(join(__dirname,'../10-Веб/06-Личность.css'),'utf8');
  assert.match(css,/\.unified-workspace \.persona-evolution-stage\s*\{\s*position:absolute;/);
  assert.match(css,/\.unified-workspace \.persona-evolution-canvas\s*\{[^}]*pointer-events:none/);
  const points=[];
  const gradient={addColorStop(){}};
  const ctx=new Proxy({
    createRadialGradient(){return gradient;},
    createLinearGradient(){return gradient;},
    arc(x,y,r){points.push({x,y,r});}
  },{get(target,key){return target[key]||(()=>{});}});
  const panel={getBoundingClientRect:()=>({left:0,top:0,width:500,height:700})};
  const canvas={parentElement:panel,getContext:()=>ctx};
  const nodes={
    'persona-evolution-canvas':canvas,
    'persona-evolution-stage':{getBoundingClientRect:()=>({left:0,top:52,width:500,height:590,bottom:642})},
    'persona-evolution-caption':{textContent:''},
    'brain-canvas':{getBoundingClientRect:()=>({left:0,top:52,width:500,height:590,bottom:642})}
  };
  const window={devicePixelRatio:1,matchMedia:()=>({matches:true,addEventListener(){}}),
    KiyomiraBrain:{getCorePosition:()=>({x:240,y:370})},addEventListener(){}};
  vm.runInNewContext(source,{
    window,document:{hidden:false,getElementById:id=>nodes[id],addEventListener(){}},
    performance:{now:()=>100},requestAnimationFrame(){return 1;},cancelAnimationFrame(){},
    setInterval(){return 1;},clearInterval(){},
    ResizeObserver:class{observe(){}disconnect(){}},Math,Number,Array,Set,Object,String
  },{filename:'08-Эволюция.js',timeout:2500});
  assert.ok(points.some(p=>Math.abs(p.x-240)<1&&p.y<370&&p.y>200),
    'Personality root must follow the real brain core inside its viewport');
});
