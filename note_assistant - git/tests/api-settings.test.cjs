const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../assets/api-settings.js');
const defaults = {apiBase:'https://example.com/v1',model:'model-default'};
const settings = {apiBase:'https://example.com/v1',model:'glm-test',apiKey:'test.key'};
test('defaults are explicit; empty key may be saved but cannot be tested',()=>{
  const r=api.validate({},defaults);
  assert.equal(r.valid,true); assert.equal(r.ready,false);
  assert.equal(r.settings.model,defaults.model); assert.equal(r.hints.apiKey,'keyMissing');
});
test('reject malformed URLs and URL credentials, accept local compatible endpoints',()=>{
  for(const apiBase of ['example.com','ftp://host','[https://host](https://host)','https://name:secret@host','https://host?k=secret','https://host/#x'])
    assert.equal(api.validate({...settings,apiBase},defaults).valid,false,apiBase);
  assert.equal(api.validate({...settings,apiBase:'http://localhost:8000/v1'},defaults).ready,true);
});
test('normalize full endpoint and permit provider-specific keys and model IDs',()=>{
  const r=api.validate({...settings,apiBase:'https://example.com/v4/chat/completions/'},defaults);
  assert.equal(r.settings.apiBase,'https://example.com/v4'); assert.equal(r.hints.apiBase,'endpoint');
  for(const apiKey of ['Bearer test','test key','"test"']) assert.equal(api.validate({...settings,apiKey},defaults).valid,false);
  assert.equal(api.validate({...settings,model:'org/model:latest'},defaults).ready,true);
  assert.equal(api.validate({...settings,model:'bad model'},defaults).valid,false);
});
test('HTTP errors mapped without leaking provider text or key',async()=>{
  const original=global.fetch;
  try {
    for(const [status,code] of [[400,'badRequest'],[401,'auth'],[402,'quota'],[403,'forbidden'],[404,'missing'],[429,'limited'],[503,'server']]) {
      global.fetch=async()=>({ok:false,status,json:async()=>({error:'secret'})});
      await assert.rejects(api.request(settings,[]),e=>e.apiCode===code && !e.message.includes('secret'));
    }
    global.fetch=async()=>{throw new TypeError('secret URL');};
    await assert.rejects(api.request(settings,[]),e=>e.apiCode==='network');
    global.fetch=async()=>{throw new DOMException('timeout','TimeoutError');};
    await assert.rejects(api.request(settings,[]),e=>e.apiCode==='timeout');
  } finally {global.fetch=original;}
});
test('429 preserves only a safe Retry-After delay, not provider response text',async()=>{
  const original=global.fetch;
  try {
    global.fetch=async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'7'}),json:async()=>({error:'private'})});
    await assert.rejects(api.request(settings,[]),e=>e.apiCode==='limited'&&e.retryAfterMs===7000&&!e.message.includes('private'));
    global.fetch=async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'invalid'})});
    await assert.rejects(api.request(settings,[]),e=>e.retryAfterMs===null);
  } finally {global.fetch=original;}
});
test('successful HTTP status still requires a nonempty compatible completion',async()=>{
  const original=global.fetch;
  try {
    for(const data of [{},{choices:[{message:{content:''}}]}]) {
      global.fetch=async()=>({ok:true,json:async()=>data});
      await assert.rejects(api.request(settings,[]),e=>e.apiCode==='response');
    }
    global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})});
    assert.equal(await api.request(settings,[]),'OK');
  } finally {global.fetch=original;}
});
function ui() {
  const elements={};
  function element(id) {return elements[id] ||= {value:'',textContent:'',disabled:false,attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(){}};}
  element('setting-api-base').value=settings.apiBase;
  element('setting-api-key').value=settings.apiKey;
  element('setting-model').value=settings.model;
  const c=vm.createContext({ApiSettings:{...api},DEFAULT_API_BASE:defaults.apiBase,DEFAULT_MODEL:defaults.model,_lang:'zh',AbortController,AbortSignal,
    document:{getElementById:element},window:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/api-settings-ui.js'),'utf8'),c);
  return {c,element};
}
test('typing validates locally, disables invalid tests, and language follows the UI',()=>{
  const {c,element}=ui();let requests=0;c.ApiSettings.request=()=>{requests++;};
  element('setting-api-base').value='bad'; c.apiFormChanged();
  assert.equal(requests,0);assert.equal(element('api-test-button').disabled,true);
  assert.equal(element('setting-api-base').attrs['aria-invalid'],'true');
  c._lang='en';c.validateApiForm(); assert.match(element('setting-api-base-feedback').textContent,/Enter a full/);
});
test('changing input cancels old test and cannot display a stale success',async()=>{
  const {c,element}=ui();let resolve,signal;
  c.ApiSettings.request=(_,messages,options)=>{assert.equal(messages.length,1);signal=options.signal;return new Promise(r=>resolve=r);};
  const pending=c.testApiConnection();assert.equal(element('api-test-button').disabled,true);
  element('setting-model').value='new-model';c.apiFormChanged();assert.equal(signal.aborted,true);
  resolve('OK');await pending;assert.equal(c.apiTestStatus,'changed');
  c.ApiSettings.request=async()=> 'OK';await c.testApiConnection();assert.equal(c.apiTestStatus,'success');
});
