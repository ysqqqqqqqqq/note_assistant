/* OpenAI-compatible SSE reader. Incremental UTF-8 decoding, no HTML injection. */
(function(root) {
  async function readCompletionStream(response, onDelta) {
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      var json = await response.json();
      var message = json.choices && json.choices[0] && json.choices[0].message;
      if (!message || typeof message.content !== 'string') throw new Error('Invalid completion response');
      onDelta(message.content);
      return message.content;
    }
    if (!response.body) throw new Error('Streaming response unavailable');
    var reader = response.body.getReader(), decoder = new TextDecoder();
    var buffer = '', output = '', done = false, finished = false;
    function event(block) {
      var data = block.split('\n').filter(function(line){return line.startsWith('data:');})
        .map(function(line){return line.slice(5).replace(/^ /,'');}).join('\n');
      if (!data) return;
      if (data.trim() === '[DONE]') {done = true; return;}
      var packet = JSON.parse(data);
      if (packet.error) throw new Error('Stream provider error');
      var choice = packet.choices && packet.choices[0];
      if (!choice) return;
      var content = choice.delta && choice.delta.content;
      if (typeof content === 'string' && content) {output += content; onDelta(content);}
      if (choice.finish_reason === 'length') throw new Error('Output limit reached');
      if (choice.finish_reason === 'content_filter') throw new Error('Output filtered');
      if (choice.finish_reason) finished = true;
    }
    try {
      while (!done) {
        var part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), {stream:!part.done});
        // Normalize after buffering, so CRLF split across network chunks is safe.
        buffer = buffer.replace(/\r\n/g,'\n');
        var boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          event(buffer.slice(0,boundary)); buffer = buffer.slice(boundary+2);
          if (done) break;
        }
        if (part.done) {if (buffer.trim() && !done) event(buffer); break;}
      }
      if (!done && !finished) throw new Error('Stream interrupted before completion');
      if (!output.trim()) throw new Error('Empty completion');
      return output;
    } finally { await reader.cancel().catch(function(){}); reader.releaseLock(); }
  }
  root.readCompletionStream = readCompletionStream;
  if (typeof module !== 'undefined') module.exports = {readCompletionStream};
})(typeof globalThis !== 'undefined' ? globalThis : this);
