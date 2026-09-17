/* Short standalone questions retain dates, places and conditions as one retrieval query. */
(function(root){
  function isQuestion(text){
    text=text.trim();
    return text.length<=2000 && !/\n\s*\n/.test(text) &&
      (/[?？]\s*$/.test(text) || /(?:多少|多久|几天|谁|哪里|哪儿)[。！!]*$/.test(text) || /^(?:请问|哪些|什么|如何|怎么|为何|为什么|是否|能否)/.test(text) || /^(?:what|why|how|when|where|who|which|can|could|does|do|is|are|should)\b/i.test(text));
  }
  function questionCandidate(text){
    const content=text.trim(),start=text.indexOf(content);
    return {type:'sentence',content,start,end:start+content.length,answerQuestion:true};
  }
  root.QuestionRouting={isQuestion,questionCandidate};
  if(typeof module!=='undefined')module.exports=root.QuestionRouting;
})(typeof globalThis!=='undefined'?globalThis:this);
