/* Independent ASR credentials, using the same vault crypto and session primitives as LLM. */
(function(root){
  const session=ApiSession.create(localStorage,'note_asr_settings');
  let store=null,selected='',mode='idle',busy=false,epoch=0;
  const el=id=>document.getElementById('asr-'+id);
  function checked(){
    const values={apiBase:el('base').value.trim().replace(/\/audio\/transcriptions\/?$/i,''),apiKey:el('key').value.trim(),model:el('model').value.trim()};
    const result=ApiSettings.validate(values,{apiBase:'',model:''});
    if(!values.apiBase)result.errors.apiBase='url';
    if(!values.model)result.errors.model='model';
    result.valid=!Object.keys(result.errors).length;
    result.ready=result.valid&&!!values.apiKey;
    for(const [name,id] of [['apiBase','base'],['apiKey','key'],['model','model']]){
      const input=el(id),feedback=el(id+'-feedback'),error=result.errors[name];
      input.setAttribute('aria-invalid',error?'true':'false');
      input.classList.toggle('is-valid',!error&&!!input.value.trim());
      feedback.textContent=error?ApiSettings.label(error,typeof _lang==='undefined'?'zh':_lang):'';
      feedback.classList.toggle('is-error',!!error);
    }
    return result;
  }
  function status(message,error){el('status').textContent=message;el('status').classList.toggle('is-error',!!error);el('status').classList.toggle('is-ready',!error&&mode==='ready');}
  function render(){
    const creating=mode==='new',unlocking=mode==='unlock',renaming=mode==='rename',ready=mode==='ready';
    el('name-row').hidden=!(creating||renaming);el('pin-row').hidden=!(creating||unlocking);
    el('confirm-row').hidden=!creating;el('fields').hidden=!(creating||ready);
    for(const id of ['base','key','model']){el(id).readOnly=!creating;el(id).disabled=busy;}
    for(const [id,show] of Object.entries({new:!creating&&!renaming,save:creating,unlock:unlocking,lock:ready,edit:ready,rename:!!selected&&!creating&&!renaming,'rename-save':renaming,remove:!!selected&&!creating&&!renaming,cancel:creating||renaming})){
      el(id).hidden=!show;el(id).disabled=busy;
    }
    for(const id of ['select','name','pin','confirm'])el(id).disabled=busy;
  }
  function clearSecrets(){el('pin').value='';el('confirm').value='';}
  function lock(){epoch++;session.lock();for(const id of ['base','key','model'])el(id).value='';clearSecrets();mode=selected?'unlock':'idle';status('已锁定，请输入密码解锁。');render();}
  async function list(id){
    const rows=await store.list();el('select').replaceChildren(new Option('请选择配置',''));
    rows.forEach(row=>el('select').add(new Option(row.name,row.id)));
    el('select').value=id||'';selected=el('select').value;
  }
  function setConfig(config){el('base').value=config.apiBase;el('key').value=config.apiKey;el('model').value=config.model;checked();}
  async function action(type){
    if(busy)return;
    const token=++epoch,id=selected,name=el('name').value.trim(),pin=el('pin').value,config=checked();
    if(['save','unlock'].includes(type)&&!ApiVault.pinValid(pin)){status('请输入恰好 6 位数字密码。',true);return;}
    if(type==='save'&&pin!==el('confirm').value){status('两次密码不一致。',true);return;}
    if(['save','rename'].includes(type)&&(!name||name.length>60)){status('请输入 1–60 字的配置名称。',true);return;}
    if(type==='save'&&!config.ready){status('请填写有效的 API Key、Base URL 和 Model。',true);return;}
    if(type!=='save'&&!id){status('请先选择配置。',true);return;}
    if(type==='remove'&&!confirm('删除这个加密配置？此操作无法撤销。'))return;
    busy=true;render();
    try{
      if(!store)throw new Error('storage');
      if(type==='save'){
        const newId=crypto.randomUUID(),envelope=await ApiVault.seal(newId,config.settings,pin);
        if(token!==epoch)return;
        await store.add(newId,name,envelope);if(token!==epoch)return;
        session.activate(config.settings);await list(newId);mode='ready';status('已加密保存并启用。刷新后需要重新解锁。');
      }else if(type==='unlock'){
        session.lock();el('key').value='';
        const row=await store.get(id),value=await ApiVault.open(id,row.envelope,pin);
        if(token!==epoch)return;
        const validity=ApiSettings.validate(value,{apiBase:'',model:''});
        if(!value.apiBase||!value.model||!validity.ready)throw new Error('decrypt');
        session.activate(value);setConfig(value);mode='ready';status('已解锁，本页可使用语音识别。');
      }else if(type==='rename'){
        await store.rename(id,name);if(token!==epoch)return;
        await list(id);mode=session.load({}).apiKey?'ready':'unlock';status('配置名称已更新。');
      }else if(type==='remove'){
        await store.remove(id);if(token!==epoch)return;
        lock();await list('');mode='idle';status('配置已删除。');
      }
    }catch(error){if(token===epoch)status(error.message==='decrypt'?'密码错误或配置已损坏。':'配置保存或读取失败，请检查浏览器存储空间。',true);}
    finally{clearSecrets();busy=false;checked();render();}
  }
  function config(){
    const saved=session.load({apiBase:'',model:''});
    const result=ApiSettings.validate(saved,{apiBase:'',model:''});
    return saved.apiBase&&saved.model&&result.ready?{base:result.settings.apiBase,key:result.settings.apiKey,model:result.settings.model}:null;
  }
  function report(success,message){if(mode==='ready')status(success?'连接成功，语音识别可用。':message||'转写失败，请检查语音识别配置。',!success);}
  root.AsrSettings={config,signal:()=>session.signal(),report};
  window.addEventListener('DOMContentLoaded',async()=>{
    for(const id of ['base','key','model'])el(id).addEventListener('input',()=>{checked();if(mode==='new')status('配置已修改，保存后使用。');});
    el('select').addEventListener('change',function(){lock();selected=this.value;mode=selected?'unlock':'idle';el('name').value=selected?this.selectedOptions[0].textContent:'';render();});
    el('new').addEventListener('click',()=>{lock();selected='';el('select').value='';el('name').value='';mode='new';status('填写 ASR 配置并加密保存。');render();});
    el('edit').addEventListener('click',()=>{mode='new';status('修改后另存为新配置。');render();});
    el('lock').addEventListener('click',lock);
    el('rename').addEventListener('click',()=>{mode='rename';render();el('name').focus();});
    el('cancel').addEventListener('click',()=>{if(mode==='new')lock();mode=selected?(config()?'ready':'unlock'):'idle';render();});
    for(const type of ['save','unlock','remove'])el(type).addEventListener('click',()=>action(type));
    el('rename-save').addEventListener('click',()=>action('rename'));
    window.addEventListener('pagehide',lock);
    checked();render();
    try{
      if(!crypto.subtle||!navigator.locks||typeof initSqlJs==='undefined')throw new Error('unsupported');
      store=ApiVault.createStore(()=>initSqlJs({locateFile:file=>'./assets/'+file}),indexedDB,navigator.locks,'asr');
      await list('');render();
    }catch(error){status('当前浏览器无法安全保存语音识别配置。',true);}
  });
})(window);
