'use strict';
const $=id=>document.getElementById(id),P=LeafProtocol;
const pageQuery=globalThis.location?.search||'';
const burstRequested=/(?:^|[?&])burst=1(?:&|$)/.test(pageQuery);
let burstDisabled=false;
const phoneSetup=/(?:^|[?&])setup=1(?:&|$)/.test(pageQuery);
const qrCode=/(?:^|[?&])device=([^&]*)/.exec(pageQuery)?.[1]?.toUpperCase();
const preferNativeE6=/(?:^|[?&])format=e6n4(?:&|$)/.test(pageQuery);
const nativeTrial=phoneSetup&&preferNativeE6;
if(phoneSetup)
  document.body?.classList.add('phone-setup');
if(phoneSetup||qrCode!==undefined){
  $('connectionHint').textContent=qrCode&&/^[0-9A-F]{4}$/.test(qrCode)
    ?`点连接并选择 HueLeaf Lite-${qrCode}。发送时保持此页在前台，直到屏幕刷新完成。`
    :'开启彩叶传图模式，点连接并选择你的设备。选图后保持此页在前台，直到屏幕刷新完成。';
}
let committed=false;
const pendingStorageKey='hueleaf.pendingCommit.v1';
let pendingCommit=readPendingCommit();
let image=null,mode='image',device=null,chars=null,cap=null;
let busy=false,canceled=false,connecting=false,rendered=null;
let painting=null,stroke=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function message(t){$('status').textContent=t;}
function dimensions(){
  const format=$('format').value,known=P.FORMATS[format];
  if(!known)throw Error('未知屏幕模式');
  return {w:cap?.w||known.w,h:cap?.h||known.h,format};
}
function supported(format){
  return Object.hasOwn(P.FORMATS,format)&&(!cap||cap.formats.some(f=>f.format===format));
}
function syncFormats(){
  for(const option of $('format').options||[]){
    option.disabled=!supported(option.value);
    option.hidden=option.disabled;
  }
  const formatLabel=$('format').closest?.('label');
  if(formatLabel)formatLabel.hidden=phoneSetup&&cap?.format==='mono1';
}
function render(){
  const d=dimensions(),canvas=$('canvas');canvas.width=d.w;canvas.height=d.h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  let q;
  if(mode==='chart'&&['e6f6','e6q9','e6s8','e6f8'].includes(d.format)){
    q=LeafImage.chart(d.w,d.h,d.format);
  }else{
    if(mode==='chart')mode='image';
    ctx.fillStyle='#fff';ctx.fillRect(0,0,d.w,d.h);
    if(mode==='paint'){
      if(!painting||painting.w!==d.w||painting.h!==d.h)painting=LeafPaint.create(d.w,d.h);
    }else if(mode==='text'){
      ctx.fillStyle='#111';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font=`${Math.round(d.w/13)}px sans-serif`;
      const lines=$('text').value.replaceAll(String.fromCharCode(92)+'n',String.fromCharCode(10)).split(String.fromCharCode(10));
      lines.forEach((line,i)=>ctx.fillText(line,d.w/2,d.h/2+(i-(lines.length-1)/2)*d.w/9,d.w*.9));
    }else if(image){
      const s=Math.max(d.w/image.width,d.h/image.height)*Number($('zoom').value);
      const iw=image.width*s,ih=image.height*s;
      ctx.drawImage(image,(d.w-iw)/2-Number($('panX').value)*(iw-d.w)/2,
        (d.h-ih)/2-Number($('panY').value)*(ih-d.h)/2,iw,ih);
    }else{
      ctx.fillStyle='#315c40';ctx.textAlign='center';ctx.font=`${Math.round(d.w/9)}px sans-serif`;
      ctx.fillText('HueLeaf',d.w/2,d.h*.47);ctx.font=`${Math.round(d.w/22)}px sans-serif`;
      ctx.fillText('把喜欢的画面留在身边',d.w/2,d.h*.6);
    }
    q=LeafImage.quantize(mode==='paint'?painting.rgba:ctx.getImageData(0,0,d.w,d.h).data,d.w,d.h,d.format,
      $('dither').checked,Number($('brightness').value),Number($('contrast').value));
  }
  rendered=q.bytes;ctx.putImageData(new ImageData(q.preview,d.w,d.h),0,0);
  $('size').textContent=`${d.w} × ${d.h} · ${P.FORMATS[d.format].label}`;
  globalThis.LeafRefreshSummary?.(d.format, chars ? (device?.name || '已连接') : '未连接');
  $('paintTools').hidden=mode!=='paint';
  canvas.classList.toggle('painting',mode==='paint');
  $('paletteHint').textContent=d.format==='e6f8'
    ?'256快刷使用 3.7 寸工程的参考色表；与精选256慢刷色表不同，首次准备较久。'
    :d.format==='e6s8'
    ?'精选256色使用3.7寸工程的原生底色与两遍阴影配方；参考色表尚未针对本屏校准。'
    :d.format==='e6q9'
    ?'512色正常刷新需要完整刷新过程。参考色表尚未针对当前屏幕校准。'
    :d.format==='e6f6'?'64色快刷会保留下一次刷新所需的前态；首次使用或切换模式后需要准备。':'预览用于构图与量化参考，实际墨水屏颜色会有所不同。';
  $('zoomValue').value=Number($('zoom').value).toFixed(2)+'×';
  lock();
}
function lock(){
  $('send').disabled=busy||connecting||!chars;
  $('send').textContent=samePendingDevice()?'查询刷新结果':'传到彩叶 ↗';
  $('connect').disabled=busy||connecting||!!chars;
  $('disconnect').disabled=!device;
  $('format').disabled=busy||connecting||(phoneSetup&&cap?.format==='mono1');
  $('cancel').hidden=!busy;
  for(const id of ['file','text','imageMode','textMode','paintMode','paintColour','paintSize','paintErase','paintClear','reset'])$(id).disabled=busy||connecting;
  for(const id of ['zoom','panX','panY','brightness','contrast','dither'])
    $(id).disabled=busy||connecting||mode==='chart';
  $('chart64').disabled=busy||connecting||!supported('e6f6');
  $('chart512Qual').disabled=busy||connecting||!supported('e6q9');
  $('chart256').disabled=busy||connecting||!supported('e6s8');
  $('chartFast256').disabled=busy||connecting||!supported('e6f8');
}
async function operation(run,selected=device,timeoutMs=12000,timeoutMessage='蓝牙操作超时，已断开连接；请重新连接后确认设备状态'){
  let timer;
  try{return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      if(selected?.gatt.connected)selected.gatt.disconnect();
      reject(Error(timeoutMessage));
    },timeoutMs);
  })]);}finally{clearTimeout(timer);}
}
async function write(c,b,selected=device,timeoutMs,timeoutMessage){
  return operation(()=>c.writeValueWithResponse?c.writeValueWithResponse(b):c.writeValue(b),selected,timeoutMs,timeoutMessage);
}
async function uploadData(link,selected,bytes,chunk,burst,check,state){
  const batchSize=burst?4:1;
  for(let off=0;off<bytes.length;){
    const batchStart=off;
    const end=Math.min(bytes.length,off+batchSize*chunk);
    while(off<end){
      check();
      const next=Math.min(end,off+chunk);
      const packet=P.packet(off,bytes.subarray(off,next));
      if(burst)await operation(()=>link.data.writeValueWithoutResponse(packet),selected);
      else await write(link.data,packet,selected);
      off=next;
    }
    if(burst){
      let confirmed=false;
      for(let poll=0;poll<5;poll++){
        const s=await state();
        if(s.state!==1||s.received<batchStart||s.received>end)throw Error('批次接收位置异常');
        if(s.received===end){confirmed=true;break;}
        await sleep(100);
      }
      if(!confirmed)throw Error('设备没有确认完整批次');
    }
    $('progress').value=off/bytes.length*100;
    message(`正在传输 ${off} / ${bytes.length} 字节`);
  }
}
function samePendingDevice(){
  return !!(device&&pendingCommit&&(pendingCommit.device===device||
    (device.id&&pendingCommit.deviceId===device.id)));
}
function trialReceipt({tx,crc,bytes}){
  return nativeTrial&&bytes===28800&&Number.isInteger(crc)&&crc>=0&&crc<=0xffffffff
    ?` 原生六色 · ${bytes} 字节 · 事务 ${tx} · CRC ${crc.toString(16).padStart(8,'0')}。`:'';
}
function readPendingCommit(){
  try{
    const entry=JSON.parse(globalThis.sessionStorage?.getItem(pendingStorageKey)||'null');
    if(entry&&typeof entry.deviceId==='string'&&entry.deviceId&&
      Number.isInteger(entry.tx)&&entry.tx>0&&entry.tx<=0xffffffff)return entry;
  }catch{}
  return null;
}
function setPendingCommit(entry){
  pendingCommit=entry;
  try{
    if(entry?.deviceId)globalThis.sessionStorage?.setItem(pendingStorageKey,
      JSON.stringify({deviceId:entry.deviceId,tx:entry.tx,bytes:entry.bytes,crc:entry.crc}));
    else globalThis.sessionStorage?.removeItem(pendingStorageKey);
  }catch{}
}
async function recoverCommit(){
  const selected=device, pending=pendingCommit;
  if(!samePendingDevice())return;
  const result=P.status(await operation(()=>chars.status.readValue(),selected));
  if(device!==selected||!selected.gatt.connected)return;
  if(result.tx!==pending.tx||result.state<2){
    setPendingCommit(null);
    message('设备未保留上次刷新的结果。可再次点击发送。');
  }else if(result.state===4){
    if(result.error!==0||(pending.bytes!==undefined&&result.received!==pending.bytes))
      throw Error('设备回报的完成状态与上次发送不符');
    setPendingCommit(null);
    $('progress').value=100;
    message('已确认上次屏幕刷新完成。'+trialReceipt(pending));
  }else if(result.state===5){
    setPendingCommit(null);
    message(`上次刷新失败，设备错误 ${result.error}。可再次点击发送。`);
  }else{
    message('上次图片正在刷新。稍后点击「查询刷新结果」。');
  }
}
function detached(){
  device=null;chars=null;cap=null;canceled=true;
  $('deviceName').textContent='连接已断开';message('请重新连接；未完成的图片需要重传。');
  syncFormats();render();
}
async function discoverCharacteristics(selected){
  const keys=['info','control','data','status'];
  for(let attempt=0;attempt<2;attempt++){
    try{
      const server=await operation(()=>selected.gatt.connect(),selected);
      const service=await operation(()=>server.getPrimaryService(P.UUID.service),selected);
      let list=[];
      try{
        for(const key of keys)list.push(await operation(()=>service.getCharacteristic(P.UUID[key]),selected));
      }catch(e){
        if(!selected.gatt.connected||e.name!=='NotFoundError'||!service.getCharacteristics)throw e;
        const all=await operation(()=>service.getCharacteristics(),selected);
        list=keys.map(key=>all.find(c=>c.uuid.toLowerCase()===P.UUID[key]));
        if(list.some(c=>!c))throw e;
      }
      const link=Object.fromEntries(keys.map((key,i)=>[key,list[i]]));
      const capability=P.info(await operation(()=>link.info.readValue(),selected));
      if(!selected.gatt.connected)throw Error('GATT disconnected during discovery');
      return {link,capability};
    }catch(e){
      const dropped=!selected.gatt.connected &&
        (e.name==='NetworkError'||/GATT.*disconnect/i.test(e.message));
      const missing=e.name==='NotFoundError';
      if(!dropped&&!missing)throw e;
      if(attempt)throw Error(missing
        ?`已连到设备，但没有读全传图特征。请关闭本页，在系统蓝牙设置中仅移除「${selected.name||'HueLeaf Lite'}」并重新配对，再打开网页。`
        :'设备在读取蓝牙服务前断开。请关闭其他正在连接彩叶的程序，再点击连接。');
      if(selected.gatt.connected)selected.gatt.disconnect();
      message(missing?'传图特征不全，正在重新读取同一台设备…':'读取服务前连接断开，正在重连同一台设备…');
      await sleep(400);
    }
  }
}
$('connect').onclick=async()=>{
  if(connecting||chars)return;
  connecting=true;lock();
  try{
    if(qrCode!==undefined&&!/^[0-9A-F]{4}$/.test(qrCode))throw Error('设备二维码编号无效，请重新扫码。');
    if(!isSecureContext)throw Error('请通过 HTTPS 或 localhost 打开本页');
    if(!navigator.bluetooth)throw Error('当前浏览器不支持蓝牙传图。Windows 请用 Edge 或 Chrome，安卓请用 Chrome。');
    const filter={services:[P.UUID.service]};
    if(qrCode)filter.name=`HueLeaf Lite-${qrCode}`;
    const selected=await navigator.bluetooth.requestDevice({filters:[filter]});
    device=selected;
    const {link,capability}=await discoverCharacteristics(selected);
    chars=link;cap=capability;
    if(qrCode!==undefined&&cap.device_code!==qrCode)
      throw Error(`所选设备与二维码编号 ${qrCode} 不符，请重新选择。`);
    selected.addEventListener('gattserverdisconnected',detached,{once:true});
    const defaultFormat=supported(cap.default_format)?cap.default_format:supported('e6f6')?'e6f6':cap.format;
    $('format').value=preferNativeE6&&supported('e6n4')?'e6n4':defaultFormat;
    syncFormats();$('deviceName').textContent=device.name||'HueLeaf Lite';
    message('已连接，可选择设备支持的颜色模式后传图。');render();
    await recoverCommit();
  }catch(e){
    if(device?.gatt.connected)device.gatt.disconnect();
    message(e.message);
    device=null;chars=null;cap=null;syncFormats();
  }finally{connecting=false;lock();}
};
$('disconnect').onclick=()=>{canceled=true;device?.gatt.disconnect();};
$('cancel').onclick=()=>{
  canceled=true;message(committed?'停止等待；屏幕刷新已经提交，无法撤销。':'正在取消，等待当前蓝牙操作结束…');
};
$('send').onclick=async()=>{
  if(busy||!chars||!cap)return;
  if(samePendingDevice()){
    busy=true;lock();
    try{await recoverCommit();}
    catch(e){message(`查询失败：${e.message}`);}
    finally{busy=false;lock();}
    return;
  }
  const format=$('format').value;
  if(!supported(format)){message('设备不支持当前图像格式');return;}
  busy=true;canceled=false;committed=false;lock();
  const link=chars,selected=device,capability=cap;
  const tx=crypto.getRandomValues(new Uint32Array(1))[0]||1,bytes=rendered.slice();
  const crc=P.crc32(bytes);
  const check=()=>{if(canceled||device!==selected||!selected.gatt.connected)throw Error('传输已取消或连接中断');};
  const state=async()=>{
    check();const s=P.status(await operation(()=>link.status.readValue(),selected));check();
    if(s.tx!==tx)throw Error('设备事务已改变');
    if(s.state===5){
      if(samePendingDevice()&&pendingCommit.tx===tx)setPendingCommit(null);
      throw Error(`设备错误 ${s.error}`);
    }
    return s;
  };
  try{
    // Cached protocol.js versions only accept the legacy INFO payload limit.
    const chunk=typeof P.dataPayload==='function'?P.dataPayload(capability):capability.max_payload;
    $('progress').value=0;
    message('正在开始传图。首次发送若弹出系统蓝牙配对提示，请确认是这台彩叶。');
    await write(link.control,P.begin(tx,bytes.length,crc,format,capability),selected,60000,
      '开始传图超时。若出现蓝牙配对提示，请先确认配对，再连接设备重试。');
    let s=await state();if(s.state!==1)throw Error('设备未进入接收状态');
    const burst=burstRequested&&!burstDisabled&&link.data.properties?.writeWithoutResponse&&
      typeof link.data.writeValueWithoutResponse==='function';
    const uploadStarted=Date.now();
    try{await uploadData(link,selected,bytes,chunk,burst,check,state);}
    catch(e){
      if(!burst||canceled)throw e;
      burstDisabled=true;
      throw Error(`${e.message}；请再次发送，将使用逐包确认。`);
    }
    check();s=await state();
    if(s.received!==bytes.length)throw Error('设备接收长度不一致');
    const uploadMs=Math.max(1,Date.now()-uploadStarted);
    const uploadSummary=`${burst?'批次确认':'逐包确认'} ${(bytes.length/uploadMs).toFixed(1)} kB/s，单包最多 ${chunk} 字节。`;
    committed=true;
    const receipt={tx,bytes:bytes.length,crc:nativeTrial&&format==='e6n4'?crc:undefined};
    setPendingCommit({device:selected,deviceId:selected.id,...receipt});
    await write(link.control,P.command(2,tx),selected);
    message(`图片已传输，正在刷新屏幕。 ${uploadSummary}`);
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){
      s=await state();if(s.state===4){
        if(s.received!==bytes.length||s.error!==0)throw Error('设备回报的完成状态与本次发送不符');
        setPendingCommit(null);message(`屏幕刷新完成。 ${uploadSummary}${trialReceipt(receipt)}`);return;
      }
      await sleep(500);
    }
    throw Error('等待刷新超时，请检查设备');
  }catch(e){
    message(committed?(canceled?'已停止等待或连接中断；刷新提交结果未知，请重连确认。'
      :`${e.message}；刷新已提交或结果未知，请重连确认。`):e.message);
    if(!committed&&selected?.gatt.connected&&device===selected)
      try{await write(link.control,P.command(3,tx),selected);}catch{}
  }finally{busy=false;lock();}
};
$('file').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    let bitmap;
    if(typeof createImageBitmap==='function')bitmap=await createImageBitmap(file);
    else{
      const url=URL.createObjectURL(file);
      try{bitmap=await new Promise((resolve,reject)=>{
        const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;
      });}finally{URL.revokeObjectURL(url);}
    }
    image?.close?.();image=bitmap;mode='image';$('text').hidden=true;
    $('imageMode').classList.add('selected');$('textMode').classList.remove('selected');$('paintMode').classList.remove('selected');
    render();message('照片已载入，可以调整构图。');
  }catch{message('无法读取此图片，请尝试 JPEG 或 PNG。');}
};
for(const id of ['zoom','panX','panY','brightness','contrast','dither','format','text'])
  $(id).addEventListener('input',render);
for(const name of ['image','text','paint'])$(name+'Mode').onclick=()=>{
  mode=name;$('text').hidden=name!=='text';
  $('imageMode').classList.toggle('selected',name==='image');$('textMode').classList.toggle('selected',name==='text');
  $('paintMode').classList.toggle('selected',name==='paint');
  render();
};
for(const [id,format] of [['chart64','e6f6'],['chart512Qual','e6q9'],['chart256','e6s8'],['chartFast256','e6f8']])$(id).onclick=()=>{
  if(!supported(format)||busy)return;
  $('format').value=format;mode='chart';$('text').hidden=true;
  $('imageMode').classList.remove('selected');$('textMode').classList.remove('selected');$('paintMode').classList.remove('selected');
  render();message(`${P.FORMATS[format].label}色卡已生成，点击“传到彩叶”即可显示。`);
};
$('paintErase').onclick=()=>{$('paintColour').value='#ffffff';};
$('paintClear').onclick=()=>{if(busy||connecting)return;painting=null;stroke=null;mode='paint';render();};
function paintPoint(event){
  const rect=$('canvas').getBoundingClientRect(),d=dimensions();
  /* Canvas border is part of the CSS box, not the drawing surface. */
  const scaleX=$('canvas').offsetWidth?rect.width/$('canvas').offsetWidth:1;
  const inset=9*scaleX;
  return {x:Math.max(0,Math.min(d.w-1,(event.clientX-rect.left-inset)/Math.max(1,rect.width-2*inset)*d.w)),
    y:Math.max(0,Math.min(d.h-1,(event.clientY-rect.top-inset)/Math.max(1,rect.height-2*inset)*d.h))};
}
$('canvas').onpointerdown=event=>{
  if(mode!=='paint'||busy||connecting||(event.button!==undefined&&event.button!==0))return;
  event.preventDefault();$('canvas').setPointerCapture?.(event.pointerId);
  stroke={...paintPoint(event),pointer:event.pointerId};
  LeafPaint.line(painting,stroke.x,stroke.y,stroke.x,stroke.y,$('paintColour').value,Number($('paintSize').value));render();
};
$('canvas').onpointermove=event=>{
  if(!stroke||stroke.pointer!==event.pointerId||mode!=='paint'||busy||connecting)return;
  event.preventDefault();const next=paintPoint(event);
  LeafPaint.line(painting,stroke.x,stroke.y,next.x,next.y,$('paintColour').value,Number($('paintSize').value));
  stroke={...next,pointer:event.pointerId};render();
};
for(const name of ['onpointerup','onpointercancel','onlostpointercapture'])$('canvas')[name]=event=>{
  if(stroke?.pointer===event.pointerId)stroke=null;
};
$('reset').onclick=()=>{
  for(const [id,value] of Object.entries({zoom:1,panX:0,panY:0,brightness:0,contrast:1}))$(id).value=value;
  $('dither').checked=true;if(mode==='chart')mode='image';render();
};
$('export').onclick=()=>{
  const d=dimensions(),url=URL.createObjectURL(new Blob([rendered],{type:'application/octet-stream'}));
  const a=document.createElement('a');a.href=url;a.download=`hueleaf-${d.w}x${d.h}-${d.format}.bin`;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
};
if(!navigator.bluetooth)$('connectionHint').textContent='此浏览器没有 Web Bluetooth。请使用安卓或 Windows 版 Chrome；苹果端暂缓适配。仍可编辑并导出图片。';
if(preferNativeE6)$('format').value='e6n4';
syncFormats();render();
