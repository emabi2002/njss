import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const ts=(()=>{try{return require('typescript')}catch{return require(process.execPath.replace(/\/bin\/node$/, '/lib/node_modules/typescript'))}})()
const source=readFileSync(new URL('../src/server-auth.ts',import.meta.url),'utf8')
const transpiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}})
assert.equal(transpiled.diagnostics?.length||0,0)
const exports={}
new Function('require','exports',transpiled.outputText)((name)=>({}),exports)
const {safeUuid,validateFile,isValidFileSignature}=exports
const valid='7ce49d05-1567-44b7-a5d9-c8f6b9e5ef09'
test('document IDs must be valid random UUIDs',()=>{
 assert.ok(safeUuid(valid))
 assert.equal(safeUuid('../private/path'),false)
 assert.equal(safeUuid('not-a-uuid'),false)
})
test('file contents must match PDF signature',()=>{
 assert.equal(isValidFileSignature(Uint8Array.from(Buffer.from('%PDF-1.7')),'application/pdf'),true)
 assert.equal(isValidFileSignature(Uint8Array.from(Buffer.from('not a pdf')),'application/pdf'),false)
})
test('file contents must match JPEG and PNG magic bytes',()=>{
 assert.equal(isValidFileSignature(Uint8Array.from([137,80,78,71,13,10,26,10]),'image/png'),true)
 assert.equal(isValidFileSignature(Uint8Array.from([255,216,255,224]),'image/jpeg'),true)
 assert.equal(isValidFileSignature(Uint8Array.from([255,216,255,224]),'image/png'),false)
})
test('file size and MIME restrictions block dangerous uploads',()=>{
 assert.equal(validateFile({size:1,type:'text/html'}), 'Unsupported file type')
 assert.equal(validateFile({size:9*1024*1024,type:'application/pdf'}),'File size exceeds allowed limit')
 assert.equal(validateFile({size:4*1024*1024,type:'image/png'},true),'File size exceeds allowed limit')
 assert.equal(validateFile({size:512,type:'image/png'}),null)
})
