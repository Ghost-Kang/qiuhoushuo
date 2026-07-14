const path=require('path'); const automator=require('miniprogram-automator');
const CLI='/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT=path.resolve(__dirname,'../miniprogram');
(async()=>{
  const mp=await automator.launch({cliPath:CLI,projectPath:PROJECT,timeout:90000});
  console.log('[me] launched');
  try{
    await new Promise(r=>setTimeout(r,6000));
    const me=await mp.reLaunch('/pages/me/index'); await me.waitFor(3000);
    await mp.screenshot({path:'/path/to/qhs-v2-me.png'}); console.log('[me] 📸 me');
    const cs=await mp.reLaunch('/pages/customer-service/index'); await cs.waitFor(1500);
    await mp.screenshot({path:'/path/to/qhs-v2-cs.png'}); console.log('[me] 📸 cs');
  }catch(e){console.log('[me] ERR',e&&e.message);}
  finally{try{await mp.close();}catch(e){} process.exit(0);}
})();
