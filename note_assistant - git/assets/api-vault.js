/* Versioned, authenticated local encryption. No password or plaintext credentials are persisted. */
(function(root) {
  const encoder = new TextEncoder(), iterations = 600000;
  function pinValid(pin) { return /^[0-9]{6}$/.test(pin); }
  async function keyFor(pin, salt) {
    if (!pinValid(pin)) throw new Error('pin');
    const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'}, material,
      {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  }
  async function seal(id, settings, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(pin, salt);
    const bytes = encoder.encode(JSON.stringify({apiBase:settings.apiBase,model:settings.model,apiKey:settings.apiKey}));
    try {
      const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('api-vault:1:'+id)}, key, bytes);
      return {v:1,salt:Array.from(salt),iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(ciphertext))};
    } finally { bytes.fill(0); }
  }
  async function open(id, envelope, pin) {
    if (!pinValid(pin)) throw new Error('pin');
    if (envelope.v !== 1 || envelope.salt.length !== 16 || envelope.iv.length !== 12 || envelope.ciphertext.length > 65536) throw new Error('decrypt');
    let bytes;
    try {
      const key = await keyFor(pin, new Uint8Array(envelope.salt));
      bytes = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(envelope.iv),additionalData:encoder.encode('api-vault:1:'+id)},key,new Uint8Array(envelope.ciphertext)));
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!data || !['apiBase','model','apiKey'].every(k=>typeof data[k]==='string') || !data.apiKey) throw new Error('decrypt');
      return data;
    } catch(_) { throw new Error('decrypt'); }
    finally { if(bytes) bytes.fill(0); }
  }
  // Independent SQLite file avoids coupling credential persistence to note-history snapshots.
  function createStore(sqlLoader, idb, locks, namespace) {
    const dbName = namespace === 'asr' ? 'note_asr_vault' : 'note_api_vault';
    const lockName = namespace === 'asr' ? 'note-asr-vault-write' : 'note-api-vault-write';
    let sqlPromise;
    function io(value, write) {
      return new Promise((resolve,reject)=>{
        const request=idb.open(dbName,1);
        request.onupgradeneeded=()=>request.result.createObjectStore('kv');
        request.onerror=()=>reject(new Error('storage'));
        request.onsuccess=()=>{
          const db=request.result, tx=db.transaction('kv',write?'readwrite':'readonly');
          const query=write?tx.objectStore('kv').put(value,'sqlite'):tx.objectStore('kv').get('sqlite');
          let result;query.onsuccess=()=>{result=query.result;};
          tx.oncomplete=()=>{db.close();resolve(result);};
          tx.onerror=tx.onabort=()=>{db.close();reject(new Error('storage'));};
        };
      });
    }
    async function use(action, write) {
      async function run() {
        const SQL=await (sqlPromise ||= sqlLoader()), data=await io(null,false);
        const db=data?new SQL.Database(new Uint8Array(data)):new SQL.Database();
        try {
          db.run('CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, envelope TEXT NOT NULL)');
          const result=action(db);
          if(write) await io(db.export(),true);
          return result;
        } finally {db.close();}
      }
      if(write) {
        if(!locks) throw new Error('unsupported');
        return locks.request(lockName,run);
      }
      return run();
    }
    function row(db,id) {
      const stmt=db.prepare('SELECT id,name,envelope FROM profiles WHERE id=?');
      try {stmt.bind([id]);if(!stmt.step())throw new Error('missing');return stmt.getAsObject();}finally{stmt.free();}
    }
    return {
      list:()=>use(db=>{const r=db.exec('SELECT id,name FROM profiles ORDER BY name,id');return r.length?r[0].values.map(v=>({id:v[0],name:v[1]})):[];},false),
      get:id=>use(db=>{const r=row(db,id);return {...r,envelope:JSON.parse(r.envelope)};},false),
      add:(id,name,envelope)=>use(db=>db.run('INSERT INTO profiles VALUES (?,?,?)',[id,name,JSON.stringify(envelope)])&&undefined,true),
      rename:(id,name)=>use(db=>{row(db,id);db.run('UPDATE profiles SET name=? WHERE id=?',[name,id]);},true),
      remove:id=>use(db=>db.run('DELETE FROM profiles WHERE id=?',[id])&&undefined,true)
    };
  }
  root.ApiVault={pinValid,seal,open,createStore};
  if(typeof module!=='undefined')module.exports=root.ApiVault;
})(typeof globalThis!=='undefined'?globalThis:this);
