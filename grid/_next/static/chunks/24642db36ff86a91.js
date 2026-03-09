(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,24053,e=>{"use strict";var t=e.i(59482),r=e.i(10141);function i(e){let t=[];for(let r of e.split(",")){let e=r.trim().split(/\s+/);if(e.length>=2){let r=parseFloat(e[0]),i=parseFloat(e[1]);!isNaN(i)&&!isNaN(r)&&90>=Math.abs(i)&&180>=Math.abs(r)&&t.push([i,r])}}return t}function o({lines:o,center:a=[34,-108],zoom:n=5,height:s="500px",onLineClick:l,singleLine:p=!1,siteMarker:d,boldLines:c=!1,fiberRoutes:g}){let u=(0,r.useRef)(null),[f,y]=(0,r.useState)(!1),h=(0,r.useRef)(null);return((0,r.useEffect)(()=>{y(!0)},[]),(0,r.useEffect)(()=>{let t;if(!f||!u.current)return;let r=!1;return(async()=>{let s=await e.A(14594);if(r||!u.current)return;h.current&&h.current.remove(),h.current=t=s.map(u.current).setView(a,n);let f=s.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles &copy; Esri",maxZoom:19}),y=s.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}),m=s.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',maxZoom:19});(p?m:f).addTo(t),s.control.layers({Satellite:f,Dark:m,Street:y},{},{position:"topright"}).addTo(t);let b=[];for(let e of o){if(!e.geometry_wkt)continue;let r=function(e){if(!e)return[];let t=[];if(e.startsWith("MULTILINESTRING"))for(let r of e.replace(/^MULTILINESTRING\s*\(\(/,"").replace(/\)\)\s*$/,"").split("),(")){let e=i(r);e.length>0&&t.push(e)}else if(e.startsWith("LINESTRING")){let r=i(e.replace(/^LINESTRING\s*\(/,"").replace(/\)\s*$/,""));r.length>0&&t.push(r)}return t}(e.geometry_wkt);if(0===r.length)continue;let o=e.upgrade_candidate?"#a855f7":c?"#3b82f6":"#6b7280",a=e.upgrade_candidate?c?4:3:c?2.5:1.5,n=e.upgrade_candidate?.9:c?.8:.5;for(let i of r){b.push(...i);let r=s.polyline(i,{color:o,weight:p?4:a,opacity:p?1:n}),d=null!=e.capacity_mw?`${Number(e.capacity_mw).toFixed(1)} MW`:"Unknown",c=null!=e.voltage_kv?`${Number(e.voltage_kv).toFixed(0)} kV`:"?";r.bindPopup(`<div style="min-width:200px;font-family:system-ui">
              <strong style="font-size:13px">${e.naession||`${e.sub_1||"?"} → ${e.sub_2||"?"}`}</strong><br/>
              <span style="color:${e.upgrade_candidate?"#a855f7":"#6b7280"};font-weight:600">
                ${d} \xb7 ${c}
              </span><br/>
              ${e.owner?`Owner: ${e.owner}<br/>`:""}
              ${e.state||""}
              ${e.upgrade_candidate?'<br/><span style="color:#a855f7;font-weight:600">⚡ Upgrade Candidate</span>':""}
              ${l?`<br/><a href="/grid/line/?id=${e.id}" style="color:#7c3aed;text-decoration:underline">View Details →</a>`:""}
            </div>`),r.addTo(t),l&&r.on("click",()=>l(e.id))}}if(d){let e="brownfield"===d.type?"#d97706":"#7c3aed",r=s.divIcon({html:`<div style="
            width:16px;height:16px;border-radius:50%;
            background:${e};border:3px solid white;
            box-shadow:0 2px 6px rgba(0,0,0,0.4);
          "></div>`,iconSize:[16,16],iconAnchor:[8,8],className:""}),i=s.marker([d.lat,d.lng],{icon:r});i.bindPopup(`<strong>${d.label}</strong>`),i.addTo(t),b.push([d.lat,d.lng])}if(g&&g.length>0)for(let e of g){if(!e.geometry_json)continue;let r="string"==typeof e.geometry_json?JSON.parse(e.geometry_json):e.geometry_json;if(!r||!r.coordinates)continue;let i=r=>{let i=r.map(e=>[e[1],e[0]]);if(i.length<2)return;let o=s.polyline(i,{color:"#10b981",weight:2,opacity:.7});o.bindPopup(`<div style="min-width:180px;font-family:system-ui;font-size:13px">
                <strong style="font-size:14px">${e.name||"Fiber Route"}</strong><br/>
                <span style="color:#10b981;font-weight:600">Fiber Route</span><br/>
                ${e.operator?`<b>Operator:</b> ${e.operator}<br/>`:""}
                ${e.fiber_type?`<b>Type:</b> ${e.fiber_type}<br/>`:""}
              </div>`),o.addTo(t)};if("LineString"===r.type)i(r.coordinates);else if("MultiLineString"===r.type)for(let e of r.coordinates)i(e)}if(b.length>0)if(d)t.setView([d.lat,d.lng],n);else if(p){let e=s.latLngBounds(b);t.fitBounds(e,{padding:[40,40],maxZoom:14})}else{let e=s.latLngBounds(b);t.fitBounds(e,{padding:[20,20],maxZoom:10})}let x=new s.Control({position:"bottomright"});x.onAdd=()=>{let e=s.DomUtil.create("div","");return e.style.cssText="background:rgba(0,0,0,0.8);padding:8px 12px;border-radius:6px;font-size:11px;color:#fff;font-family:system-ui",e.innerHTML=`
          <div style="margin-bottom:4px;font-weight:600">Line Capacity</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <div style="width:20px;height:3px;background:#a855f7;border-radius:2px"></div>
            <span>Upgrade (50-100 MW)</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:20px;height:2px;background:#6b7280;border-radius:2px"></div>
            <span>Other</span>
          </div>
          ${g&&g.length>0?`<div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <div style="width:20px;height:2px;background:#10b981;border-radius:2px"></div>
            <span>Fiber Route</span>
          </div>`:""}
        `,e},x.addTo(t)})(),()=>{r=!0,h.current&&(h.current.remove(),h.current=null)}},[f,o,a,n,l,p,d,c,g]),f)?(0,t.jsxs)(t.Fragment,{children:[(0,t.jsx)("link",{rel:"stylesheet",href:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"}),(0,t.jsx)("div",{ref:u,style:{height:s},className:"rounded-lg z-0"})]}):(0,t.jsx)("div",{style:{height:s},className:"bg-gray-800 rounded-lg flex items-center justify-center text-gray-400",children:"Loading map..."})}e.s(["default",()=>o])},67712,e=>{e.n(e.i(24053))},14594,e=>{e.v(t=>Promise.all(["static/chunks/15cb915724f99aad.js"].map(t=>e.l(t))).then(()=>t(46798)))}]);