const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(x=>!x[1].includes('src=')).map(x=>x[2]);
const source=scripts.join('\n');
function chunk(a,b){return source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));}
function fixture(){
  let next=0;const pending=new Map(),els=new Map();
  const el=id=>{if(!els.has(id))els.set(id,{style:{},textContent:'',replaceChildren(){this.cleared=true;}});return els.get(id);};
  const context={console,Set,Map,location:{hash:'#/home'},$:el,
    document:{body:{style:{}},querySelectorAll:()=>[]},
    setTimeout:(fn,delay,...args)=>{pending.set(++next,()=>fn(...args));return next;},clearTimeout:id=>pending.delete(id),
    setInterval:fn=>{pending.set(++next,fn);return next;},clearInterval:id=>pending.delete(id),
    requestAnimationFrame:fn=>{pending.set(++next,fn);return next;},cancelAnimationFrame:id=>pending.delete(id)};
  context.window=context;vm.createContext(context);
  vm.runInContext(chunk('const IVS=new Set()', 'const ROUTES='),context);
  return {context,pending,el,run:s=>vm.runInContext(s,context)};
}
test('all inline scripts parse',()=>{scripts.forEach(s=>new vm.Script(s));});
test('fired timeouts and animation frames release their tracking entries',()=>{
  const f=fixture();f.run('var calls=0;setTimeout(x=>calls+=x,0,2);requestAnimationFrame(()=>calls++);');
  for(const [id,fn] of [...f.pending]){f.pending.delete(id);fn(10);}
  assert.equal(f.run('calls'),3);assert.equal(f.run('TOS.size+RAFS.size'),0);
});
test('leaving a game cancels timers, frames and media; restart controls recover',()=>{
  const f=fixture();f.run(`var rolling=true,bottleSpinning=true,bombOn=true;
    var ytBusy=true,songBusy=true,ytCurId='x',sgCurId='y',stopped=0;
    var ytPlayer={stopVideo(){stopped++},destroy(){stopped++}},sgPlayer=null;
    var tmState='run',tmNum=2,tmRAF=0,silentT=1;
    setTimeout(()=>{throw Error('late timeout')},10);setInterval(()=>{},10);requestAnimationFrame(()=>{});
    stopAllPlay();`);
  assert.equal(f.pending.size,0);assert.equal(f.run('IVS.size+TOS.size+RAFS.size'),0);
  assert.equal(f.run('stopped'),2);assert.equal(f.run('bottleSpinning||ytBusy||songBusy||bombOn'),false);
  assert.equal(f.el('bombBtn').style.display,'inline-block');assert.match(f.el('tmMain').textContent,/3번 선수 START/);
  assert.equal(f.el('silentStart').style.display,'inline-block');assert.equal(f.el('ytHolder').cleared,true);
});
test('malformed saved preferences cannot crash startup or inject invalid setup',()=>{
  const f=fixture();f.context.saved={aoki_recent_v1:{bad:true},aoki_fav_v1:null,aoki_setup_v1:{n:999,loc:'outdoor',mood:'bogus'}};
  f.context.localStorage={getItem:k=>JSON.stringify(f.context.saved[k])};
  f.run('var GAMES=[{id:"dice"}],HOME_N=6;');
  f.run(chunk('const LSK=', 'function pushRecent('));f.run('loadPrefs();');
  assert.equal(f.run('RECENT.length+FAVS.length'),0);assert.equal(f.run('HOME_N'),20);
  assert.equal(f.run('SETUP.loc'),'outdoor');assert.equal(f.run('SETUP.mood'),'any');
});
test('late YouTube API readiness cannot restart playback after timeout or exit',()=>{
  for(const mode of ['timeout','exit']){
    const f=fixture();f.context.document.createElement=()=>({});f.context.document.head={appendChild(){}};
    f.run(chunk('function ytLoad(', '/* 폴백:'));f.run('var readyCalls=0,failCalls=0;ytLoad(()=>readyCalls++,()=>failCalls++);');
    if(mode==='exit')f.run('stopAllPlay();');else for(const fn of [...f.pending.values()])fn();
    f.run('window.onYouTubeIframeAPIReady();');
    assert.equal(f.run('readyCalls'),0);assert.equal(f.run('failCalls'),mode==='timeout'?1:0);
  }
});
