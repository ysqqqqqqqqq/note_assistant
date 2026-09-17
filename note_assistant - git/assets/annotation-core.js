/* Pure policies shared by annotation UI and regression tests. */
(function(root){
  function hanCount(s){return (String(s).match(/[\u3400-\u9fff]/g)||[]).length;}
  function latinCount(s){return (String(s).match(/[A-Za-z]/g)||[]).length;}
  function languagePreserved(before,after){
    var originalHan=hanCount(before), outputHan=hanCount(after);
    var originalLatin=latinCount(before), outputLatin=latinCount(after);
    if(originalHan>=6 && (outputHan<originalHan*0.45 || outputHan/(outputHan+outputLatin+1)<originalHan/(originalHan+originalLatin+1)*0.55))return false;
    if(originalHan>=6){
      var originalTerms=String(before).match(/[A-Za-z][A-Za-z0-9@+._/-]*(?:\s+[A-Za-z][A-Za-z0-9@+._/-]*)*/g)||[];
      var normalized=String(after).toLowerCase().replace(/\s+/g,' ');
      if(originalTerms.some(function(term){return !normalized.includes(term.toLowerCase().replace(/\s+/g,' '));}))return false;
    }
    if(originalLatin>=20 && originalHan<3 && outputHan>Math.max(5,originalLatin*0.2))return false;
    return true;
  }
  function selectCandidates(extracted,note){
    var terms=[],sentences=[],seen=new Set();
    function add(value,type,target){
      if(typeof value!=='string')return;
      value=value.trim();
      if(!value||seen.has(value))return;
      var start=note.indexOf(value);if(start<0)return;
      seen.add(value);target.push({type:type,content:value,start:start,end:start+value.length,explanation:'',pending:true,status:''});
    }
    function embeddedTerms(v){
      if(typeof v!=='string'||hanCount(v)<2)return 0;
      var phrases=(v.match(/[A-Za-z][A-Za-z0-9@+._/-]*(?:\s+[A-Za-z][A-Za-z0-9@+._/-]*)*/g)||[])
        .filter(function(phrase){return !/^(?:a|an|the|and|or|to|in|on|for|of|is)$/i.test(phrase);});
      phrases.forEach(function(phrase){add(phrase,'term',terms);});
      return phrases.length;
    }
    (Array.isArray(extracted.terms)?extracted.terms:[]).forEach(function(v){
      if(typeof v==='string'&&v.length>24&&/[，。！？；]/.test(v)&&embeddedTerms(v))return;
      add(v,'term',terms);
    });
    (Array.isArray(extracted.sentences)?extracted.sentences:[]).forEach(function(v){
      // Recover embedded Latin technical expressions when the model returned a mixed-language sentence.
      embeddedTerms(v);
      add(v,'sentence',sentences);
    });
    // A sentence containing an extracted term is context, not a second annotation.
    sentences=sentences.filter(function(s){return !terms.some(function(t){return s.start<=t.start&&s.end>=t.end;});});
    return terms.concat(sentences).sort(function(a,b){return a.start-b.start;});
  }
  function validCitations(answer,hits){
    var allowed=new Set((hits||[]).map(function(h){return h.citation;}));
    return String(answer||'').replace(/\[(S\d+)\]/g,function(mark,id){return allowed.has(id)?mark:'';})
      .replace(/[ \t]{2,}/g,' ').trim();
  }
  function decodeEntities(value){
    return String(value||'').replace(/&#(x[0-9a-f]+|\d+);/gi,function(mark,n){
      var code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);
      return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):mark;
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,function(mark,n){
      return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n.toLowerCase()]||mark;
    });
  }
  function readableMath(value){
    function group(text,start){
      if(text[start]!=='{')return null;
      var depth=0;
      for(var i=start;i<text.length;i++){
        if(text[i]==='{')depth++;
        if(text[i]==='}'&&!--depth)return {body:text.slice(start+1,i),end:i+1};
      }
      return null;
    }
    function fractions(text){
      var out='';
      for(var i=0;i<text.length;){
        if(text.startsWith('\\frac',i)){
          var numerator=group(text,i+5);
          var denominator=numerator&&group(text,numerator.end);
          if(denominator){out+='('+fractions(numerator.body)+') / ('+fractions(denominator.body)+')';i=denominator.end;continue;}
        }
        out+=text[i++];
      }
      return out;
    }
    return fractions(value).replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g,'$1')
      .replace(/\\(?:left|right)\b/g,'').replace(/\\cdot\b/g,'·').replace(/\\times\b/g,'×')
      .replace(/\\sum\b/g,'Σ').replace(/\\_/g,'_').replace(/([\wΣ])_\{([^{}]+)\}/g,'$1_$2')
      .replace(/\^\{([^{}]+)\}/g,'^$1');
  }
  function cleanModelText(value){
    return readableMath(decodeEntities(value)).replace(/\\\[\s*/g,'\n').replace(/\s*\\\]/g,'\n')
      .replace(/\\\(|\\\)/g,'').replace(/\*\*([^*\n]+)\*\*/g,'$1').replace(/^[ \t]*\*\*(?=\S)/gm,'')
      .replace(/^[ \t]*#{1,6}[ \t]+/gm,'').replace(/[ \t]{2,}/g,' ')
      .replace(/\n{3,}/g,'\n\n').trim();
  }
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function renderExplanationHtml(value,hits){
    var answer=validCitations(cleanModelText(value),hits);
    if(!hits||!hits.length)return escapeHtml(answer);
    var out='',cursor=0,match,pattern=/([^。！？.!?\n]+[。！？.!?]?\s*(?:\[S\d+\])+)/g;
    while((match=pattern.exec(answer))){out+=escapeHtml(answer.slice(cursor,match.index));out+='<strong>'+escapeHtml(match[0])+'</strong>';cursor=pattern.lastIndex;}
    return out+escapeHtml(answer.slice(cursor));
  }
  root.AnnotationCore={languagePreserved:languagePreserved,selectCandidates:selectCandidates,validCitations:validCitations,
    cleanModelText:cleanModelText,renderExplanationHtml:renderExplanationHtml};
  if(typeof module!=='undefined')module.exports=root.AnnotationCore;
})(typeof globalThis!=='undefined'?globalThis:this);
