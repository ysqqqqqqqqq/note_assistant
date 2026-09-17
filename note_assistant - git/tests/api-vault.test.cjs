const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vault=require('../assets/api-vault.js');
const sessions=require('../assets/api-session.js');
const initSqlJs=require('../assets/sql-wasm.js');
const config={apiBase:'https://example.com/v1',model:'test-model',apiKey:'synthetic-key-never-real'};
function memory(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};}
test('six digits including leading zeros, rejecting non-ASCII / wrong length',()=>{
  assert.equal(vault.pinValid('001234'),true);
  for(const pin of ['12345','1234567','１２３４５６','123a56','123 56'])assert.equal(vault.pinValid(pin),false);
});
test('AES-GCM roundtrip, random salt / IV, and no plaintext credential in envelope',async()=>{
  const a=await vault.seal('one',config,'001234'),b=await vault.seal('one',config,'001234');
  assert.deepEqual(await vault.open('one',a,'001234'),config);
  assert.notDeepEqual(a.salt,b.salt);assert.notDeepEqual(a.iv,b.iv);assert.notDeepEqual(a.ciphertext,b.ciphertext);
  assert.equal(JSON.stringify(a).includes(config.apiKey),false);
});
test('wrong PIN, tampering, profile substitution and unsupported format fail closed',async()=>{
  const a=await vault.seal('one',config,'001234');
  await assert.rejects(vault.open('one',a,'654321'),/decrypt/);
  await assert.rejects(vault.open('two',a,'001234'),/decrypt/);
  const changed=structuredClone(a);changed.ciphertext[0]^=1;
  await assert.rejects(vault.open('one',changed,'001234'),/decrypt/);
  await assert.rejects(vault.open('one',{...a,v:99},'001234'),/decrypt/);
});
test('new credentials never persist; lock aborts active requests; refresh is locked',()=>{
  const storage=memory(),s=sessions.create(storage,'settings');
  s.save({...config,ragBackend:true});
  assert.equal(JSON.parse(storage.getItem('settings')).apiKey,undefined);
  assert.equal(s.load({}).apiKey,config.apiKey);
  const signal=s.signal();s.lock();assert.equal(signal.aborted,true);assert.equal(s.load({}).apiKey,'');
  assert.equal(sessions.create(storage,'settings').load({}).apiKey,'');
  assert.equal(s.load({}).ragBackend,true);
});
test('legacy key is retained until matching encrypted save; ordinary saves cannot replace it',()=>{
  const storage=memory();storage.setItem('settings',JSON.stringify(config));
  const s=sessions.create(storage,'settings');
  s.save({...config,apiKey:'different-new-secret'});
  assert.equal(JSON.parse(storage.getItem('settings')).apiKey,config.apiKey);
  s.migrated('different-new-secret');assert.ok(s.legacy());
  s.migrated(config.apiKey);assert.equal(s.legacy(),null);
  assert.equal(JSON.parse(storage.getItem('settings')).apiKey,undefined);
});
test('failed legacy cleanup preserves migration state for retry',()=>{
  const storage=memory();storage.setItem('settings',JSON.stringify(config));
  const s=sessions.create(storage,'settings');storage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>s.migrated(config.apiKey),/quota/);assert.ok(s.legacy());
});
test('another tab cannot restore legacy plaintext after migration',()=>{
  const storage=memory();storage.setItem('settings',JSON.stringify(config));
  const a=sessions.create(storage,'settings'),b=sessions.create(storage,'settings');
  a.migrated(config.apiKey);b.save({...config,topN:4});
  assert.equal(JSON.parse(storage.getItem('settings')).apiKey,undefined);assert.equal(b.legacy(),null);
});
test('locking while decryption is pending cannot reactivate a stale key',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),elements={};
  const el=id=>elements[id] ||= {value:'',disabled:false};
  el('vault-pin').value='001234';
  const session=sessions.create(memory(),'settings');session.activate(config);
  let resolve;
  const c=vm.createContext({console,AbortController,ApiVault:{...vault,open:()=>new Promise(r=>resolve=r)},ApiSettings:{validate:()=>({ready:true})},
    apiSession:session,window:{addEventListener(){}},document:{getElementById:el},_lang:'zh',
    apiDefaults:()=>({}),apiFieldIds:()=>({apiKey:'setting-api-key'}),apiFormChanged(){},validateApiForm:()=>({ready:true}),onSettingsSave(){},confirm:()=>true});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/api-vault-ui.js'),'utf8'),c);
  c.renderVault=()=>{};c.vaultSelected='a';c.vaultStore={get:async()=>({envelope:{}})};
  const pending=c.vaultAction('unlock');await new Promise(r=>setImmediate(r));
  c.lockApiVault();resolve(config);await pending;
  assert.equal(session.load({}).apiKey,'');assert.equal(c.vaultStatus,'locked');assert.equal(el('vault-pin').value,'');
});
// Transaction fixture commits writes only on completion, and can abort them.
function diskFixture(){
  let bytes,fail=false;
  return {get bytes(){return bytes;},failNext(){fail=true;},open(){
    const r={};setImmediate(()=>{r.result={close(){},transaction(){
      const tx={objectStore(){return {get(){const q={};setImmediate(()=>{q.result=bytes;q.onsuccess();tx.oncomplete();});return q;},
        put(value){const q={};setImmediate(()=>{if(fail){fail=false;tx.onabort();}else{bytes=value;q.onsuccess();tx.oncomplete();}});return q;}};}};return tx;}};r.onsuccess();});return r;
  }};
}
test('SQLite stores independent encrypted profiles; reload, rename, deletion, and failed commit',async()=>{
  const SQL=await initSqlJs({locateFile:f=>path.join(__dirname,'../assets',f)});
  const disk=diskFixture();let queue=Promise.resolve();
  const locks={request:(_,fn)=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;}};
  const store=vault.createStore(async()=>SQL,disk,locks);
  const a=await vault.seal('a',config,'001234'),b=await vault.seal('b',{...config,apiKey:'second-secret'},'654321');
  await Promise.all([store.add('a','智谱',a),store.add('b','备用',b)]);
  assert.equal((await store.list()).length,2);
  assert.equal(Buffer.from(disk.bytes).includes(Buffer.from(config.apiKey)),false);
  assert.equal(Buffer.from(disk.bytes).includes(Buffer.from('second-secret')),false);
  assert.equal(Buffer.from(disk.bytes).includes(Buffer.from('001234')),false);
  const reload=vault.createStore(async()=>SQL,disk,locks);
  assert.deepEqual(await vault.open('a',(await reload.get('a')).envelope,'001234'),config);
  await reload.rename('a',"name'; DROP TABLE profiles; --");assert.equal((await store.list()).length,2);
  disk.failNext();await assert.rejects(store.remove('a'),/storage/);assert.ok(await store.get('a'));
  await store.remove('a');await assert.rejects(store.get('a'),/missing/);
  assert.equal((await store.list()).length,1);
});
