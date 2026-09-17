var vaultStore, vaultEpoch=0, vaultBusy=false, vaultStatus='locked', vaultSelected='', vaultMode='idle';
var vaultLabels={
  new:['新增配置','New profile'],edit:['修改 / 另存','Edit / save as new'],cancel:['取消','Cancel'],confirmRename:['保存名称','Save name'],
  title:['本地 API 配置','Local API profiles'],choose:['选择配置','Choose a profile'],fresh:['请选择配置','Choose a profile'],
  name:['配置名称','Profile name'],pin:['6 位数字密码','6-digit password'],confirm:['确认密码（保存时填写）','Confirm password (when saving)'],
  save:['加密保存为新配置','Save as a new encrypted profile'],unlock:['解锁使用','Unlock'],lock:['锁定','Lock'],rename:['重命名','Rename'],remove:['删除配置','Delete profile'],
  hint:['密钥仅在解锁后的当前页面内存中使用。6 位密码防护有限，忘记无法找回；清理站点数据会删除配置。','Keys are used only in this unlocked page. A 6-digit password offers limited protection and cannot be recovered. Clearing site data removes profiles.'],
  legacy:['检测到旧明文 Key。请保留当前内容并加密保存，成功后才清除旧明文。','A legacy plaintext key exists. Encrypt and save it to remove the old plaintext copy.'],
  importLegacy:['载入旧配置以迁移','Load legacy profile for migration'],
  locked:['已锁定，请选择配置并输入密码解锁，或填写新配置。','Locked. Select a profile and enter its password, or enter a new configuration.'],
  unlocked:['已解锁，本次页面内可使用。修改字段只影响本次使用；需要持久保存请另存新配置。','Unlocked for this page. Field edits affect this session only; save a new profile to persist changes.'],
  saved:['已加密保存并启用。刷新页面后需要重新解锁。','Encrypted profile saved and activated. Reloading requires unlocking again.'],
  busy:['正在处理…','Working…'],pinError:['请输入恰好 6 位数字，可包含开头的 0。','Enter exactly 6 digits; leading zeros are allowed.'],
  mismatch:['两次输入的密码不一致。','Passwords do not match.'],nameError:['请输入 1–60 字的配置名称。','Enter a profile name of 1–60 characters.'],
  decrypt:['密码错误或加密数据已损坏，未解锁。','Wrong password or damaged encrypted data. Still locked.'],
  storage:['本地保存失败，请检查浏览器存储权限或剩余空间。旧配置未被删除。','Local storage failed. Check browser permissions or free space. Existing profiles were not deleted.'],
  unsupported:['当前浏览器不支持安全存储，请用新版浏览器通过 localhost 或 HTTPS 打开。','Secure storage is unavailable. Use a current browser on localhost or HTTPS.'],
  missing:['配置不存在，请重新选择。','Profile no longer exists. Select it again.'],invalid:['请先填写有效的 API 地址、密钥和模型。','Enter a valid API URL, key and model first.'],
  deleteConfirm:['删除这个加密配置？此操作无法撤销。','Delete this encrypted profile? This cannot be undone.'],
  renamed:['配置名称已更新。','Profile renamed.'],removed:['配置已删除，当前会话已锁定。','Profile deleted. The current session is locked.'],
  temporary:['临时配置未加密保存，刷新后需要重新填写。','Temporary credentials are not saved. Reloading requires entering them again.']
};
function vt(key){return (vaultLabels[key]||vaultLabels.storage)[_lang==='en'?1:0];}
function ve(id){return document.getElementById('vault-'+id);}
function renderVault(){
  if(!ve('panel'))return;
  ve('panel').querySelectorAll('[data-vtext]').forEach(function(el){el.textContent=vt(el.dataset.vtext);});
  ve('status').textContent=vt(vaultBusy?'busy':vaultStatus);
  ve('legacy-note').hidden=!apiSession.legacy();
  ve('import').hidden=!apiSession.legacy();
  ve('select').disabled=vaultBusy;
  ['save','unlock','rename','remove','import'].forEach(function(id){ve(id).disabled=vaultBusy||(!vaultSelected&&['unlock','rename','remove'].includes(id));});
  ['name','pin','confirm'].forEach(function(id){ve(id).disabled=vaultBusy;});
  Object.values(apiFieldIds()).forEach(function(id){document.getElementById(id).disabled=vaultBusy;});
  var creating=vaultMode==='new', renaming=vaultMode==='rename', unlocking=vaultMode==='unlock';
  ve('name').parentElement.hidden=!(creating||renaming);
  ve('pin').parentElement.hidden=!(creating||unlocking);
  ve('confirm').parentElement.hidden=!creating;
  ve('api-fields').hidden=!creating;
  Object.values(apiFieldIds()).forEach(function(id){document.getElementById(id).readOnly=!creating;});
  ve('test-panel').hidden=!(creating||vaultMode==='ready');
  var show={save:creating,unlock:unlocking,lock:vaultMode==='ready'||vaultBusy,new:!creating&&!renaming,edit:vaultMode==='ready',rename:!!vaultSelected&&!creating&&!renaming,remove:!!vaultSelected&&!creating&&!renaming,cancel:creating||renaming,confirmRename:renaming};
  Object.keys(show).forEach(function(id){ve(id).hidden=!show[id];if(id!=='lock')ve(id).disabled=vaultBusy;});
  var fresh=ve('select').options[0];if(fresh)fresh.textContent=vt('fresh');
}
function clearVaultPasswords(){ve('pin').value='';ve('confirm').value='';}
function lockApiVault(){
  vaultEpoch++;apiSession.lock();vaultMode=vaultSelected?'unlock':'idle';
  if(typeof _generationController!=='undefined'&&_generationController)_generationController.abort();
  Object.values(apiFieldIds()).forEach(function(id){document.getElementById(id).value='';});
  clearVaultPasswords();apiFormChanged();vaultStatus='locked';renderVault();
}
async function refreshVaultList(selected){
  var rows=await vaultStore.list();
  ve('select').replaceChildren(new Option(vt('fresh'),''));
  rows.forEach(function(row){ve('select').add(new Option(row.name,row.id));});
  ve('select').value=selected||'';vaultSelected=ve('select').value;
}
function fillApiConfig(s){
  var fields=apiFieldIds();Object.keys(fields).forEach(function(k){document.getElementById(fields[k]).value=s[k]||'';});
  apiFormChanged();
}
async function vaultAction(action){
  if(vaultBusy)return;
  var epoch=++vaultEpoch, id=vaultSelected, name=ve('name').value.trim();
  var pin=ve('pin').value, confirmation=ve('confirm').value;
  var checked=validateApiForm();
  if(['save','unlock'].includes(action)&&!ApiVault.pinValid(pin)){vaultStatus='pinError';renderVault();return;}
  if(action==='save'&&pin!==confirmation){vaultStatus='mismatch';renderVault();return;}
  if(['save','rename'].includes(action)&&(!name||name.length>60)){vaultStatus='nameError';renderVault();return;}
  if(action==='save'&&!checked.ready){vaultStatus='invalid';renderVault();return;}
  if(action!=='save'&&!id){vaultStatus='missing';renderVault();return;}
  if(action==='remove'&&!confirm(vt('deleteConfirm')))return;
  vaultBusy=true;renderVault();
  try{
    if(!vaultStore)throw new Error('unsupported');
    if(action==='save'){
      var newId=crypto.randomUUID(), envelope=await ApiVault.seal(newId,checked.settings,pin);
      if(epoch!==vaultEpoch)return;
      await vaultStore.add(newId,name,envelope);
      // Clear legacy plaintext only after IndexedDB's write transaction has committed.
      apiSession.migrated(checked.settings.apiKey);
      if(epoch!==vaultEpoch)return;
      apiSession.activate(checked.settings);await refreshVaultList(newId);
      if(epoch!==vaultEpoch)return;
      vaultStatus='saved';vaultMode='ready';onSettingsSave();
    }else if(action==='unlock'){
      // A failed unlock must never leave a previously active key available.
      apiSession.lock();document.getElementById('setting-api-key').value='';
      var row=await vaultStore.get(id), config=await ApiVault.open(id,row.envelope,pin);
      if(epoch!==vaultEpoch)return;
      if(!ApiSettings.validate(config,apiDefaults()).ready)throw new Error('decrypt');
      apiSession.activate(config);fillApiConfig(config);vaultStatus='unlocked';vaultMode='ready';onSettingsSave();
    }else if(action==='rename'){
      await vaultStore.rename(id,name);if(epoch!==vaultEpoch)return;
      await refreshVaultList(id);vaultStatus='renamed';vaultMode=apiSession.load({}).apiKey?'ready':'unlock';
    }else if(action==='remove'){
      await vaultStore.remove(id);lockApiVault();await refreshVaultList('');vaultStatus='removed';vaultMode='idle';
    }
  }catch(e){if(epoch===vaultEpoch)vaultStatus=vaultLabels[e.message]?e.message:'storage';}
  finally{pin='';confirmation='';clearVaultPasswords();vaultBusy=false;validateApiForm();renderVault();}
}
window.addEventListener('DOMContentLoaded',async function(){
  var panel=document.createElement('div');panel.id='vault-panel';panel.className='modal-section vault-panel';
  panel.innerHTML='<div class="modal-label" data-vtext="title"></div>'+
    '<label for="vault-select" data-vtext="choose"></label><select id="vault-select" class="setting-input"><option value=""></option></select>'+
    '<div class="setting-row"><label for="vault-name" data-vtext="name"></label><input id="vault-name" class="setting-input" maxlength="60" autocomplete="off"></div>'+
    '<div class="vault-passwords"><div><label for="vault-pin" data-vtext="pin"></label><input id="vault-pin" class="setting-input" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div>'+
    '<div><label for="vault-confirm" data-vtext="confirm"></label><input id="vault-confirm" class="setting-input" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div></div>'+
    '<div class="vault-actions">'+['new','save','unlock','lock','edit','rename','confirmRename','remove','cancel'].map(function(id){return '<button type="button" class="btn btn-secondary" id="vault-'+id+'" data-vtext="'+id+'"></button>';}).join('')+'</div>'+
    '<p id="vault-status" role="status" aria-live="polite"></p><p class="setting-hint" data-vtext="hint"></p>'+
    '<p id="vault-legacy-note" class="setting-hint" data-vtext="legacy"></p><button type="button" class="btn" id="vault-import" data-vtext="importLegacy"></button>';
  var apiSection=document.getElementById('setting-api-base').closest('.modal-section');apiSection.before(panel);
  apiSection.id='vault-api-fields';panel.insertBefore(apiSection,ve('name').parentElement);
  var testPanel=document.getElementById('api-test-button').parentElement;testPanel.id='vault-test-panel';apiSection.appendChild(testPanel);
  ve('select').addEventListener('change',function(){lockApiVault();vaultSelected=this.value;vaultMode=this.value?'unlock':'idle';ve('name').value=this.value?this.selectedOptions[0].textContent:'';renderVault();});
  ve('lock').addEventListener('click',lockApiVault);
  ['save','unlock','remove'].forEach(function(action){ve(action).addEventListener('click',function(){vaultAction(action);});});
  ve('new').addEventListener('click',function(){lockApiVault();vaultSelected='';ve('select').value='';ve('name').value='';vaultMode='new';vaultStatus='temporary';renderVault();});
  ve('edit').addEventListener('click',function(){clearVaultPasswords();vaultMode='new';renderVault();});
  ve('rename').addEventListener('click',function(){vaultMode='rename';clearVaultPasswords();renderVault();ve('name').focus();});
  ve('confirmRename').addEventListener('click',function(){vaultAction('rename');});
  ve('cancel').addEventListener('click',function(){if(vaultMode==='new')lockApiVault();clearVaultPasswords();vaultMode=vaultSelected?(apiSession.load({}).apiKey?'ready':'unlock'):'idle';renderVault();});
  ve('import').addEventListener('click',function(){var old=apiSession.legacy();if(old){lockApiVault();vaultSelected='';ve('select').value='';apiSession.activate(old);fillApiConfig(old);vaultStatus='temporary';vaultMode='new';renderVault();}});
  window.addEventListener('pagehide',lockApiVault);
  renderVault();
  try{
    if(!crypto.subtle||!navigator.locks||typeof initSqlJs==='undefined')throw new Error('unsupported');
    vaultStore=ApiVault.createStore(function(){return initSqlJs({locateFile:function(f){return './assets/'+f;}});},indexedDB,navigator.locks);
    await refreshVaultList('');renderVault();
  }catch(e){vaultStatus=e.message==='unsupported'?'unsupported':'storage';renderVault();}
});
