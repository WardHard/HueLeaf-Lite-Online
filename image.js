(function(root){
  'use strict';
  const P=root.LeafProtocol||(typeof require==='function'?require('./protocol.js'):null);
  const reference=root.LeafPalettes||(typeof require==='function'?require('./palettes.js'):null);
  const palettes={
    mono1:[[0,0,0,0],[255,255,255,1]],
    e6n4:[[17,17,17,0],[247,247,242,1],[230,200,76,2],[196,60,60,3],[47,95,191,5],[47,143,78,6]],
    e6f6:reference.fast64,
    e6q9:reference.qual512,
    e6s8:reference.selected256,
    e6f8:reference.fast256
  };
  function writer(count,bits) {
    if(![1,4,6,8,9].includes(bits)) throw Error('不支持的像素位数');
    const bytes=new Uint8Array(Math.ceil(count*bits/8));
    let acc=0,used=0,pos=0,written=0;
    return {put(value){
      if(written++>=count||!Number.isInteger(value)||value<0||value>=(1<<bits)) throw Error('像素编号无效');
      acc=(acc<<bits)|value;used+=bits;
      while(used>=8){used-=8;bytes[pos++]=(acc>>>used)&255;}
      acc&=(1<<used)-1;
    },finish(){
      if(written!==count) throw Error('像素数量不完整');
      if(used)bytes[pos]=acc<<(8-used);
      return bytes;
    }};
  }
  function pack(ids,bits) {const out=writer(ids.length,bits);for(const id of ids)out.put(id);return out.finish();}
  function unpack(bytes,bits,count) {
    if(![1,4,6,8,9].includes(bits)||bytes.length!==Math.ceil(count*bits/8)) throw Error('像素数据长度无效');
    const ids=new Uint16Array(count);let acc=0,used=0,pos=0;
    for(let i=0;i<count;i++){
      while(used<bits){acc=(acc<<8)|bytes[pos++];used+=8;}
      used-=bits;ids[i]=(acc>>>used)&((1<<bits)-1);acc&=(1<<used)-1;
    }
    return ids;
  }
  const trees=new Map();
  function tree(points,depth=0) {
    if(!points.length)return null;
    const axis=depth%3;points.sort((a,b)=>a[axis]-b[axis]||a[3]-b[3]);
    const mid=points.length>>1;
    return {point:points[mid],axis,left:tree(points.slice(0,mid),depth+1),right:tree(points.slice(mid+1),depth+1)};
  }
  function nearest(rootNode,r,g,b) {
    let best=null,dist=Infinity;
    function visit(node){
      if(!node)return;
      const p=node.point,dr=r-p[0],dg=g-p[1],db=b-p[2],d=dr*dr+dg*dg+db*db;
      if(d<dist||(d===dist&&p[3]<best[3])){dist=d;best=p;}
      const delta=(node.axis===0?r:node.axis===1?g:b)-p[node.axis];
      visit(delta<0?node.left:node.right);
      if(delta*delta<=dist)visit(delta<0?node.right:node.left);
    }
    visit(rootNode);return best;
  }
  function quantize(rgba,w,h,format,dither,brightness=0,contrast=1) {
    const palette=palettes[format],bits=P.FORMATS[format]?.bits;
    if(!palette||rgba.length!==w*h*4) throw Error('图像尺寸或格式无效');
    if(!trees.has(format))trees.set(format,tree(palette.filter(p=>format!=='e6f6'||p[0]||p[1]||p[2])));
    const out=writer(w*h,bits),preview=new Uint8ClampedArray(w*h*4);
    const rows=[new Float32Array((w+2)*3),new Float32Array((w+2)*3)];
    const clamp=v=>Math.max(0,Math.min(255,v));
    for(let y=0;y<h;y++){
      const cur=rows[y&1],next=rows[(y+1)&1];next.fill(0);
      for(let x=0;x<w;x++){
        const i=y*w+x,k=i*4,e=(x+1)*3,a=rgba[k+3];
        const r=clamp(((rgba[k]*a/255+255-a)-128)*contrast+128+brightness+cur[e]);
        const g=clamp(((rgba[k+1]*a/255+255-a)-128)*contrast+128+brightness+cur[e+1]);
        const b=clamp(((rgba[k+2]*a/255+255-a)-128)*contrast+128+brightness+cur[e+2]);
        const p=nearest(trees.get(format),r,g,b);out.put(p[3]);
        preview[k]=p[0];preview[k+1]=p[1];preview[k+2]=p[2];preview[k+3]=255;
        if(dither){
          const errors=[r-p[0],g-p[1],b-p[2]];
          for(let c=0;c<3;c++){
            const error=errors[c];cur[e+3+c]+=error*7/16;
            next[e-3+c]+=error*3/16;next[e+c]+=error*5/16;next[e+3+c]+=error/16;
          }
        }
      }
    }
    return {bytes:out.finish(),preview};
  }
  function chart(w,h,format) {
    if(!['e6f6','e6q9','e6s8','e6f8'].includes(format)) throw Error('请选择多色模式');
    const out=writer(w*h,P.FORMATS[format].bits),preview=new Uint8ClampedArray(w*h*4),palette=palettes[format];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let id;
      if(format==='e6s8'||format==='e6f8')id=Math.floor(y*16/h)*16+Math.floor(x*16/w);
      else if(format==='e6f6')id=Math.floor(y*8/h)*8+Math.floor(x*8/w);
      else {
        const col=Math.floor(x*16/w),row=Math.floor(y*32/h);
        id=((Math.floor(row/8)*2+Math.floor(col/8))<<6)|((col&7)<<3)|(row&7);
      }
      out.put(id);const k=(y*w+x)*4,p=palette[id];
      preview[k]=p[0];preview[k+1]=p[1];preview[k+2]=p[2];preview[k+3]=255;
    }
    return {bytes:out.finish(),preview};
  }
  root.LeafImage={quantize,pack,unpack,chart,palettes};
  if(typeof module!=='undefined')module.exports=root.LeafImage;
})(globalThis);
