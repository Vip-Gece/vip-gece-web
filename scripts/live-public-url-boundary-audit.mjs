import {writeFile} from 'node:fs/promises';
const base='https://vip-gece.site';
const checks=[];
const transportRetries=[];
async function request(url) {
  for(let attempt=1;attempt<=2;attempt++) {
    try {
      return await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
    } catch(error) {
      transportRetries.push({url,attempt,error:error.message});
      if(attempt===2) return {status:0,headers:new Headers(),text:async()=>'',arrayBuffer:async()=>new ArrayBuffer(0)};
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
}
const cases=[
  ['/profil/ISTANBUL-KARDELEN',301,'/profil/istanbul-kardelen'],
  ['/profil/istanbul-kardelen/',301,'/profil/istanbul-kardelen'],
  ['/ISTANBUL-ESCORT',301,'/istanbul-escort'], ['/istanbul-escort/',301,'/istanbul-escort'],
  ['/ILANLAR',301,'/ilanlar'], ['/ilanlar/',301,'/ilanlar'], ['/INDEX.HTML/',301,'/'],
  ['/detay.html?slug=istanbul-kardelen',301,'/profil/istanbul-kardelen'],
  ['/profil/not-an-existing-profile-20260914',404], ['/not-an-existing-page-20260914',404],
  ['/vg-panel-91x',404], ['/admin.js',404], ['/api/admin/mobile/profiles',404],
  ['/musteri',404], ['/api/v1/customer/profile',404], ['/customer-panel.html',404],
  ['/src/app.js',404], ['/.env',404], ['/.git/config',404], ['/package.json',404],
  ['/api/ready',200]
];
for(const slug of ['anal','otel','yabanci','gfe','kumral','balik-etli','genc']) cases.push(['/'+slug+'-escort',200,null,true]);
for(const [path,status,location,noindex] of cases) {
  const response=await request(base+path);
  const text=await response.text();
  const actualLocation=response.headers.get('location');
  const row={path,status:response.status,location:actualLocation,cache:response.headers.get('cf-cache-status'),age:response.headers.get('age'),robots:text.match(/name="robots" content="([^"]*)"/)?.[1]||null};
  row.ok=response.status===status && (!location || new URL(actualLocation||'/invalid',base).pathname===location) && (!noindex || /\bnoindex\b/.test(row.robots||''));
  checks.push(row);
  console.error(`${path}: ${row.status} ${row.ok ? 'ok' : 'FAIL'}`);
}
for(const url of ['http://vip-gece.site/','https://www.vip-gece.site/']) {
  const response=await request(url);
  await response.arrayBuffer();
  checks.push({url,status:response.status,location:response.headers.get('location'),ok:[301,308].includes(response.status)&&response.headers.get('location')===base+'/'});
}
const home=await request(base);
await home.arrayBuffer();
const hsts=home.headers.get('strict-transport-security');
checks.push({url:base,check:'HSTS',value:hsts,ok:!!hsts&&/max-age=[1-9]\d*/.test(hsts)});
const report={at:new Date().toISOString(),ok:checks.every(c=>c.ok),transportRetries,checks};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(output) await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exitCode=report.ok?0:1;
