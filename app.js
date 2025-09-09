// Enhanced: adds umbra/penumbra cones + pass predictions
window.CESIUM_BASE_URL='https://cdn.jsdelivr.net/npm/cesium@1.117.0/Build/Cesium/';
const viewer=new Cesium.Viewer('cesiumContainer',{
  animation:false,timeline:false,baseLayerPicker:true,terrainProvider:Cesium.createWorldTerrain(),
  geocoder:false,homeButton:true,sceneModePicker:false,navigationHelpButton:false,infoBox:false,fullscreenButton:false,selectionIndicator:false,
  requestRenderMode:true,maximumRenderTimeChange:Infinity
});
viewer.scene.globe.enableLighting=true;
viewer.scene.skyAtmosphere.show=true;
viewer.scene.fog.enabled=true;
viewer.clock.clockStep=Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
viewer.clock.multiplier=1;

// UI
const locBtn=document.getElementById('locBtn');
const installBtn=document.getElementById('installBtn');
const quickSelect=document.getElementById('quickSelect');
const loadQuick=document.getElementById('loadQuick');
const tleText=document.getElementById('tleText');
const useTle=document.getElementById('useTle');
const resetCam=document.getElementById('resetCam');
const obsInfo=document.getElementById('obsInfo');
const sunAltEl=document.getElementById('sunAlt');
const visBadge=document.getElementById('visBadge');
const elMask=document.getElementById('elMask');
const elMaskVal=document.getElementById('elMaskVal');
const refreshPass=document.getElementById('refreshPass');
const passHint=document.getElementById('passHint');
const passTable=document.getElementById('passTable').querySelector('tbody');
elMask.addEventListener('input',()=>elMaskVal.textContent=`${elMask.value}°`);

// PWA
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;installBtn.hidden=false;});
installBtn.addEventListener('click',async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installBtn.hidden=true;}});

// Globals
let tleLines=null,satrec=null,satEntity=null,labelEntity=null;
let observer={lat:null,lon:null,height:0.0};
let simon=new Cesium.Simon1994PlanetaryPositions();
const Re=6378137.0; // meters
const Rs=695700000.0; // Sun radius [m]

function toDeg(r){return r*180/Math.PI} function toRad(d){return d*Math.PI/180}
function setBadge(state,text){visBadge.className='badge '+(state==='ok'?'badge-ok':state==='warn'?'badge-warn':'badge-err');visBadge.textContent=text;}

async function fetchTLEByCatnr(catnr){
  const url=`https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(catnr)}&FORMAT=TLE`;
  const resp=await fetch(url); if(!resp.ok) throw new Error('TLE 获取失败');
  const txt=await resp.text(); const lines=txt.trim().split(/\r?\n/).filter(Boolean);
  if(lines.length>=2){ if(lines.length>=3 && lines[0][0]!=='1') return [lines[1],lines[2]]; else return [lines[0],lines[1]];}
  throw new Error('TLE 解析失败');
}
function parseTLE(text){const lines=text.trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean); if(lines.length===2)return [lines[0],lines[1]]; if(lines.length>=3)return [lines[1],lines[2]]; throw new Error('请输入两行或三行 TLE');}
function buildSatrec(lines){return satellite.twoline2satrec(lines[0],lines[1]);}

function genTrack(satrec,startDate=new Date()){
  const sampled=new Cesium.SampledPositionProperty(); const stepSec=10,totalSec=2*60*60;
  for(let t=0;t<=totalSec;t+=stepSec){const d=new Date(startDate.getTime()+t*1000); const pv=satellite.propagate(satrec,d); if(!pv.position) continue;
    const gmst=satellite.gstime(d); const g=satellite.eciToGeodetic(pv.position,gmst);
    const cart=Cesium.Cartesian3.fromDegrees(toDeg(g.longitude),toDeg(g.latitude),g.height*1000.0);
    sampled.addSample(Cesium.JulianDate.fromDate(d),cart);
  } return sampled;
}
function createOrUpdateEntity(sampled){
  if(!satEntity){
    satEntity=viewer.entities.add({name:'satellite',position:sampled,point:{pixelSize:8,outlineWidth:2,color:Cesium.Color.CYAN,outlineColor:Cesium.Color.BLACK},path:{leadTime:3600,trailTime:1800,width:1.5,material:Cesium.Color.CYAN.withAlpha(0.6)}});
    labelEntity=viewer.entities.add({position:new Cesium.CallbackProperty(()=>satEntity.position.getValue(viewer.clock.currentTime),false),label:{text:'计算中...',font:'bold 16px sans-serif',showBackground:true,backgroundColor:Cesium.Color.fromCssColorString('#002233').withAlpha(0.7),pixelOffset:new Cesium.Cartesian2(0,-25)}});
  }else{satEntity.position=sampled;}
}
function resetCamera(){viewer.camera.flyHome(1.2);}

// Shadow test using umbra/penumbra cones
function shadowState(now,pv){
  const jd=Cesium.JulianDate.fromDate(now);
  const sunPos=simon.computeSunPosition(jd); // ICRF meters
  const sunDir=Cesium.Cartesian3.normalize(sunPos,new Cesium.Cartesian3());
  const D=Cesium.Cartesian3.magnitude(sunPos); // Earth->Sun distance [m]

  // Satellite ECI km -> meters
  const r=new Cesium.Cartesian3(pv.position.x*1000,pv.position.y*1000,pv.position.z*1000);

  // x = distance behind Earth along anti-sun axis
  const dot=Cesium.Cartesian3.dot(r,sunDir);
  const proj=Cesium.Cartesian3.multiplyByScalar(sunDir,dot,new Cesium.Cartesian3());
  const perp=Cesium.Cartesian3.subtract(r,proj,new Cesium.Cartesian3());
  const rho=Cesium.Cartesian3.magnitude(perp);
  const x=-dot; // positive if behind Earth (opposite to sunDir)

  if(x<=0) return {state:'sunlit',detail:{x,rho}};

  // Umbra and penumbra cone geometry
  const L=Re*D/(Rs-Re);      // umbra length
  const Lp=Re*D/(Rs+Re);     // penumbra "negative" length
  const rUmbra = (x<=L)? Re*(1 - x/L) : 0;     // linear taper to apex
  const rPenum = Re*(1 + x/Lp);                // widens outward

  if(rho < rUmbra) return {state:'umbra',detail:{x,rho,rUmbra,rPenum}};
  if(rho < rPenum) return {state:'penumbra',detail:{x,rho,rUmbra,rPenum}};
  return {state:'sunlit',detail:{x,rho,rUmbra,rPenum}};
}

function computeVisibility(now,satrec){
  if(observer.lat==null||observer.lon==null) return {ok:false,reason:'未定位'};
  const pv=satellite.propagate(satrec,now); if(!pv.position) return {ok:false,reason:'传播失败'};
  const gmst=satellite.gstime(now);
  const look=satellite.ecfToLookAngles({longitude:toRad(observer.lon),latitude:toRad(observer.lat),height:observer.height}, satellite.eciToEcf(pv.position,gmst));
  const el=toDeg(look.elevation);
  const sun=SunCalc.getPosition(now,observer.lat,observer.lon);
  const sunAlt=toDeg(sun.altitude);
  const sh=shadowState(now,pv);
  const elMaskDeg=parseFloat(elMask.value);
  const night=sunAlt<-6.0;
  const sunlit=(sh.state==='sunlit'); // penumbra通常也可见，但亮度降低；这里保守仅 sunlit
  const visible=(el>elMaskDeg)&&night&&sunlit;
  return {ok:visible,el,sunAlt,night,shadow:sh.state,detail:sh.detail};
}
function updateLabel(vis){
  const parts=[];
  parts.push(`仰角: ${vis.el!=null?vis.el.toFixed(1):'--'}°`);
  parts.push(`太阳: ${vis.sunAlt!=null?vis.sunAlt.toFixed(1):'--'}°`);
  parts.push(`地影: ${vis.shadow==='sunlit'?'阳照':vis.shadow==='umbra'?'本影':'半影'}`);
  labelEntity.label.text=parts.join(' | ');
}

// Pass predictions
function predictPasses(satrec,observer,startDate=new Date(),hours=12,step=30){
  // Find passes where elevation crosses 0 upward and then downward; compute max elevation and whether max segment is sunlit
  const results=[];
  const endDate=new Date(startDate.getTime()+hours*3600*1000);
  let t=startDate.getTime(), lastEl=null, inPass=false, passStart=null, maxEl=-90, sunlitAtMax=false;
  let gmst, pv, look, el, sh, now;
  while(t<=endDate.getTime()){
    now=new Date(t);
    pv=satellite.propagate(satrec,now); 
    if(pv.position){
      gmst=satellite.gstime(now);
      look=satellite.ecfToLookAngles({longitude:toRad(observer.lon),latitude:toRad(observer.lat),height:observer.height}, satellite.eciToEcf(pv.position,gmst));
      el=toDeg(look.elevation);
      // Entering pass
      if(!inPass && lastEl!==null && lastEl<=0 && el>0){
        inPass=true; passStart=new Date(t-step*1000);
        maxEl=-90; sunlitAtMax=false;
      }
      // Track max
      if(inPass && el>maxEl){
        maxEl=el;
        sh=shadowState(now,pv);
        sunlitAtMax=(sh.state==='sunlit'); // simple flag
      }
      // Exiting pass
      if(inPass && lastEl!==null && lastEl>0 && el<=0){
        const passEnd=new Date(t);
        results.push({start:passStart,peak:maxEl,end:passEnd,sunlit:sunlitAtMax});
        inPass=false;
      }
      lastEl=el;
    }
    t+=step*1000;
  }
  return results;
}

function fillPassTable(passes){
  const fmt=(d)=>{
    const pad=(n)=>String(n).padStart(2,'0');
    return `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  passTable.innerHTML='';
  if(!passes.length){passTable.innerHTML='<tr><td colspan="4">暂无可见过境（或阈值过高）</td></tr>';return;}
  for(const p of passes){
    const tr=document.createElement('tr');
    const td1=document.createElement('td'); td1.textContent=fmt(p.start);
    const td2=document.createElement('td'); td2.textContent=`${p.peak.toFixed(1)}°`;
    const td3=document.createElement('td'); td3.textContent=fmt(p.end);
    const td4=document.createElement('td'); td4.textContent=p.sunlit?'阳照':'可能半影/本影';
    tr.append(td1,td2,td3,td4); passTable.appendChild(tr);
  }
}

function refreshPassesNow(){
  if(!satrec || observer.lat==null){passHint.textContent='需要 TLE 与定位'; return;}
  passHint.textContent='计算中…';
  setTimeout(()=>{
    const passes=predictPasses(satrec,observer,new Date(),12,30);
    // Filter by elevation mask at peak
    const mask=parseFloat(elMask.value);
    const filtered=passes.filter(p=>p.peak>mask);
    fillPassTable(filtered);
    passHint.textContent=`共 ${filtered.length} 次（阈值 ${mask}°）`;
  },0);
}

// Loop
function startLoop(){
  viewer.clock.onTick.addEventListener(()=>{
    if(!satrec||!satEntity) return;
    const now=Cesium.JulianDate.toDate(viewer.clock.currentTime);
    try{
      const vis=computeVisibility(now,satrec);
      updateLabel(vis);
      if(observer.lat==null){setBadge('warn','请点击“定位”以启用可见性评估');}
      else if(vis.ok){setBadge('ok','✅ 现在可见（夜间 + 阳照 + 仰角>阈值）');}
      else{
        const reasons=[];
        if(!vis.night) reasons.push('观测地未入夜');
        if(vis.shadow==='umbra') reasons.push('卫星在本影');
        if(vis.shadow==='penumbra') reasons.push('卫星在半影（亮度较低）');
        if(vis.el!=null && vis.el<parseFloat(elMask.value)) reasons.push('仰角不足');
        setBadge('warn','不可见：'+(reasons.join('、')||'条件未满足'));
      }
      if(observer.lat!=null){sunAltEl.textContent=vis.sunAlt!=null?`${vis.sunAlt.toFixed(1)}°`:'--';}
    }catch(e){setBadge('err','计算异常：'+e.message);}
  });
}

// Events
loadQuick.addEventListener('click',async()=>{
  try{
    const cat=quickSelect.value; const lines=await fetchTLEByCatnr(cat);
    tleLines=lines; tleText.value=lines.join('\n'); satrec=buildSatrec(lines);
    const sampled=genTrack(satrec,new Date()); createOrUpdateEntity(sampled); resetCamera();
    refreshPassesNow();
  }catch(e){alert(e.message);}
});
useTle.addEventListener('click',()=>{
  try{
    const lines=parseTLE(tleText.value); tleLines=lines; satrec=buildSatrec(lines);
    const sampled=genTrack(satrec,new Date()); createOrUpdateEntity(sampled); resetCamera();
    refreshPassesNow();
  }catch(e){alert(e.message);}
});
resetCam.addEventListener('click',resetCamera);
locBtn.addEventListener('click',()=>{
  if(!navigator.geolocation){alert('此设备不支持定位');return;}
  navigator.geolocation.getCurrentPosition((pos)=>{
    observer.lat=pos.coords.latitude; observer.lon=pos.coords.longitude; observer.height=(pos.coords.altitude||0)/1000.0;
    obsInfo.textContent=`${observer.lat.toFixed(3)}, ${observer.lon.toFixed(3)}`;
    setBadge('warn','已定位，等待计算...'); refreshPassesNow();
  },(err)=>alert('定位失败: '+err.message),{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
});
refreshPass.addEventListener('click',refreshPassesNow);

// Init
startLoop();
document.addEventListener('visibilitychange',()=>viewer.scene.requestRender());
loadQuick.click();
