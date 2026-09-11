/** Exercise the production GLSL on the browser GPU, independently of tone mapping. */
export function probeWindowLights(source){
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=2;
 const gl=canvas.getContext('webgl2');if(!gl)throw Error('No WebGL2');
 const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
 const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}');
 const fragment=compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\nout vec4 outputColour;\n'+source+`\nvoid main(){
 float i=floor(gl_FragCoord.x),kind=floor(gl_FragCoord.y);vec3 colour,lamp;float light,roughness;
 colonyWindowSurface(vec2(mod(i,8.),floor(i/8.))+vec2(.5),vec2(.5),vec2(.64,.42),.32,
 vec4(kind,.5,1.,0.),.42,vec3(0.,0.,1.),vec2(.01),colour,light,roughness,lamp);
 outputColour=vec4(lamp,1.);}`);
 const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);gl.viewport(0,0,64,2);gl.drawArrays(gl.TRIANGLES,0,3);
 const a=new Uint8Array(64*2*4),b=new Uint8Array(a.length);gl.readPixels(0,0,64,2,gl.RGBA,gl.UNSIGNED_BYTE,a);
 gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,64,2,gl.RGBA,gl.UNSIGNED_BYTE,b);
 const colours=row=>[...new Set(Array.from({length:64},(_,i)=>Array.from(a.slice((row*64+i)*4,(row*64+i)*4+3)).join(',')))];
 const residential=colours(0),office=colours(1);
 if(residential.length!==3||office.length!==1||a.some((v,i)=>v!==b[i]))throw Error('Room temperature variation or stability failed');
 if(office[0]!=='194,219,255')throw Error('Office lights are not the shared daylight colour');
 gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.getExtension('WEBGL_lose_context')?.loseContext();
 return {roomsPerUse:64,residential,office,stable:true};
}
