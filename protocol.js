(function (root) {
  'use strict';
  const uuid = n => `7b9e000${n}-6a5c-4f87-9d12-4c6561660001`;
  const UUID = {service:uuid(1),info:uuid(2),control:uuid(3),data:uuid(4),status:uuid(5)};
  const MAX_DATA_PAYLOAD=508; // 512-byte ATT attribute value minus 4-byte offset.
  const FORMATS = Object.freeze({
    mono1:{id:1,bits:1,w:200,h:200,label:'黑白'},
    e6n4:{id:2,bits:4,w:240,h:240,label:'原生六色'},
    e6f6:{id:3,bits:6,w:240,h:240,label:'64色快刷'},
    e6q9:{id:5,bits:9,w:240,h:240,label:'512色正常刷新'},
    e6s8:{id:6,bits:8,w:240,h:240,label:'精选256色'},
    e6f8:{id:7,bits:8,w:240,h:240,label:'精选256快刷 · 试验'}
  });
  const frameBytes = (format,w,h) => {
    if (!Object.hasOwn(FORMATS,format)) throw Error('未知图像格式');
    return Math.ceil(w*h*FORMATS[format].bits/8);
  };
  function crc32(bytes) {
    let c=0xffffffff;
    for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}
    return (c^0xffffffff)>>>0;
  }
  function command(op,tx,total,crc,formatId) {
    if(![1,2,3,4].includes(op)) throw Error('未知控制指令');
    if(op===4&&!Object.values(FORMATS).some(f=>f.id===formatId)) throw Error('未知图像格式编号');
    const b=new Uint8Array(op===4?14:op===1?13:5),v=new DataView(b.buffer);
    b[0]=op;v.setUint32(1,tx,true);
    if(op===1||op===4){v.setUint32(5,total,true);v.setUint32(9,crc,true);}
    if(op===4)b[13]=formatId;
    return b;
  }
  function packet(offset,bytes) {
    if(bytes.length<1||bytes.length>MAX_DATA_PAYLOAD) throw Error('图像数据包长度无效');
    const b=new Uint8Array(bytes.length+4);
    new DataView(b.buffer).setUint32(0,offset,true);b.set(bytes,4);return b;
  }
  /* Low-level engineering helper only; no tuning UI in the ordinary editor. */
  function fast256Settle(tx,ms) {
    if(!Number.isInteger(tx)||tx<0||tx>0xffffffff||!Number.isInteger(ms)||ms<0||ms>1000)
      throw Error('工程快刷间隔参数无效');
    const b=new Uint8Array(7),v=new DataView(b.buffer);
    b[0]=7;v.setUint32(1,tx,true);v.setUint16(5,ms,true);return b;
  }
  function status(v) {
    if(v.byteLength!==12||v.getUint8(0)!==1) throw Error('设备状态格式不兼容');
    return {state:v.getUint8(1),error:v.getUint8(2),received:v.getUint32(4,true),tx:v.getUint32(8,true)};
  }
  function info(v) {
    const d=JSON.parse(new TextDecoder().decode(v));
    if(d.v!==1||!['mono1','e6n4'].includes(d.format)||!Number.isInteger(d.w)||!Number.isInteger(d.h)||
       d.w<1||d.h<1||d.w*d.h>1000000||d.bytes!==frameBytes(d.format,d.w,d.h)||
       !Number.isInteger(d.max_payload)||d.max_payload<1||d.max_payload>240) throw Error('设备图像能力不兼容');
    if(d.mtu!==undefined&&(!Number.isInteger(d.mtu)||d.mtu<23||d.mtu>527||
       d.max_payload>Math.min(240,d.mtu-7))) throw Error('设备报告的蓝牙 MTU 无效');
    const native={id:FORMATS[d.format].id,format:d.format,bytes:d.bytes};
    if(d.formats!==undefined) {
      if(!Array.isArray(d.formats)||!Number.isInteger(d.protocol)||d.protocol<2) throw Error('设备多色能力不兼容');
      const seen=new Set();
      d.formats=d.formats.filter(f=>Object.hasOwn(FORMATS,f?.format)).map(f=>{
        if(f.id!==FORMATS[f.format].id||f.bytes!==frameBytes(f.format,d.w,d.h)||seen.has(f.id)||
           (d.format==='mono1'&&f.format!=='mono1')||(d.format==='e6n4'&&f.format==='mono1'))
          throw Error('设备多色能力不兼容');
        seen.add(f.id);return {id:f.id,format:f.format,bytes:f.bytes};
      });
      if(!d.formats.some(f=>f.id===native.id)) throw Error('设备缺少原生显示模式');
    } else d.formats=[native];
    return d;
  }
  function begin(tx,bytes,crc,format,cap) {
    const chosen=cap.formats.find(f=>f.format===format);
    if(!chosen||chosen.bytes!==bytes) throw Error('设备不支持当前图像格式');
    if(format===cap.format) return command(1,tx,bytes,crc);
    if(!(cap.protocol>=2)) throw Error('设备不支持多色快刷');
    return command(4,tx,bytes,crc,chosen.id);
  }
  const dataPayload=d=>d.mtu===undefined?d.max_payload:Math.min(MAX_DATA_PAYLOAD,d.mtu-7);
  const api={UUID,FORMATS,frameBytes,crc32,command,packet,fast256Settle,status,info,begin,dataPayload};
  root.LeafProtocol=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
