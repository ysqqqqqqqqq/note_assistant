const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ctx=vm.createContext({console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/rag.js'),'utf8'),ctx);
test('unpunctuated long paragraphs are bounded and overlap=0 works',()=>{
  const parts=ctx.ragChunkText('a'.repeat(210),100,0);
  assert.deepEqual(Array.from(parts,p=>p.length),[100,100,10]);
});
test('invalid overlaps terminate with a validation error',()=>{
  assert.throws(()=>ctx.ragChunkText('abc',100,100));
});
test('punctuation boundary preserves all characters at zero overlap',()=>{
  const text='中文句子。'.repeat(100);
  assert.equal(ctx.ragChunkText(text,50,0).join(''),text);
});
