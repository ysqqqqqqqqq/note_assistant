var apiTestController = null, apiTestVersion = 0, apiTestStatus = '';
function apiDefaults() { return {apiBase:DEFAULT_API_BASE, model:DEFAULT_MODEL}; }
function apiFieldIds() { return {apiBase:'setting-api-base', apiKey:'setting-api-key', model:'setting-model'}; }
function validateApiForm() {
  var fields = apiFieldIds(), values = {};
  Object.keys(fields).forEach(function(k) { values[k] = document.getElementById(fields[k]).value; });
  var result = ApiSettings.validate(values, apiDefaults());
  Object.keys(fields).forEach(function(k) {
    var field = document.getElementById(fields[k]), hint = document.getElementById(fields[k] + '-feedback');
    var code = result.errors[k] || result.hints[k] || 'unverified';
    field.setAttribute('aria-invalid', result.errors[k] ? 'true' : 'false');
    field.classList.toggle('is-valid', !result.errors[k] && !!field.value.trim() && !(k==='apiKey'&&!result.settings.apiKey));
    hint.classList.toggle('is-error', !!result.errors[k]);
    hint.textContent = code === 'unverified' ? '' : ApiSettings.label(code, _lang) + (code === 'baseDefault' ? DEFAULT_API_BASE : code === 'modelDefault' ? DEFAULT_MODEL : '');
    hint.hidden = !hint.textContent;
  });
  var button = document.getElementById('api-test-button');
  button.disabled = !result.ready || !!apiTestController;
  button.textContent = ApiSettings.label(apiTestController ? 'testing' : 'test', _lang);
  document.getElementById('api-test-hint').textContent = ApiSettings.label('testHint', _lang);
  document.getElementById('api-test-status').textContent = apiTestStatus ? ApiSettings.label(apiTestStatus, _lang) : '';
  return result;
}
function apiFormChanged(event) {
  apiTestVersion++;
  if (apiTestController) apiTestController.abort();
  apiTestController = null;
  if (apiTestStatus) apiTestStatus = 'changed';
  validateApiForm();
  if(event && typeof renderVault==='function') { vaultStatus='temporary';renderVault(); }
}
function apiUserError(error) { return ApiSettings.label(ApiSettings.errorCode(error), _lang); }
async function testApiConnection() {
  var result = validateApiForm();
  if (!result.ready || apiTestController) return;
  var version = ++apiTestVersion, controller = new AbortController();
  apiTestController = controller; apiTestStatus = 'testing'; validateApiForm();
  try {
    await ApiSettings.request(result.settings, [{role:'user',content:'Reply with OK only.'}], {
      signal:AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
    });
    if (version === apiTestVersion) apiTestStatus = 'success';
  } catch(e) {
    if (version === apiTestVersion) apiTestStatus = ApiSettings.errorCode(e);
  } finally {
    if (version === apiTestVersion) { apiTestController = null; validateApiForm(); }
  }
}
window.addEventListener('DOMContentLoaded', function() {
  Object.values(apiFieldIds()).forEach(function(id) {
    document.getElementById(id).addEventListener('input', apiFormChanged);
  });
  document.getElementById('api-test-button').addEventListener('click', testApiConnection);
});
