/** @jest-environment node */
import { execFileSync } from 'node:child_process';

it('guards real SDK generation and streaming and serializes multiple images through Ollama', () => {
  // A separate ESM process exercises the installed SDK/provider rather than Jest mocks.
  const output = execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
      import assert from 'node:assert/strict';
      import { generateText, streamText } from 'ai';
      import { resolveChatModel } from './lib/ai/ollama.ts';
      process.env.OLLAMA_BASE_URL = 'http://ollama.test';
      delete process.env.AI_MODEL_CAPABILITY_OVERRIDES;
      let inference = 0;
      const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64');
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/tags')) return Response.json({models:[{name:'vision:test'},{name:'text:test'}]});
        if (String(url).endsWith('/show')) return Response.json({capabilities: JSON.parse(init.body).model === 'vision:test' ? ['completion','vision'] : ['completion']});
        inference++;
        const body = JSON.parse(init.body);
        assert.equal(body.messages[0].content, 'Lees beide foto’s');
        assert.deepEqual(body.messages[0].images, [image.toString('base64'), image.toString('base64')]);
        const response = { model:body.model, created_at:new Date().toISOString(), message:{role:'assistant',content:'synthetic success'}, done:true, done_reason:'stop', prompt_eval_count:10, eval_count:2 };
        return body.stream ? new Response(JSON.stringify(response)+'\\n',{headers:{'content-type':'application/x-ndjson'}}) : Response.json(response);
      };
      const messages = [{role:'user',content:[{type:'text',text:'Lees beide foto’s'}, ...[image,image].map(data=>({type:'file',mediaType:'image/png',data}))]}];
      const text = await resolveChatModel({provider:'ollama',modelId:'text:test'});
      await assert.rejects(generateText({model:text,messages,maxRetries:0}),{code:'MODEL_NOT_SUPPORTED'});
      let streamError;
      await assert.rejects(streamText({model:text,messages,maxRetries:0,onError:({error})=>{streamError=error}}).text);
      assert.equal(streamError.code, 'MODEL_NOT_SUPPORTED');
      assert.equal(inference,0);
      const vision = await resolveChatModel({provider:'ollama',modelId:'vision:test'});
      assert.equal((await generateText({model:vision,messages,maxRetries:0})).text,'synthetic success');
      assert.equal(await streamText({model:vision,messages,maxRetries:0}).text,'synthetic success');
      assert.equal(inference,2);
      process.stdout.write('PASS');
    `,
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 }
  );
  expect(output).toBe('PASS');
});
