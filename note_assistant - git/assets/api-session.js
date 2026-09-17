/* Session credentials are deliberately separate from persistent non-secret settings. */
(function(root){
  function create(storage, storageKey) {
    let session=null, legacy=null, controller=new AbortController();
    function read(){try{return JSON.parse(storage.getItem(storageKey)||'{}')||{};}catch(_){return {};}}
    const old=read();
    if(typeof old.apiKey==='string'&&old.apiKey) {legacy={apiKey:old.apiKey,apiBase:old.apiBase,model:old.model};session={...legacy};}
    return {
      load(defaults){const s={...defaults,...read()};delete s.apiKey;return {...s,...(session||{}),apiKey:session?session.apiKey:''};},
      save(s){
        session={apiKey:s.apiKey||'',apiBase:s.apiBase,model:s.model};
        const safe={...s};delete safe.apiKey;
        if(legacy && read().apiKey!==legacy.apiKey) legacy=null;
        // Preserve only the pre-existing legacy key until its encrypted copy is durably saved.
        if(legacy) {safe.apiKey=legacy.apiKey;safe.apiBase=legacy.apiBase;safe.model=legacy.model;}
        storage.setItem(storageKey,JSON.stringify(safe));
      },
      activate(s){controller.abort();controller=new AbortController();session={...s};},
      lock(){controller.abort();controller=new AbortController();session=null;},
      signal(){return controller.signal;},
      legacy(){return legacy?{...legacy}:null;},
      migrated(key){if(legacy&&legacy.apiKey===key){const safe=read();delete safe.apiKey;storage.setItem(storageKey,JSON.stringify(safe));legacy=null;}},
    };
  }
  root.ApiSession={create};
  if(typeof module!=='undefined')module.exports=root.ApiSession;
})(typeof globalThis!=='undefined'?globalThis:this);
