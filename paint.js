(function(root){
  'use strict';
  /* Browser-only RGBA drawing source. Quantization and BLE use image.js and
   * protocol.js unchanged; no canvas snapshots or image files per stroke. */
  function create(w,h){
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>1000000)throw Error('画布尺寸无效');
    const rgba=new Uint8ClampedArray(w*h*4);rgba.fill(255);
    return {w,h,rgba};
  }
  function rgb(hex){
    if(!/^#[0-9a-f]{6}$/i.test(hex))throw Error('画笔颜色无效');
    return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  }
  function line(surface,x0,y0,x1,y1,colour,diameter){
    if(!surface||surface.rgba.length!==surface.w*surface.h*4||
       ![x0,y0,x1,y1,diameter].every(Number.isFinite)||diameter<1||diameter>64)
      throw Error('画笔参数无效');
    const c=rgb(colour),r=diameter/2;
    const bound=(v,max)=>Math.max(0,Math.min(max-1,v));
    x0=bound(x0,surface.w);x1=bound(x1,surface.w);
    y0=bound(y0,surface.h);y1=bound(y1,surface.h);
    const steps=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)*2));
    for(let i=0;i<=steps;i++){
      const cx=x0+(x1-x0)*i/steps,cy=y0+(y1-y0)*i/steps;
      for(let y=Math.max(0,Math.floor(cy-r));y<=Math.min(surface.h-1,Math.ceil(cy+r));y++)
        for(let x=Math.max(0,Math.floor(cx-r));x<=Math.min(surface.w-1,Math.ceil(cx+r));x++)
          if((x-cx)**2+(y-cy)**2<=r*r){const k=(y*surface.w+x)*4;
            surface.rgba[k]=c[0];surface.rgba[k+1]=c[1];surface.rgba[k+2]=c[2];surface.rgba[k+3]=255;}
    }
    return surface;
  }
  const api={create,line,rgb};root.LeafPaint=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
