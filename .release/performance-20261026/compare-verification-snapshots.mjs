import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
const expected=JSON.parse(await readFile(new URL('verification-expected.json',import.meta.url),'utf8'));
const unwrap=value=>Array.isArray(value)?unwrap(value[0]):value?.verification??value;
if(!process.argv[2]||!process.argv[3])throw new Error('Usage: node compare-verification-snapshots.mjs before.json after.json [result.json]');
const beforeBytes=await readFile(process.argv[2]),afterBytes=await readFile(process.argv[3]);
const before=unwrap(JSON.parse(beforeBytes)),after=unwrap(JSON.parse(afterBytes));
const failures=[];const checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass,...(detail?{detail}:{} )});if(!pass)failures.push(name);};
const get=(value,key)=>key.split('.').reduce((row,part)=>row?.[part],value);
for(const [phase,snapshot] of [['before',before],['after',after]]){
 check(phase+'.identity',snapshot?.format===expected.format&&snapshot.phase===phase&&snapshot.sourceCommit===expected.sourceCommit);
 check(phase+'.readOnly',snapshot?.environment?.transactionReadOnly==='on'&&snapshot?.environment?.isolation==='repeatable read');
 for(const name of expected.expectedChecks[phase])check(phase+'.checks.'+name,snapshot?.checks?.[name]===true);
 for(const key of expected.stateRules.alwaysZero)check(phase+'.'+key,get(snapshot,key)===0);
}
for(const key of expected.stateRules.afterZero)check('after.'+key,get(after,key)===0);
for(const name of expected.preservation.tables){
 const a=before?.preservation?.find(row=>row.name===name),b=after?.preservation?.find(row=>row.name===name);
 check('preservation.'+name,Boolean(a?.present&&b?.present&&Number.isSafeInteger(a.row_count)&&Number.isSafeInteger(b.row_count)&&a.row_count===b.row_count&&a.row_digest_sha256===b.row_digest_sha256),{beforeCount:a?.row_count??null,afterCount:b?.row_count??null,digestEqual:Boolean(a?.row_digest_sha256&&a.row_digest_sha256===b?.row_digest_sha256)});
}
check('preservation.otherSchemaMarkers',before?.otherSchemaMarkersSha256===after?.otherSchemaMarkersSha256);
check('preservation.cronConfiguration',Boolean(before?.cron?.available&&after?.cron?.available&&before.cron.configurationSha256===after.cron.configurationSha256));
check('preservation.otherMigrationHistory',Boolean(before?.history?.available&&after?.history?.available&&before.history.otherRowCount===after.history.otherRowCount&&before.history.otherRowsSha256===after.history.otherRowsSha256));
for(const a of before?.unchangedDependencies??[]){const b=after?.unchangedDependencies?.find(row=>row.signature===a.signature);check('preservation.dependency.'+a.signature,Boolean(a.present&&b?.present&&a.body_sha256===b.body_sha256&&a.security_definer===b.security_definer&&JSON.stringify(a.config)===JSON.stringify(b.config)));}
const result={generatedAt:new Date().toISOString(),format:expected.format,sourceCommit:expected.sourceCommit,inputHashes:{beforeSha256:createHash('sha256').update(beforeBytes).digest('hex'),afterSha256:createHash('sha256').update(afterBytes).digest('hex')},passed:checks.filter(row=>row.pass).length,failed:failures.length,failures,checks,
 interpretation:'A failed preservation comparison requires investigation/attribution; this comparator never treats concurrent application/cron writes as automatically acceptable. Successful database checks alone do not prove UI/API/deployment or notification delivery.',
 boundaries:['Reads two already exported local JSON snapshots only; no database/network/source access or mutation','No secret values, row bodies or error text are printed']};
const target=process.argv[4]??path.join(base,'verification-comparison.json');await writeFile(target,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed,failures}));if(result.failed)process.exitCode=1;
