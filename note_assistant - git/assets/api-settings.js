/* Local validation never sends credentials. Only explicit tests / generation call the provider. */
(function(root) {
  var messages = {
    url:['请输入完整的 http:// 或 https:// 地址，不要粘贴 Markdown 链接。','Enter a full http:// or https:// URL, not a Markdown link.'],
    urlParts:['地址不能包含账号密码、查询参数或 # 片段。','The URL must not contain credentials, query parameters or a fragment.'],
    endpoint:['已识别完整接口路径，保存时会自动移除 /chat/completions。','Full endpoint detected; /chat/completions will be removed when saved.'],
    baseDefault:['留空将使用默认地址：','Empty uses the default URL: '],
    modelDefault:['留空将使用默认模型：','Empty uses the default model: '],
    keyMissing:['尚未填写密钥，无法测试连接或生成批注。','Enter an API key to test the connection or generate annotations.'],
    keyFormat:['密钥不能包含空白、引号或 Bearer 前缀，请只粘贴密钥本身。','Paste only the key, without whitespace, quotes or the Bearer prefix.'],
    model:['模型名称不能包含空格或引号，请填写服务商提供的模型标识。','Use the provider model ID without whitespace or quotes.'],
    unverified:['格式检查通过；有效性需要测试连接确认。','Format looks valid; test the connection to verify access.'],
    test:['测试连接','Test connection'], testing:['正在测试…','Testing…'],
    testHint:['点击后发送一条简短测试消息，可能产生少量费用。不会发送笔记内容。','Sends a short test message and may incur a small charge. Notes are not sent.'],
    success:['连接成功，当前密钥和模型可用。','Connected. The current key and model are available.'],
    changed:['配置已修改，请重新测试连接。','Settings changed. Test the connection again.'],
    invalid:['请先修正设置中的格式错误。','Correct the settings format errors first.'],
    auth:['认证失败（401）：请检查密钥是否正确、过期，以及是否与 API 地址对应。','Authentication failed (401). Check the key, its expiry and the provider URL.'],
    forbidden:['访问被拒绝（403）：请检查账号或模型访问权限。','Access denied (403). Check account and model permissions.'],
    missing:['接口或模型不存在（404）：请检查 API 地址和模型名称。','Endpoint or model not found (404). Check the URL and model ID.'],
    badRequest:['请求参数不被接受：请检查模型名称及接口兼容性。','Request rejected. Check the model ID and API compatibility.'],
    quota:['额度不足或需要付费（402）：请检查账号余额。','Payment or quota required (402). Check the account balance.'],
    limited:['请求受限（429）：可能是频率、并发或额度限制，请检查服务商控制台。','Request limited (429). Check rate, concurrency and quota limits.'],
    server:['服务商暂时异常，请稍后重试。','The provider is temporarily unavailable. Try again later.'],
    network:['连接失败：请检查 API 地址、网络、代理或浏览器跨域限制。','Connection failed. Check the URL, network, proxy or browser CORS restrictions.'],
    timeout:['请求超时，请检查网络或稍后重试。','Request timed out. Check the network or try again later.'],
    cancelled:['请求已取消。','Request cancelled.'],
    response:['接口返回了不兼容或空的回答，请检查 API 地址和模型。','The API returned an incompatible or empty response. Check the URL and model.'],
    failed:['请求失败，请检查连接和 API 设置。','Request failed. Check the connection and API settings.']
  };
  function label(code, lang) { return (messages[code] || messages.failed)[lang === 'en' ? 1 : 0]; }
  function validate(settings, defaults) {
    var base = (settings.apiBase || '').trim(), key = (settings.apiKey || '').trim(), model = (settings.model || '').trim();
    var errors = {}, hints = {};
    if (!base) { base = defaults.apiBase; hints.apiBase = 'baseDefault'; }
    try {
      var u = new URL(base);
      if (!/^https?:$/.test(u.protocol) || /[\s\[\]()]/.test(base)) errors.apiBase = 'url';
      else if (u.username || u.password || u.search || u.hash) errors.apiBase = 'urlParts';
    } catch (_) { errors.apiBase = 'url'; }
    base = base.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(base)) { base = base.replace(/\/chat\/completions$/i, ''); hints.apiBase = 'endpoint'; }
    if (!key) hints.apiKey = 'keyMissing';
    else if (/[\s"'“”‘’]/.test(key) || /^Bearer\b/i.test(key)) errors.apiKey = 'keyFormat';
    if (!model) { model = defaults.model; hints.model = 'modelDefault'; }
    else if (/[\s"'“”‘’]/.test(model)) errors.model = 'model';
    return {valid:!Object.keys(errors).length, ready:!Object.keys(errors).length && !!key, errors:errors, hints:hints,
      settings:{apiBase:base, apiKey:key, model:model}};
  }
  function failure(code, status) { var e = new Error(code); e.apiCode = code; e.status = status; return e; }
  function errorCode(err) {
    if (err.apiCode) return err.apiCode;
    if (err.name === 'TimeoutError') return 'timeout';
    if (err.name === 'AbortError') return 'cancelled';
    if (err instanceof TypeError) return 'network';
    return 'failed';
  }
  function retryAfterMs(response) {
    var raw = response.headers && typeof response.headers.get === 'function' ? response.headers.get('Retry-After') : null;
    if (raw == null || !String(raw).trim()) return null;
    var seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    var date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }
  async function request(settings, messages, options) {
    options = options || {};
    var response;
    try {
      response = await fetch(settings.apiBase.replace(/\/+$/, '') + '/chat/completions', {
        method:'POST', signal:options.signal,
        headers:{'Content-Type':'application/json', Authorization:'Bearer ' + settings.apiKey},
        body:JSON.stringify({model:settings.model, messages:messages, stream:!!options.onDelta, temperature:options.temperature || 0})
      });
    } catch (e) { throw failure(errorCode(e)); }
    if (!response.ok) {
      var codes = {400:'badRequest',401:'auth',402:'quota',403:'forbidden',404:'missing',422:'badRequest',429:'limited'};
      var err = failure(codes[response.status] || (response.status >= 500 ? 'server' : 'failed'), response.status);
      if (response.status === 429) err.retryAfterMs = retryAfterMs(response);
      throw err;
    }
    if (options.onDelta) return readCompletionStream(response, options.onDelta);
    try {
      var data = await response.json(), content = data.choices[0].message.content;
      if (typeof content !== 'string' || !content.trim()) throw failure('response');
      return content;
    } catch(e) { throw failure(e.name === 'TimeoutError' ? 'timeout' : e.name === 'AbortError' ? 'cancelled' : 'response'); }
  }
  root.ApiSettings = {validate:validate, label:label, request:request, errorCode:errorCode, failure:failure};
  if (typeof module !== 'undefined') module.exports = root.ApiSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
