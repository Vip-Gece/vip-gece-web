const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(process.argv[2]||'.');
const files=[];
function visit(directory) {
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()) visit(file);
    else if(entry.isFile() && /\.(?:m?js|cjs)$/.test(entry.name)) files.push(file);
  }
}
visit(path.join(root,'src'));
visit(path.join(root,'public'));
for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
  if(entry.isFile() && /\.(?:m?js|cjs)$/.test(entry.name)) files.push(path.join(root,entry.name));
}
const results=files.sort().map(file=>{
  const source=fs.readFileSync(file,'utf8');
  const row={file:path.relative(root,file),sha256:crypto.createHash('sha256').update(source).digest('hex'),ok:true};
  try {new vm.Script(source,{filename:file});}
  catch {
    try {new vm.SourceTextModule(source,{identifier:file});}
    catch(error) {row.ok=false;row.error=error.message;}
  }
  return row;
});
const report={at:new Date().toISOString(),root,ok:results.every(r=>r.ok),checked:results.length,results};
const output=process.argv[3];
if(output) fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({ok:report.ok,checked:report.checked,failures:results.filter(r=>!r.ok)},null,2));
process.exitCode=report.ok?0:1;
