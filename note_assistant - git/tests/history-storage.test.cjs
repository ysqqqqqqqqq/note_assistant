const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function app(indexedDB){
  const c=vm.createContext({console:{error(){},warn(){},log(){}},indexedDB,ApiSession:{create:()=>({})},localStorage:{},window:{addEventListener(){}},
    document:{getElementById(){return null;}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8'),c);
  return c;
}
test('history persistence resolves only after IndexedDB transaction commits',async()=>{
  let request,tx,closed=false;
  const db={transaction(){tx={objectStore(){return {put(){return {};}}}};return tx;},close(){closed=true;}};
  const c=app({open(){request={result:db};queueMicrotask(()=>request.onsuccess());return request;}});
  let settled=false;const pending=c._idbSet(new Uint8Array([1])).then(()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);
  assert.equal(typeof tx.oncomplete,'function');
  tx.oncomplete();await pending;
  assert.equal(settled,true);assert.equal(closed,true);
});
test('failed note history mutation restores in-memory database',async()=>{
  const c=app({});
  class Database{constructor(bytes){this.value=bytes[0];}export(){return new Uint8Array([this.value]);}run(){this.value=2;}}
  c._SQL={Database};c._db=new Database(new Uint8Array([1]));
  c._saveDb=async()=>{throw Error('quota');};
  assert.equal(await c.persistHistoryMutation(()=>c._db.run()),false);
  assert.equal(c._db.value,1);
});
