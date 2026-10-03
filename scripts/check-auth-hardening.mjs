import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createHash, createHmac, webcrypto } from 'node:crypto'
import { transformSync } from 'esbuild'

const source = readFileSync('supabase/functions/auth-otp/index.ts','utf8')
const { code } = transformSync(source,{loader:'ts',format:'cjs',target:'es2022'})
const secret = 'local-test-secret-not-a-real-credential'
function harness(queue = [], rpc = {}, options = {}) {
  let handler
  const calls = []
  const db = {
    rpc: async (name,args) => { calls.push({rpc:name,args}); return rpc[name] || {data:null} },
    from(table) {
      const call = {table,steps:[]}; calls.push(call)
      const chain = new Proxy({}, {get(_target,method) {
        if(method === 'then') return (resolve,reject) => {
          const response = queue.shift()
          if(!response) return reject(new Error(`Unexpected query to ${table}`))
          resolve(response)
        }
        return (...args) => { call.steps.push([method,...args]); return chain }
      }})
      return chain
    },
  }
  const sandbox = {
    exports:{}, TextEncoder,TextDecoder,Uint8Array,Uint32Array,Response,Request,Date,atob,btoa,
    crypto:webcrypto, console,
    Deno:{env:{get:key=>({SUPABASE_SERVICE_ROLE_KEY:secret,AUTH_OTP_SECRET:secret,
      SESSION_JWT_SECRET:secret,SUPABASE_URL:'https://example.test',GOOGLE_CLIENT_ID:'fixture-client',
      RESEND_API_KEY:options.emailConfigured?'fixture-only':undefined})[key]}},
    fetch:async()=>{
      if(options.emailConfigured)return new Response(JSON.stringify({id:'fixture'}),{status:200})
      throw new Error('Tests must not send network requests')
    },
    require(name) {
      if(name.includes('/http/server'))return {serve:fn=>{handler=fn}}
      if(name.includes('supabase-js'))return {createClient:()=>db}
      if(name.includes('djwt'))return {create:async(_header,payload)=>JSON.stringify(payload),getNumericDate:seconds=>Math.floor(Date.now()/1000)+seconds}
      if(name==='./google.ts')return {verifyGoogleIdToken:async()=>({email:'resident@example.test',name:'Resident'})}
      throw new Error(`Unexpected import ${name}`)
    },
  }
  vm.runInNewContext(code,sandbox)
  return {calls,async request(body){const r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()}}}
}
test('password throttling returns 429, not a session or internal error',async()=>{
  const h=harness([], {app_login:{error:{code:'PT429',message:'Too many sign-in attempts.'}}})
  const r=await h.request({action:'login',identifier:'fixture',password:'bad'})
  assert.equal(r.status,429); assert.equal(r.body.token,undefined)
})
test('new sessions carry the database revocation version',async()=>{
  const h=harness([{data:{id:3,role:'resident',status:'active',session_version:7,mfa_enabled:false}}],{app_login:{data:{id:3}}})
  const r=await h.request({action:'login',identifier:'fixture',password:'fixture-password'})
  assert.equal(r.status,200); assert.equal(JSON.parse(r.body.token).session_version,7)
})
test('Google cannot bypass privileged MFA or suspended accounts',async()=>{
  for(const account of [{role:'admin',status:'active'},{role:'resident',status:'suspended'},
    {role:'resident',status:'active',mfa_enabled:true}]) {
    const h=harness([{data:account}]); const r=await h.request({action:'google',credential:'fixture'})
    assert.equal(r.status,403); assert.equal(r.body.token,undefined)
  }
})
test('Google completion race cannot sign into an existing privileged account',async()=>{
  const payload=[Date.now()+60000,Buffer.from('resident@example.test').toString('base64url'),Buffer.from('Resident').toString('base64url')].join('.')
  const ticket=payload+'.'+createHmac('sha256',secret).update(payload).digest('hex')
  const h=harness([{data:{value:{allowRegistration:true}}},{data:{role:'admin',status:'active',email_verified_at:'today'}}])
  const r=await h.request({action:'google-complete',ticket,barangay:'A'})
  assert.equal(r.status,403); assert.equal(r.body.token,undefined)
})
test('an MFA code alone cannot start a session or request another code',async()=>{
  const h=harness()
  const verify=await h.request({action:'verify-login',email:'admin@example.test',code:'123456'})
  const resend=await h.request({action:'resend',email:'admin@example.test',purpose:'login_mfa'})
  assert.equal(verify.status,403)
  assert.equal(resend.status,403)
  assert.equal(h.calls.length,0)
})
test('MFA challenge binds the code to the password-checked account',async()=>{
  const payload=`${Date.now()+60000}.3.${'a'.repeat(24)}`
  const mfaTicket=payload+'.'+createHmac('sha256',secret).update(payload).digest('hex')
  const h=harness([{data:{id:3,email:'resident@example.test',status:'active',mfa_enabled:true}}],
    {app_consume_auth_code:{data:{ok:true,accountId:4,channel:'email'}}})
  const r=await h.request({action:'verify-login',email:'resident@example.test',code:'123456',mfaTicket})
  assert.equal(r.status,403)
  assert.equal(r.body.token,undefined)
})
test('password then MFA code starts a session with the signed ticket',async()=>{
  const account={id:3,email:'resident@example.test',full_name:'Resident',role:'resident',
    status:'active',mfa_enabled:true,session_version:0}
  const h=harness([{data:account},{data:[]},{data:null},{data:{id:11}},
    {data:null},{data:account},{data:account},{data:null}],{
    app_login:{data:{id:3}},
    app_consume_auth_code:{data:{ok:true,accountId:3,channel:'email'}},
  },{emailConfigured:true})
  const first=await h.request({action:'login',identifier:'resident@example.test',password:'fixture-password'})
  assert.equal(first.status,200,JSON.stringify(first.body))
  assert.equal(first.body.mfaRequired,true)
  assert.match(first.body.mfaTicket,/^\d+\.3\.[a-f0-9]{24}\.[a-f0-9]{64}$/)
  const second=await h.request({action:'verify-login',email:account.email,code:'123456',mfaTicket:first.body.mfaTicket})
  assert.equal(second.status,200,JSON.stringify(second.body))
  assert.equal(JSON.parse(second.body.token).account_id,3)
})
test('verification and recovery bind to the atomically consumed account and status',async()=>{
  for(const action of ['verify-email','confirm-reset']) {
    const h=harness([{data:null,error:{message:'Account not eligible'}}],{app_consume_auth_code:{data:{ok:true,accountId:3,channel:'email'}}})
    const r=await h.request({action,email:'resident@example.test',code:'123456',password:'replacement-password'})
    assert.notEqual(r.status,200); assert.equal(r.body.token,undefined)
    const update=h.calls.find(c=>c.table==='accounts')
    assert(update.steps.some(([method,key,value])=>method==='eq'&&key==='id'&&value===3))
    assert(update.steps.some(([method,key,value])=>method==='eq'&&key==='status'&&value===(action==='verify-email'?'pending':'active')))
  }
})
test('delivery failure leaves registration pending even with legacy fallback enabled',async()=>{
  const h=harness([{data:{value:{allowRegistration:true,verificationFallback:true}}},{data:null},
    {data:{id:3}},{data:[]},{data:null},{data:{id:1}},{data:null}])
  const {body:{challenge}}=await h.request({action:'challenge'})
  const payload=challenge.split('.').slice(0,2).join('.')
  let solution=0
  while(!createHash('sha256').update(`${payload}.${solution}`).digest('hex').startsWith('0000'))solution++
  const r=await h.request({action:'register',challenge,solution:String(solution),elapsedMs:10000,
    email:'resident@example.test',password:'fixture-password',fullName:'Resident',barangay:'A'})
  assert.equal(r.status,503,JSON.stringify(r.body)); assert.equal(r.body.token,undefined)
  assert.equal(h.calls.filter(c=>c.table==='accounts'&&c.steps.some(s=>s[0]==='update')).length,0)
})
