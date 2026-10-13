const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {test}=require('node:test');
const root=path.resolve(__dirname,'../frontend');
const routeSource=fs.readFileSync(path.join(root,'js/recovery-route.js'),'utf8');
function route(href){let destination;vm.runInNewContext(routeSource,{URL,URLSearchParams,window:{location:{href,replace:value=>destination=value}}});return destination;}
test('recovery fallback forwards the full payload before SDK initialization',()=>{
  const payload='#access_token=fake&refresh_token=fake-refresh&type=recovery';
  assert.equal(route('https://dilgtest2.netlify.app/'+payload),'https://dilgtest2.netlify.app/reset-password.html'+payload);
  assert.equal(route('http://localhost:5500/DILGtest2/frontend/index.html'+payload),'http://localhost:5500/DILGtest2/frontend/reset-password.html'+payload);
  assert.equal(route('https://dilgtest2.netlify.app/?token_hash=fake&type=invite'),'https://dilgtest2.netlify.app/reset-password.html?token_hash=fake&type=invite');
});
test('normal sign-in and non-recovery auth payloads are not redirected',()=>{
  for(const href of ['https://dilgtest2.netlify.app/','https://dilgtest2.netlify.app/index.html#','https://dilgtest2.netlify.app/#access_token=fake&type=signup','https://dilgtest2.netlify.app/?type=recovery'])assert.equal(route(href),undefined);
});
test('expired setup links reach the password page for a useful error',()=>{
  assert.match(route('https://dilgtest2.netlify.app/#error=access_denied&error_code=otp_expired'),/reset-password.html#error=/);
});
test('forgot-password redirect keeps the hosted/local frontend directory',async()=>{
  for(const href of ['https://dilgtest2.netlify.app/index.html','http://localhost:5500/DILGtest2/frontend/index.html']){
    let requested;const context=vm.createContext({URL,window:{location:{href}},document:{addEventListener(){}},supabaseClient:{auth:{resetPasswordForEmail:async(email,options)=>{requested={email,options};return {};}}}});
    vm.runInContext(fs.readFileSync(path.join(root,'js/auth.js'),'utf8'),context);
    await vm.runInContext('requestPasswordReset("test@example.invalid")',context);
    assert.equal(requested.email,'test@example.invalid');
    assert.equal(requested.options.redirectTo,new URL('reset-password.html',href).href);
  }
});
test('theme is opt-in and public pages cannot change the internal preference',()=>{
  const source=fs.readFileSync(path.join(root,'js/theme.js'),'utf8');
  for(const scope of ['public','system']){
    let theme;const listeners={};let stored='dark';const html={getAttribute:key=>key==='data-theme-scope'?scope:theme,setAttribute:(key,value)=>theme=value,removeAttribute:()=>theme=undefined};
    const context=vm.createContext({document:{documentElement:html,dispatchEvent(){}},localStorage:{getItem:()=>stored,setItem:(_,value)=>stored=value},window:{addEventListener:(name,callback)=>listeners[name]=callback},CustomEvent:class{}});
    vm.runInContext(source,context);
    assert.equal(theme,scope==='system'?'dark':undefined);
    vm.runInContext('toggleTheme()',context);
    assert.equal(stored,scope==='system'?'light':'dark');
    if(scope==='system'){listeners.storage({key:'bcs-theme',newValue:'dark'});assert.equal(theme,'dark');}else assert.equal(listeners.storage,undefined);
  }
});
test('reset requests use the existing email service while deployment is pending',async()=>{
  let fallback;
  const context=vm.createContext({URL,window:{location:{href:'https://dilgtest2.netlify.app/index.html'}},document:{addEventListener(){}},supabaseClient:{functions:{invoke:async()=>{throw new Error('The undeployed endpoint must not be called');}},auth:{resetPasswordForEmail:async(email,options)=>{fallback={email,options};return {};}}}});
  vm.runInContext(fs.readFileSync(path.join(root,'js/auth.js'),'utf8'),context);
  await vm.runInContext('requestPasswordReset("test@example.invalid")',context);
  assert.equal(fallback.email,'test@example.invalid');
  assert.equal(fallback.options.redirectTo,'https://dilgtest2.netlify.app/reset-password.html');
});
