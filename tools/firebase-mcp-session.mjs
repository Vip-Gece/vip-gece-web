import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=process.env.FIREBASE_MCP_RUNTIME;
if(!runtime)throw new Error('Set FIREBASE_MCP_RUNTIME to the installed firebase-tools directory');
const require=createRequire(path.join(path.resolve(runtime),'package.json'));
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const env=Object.fromEntries(Object.entries(process.env).filter(([,value])=>typeof value==='string'));
env.npm_config_cache=path.join(root,'work/firebase-cli-cache');
const transport=new StdioClientTransport({command:'npx',args:['-y','firebase-tools@latest','mcp','--dir',path.join(root,'apps/customer-android'),'--only','core,remoteconfig'],env,stderr:'pipe'});
const client=new Client({name:'vip-gece-android-setup',version:'1.0.0'});
const timeout=setTimeout(()=>{void transport.close();},120000);
try {
  await client.connect(transport);
  const listed=await client.listTools();
  const name=process.argv[2];
  if(!name)console.log(JSON.stringify(listed.tools,null,2));
  else {
    const tool=listed.tools.find(t=>t.name===name);
    if(!tool)throw new Error('Requested tool was not advertised');
    if(tool.annotations?.readOnlyHint!==true)throw new Error('This setup helper only permits read-only MCP calls');
    console.log(JSON.stringify(await client.callTool({name,arguments:JSON.parse(process.argv[3]||'{}')}),null,2));
  }
} finally {clearTimeout(timeout);await client.close();await transport.close();}
