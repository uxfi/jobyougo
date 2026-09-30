import{e as f,c as xo,j as n}from"./vendor-react-DUX7-3KW.js";import{aw as re,au as _t,n as bo,al as G,ak as Y,W as et,U as tt,M as Fe,ab as We,aa as cs,Z as ls,a0 as vo,X as wo,s as yo,p as us,t as It,v as He,aq as Mo,b as Vt,a9 as ks,a6 as _o,ah as ds,ag as fs,N as Ao,am as Ze,L as Eo,K as So,J as Ce,h as W,E as jo,C as Ns,Q as Is,a2 as Gs,B as Zt,D as Ro,$ as Co,q as To,o as Oo,V as Po,T as de,a as K,r as Bs,av as Ne,a3 as hs,a4 as Lo,S as zo,ad as Ie}from"./RenderWhenVisible-D2gCYNMq.js";import{bt as Uo,fc as Do,dz as Ot}from"./main-CkwmdojU.js";import{u as ko,c as No}from"./marketing-locale-Bi7r9K7t.js";import{a as Fs}from"./useInView-C6haFsft.js";import{V as Pt,ak as Io,cU as Go,bo as Bo,j as Fo}from"./vendor-icons-BDFm4FbF.js";import{_ as st}from"./vendor-charts-DV5HzagS.js";import{v as Ws}from"./constants-BGeYrhy8.js";import"./workspace-navigation-CnubU-Pg.js";import"./vendor-radix-D5bgM0J6.js";import"./logo-oneasset-white-xVS3D9lx.js";const Wo="/demos/oneasset/assets/asset-tower-base-D0e5CS7D.webp",Ho="/demos/oneasset/assets/asset-tower-emissive-CXaaQwEC.webp",Xo="/demos/oneasset/assets/asset-tower-normal-CdptEHxd.webp",Vo="/demos/oneasset/assets/asset-tower-roughness-CAfzJCrv.webp",Zo="/demos/oneasset/assets/concrete-office-base-pAW9duu4.webp",qo="/demos/oneasset/assets/concrete-office-emissive-G_QEPrTx.webp",Yo="/demos/oneasset/assets/concrete-office-normal-B-GgW6yl.webp",Ko="/demos/oneasset/assets/concrete-office-roughness-bwkIv5RG.webp",Qo="/demos/oneasset/assets/dark-office-tower-base-BnghfR1V.webp",Jo="/demos/oneasset/assets/dark-office-tower-emissive-U8hgS3-m.webp",$o="/demos/oneasset/assets/dark-office-tower-normal-B_kZAA9o.webp",en="/demos/oneasset/assets/dark-office-tower-roughness-CMqeP95Y.webp",tn="/demos/oneasset/assets/mixed-use-residential-base-B42ObJk1.webp",sn="/demos/oneasset/assets/mixed-use-residential-emissive-DN7hDJ7J.webp",on="/demos/oneasset/assets/mixed-use-residential-normal-BYcgk8LE.webp",nn="/demos/oneasset/assets/mixed-use-residential-roughness-C8-vIsgv.webp",an="/demos/oneasset/assets/modern-glass-office-base-Bn9ecW0h.webp",rn="/demos/oneasset/assets/modern-glass-office-emissive-ByBgQt0j.webp",cn="/demos/oneasset/assets/asset-tower-normal-CdptEHxd.webp",ln="/demos/oneasset/assets/modern-glass-office-roughness-DmCIoxp8.webp",un="/demos/oneasset/assets/retail-commercial-base-B2oQUjCF.webp",dn="/demos/oneasset/assets/retail-commercial-emissive-CXh1cZIL.webp",fn="/demos/oneasset/assets/retail-commercial-normal-00P0M75W.webp",hn="/demos/oneasset/assets/retail-commercial-roughness-Ds8ti84g.webp",pn="/demos/oneasset/assets/stone-classic-base-CuZqP_93.webp",mn="/demos/oneasset/assets/stone-classic-emissive-B0H6yMEm.webp",gn="/demos/oneasset/assets/stone-classic-normal-Ia0mrVs6.webp",xn="/demos/oneasset/assets/stone-classic-roughness-DHHvyKAQ.webp",bn="data:image/webp;base64,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",vn="/demos/oneasset/assets/bark-normal-DXD4BJ_N.webp",wn="data:image/webp;base64,UklGRmwCAABXRUJQVlA4IGACAACQJQCdASoAAQABPj0ejkWiIaEQFAAgA8S0t3Ad3SS8z0Km+9nrnqmyPkQdNLztkb8+gAT0YbbD43i5ZVfDGmx2/53gM/rJLuJkXgwgmWWPCVnRXsYQ8bly77pPJl251M6qnpdIFKr7OiWq63xXhM9KaddCwq6lvNhw2mzMYB+ES6s1UCNncZ6GuegHB00A8AHqXGPb63vfcwScrNO4WsN+zAUL5l0OiUMeBilDnifNdlVEZQJIrhXDD75gG8/ZWUTKJ4A0fIwcNJqxYqFZxO4DFqBFEj4D3T5rMU7Wi7o2YoZSsoGKRoKOZzS50OOXMyS4p0OS6bIZp8pW5VNTeYsBms5zMH8FEzjUxY30TlOKCXFP1GKJ6A+y0K3N4hxsjrQt7lrsUYTnz6yGk8N2wAMUEzxV6gAA/vxOHUIC17zVdbrlhDew3hYJjMRNxDNS/eXeVRpS4P1s84Es46Mur1X2nSvSoLdaG+10oO2FoGBMxNEmPqBOcnPKn6qjNVGpGTRlooNF54FczavCljbxThhf36ySL4O/fH4PJlWaJFN3pGcVkIpg0slO9ZspndcQDkCKk8+m7mX+nGTF7qs0BX8bR7evTJ34nA885sX3qpl/lW7IbBb156nbfOsGuhR5QG+LT4FYhQ/FF2j2Parsf3OWBk+ZI839LJw9GgrTia8gkfPRhZLrEaaNlr26MbR8flBdgN7AMcS9mwnyWWIZFycoDyjOjoTOn3BKvrLQkMOGS7U6TIHnqiEMcMbS7aBUuSR3BGbaM2SrWvfthsYXx9Ros9TqDiUfZwol+dN5aggAAA==",yn="/demos/oneasset/assets/canopy-base-B6ikV8hX.webp",Mn="/demos/oneasset/assets/canopy-normal-D8naE4xm.webp",_n="data:image/webp;base64,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",An="/demos/oneasset/assets/asset-tower-roof-ao-CIyK1Dii.webp",En="/demos/oneasset/assets/asset-tower-roof-base-DbHVSMS_.webp",Sn="/demos/oneasset/assets/asset-tower-roof-normal-57G8XA0g.webp",jn="/demos/oneasset/assets/asset-tower-roof-roughness-CWHUgQEZ.webp",Rn="/demos/oneasset/assets/commercial-skylights-ao-DmBsKQY8.webp",Cn="/demos/oneasset/assets/commercial-skylights-base-D7AM0nYT.webp",Tn="/demos/oneasset/assets/commercial-skylights-normal-BbpKtm6m.webp",On="/demos/oneasset/assets/commercial-skylights-roughness-DqGwVq7T.webp",Pn="/demos/oneasset/assets/asset-tower-roof-ao-CIyK1Dii.webp",Ln="/demos/oneasset/assets/flat-office-hvac-base-Bksnd13g.webp",zn="/demos/oneasset/assets/asset-tower-roof-normal-57G8XA0g.webp",Un="/demos/oneasset/assets/flat-office-hvac-roughness-DLsD-D60.webp",Dn="/demos/oneasset/assets/industrial-metal-units-ao-D1d4YwWa.webp",kn="/demos/oneasset/assets/industrial-metal-units-base-DlEgKH3J.webp",Nn="/demos/oneasset/assets/industrial-metal-units-normal-Cg432CZ_.webp",In="/demos/oneasset/assets/industrial-metal-units-roughness-BP1FSXED.webp",Gn="/demos/oneasset/assets/mixed-use-service-ao-THyecHFP.webp",Bn="/demos/oneasset/assets/mixed-use-service-base-CxQIfBok.webp",Fn="/demos/oneasset/assets/mixed-use-service-normal-Cay7rc4b.webp",Wn="/demos/oneasset/assets/mixed-use-service-roughness-Cxze-7Md.webp",Hn="/demos/oneasset/assets/residential-simple-ao-D29FbrF-.webp",Xn="/demos/oneasset/assets/residential-simple-base-DirbvoCX.webp",Vn="/demos/oneasset/assets/residential-simple-normal-Bg-og1aZ.webp",Zn="/demos/oneasset/assets/residential-simple-roughness-rJe-8BI1.webp",qn="/demos/oneasset/assets/tar-roof-vents-ao-IntzlC1n.webp",Yn="/demos/oneasset/assets/tar-roof-vents-base-DArLTuBY.webp",Kn="/demos/oneasset/assets/tar-roof-vents-normal-CGhwQt5m.webp",Qn="/demos/oneasset/assets/tar-roof-vents-roughness-Bd1aM9T4.webp",Jn="/demos/oneasset/assets/dark-asphalt-ao-D5EY07Xs.webp",$n="/demos/oneasset/assets/dark-asphalt-base-DMRVG5NC.webp",ea="/demos/oneasset/assets/dark-asphalt-normal-BGJ2ZUgT.webp",ta="data:image/webp;base64,UklGRnAIAABXRUJQVlA4IGQIAABwKACdASoAAQABPj0ejEUiIaEhICiAQAeJaWWQhN0fOcsX9Dv1mE2f9b/5FX4q7YICOnNgE0UwLbU20d1X/38nfvDwB5EACfV4hcYBdKLl9jRZqERPKdtMjNxcX8xwwivFoodsClsrQnDN1sS9lRCe60hEbWdqgTuFeHF1/nEKxXFUBLkM4GBGkaEI0+V783sVjZ7dAkE6jMNgDLJTGLNxc8+9RKgCksawq9kA82/MliPfEVP+So9Ldh+lCcC7evzERNQATntylmzDKJZj/uACWbBRnTqUDfzAbgMvKDa7xGdHpb3zH+LD5fC5rgmKifRyvy714Zrz9ZtrIF5e4AtncUldN6WM/W9cz36pXQ27h1qGRK4QoCYvvsVjs8eTEox8wAwAUT/u8oLU/KCd8EWzqQfuMx8xiFxgF3FhN029On0/hMWBVGkJYmRkAAD+/HEQIH9Fmd3VWZqM/RU3SbuIFdRvVSWJkfTIsUE3shpwkH3zINq4FPYzjRy2mQxE2yxpXTQA1/qSUKROUuxzeRlGBQ4fosAxr5JgJDIKPRjstTNGhCVY5EkagBcvRMIZmPpSww73QJl+XOyRodrgufFijERcrijjszMEilLWHDeLXrfzbKpzR2LAH81Ocp3B3S3HUlSn3qYdtVpemZVlUAzhpGhOYHcTwOSc1+vL5zc3rx9O/M19iLBABDWOnpmm0NqZVR7v0pifdjWEeQNGykyUiXyz57NzQxW0aUH3i+W0GPRmkN8dDQCzFfddq8uLnMF3Fq5K1X6YHfswx0gfC9RTG9Q3k+QCiIaYHcbanqs9/2NVmL5t9LrlIL9roGNISchegy7V20id0951gJhSvn6mszrD4qiBlaTRAjXP21hL6Wn53o0plcrfXgRF1E7723wtbWIw3ouxPceLwAd0G+hUjgq+YoWXfSdrKAWeTLrFxDxKWdfsjy25wClVqUzoe/V1zTlmFORj0bQOrSyzq9K6IvS4pbuNbYVvbb3E/kInYNWrKTV53V2tf4BccndWPOxrQ7wnJLuj+Yul4Qvr1pftABfyOZy8OVV8/q1bCH/MavwQJ06eo50RjjBGgyPcXnPCJrObD/tSGJ3hD0MznNhmB/QdcNpsjx3ZELPmKKiRoOa0kNqpgXpivZXzaPTJxXgwxihcYt+QIbxWa0rXwsLS051YIJA3X71junnLVi7pcruAn/H+XTXoWaGuYP8ZukETiOVxRhToiBAbzu4xuuSJ4XmSOz22ZiJzefwOBOJ7Ftmy7PxBx5rkkyDqG6q4KJImHX38b8DQtuI8B0oOxEivcmFIRXIeCDZo5qv5ol3J3uXd7Qkx3matT7YkpKaVH/CQ9TUhDC+gpBvXlY3iaZ0jkpy/wU8MxFChrafylk9kUqBE5PNt1aRnsadh35rozMeJNssOfjf9cRt0MwALI6ng6//9iTUE8PyO4x14aJJGDrggYmq0Qg5gK4Yefm45p7LFj/LJuDPl2DxKR72vq3k3vmSvAlV5k5KOAmxMhy0j20GAEJx9rNsG8tWC6bZPhaRUQAMwwYsz06RmGDHIfsdowQMB/qRCHXwzD9spCKlKcgWJWEfgA1MdLKc6i/11QOUkRctg4hok8vT9YJGWbsXwwLZg3IqGL2dxPzniSESidFWEB6yh8T2uxtoFNKyRTAKpXFe6/fGsJz+tQaM7dgtLdw/Ud2Vy6hvASckWC9djMavAJSSAyrWigzuBBNxLvJSUsrK7kgVoawOwhpekVl/mc/8llSIGzJlTe/hOV63bw59qjsCb0nfQlImvfodd9h+EPRSCnuJ89crJjIwO4Km2Jv66lKvFMeXU6ib5Gw7A7X1YQ7tQb6ZSfK3w9hcVT+DJio6dUKHbNpRBekh7mLLuPjAsk4bXSVx4kZGgHHpa9Ow6shNZkZ3LMVP4YyZhIe5ZGgN/yuwkAeeRrR62UlQRtkeRSf4dnh0P1jMt0VMLPGtKUX9TyF/Xsm+qESbFfzyy6mrqJzmuIUBqv9J+fOFI6K2b/jLD+QPuYYqtwOVMoqQ7NQGsG0aTvhxmWVbMNJ5CSns3lAv6IolCFvk+gWkKw1VSx7baa6iAirPmgzlRNsFpgIRMeWix8+0takgG6cUds9YG1C8MDGljZ15c251Q3ATFEYvBzHd+Eq5dPoFtAX7wgU9fuaDFWnKZe0LKjCWi2nJAGjtMg5G/erqN9kV/Yxxuj6DkIDEBMsNCz+OU22CepK9o/Ans1GacxJEp+i2YTk2+Z7XMwHTOCl69H+Kd2o1HpbCAbnH9PiaBC6PT704+lCD91O+Mq58myMoVrczg+x7yj97r4gaXQXN8U7SL3P6+PQD16hATs0PDXsIJuyUDmr3oeb+xdYsM+IVce/VDdc7TBBDrgiWLwQUOn6IgOyqCY+j1sE0eTmjsdhaqy2RQ0ogo8FwTu2h8Q9fcjm1X0LlIKph+05HpnndExtLDOVVVIxRPsXO3Z1n6MpRjIHesPngZZ8htBoJGyfhy9GtG6NEl0JBtc/aYSO95c2KfNb8EKZXYR9mM8dcf0HM6sudsB7V0RurfS8kVpWcO7jd3+kMFVq/wGoa3OLb8OxJflXztoYx7F6VYOnMUCMIukMytahI16ppXhQ2VeA3f0cQHdMyMjr+tXZ6ogHUT4cRPcLadmcjkTU3XGpvmXvIaS+sMgX7d8dreyO8Jkty8xv5ge8+7tmuyRAkoPEGFYAoaQ/TZ/2uf4k3jfD8uGomuBM9sBD1kFGnENAjxOQSIVRcubmxVMZMTtTQbfXSgfC2/hNwM+3MDidMdxrgKhgZkAlkpQZqlBsRqE7YJdeD56f2v0MJX/ANGMqRE0Sw6vY6cDaRLxomRTUeMimkBSAmsWGmwAAA=",sa="/demos/oneasset/assets/dark-pavement-ao-CwdKHtHh.webp",oa="/demos/oneasset/assets/dark-pavement-base-DdJj6KPg.webp",na="/demos/oneasset/assets/dark-pavement-normal-DbO5VWfQ.webp",aa="data:image/webp;base64,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",ra="/demos/oneasset/assets/tiled-concrete-sidewalk-ao-BRVS2Mao.webp",ia="/demos/oneasset/assets/tiled-concrete-sidewalk-base-Bjo_e6wk.webp",ca="/demos/oneasset/assets/tiled-concrete-sidewalk-normal-BujVGbLk.webp",la="/demos/oneasset/assets/tiled-concrete-sidewalk-roughness-Cyl8Kn_n.webp",ua="/demos/oneasset/assets/tiled-road-patchwork-ao-COa12mGb.webp",da="/demos/oneasset/assets/tiled-road-patchwork-base-CXMQdmkt.webp",fa="/demos/oneasset/assets/tiled-road-patchwork-normal-DacMlu11.webp",ha="/demos/oneasset/assets/tiled-road-patchwork-roughness-B6VJ4seq.webp",pa="/demos/oneasset/assets/tiled-wet-asphalt-ao-Cj7HUWQa.webp",ma="/demos/oneasset/assets/tiled-wet-asphalt-base-B-1M29uW.webp",ga="/demos/oneasset/assets/tiled-wet-asphalt-normal-CQpfFukz.webp",xa="/demos/oneasset/assets/tiled-wet-asphalt-roughness-D0SATT2A.webp",ba="/demos/oneasset/assets/tiled-worn-asphalt-ao-CFlvkSXU.webp",va="/demos/oneasset/assets/tiled-worn-asphalt-base-DIFo0svD.webp",wa="/demos/oneasset/assets/tiled-worn-asphalt-normal-BfgkgoWa.webp",ya="/demos/oneasset/assets/tiled-worn-asphalt-roughness-AEPd1z4U.webp",it=new G,qt=new G,Ma=new G,ps=new Y;function _a(o,s,t){const e=it.setFromMatrixPosition(o.matrixWorld);e.project(s);const a=t.width/2,r=t.height/2;return[e.x*a+a,-(e.y*r)+r]}function Aa(o,s){const t=it.setFromMatrixPosition(o.matrixWorld),e=qt.setFromMatrixPosition(s.matrixWorld),a=t.sub(e),r=s.getWorldDirection(Ma);return a.angleTo(r)>Math.PI/2}function Ea(o,s,t,e){const a=it.setFromMatrixPosition(o.matrixWorld),r=a.clone();r.project(s),ps.set(r.x,r.y),t.setFromCamera(ps,s);const l=t.intersectObjects(e,!0);if(l.length){const i=l[0].distance;return a.distanceTo(t.ray.origin)<i}return!0}function Sa(o,s){if(s instanceof tt)return s.zoom;if(s instanceof et){const t=it.setFromMatrixPosition(o.matrixWorld),e=qt.setFromMatrixPosition(s.matrixWorld),a=s.fov*Math.PI/180,r=t.distanceTo(e);return 1/(2*Math.tan(a/2)*r)}else return 1}function ja(o,s,t){if(s instanceof et||s instanceof tt){const e=it.setFromMatrixPosition(o.matrixWorld),a=qt.setFromMatrixPosition(s.matrixWorld),r=e.distanceTo(a),l=(t[1]-t[0])/(s.far-s.near),i=t[1]-l*s.far;return Math.round(l*r+i)}}const Gt=o=>Math.abs(o)<1e-10?0:o;function Hs(o,s,t=""){let e="matrix3d(";for(let a=0;a!==16;a++)e+=Gt(s[a]*o.elements[a])+(a!==15?",":")");return t+e}const Ra=(o=>s=>Hs(s,o))([1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1]),Ca=(o=>(s,t)=>Hs(s,o(t),"translate(-50%,-50%)"))(o=>[1/o,1/o,1/o,1,-1/o,-1/o,-1/o,-1,1/o,1/o,1/o,1,1,1,1,1]);function Ta(o){return o&&typeof o=="object"&&"current"in o}const Oa=f.forwardRef(({children:o,eps:s=.001,style:t,className:e,prepend:a,center:r,fullscreen:l,portal:i,distanceFactor:c,sprite:u=!1,transform:d=!1,occlude:m,onOcclude:x,castShadow:g,receiveShadow:y,material:w,geometry:v,zIndexRange:_=[16777271,0],calculatePosition:R=_a,as:A="div",wrapperClass:b,pointerEvents:j="auto",...M},C)=>{const{gl:E,camera:O,scene:T,size:L,raycaster:Z,events:U,viewport:fe}=re(),[F]=f.useState(()=>document.createElement(A)),ae=f.useRef(),q=f.useRef(null),he=f.useRef(0),xe=f.useRef([0,0]),me=f.useRef(null),Ae=f.useRef(null),pe=(i==null?void 0:i.current)||U.connected||E.domElement.parentNode,oe=f.useRef(null),k=f.useRef(!1),X=f.useMemo(()=>m&&m!=="blending"||Array.isArray(m)&&m.length&&Ta(m[0]),[m]);f.useLayoutEffect(()=>{const V=E.domElement;m&&m==="blending"?(V.style.zIndex=`${Math.floor(_[0]/2)}`,V.style.position="absolute",V.style.pointerEvents="none"):(V.style.zIndex=null,V.style.position=null,V.style.pointerEvents=null)},[m]),f.useLayoutEffect(()=>{if(q.current){const V=ae.current=xo.createRoot(F);if(T.updateMatrixWorld(),d)F.style.cssText="position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;";else{const N=R(q.current,O,L);F.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${N[0]}px,${N[1]}px,0);transform-origin:0 0;`}return pe&&(a?pe.prepend(F):pe.appendChild(F)),()=>{pe&&pe.removeChild(F),V.unmount()}}},[pe,d]),f.useLayoutEffect(()=>{b&&(F.className=b)},[b]);const D=f.useMemo(()=>d?{position:"absolute",top:0,left:0,width:L.width,height:L.height,transformStyle:"preserve-3d",pointerEvents:"none"}:{position:"absolute",transform:r?"translate3d(-50%,-50%,0)":"none",...l&&{top:-L.height/2,left:-L.width/2,width:L.width,height:L.height},...t},[t,r,l,L,d]),ne=f.useMemo(()=>({position:"absolute",pointerEvents:j}),[j]);f.useLayoutEffect(()=>{if(k.current=!1,d){var V;(V=ae.current)==null||V.render(f.createElement("div",{ref:me,style:D},f.createElement("div",{ref:Ae,style:ne},f.createElement("div",{ref:C,className:e,style:t,children:o}))))}else{var N;(N=ae.current)==null||N.render(f.createElement("div",{ref:C,style:D,className:e,children:o}))}});const ce=f.useRef(!0);_t(V=>{if(q.current){O.updateMatrixWorld(),q.current.updateWorldMatrix(!0,!1);const N=d?xe.current:R(q.current,O,L);if(d||Math.abs(he.current-O.zoom)>s||Math.abs(xe.current[0]-N[0])>s||Math.abs(xe.current[1]-N[1])>s){const Q=Aa(q.current,O);let J=!1;X&&(Array.isArray(m)?J=m.map(be=>be.current):m!=="blending"&&(J=[T]));const ue=ce.current;if(J){const be=Ea(q.current,O,Z,J);ce.current=be&&!Q}else ce.current=!Q;ue!==ce.current&&(x?x(!ce.current):F.style.display=ce.current?"block":"none");const Ge=Math.floor(_[0]/2),Et=m?X?[_[0],Ge]:[Ge-1,0]:_;if(F.style.zIndex=`${ja(q.current,O,Et)}`,d){const[be,qe]=[L.width/2,L.height/2],Be=O.projectionMatrix.elements[5]*qe,{isOrthographicCamera:ct,top:St,left:lt,bottom:Ye,right:ze}=O,jt=Ra(O.matrixWorldInverse),Rt=ct?`scale(${Be})translate(${Gt(-(ze+lt)/2)}px,${Gt((St+Ye)/2)}px)`:`translateZ(${Be}px)`;let ve=q.current.matrixWorld;u&&(ve=O.matrixWorldInverse.clone().transpose().copyPosition(ve).scale(q.current.scale),ve.elements[3]=ve.elements[7]=ve.elements[11]=0,ve.elements[15]=1),F.style.width=L.width+"px",F.style.height=L.height+"px",F.style.perspective=ct?"":`${Be}px`,me.current&&Ae.current&&(me.current.style.transform=`${Rt}${jt}translate(${be}px,${qe}px)`,Ae.current.style.transform=Ca(ve,1/((c||10)/400)))}else{const be=c===void 0?1:Sa(q.current,O)*c;F.style.transform=`translate3d(${N[0]}px,${N[1]}px,0) scale(${be})`}xe.current=N,he.current=O.zoom}}if(!X&&oe.current&&!k.current)if(d){if(me.current){const N=me.current.children[0];if(N!=null&&N.clientWidth&&N!=null&&N.clientHeight){const{isOrthographicCamera:Q}=O;if(Q||v)M.scale&&(Array.isArray(M.scale)?M.scale instanceof G?oe.current.scale.copy(M.scale.clone().divideScalar(1)):oe.current.scale.set(1/M.scale[0],1/M.scale[1],1/M.scale[2]):oe.current.scale.setScalar(1/M.scale));else{const J=(c||10)/400,ue=N.clientWidth*J,Ge=N.clientHeight*J;oe.current.scale.set(ue,Ge,1)}k.current=!0}}}else{const N=F.children[0];if(N!=null&&N.clientWidth&&N!=null&&N.clientHeight){const Q=1/fe.factor,J=N.clientWidth*Q,ue=N.clientHeight*Q;oe.current.scale.set(J,ue,1),k.current=!0}oe.current.lookAt(V.camera.position)}});const le=f.useMemo(()=>({vertexShader:d?void 0:`
          /*
            This shader is from the THREE's SpriteMaterial.
            We need to turn the backing plane into a Sprite
            (make it always face the camera) if "transfrom"
            is false.
          */
          #include <common>

          void main() {
            vec2 center = vec2(0., 1.);
            float rotation = 0.0;

            // This is somewhat arbitrary, but it seems to work well
            // Need to figure out how to derive this dynamically if it even matters
            float size = 0.03;

            vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
            vec2 scale;
            scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
            scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );

            bool isPerspective = isPerspectiveMatrix( projectionMatrix );
            if ( isPerspective ) scale *= - mvPosition.z;

            vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale * size;
            vec2 rotatedPosition;
            rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
            rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
            mvPosition.xy += rotatedPosition;

            gl_Position = projectionMatrix * mvPosition;
          }
      `,fragmentShader:`
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `}),[d]);return f.createElement("group",st({},M,{ref:q}),m&&!X&&f.createElement("mesh",{castShadow:g,receiveShadow:y,ref:oe},v||f.createElement("planeGeometry",null),w||f.createElement("shaderMaterial",{side:bo,vertexShader:le.vertexShader,fragmentShader:le.fragmentShader})))}),Xs=Ws>=125?"uv1":"uv2";var Pa=Object.defineProperty,La=(o,s,t)=>s in o?Pa(o,s,{enumerable:!0,configurable:!0,writable:!0,value:t}):o[s]=t,za=(o,s,t)=>(La(o,s+"",t),t);class Ua{constructor(){za(this,"_listeners")}addEventListener(s,t){this._listeners===void 0&&(this._listeners={});const e=this._listeners;e[s]===void 0&&(e[s]=[]),e[s].indexOf(t)===-1&&e[s].push(t)}hasEventListener(s,t){if(this._listeners===void 0)return!1;const e=this._listeners;return e[s]!==void 0&&e[s].indexOf(t)!==-1}removeEventListener(s,t){if(this._listeners===void 0)return;const a=this._listeners[s];if(a!==void 0){const r=a.indexOf(t);r!==-1&&a.splice(r,1)}}dispatchEvent(s){if(this._listeners===void 0)return;const e=this._listeners[s.type];if(e!==void 0){s.target=this;const a=e.slice(0);for(let r=0,l=a.length;r<l;r++)a[r].call(this,s);s.target=null}}}var Da=Object.defineProperty,ka=(o,s,t)=>s in o?Da(o,s,{enumerable:!0,configurable:!0,writable:!0,value:t}):o[s]=t,P=(o,s,t)=>(ka(o,typeof s!="symbol"?s+"":s,t),t);const dt=new vo,ms=new wo,Na=Math.cos(70*(Math.PI/180)),gs=(o,s)=>(o%s+s)%s;let Ia=class extends Ua{constructor(s,t){super(),P(this,"object"),P(this,"domElement"),P(this,"enabled",!0),P(this,"target",new G),P(this,"minDistance",0),P(this,"maxDistance",1/0),P(this,"minZoom",0),P(this,"maxZoom",1/0),P(this,"minPolarAngle",0),P(this,"maxPolarAngle",Math.PI),P(this,"minAzimuthAngle",-1/0),P(this,"maxAzimuthAngle",1/0),P(this,"enableDamping",!1),P(this,"dampingFactor",.05),P(this,"enableZoom",!0),P(this,"zoomSpeed",1),P(this,"enableRotate",!0),P(this,"rotateSpeed",1),P(this,"enablePan",!0),P(this,"panSpeed",1),P(this,"screenSpacePanning",!0),P(this,"keyPanSpeed",7),P(this,"zoomToCursor",!1),P(this,"autoRotate",!1),P(this,"autoRotateSpeed",2),P(this,"reverseOrbit",!1),P(this,"reverseHorizontalOrbit",!1),P(this,"reverseVerticalOrbit",!1),P(this,"keys",{LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"}),P(this,"mouseButtons",{LEFT:Fe.ROTATE,MIDDLE:Fe.DOLLY,RIGHT:Fe.PAN}),P(this,"touches",{ONE:We.ROTATE,TWO:We.DOLLY_PAN}),P(this,"target0"),P(this,"position0"),P(this,"zoom0"),P(this,"_domElementKeyEvents",null),P(this,"getPolarAngle"),P(this,"getAzimuthalAngle"),P(this,"setPolarAngle"),P(this,"setAzimuthalAngle"),P(this,"getDistance"),P(this,"getZoomScale"),P(this,"listenToKeyEvents"),P(this,"stopListenToKeyEvents"),P(this,"saveState"),P(this,"reset"),P(this,"update"),P(this,"connect"),P(this,"dispose"),P(this,"dollyIn"),P(this,"dollyOut"),P(this,"getScale"),P(this,"setScale"),this.object=s,this.domElement=t,this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this.getPolarAngle=()=>d.phi,this.getAzimuthalAngle=()=>d.theta,this.setPolarAngle=h=>{let S=gs(h,2*Math.PI),z=d.phi;z<0&&(z+=2*Math.PI),S<0&&(S+=2*Math.PI);let B=Math.abs(S-z);2*Math.PI-B<B&&(S<z?S+=2*Math.PI:z+=2*Math.PI),m.phi=S-z,e.update()},this.setAzimuthalAngle=h=>{let S=gs(h,2*Math.PI),z=d.theta;z<0&&(z+=2*Math.PI),S<0&&(S+=2*Math.PI);let B=Math.abs(S-z);2*Math.PI-B<B&&(S<z?S+=2*Math.PI:z+=2*Math.PI),m.theta=S-z,e.update()},this.getDistance=()=>e.object.position.distanceTo(e.target),this.listenToKeyEvents=h=>{h.addEventListener("keydown",Ct),this._domElementKeyEvents=h},this.stopListenToKeyEvents=()=>{this._domElementKeyEvents.removeEventListener("keydown",Ct),this._domElementKeyEvents=null},this.saveState=()=>{e.target0.copy(e.target),e.position0.copy(e.object.position),e.zoom0=e.object.zoom},this.reset=()=>{e.target.copy(e.target0),e.object.position.copy(e.position0),e.object.zoom=e.zoom0,e.object.updateProjectionMatrix(),e.dispatchEvent(a),e.update(),c=i.NONE},this.update=(()=>{const h=new G,S=new G(0,1,0),z=new ls().setFromUnitVectors(s.up,S),B=z.clone().invert(),$=new G,Ee=new ls,Te=2*Math.PI;return function(){const is=e.object.position;z.setFromUnitVectors(s.up,S),B.copy(z).invert(),h.copy(is).sub(e.target),h.applyQuaternion(z),d.setFromVector3(h),e.autoRotate&&c===i.NONE&&fe(Z()),e.enableDamping?(d.theta+=m.theta*e.dampingFactor,d.phi+=m.phi*e.dampingFactor):(d.theta+=m.theta,d.phi+=m.phi);let Se=e.minAzimuthAngle,je=e.maxAzimuthAngle;isFinite(Se)&&isFinite(je)&&(Se<-Math.PI?Se+=Te:Se>Math.PI&&(Se-=Te),je<-Math.PI?je+=Te:je>Math.PI&&(je-=Te),Se<=je?d.theta=Math.max(Se,Math.min(je,d.theta)):d.theta=d.theta>(Se+je)/2?Math.max(Se,d.theta):Math.min(je,d.theta)),d.phi=Math.max(e.minPolarAngle,Math.min(e.maxPolarAngle,d.phi)),d.makeSafe(),e.enableDamping===!0?e.target.addScaledVector(g,e.dampingFactor):e.target.add(g),e.zoomToCursor&&O||e.object.isOrthographicCamera?d.radius=oe(d.radius):d.radius=oe(d.radius*x),h.setFromSpherical(d),h.applyQuaternion(B),is.copy(e.target).add(h),e.object.matrixAutoUpdate||e.object.updateMatrix(),e.object.lookAt(e.target),e.enableDamping===!0?(m.theta*=1-e.dampingFactor,m.phi*=1-e.dampingFactor,g.multiplyScalar(1-e.dampingFactor)):(m.set(0,0,0),g.set(0,0,0));let Ke=!1;if(e.zoomToCursor&&O){let Qe=null;if(e.object instanceof et&&e.object.isPerspectiveCamera){const Je=h.length();Qe=oe(Je*x);const ut=Je-Qe;e.object.position.addScaledVector(C,ut),e.object.updateMatrixWorld()}else if(e.object.isOrthographicCamera){const Je=new G(E.x,E.y,0);Je.unproject(e.object),e.object.zoom=Math.max(e.minZoom,Math.min(e.maxZoom,e.object.zoom/x)),e.object.updateProjectionMatrix(),Ke=!0;const ut=new G(E.x,E.y,0);ut.unproject(e.object),e.object.position.sub(ut).add(Je),e.object.updateMatrixWorld(),Qe=h.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),e.zoomToCursor=!1;Qe!==null&&(e.screenSpacePanning?e.target.set(0,0,-1).transformDirection(e.object.matrix).multiplyScalar(Qe).add(e.object.position):(dt.origin.copy(e.object.position),dt.direction.set(0,0,-1).transformDirection(e.object.matrix),Math.abs(e.object.up.dot(dt.direction))<Na?s.lookAt(e.target):(ms.setFromNormalAndCoplanarPoint(e.object.up,e.target),dt.intersectPlane(ms,e.target))))}else e.object instanceof tt&&e.object.isOrthographicCamera&&(Ke=x!==1,Ke&&(e.object.zoom=Math.max(e.minZoom,Math.min(e.maxZoom,e.object.zoom/x)),e.object.updateProjectionMatrix()));return x=1,O=!1,Ke||$.distanceToSquared(e.object.position)>u||8*(1-Ee.dot(e.object.quaternion))>u?(e.dispatchEvent(a),$.copy(e.object.position),Ee.copy(e.object.quaternion),Ke=!1,!0):!1}})(),this.connect=h=>{e.domElement=h,e.domElement.style.touchAction="none",e.domElement.addEventListener("contextmenu",as),e.domElement.addEventListener("pointerdown",lt),e.domElement.addEventListener("pointercancel",ze),e.domElement.addEventListener("wheel",ve)},this.dispose=()=>{var h,S,z,B,$,Ee;e.domElement&&(e.domElement.style.touchAction="auto"),(h=e.domElement)==null||h.removeEventListener("contextmenu",as),(S=e.domElement)==null||S.removeEventListener("pointerdown",lt),(z=e.domElement)==null||z.removeEventListener("pointercancel",ze),(B=e.domElement)==null||B.removeEventListener("wheel",ve),($=e.domElement)==null||$.ownerDocument.removeEventListener("pointermove",Ye),(Ee=e.domElement)==null||Ee.ownerDocument.removeEventListener("pointerup",ze),e._domElementKeyEvents!==null&&e._domElementKeyEvents.removeEventListener("keydown",Ct)};const e=this,a={type:"change"},r={type:"start"},l={type:"end"},i={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6};let c=i.NONE;const u=1e-6,d=new cs,m=new cs;let x=1;const g=new G,y=new Y,w=new Y,v=new Y,_=new Y,R=new Y,A=new Y,b=new Y,j=new Y,M=new Y,C=new G,E=new Y;let O=!1;const T=[],L={};function Z(){return 2*Math.PI/60/60*e.autoRotateSpeed}function U(){return Math.pow(.95,e.zoomSpeed)}function fe(h){e.reverseOrbit||e.reverseHorizontalOrbit?m.theta+=h:m.theta-=h}function F(h){e.reverseOrbit||e.reverseVerticalOrbit?m.phi+=h:m.phi-=h}const ae=(()=>{const h=new G;return function(z,B){h.setFromMatrixColumn(B,0),h.multiplyScalar(-z),g.add(h)}})(),q=(()=>{const h=new G;return function(z,B){e.screenSpacePanning===!0?h.setFromMatrixColumn(B,1):(h.setFromMatrixColumn(B,0),h.crossVectors(e.object.up,h)),h.multiplyScalar(z),g.add(h)}})(),he=(()=>{const h=new G;return function(z,B){const $=e.domElement;if($&&e.object instanceof et&&e.object.isPerspectiveCamera){const Ee=e.object.position;h.copy(Ee).sub(e.target);let Te=h.length();Te*=Math.tan(e.object.fov/2*Math.PI/180),ae(2*z*Te/$.clientHeight,e.object.matrix),q(2*B*Te/$.clientHeight,e.object.matrix)}else $&&e.object instanceof tt&&e.object.isOrthographicCamera?(ae(z*(e.object.right-e.object.left)/e.object.zoom/$.clientWidth,e.object.matrix),q(B*(e.object.top-e.object.bottom)/e.object.zoom/$.clientHeight,e.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),e.enablePan=!1)}})();function xe(h){e.object instanceof et&&e.object.isPerspectiveCamera||e.object instanceof tt&&e.object.isOrthographicCamera?x=h:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),e.enableZoom=!1)}function me(h){xe(x/h)}function Ae(h){xe(x*h)}function pe(h){if(!e.zoomToCursor||!e.domElement)return;O=!0;const S=e.domElement.getBoundingClientRect(),z=h.clientX-S.left,B=h.clientY-S.top,$=S.width,Ee=S.height;E.x=z/$*2-1,E.y=-(B/Ee)*2+1,C.set(E.x,E.y,1).unproject(e.object).sub(e.object.position).normalize()}function oe(h){return Math.max(e.minDistance,Math.min(e.maxDistance,h))}function k(h){y.set(h.clientX,h.clientY)}function X(h){pe(h),b.set(h.clientX,h.clientY)}function D(h){_.set(h.clientX,h.clientY)}function ne(h){w.set(h.clientX,h.clientY),v.subVectors(w,y).multiplyScalar(e.rotateSpeed);const S=e.domElement;S&&(fe(2*Math.PI*v.x/S.clientHeight),F(2*Math.PI*v.y/S.clientHeight)),y.copy(w),e.update()}function ce(h){j.set(h.clientX,h.clientY),M.subVectors(j,b),M.y>0?me(U()):M.y<0&&Ae(U()),b.copy(j),e.update()}function le(h){R.set(h.clientX,h.clientY),A.subVectors(R,_).multiplyScalar(e.panSpeed),he(A.x,A.y),_.copy(R),e.update()}function V(h){pe(h),h.deltaY<0?Ae(U()):h.deltaY>0&&me(U()),e.update()}function N(h){let S=!1;switch(h.code){case e.keys.UP:he(0,e.keyPanSpeed),S=!0;break;case e.keys.BOTTOM:he(0,-e.keyPanSpeed),S=!0;break;case e.keys.LEFT:he(e.keyPanSpeed,0),S=!0;break;case e.keys.RIGHT:he(-e.keyPanSpeed,0),S=!0;break}S&&(h.preventDefault(),e.update())}function Q(){if(T.length==1)y.set(T[0].pageX,T[0].pageY);else{const h=.5*(T[0].pageX+T[1].pageX),S=.5*(T[0].pageY+T[1].pageY);y.set(h,S)}}function J(){if(T.length==1)_.set(T[0].pageX,T[0].pageY);else{const h=.5*(T[0].pageX+T[1].pageX),S=.5*(T[0].pageY+T[1].pageY);_.set(h,S)}}function ue(){const h=T[0].pageX-T[1].pageX,S=T[0].pageY-T[1].pageY,z=Math.sqrt(h*h+S*S);b.set(0,z)}function Ge(){e.enableZoom&&ue(),e.enablePan&&J()}function Et(){e.enableZoom&&ue(),e.enableRotate&&Q()}function be(h){if(T.length==1)w.set(h.pageX,h.pageY);else{const z=Tt(h),B=.5*(h.pageX+z.x),$=.5*(h.pageY+z.y);w.set(B,$)}v.subVectors(w,y).multiplyScalar(e.rotateSpeed);const S=e.domElement;S&&(fe(2*Math.PI*v.x/S.clientHeight),F(2*Math.PI*v.y/S.clientHeight)),y.copy(w)}function qe(h){if(T.length==1)R.set(h.pageX,h.pageY);else{const S=Tt(h),z=.5*(h.pageX+S.x),B=.5*(h.pageY+S.y);R.set(z,B)}A.subVectors(R,_).multiplyScalar(e.panSpeed),he(A.x,A.y),_.copy(R)}function Be(h){const S=Tt(h),z=h.pageX-S.x,B=h.pageY-S.y,$=Math.sqrt(z*z+B*B);j.set(0,$),M.set(0,Math.pow(j.y/b.y,e.zoomSpeed)),me(M.y),b.copy(j)}function ct(h){e.enableZoom&&Be(h),e.enablePan&&qe(h)}function St(h){e.enableZoom&&Be(h),e.enableRotate&&be(h)}function lt(h){var S,z;e.enabled!==!1&&(T.length===0&&((S=e.domElement)==null||S.ownerDocument.addEventListener("pointermove",Ye),(z=e.domElement)==null||z.ownerDocument.addEventListener("pointerup",ze)),mo(h),h.pointerType==="touch"?ho(h):jt(h))}function Ye(h){e.enabled!==!1&&(h.pointerType==="touch"?po(h):Rt(h))}function ze(h){var S,z,B;go(h),T.length===0&&((S=e.domElement)==null||S.releasePointerCapture(h.pointerId),(z=e.domElement)==null||z.ownerDocument.removeEventListener("pointermove",Ye),(B=e.domElement)==null||B.ownerDocument.removeEventListener("pointerup",ze)),e.dispatchEvent(l),c=i.NONE}function jt(h){let S;switch(h.button){case 0:S=e.mouseButtons.LEFT;break;case 1:S=e.mouseButtons.MIDDLE;break;case 2:S=e.mouseButtons.RIGHT;break;default:S=-1}switch(S){case Fe.DOLLY:if(e.enableZoom===!1)return;X(h),c=i.DOLLY;break;case Fe.ROTATE:if(h.ctrlKey||h.metaKey||h.shiftKey){if(e.enablePan===!1)return;D(h),c=i.PAN}else{if(e.enableRotate===!1)return;k(h),c=i.ROTATE}break;case Fe.PAN:if(h.ctrlKey||h.metaKey||h.shiftKey){if(e.enableRotate===!1)return;k(h),c=i.ROTATE}else{if(e.enablePan===!1)return;D(h),c=i.PAN}break;default:c=i.NONE}c!==i.NONE&&e.dispatchEvent(r)}function Rt(h){if(e.enabled!==!1)switch(c){case i.ROTATE:if(e.enableRotate===!1)return;ne(h);break;case i.DOLLY:if(e.enableZoom===!1)return;ce(h);break;case i.PAN:if(e.enablePan===!1)return;le(h);break}}function ve(h){e.enabled===!1||e.enableZoom===!1||c!==i.NONE&&c!==i.ROTATE||(h.preventDefault(),e.dispatchEvent(r),V(h),e.dispatchEvent(l))}function Ct(h){e.enabled===!1||e.enablePan===!1||N(h)}function ho(h){switch(rs(h),T.length){case 1:switch(e.touches.ONE){case We.ROTATE:if(e.enableRotate===!1)return;Q(),c=i.TOUCH_ROTATE;break;case We.PAN:if(e.enablePan===!1)return;J(),c=i.TOUCH_PAN;break;default:c=i.NONE}break;case 2:switch(e.touches.TWO){case We.DOLLY_PAN:if(e.enableZoom===!1&&e.enablePan===!1)return;Ge(),c=i.TOUCH_DOLLY_PAN;break;case We.DOLLY_ROTATE:if(e.enableZoom===!1&&e.enableRotate===!1)return;Et(),c=i.TOUCH_DOLLY_ROTATE;break;default:c=i.NONE}break;default:c=i.NONE}c!==i.NONE&&e.dispatchEvent(r)}function po(h){switch(rs(h),c){case i.TOUCH_ROTATE:if(e.enableRotate===!1)return;be(h),e.update();break;case i.TOUCH_PAN:if(e.enablePan===!1)return;qe(h),e.update();break;case i.TOUCH_DOLLY_PAN:if(e.enableZoom===!1&&e.enablePan===!1)return;ct(h),e.update();break;case i.TOUCH_DOLLY_ROTATE:if(e.enableZoom===!1&&e.enableRotate===!1)return;St(h),e.update();break;default:c=i.NONE}}function as(h){e.enabled!==!1&&h.preventDefault()}function mo(h){T.push(h)}function go(h){delete L[h.pointerId];for(let S=0;S<T.length;S++)if(T[S].pointerId==h.pointerId){T.splice(S,1);return}}function rs(h){let S=L[h.pointerId];S===void 0&&(S=new Y,L[h.pointerId]=S),S.set(h.pageX,h.pageY)}function Tt(h){const S=h.pointerId===T[0].pointerId?T[1]:T[0];return L[S.pointerId]}this.dollyIn=(h=U())=>{Ae(h),e.update()},this.dollyOut=(h=U())=>{me(h),e.update()},this.getScale=()=>x,this.setScale=h=>{xe(h),e.update()},this.getZoomScale=()=>U(),t!==void 0&&this.connect(t),this.update()}};const xs=new Vt,ft=new G;class Yt extends yo{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const s=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],e=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(e),this.setAttribute("position",new us(s,3)),this.setAttribute("uv",new us(t,2))}applyMatrix4(s){const t=this.attributes.instanceStart,e=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(s),e.applyMatrix4(s),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(s){let t;s instanceof Float32Array?t=s:Array.isArray(s)&&(t=new Float32Array(s));const e=new It(t,6,1);return this.setAttribute("instanceStart",new He(e,3,0)),this.setAttribute("instanceEnd",new He(e,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(s,t=3){let e;s instanceof Float32Array?e=s:Array.isArray(s)&&(e=new Float32Array(s));const a=new It(e,t*2,1);return this.setAttribute("instanceColorStart",new He(a,t,0)),this.setAttribute("instanceColorEnd",new He(a,t,t)),this}fromWireframeGeometry(s){return this.setPositions(s.attributes.position.array),this}fromEdgesGeometry(s){return this.setPositions(s.attributes.position.array),this}fromMesh(s){return this.fromWireframeGeometry(new Mo(s.geometry)),this}fromLineSegments(s){const t=s.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Vt);const s=this.attributes.instanceStart,t=this.attributes.instanceEnd;s!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(s),xs.setFromBufferAttribute(t),this.boundingBox.union(xs))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ks),this.boundingBox===null&&this.computeBoundingBox();const s=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(s!==void 0&&t!==void 0){const e=this.boundingSphere.center;this.boundingBox.getCenter(e);let a=0;for(let r=0,l=s.count;r<l;r++)ft.fromBufferAttribute(s,r),a=Math.max(a,e.distanceToSquared(ft)),ft.fromBufferAttribute(t,r),a=Math.max(a,e.distanceToSquared(ft));this.boundingSphere.radius=Math.sqrt(a),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(s){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(s)}}class Vs extends Yt{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(s){const t=s.length-3,e=new Float32Array(2*t);for(let a=0;a<t;a+=3)e[2*a]=s[a],e[2*a+1]=s[a+1],e[2*a+2]=s[a+2],e[2*a+3]=s[a+3],e[2*a+4]=s[a+4],e[2*a+5]=s[a+5];return super.setPositions(e),this}setColors(s,t=3){const e=s.length-t,a=new Float32Array(2*e);if(t===3)for(let r=0;r<e;r+=t)a[2*r]=s[r],a[2*r+1]=s[r+1],a[2*r+2]=s[r+2],a[2*r+3]=s[r+3],a[2*r+4]=s[r+4],a[2*r+5]=s[r+5];else for(let r=0;r<e;r+=t)a[2*r]=s[r],a[2*r+1]=s[r+1],a[2*r+2]=s[r+2],a[2*r+3]=s[r+3],a[2*r+4]=s[r+4],a[2*r+5]=s[r+5],a[2*r+6]=s[r+6],a[2*r+7]=s[r+7];return super.setColors(a,t),this}fromLine(s){const t=s.geometry;return this.setPositions(t.attributes.position.array),this}}class Kt extends _o{constructor(s){super({type:"LineMaterial",uniforms:ds.clone(ds.merge([fs.common,fs.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new Y(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${Ws>=154?"colorspace_fragment":"encodings_fragment"}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA="1":delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(t){this.uniforms.diffuse.value=t}},worldUnits:{enumerable:!0,get:function(){return"WORLD_UNITS"in this.defines},set:function(t){t===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(t){this.uniforms.linewidth.value=t}},dashed:{enumerable:!0,get:function(){return"USE_DASH"in this.defines},set(t){!!t!="USE_DASH"in this.defines&&(this.needsUpdate=!0),t===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(t){this.uniforms.dashScale.value=t}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(t){this.uniforms.dashSize.value=t}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(t){this.uniforms.dashOffset.value=t}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(t){this.uniforms.gapSize.value=t}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(t){this.uniforms.opacity.value=t}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(t){this.uniforms.resolution.value.copy(t)}},alphaToCoverage:{enumerable:!0,get:function(){return"USE_ALPHA_TO_COVERAGE"in this.defines},set:function(t){!!t!="USE_ALPHA_TO_COVERAGE"in this.defines&&(this.needsUpdate=!0),t===!0?(this.defines.USE_ALPHA_TO_COVERAGE="",this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(s)}}const Lt=new Ze,bs=new G,vs=new G,ee=new Ze,te=new Ze,we=new Ze,zt=new G,Ut=new So,se=new Eo,ws=new G,ht=new Vt,pt=new ks,ye=new Ze;let Me,ke;function ys(o,s,t){return ye.set(0,0,-s,1).applyMatrix4(o.projectionMatrix),ye.multiplyScalar(1/ye.w),ye.x=ke/t.width,ye.y=ke/t.height,ye.applyMatrix4(o.projectionMatrixInverse),ye.multiplyScalar(1/ye.w),Math.abs(Math.max(ye.x,ye.y))}function Ga(o,s){const t=o.matrixWorld,e=o.geometry,a=e.attributes.instanceStart,r=e.attributes.instanceEnd,l=Math.min(e.instanceCount,a.count);for(let i=0,c=l;i<c;i++){se.start.fromBufferAttribute(a,i),se.end.fromBufferAttribute(r,i),se.applyMatrix4(t);const u=new G,d=new G;Me.distanceSqToSegment(se.start,se.end,d,u),d.distanceTo(u)<ke*.5&&s.push({point:d,pointOnLine:u,distance:Me.origin.distanceTo(d),object:o,face:null,faceIndex:i,uv:null,[Xs]:null})}}function Ba(o,s,t){const e=s.projectionMatrix,r=o.material.resolution,l=o.matrixWorld,i=o.geometry,c=i.attributes.instanceStart,u=i.attributes.instanceEnd,d=Math.min(i.instanceCount,c.count),m=-s.near;Me.at(1,we),we.w=1,we.applyMatrix4(s.matrixWorldInverse),we.applyMatrix4(e),we.multiplyScalar(1/we.w),we.x*=r.x/2,we.y*=r.y/2,we.z=0,zt.copy(we),Ut.multiplyMatrices(s.matrixWorldInverse,l);for(let x=0,g=d;x<g;x++){if(ee.fromBufferAttribute(c,x),te.fromBufferAttribute(u,x),ee.w=1,te.w=1,ee.applyMatrix4(Ut),te.applyMatrix4(Ut),ee.z>m&&te.z>m)continue;if(ee.z>m){const A=ee.z-te.z,b=(ee.z-m)/A;ee.lerp(te,b)}else if(te.z>m){const A=te.z-ee.z,b=(te.z-m)/A;te.lerp(ee,b)}ee.applyMatrix4(e),te.applyMatrix4(e),ee.multiplyScalar(1/ee.w),te.multiplyScalar(1/te.w),ee.x*=r.x/2,ee.y*=r.y/2,te.x*=r.x/2,te.y*=r.y/2,se.start.copy(ee),se.start.z=0,se.end.copy(te),se.end.z=0;const w=se.closestPointToPointParameter(zt,!0);se.at(w,ws);const v=Ce.lerp(ee.z,te.z,w),_=v>=-1&&v<=1,R=zt.distanceTo(ws)<ke*.5;if(_&&R){se.start.fromBufferAttribute(c,x),se.end.fromBufferAttribute(u,x),se.start.applyMatrix4(l),se.end.applyMatrix4(l);const A=new G,b=new G;Me.distanceSqToSegment(se.start,se.end,b,A),t.push({point:b,pointOnLine:A,distance:Me.origin.distanceTo(b),object:o,face:null,faceIndex:x,uv:null,[Xs]:null})}}}class Zs extends Ao{constructor(s=new Yt,t=new Kt({color:Math.random()*16777215})){super(s,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const s=this.geometry,t=s.attributes.instanceStart,e=s.attributes.instanceEnd,a=new Float32Array(2*t.count);for(let l=0,i=0,c=t.count;l<c;l++,i+=2)bs.fromBufferAttribute(t,l),vs.fromBufferAttribute(e,l),a[i]=i===0?0:a[i-1],a[i+1]=a[i]+bs.distanceTo(vs);const r=new It(a,2,1);return s.setAttribute("instanceDistanceStart",new He(r,1,0)),s.setAttribute("instanceDistanceEnd",new He(r,1,1)),this}raycast(s,t){const e=this.material.worldUnits,a=s.camera;a===null&&!e&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const r=s.params.Line2!==void 0&&s.params.Line2.threshold||0;Me=s.ray;const l=this.matrixWorld,i=this.geometry,c=this.material;ke=c.linewidth+r,i.boundingSphere===null&&i.computeBoundingSphere(),pt.copy(i.boundingSphere).applyMatrix4(l);let u;if(e)u=ke*.5;else{const m=Math.max(a.near,pt.distanceToPoint(Me.origin));u=ys(a,m,c.resolution)}if(pt.radius+=u,Me.intersectsSphere(pt)===!1)return;i.boundingBox===null&&i.computeBoundingBox(),ht.copy(i.boundingBox).applyMatrix4(l);let d;if(e)d=ke*.5;else{const m=Math.max(a.near,ht.distanceToPoint(Me.origin));d=ys(a,m,c.resolution)}ht.expandByScalar(d),Me.intersectsBox(ht)!==!1&&(e?Ga(this,t):Ba(this,a,t))}onBeforeRender(s){const t=this.material.uniforms;t&&t.resolution&&(s.getViewport(Lt),this.material.uniforms.resolution.value.set(Lt.z,Lt.w))}}class Fa extends Zs{constructor(s=new Vs,t=new Kt({color:Math.random()*16777215})){super(s,t),this.isLine2=!0,this.type="Line2"}}const Wa=f.forwardRef(function({points:s,color:t=16777215,vertexColors:e,linewidth:a,lineWidth:r,segments:l,dashed:i,...c},u){var d,m;const x=re(_=>_.size),g=f.useMemo(()=>l?new Zs:new Fa,[l]),[y]=f.useState(()=>new Kt),w=(e==null||(d=e[0])==null?void 0:d.length)===4?4:3,v=f.useMemo(()=>{const _=l?new Yt:new Vs,R=s.map(A=>{const b=Array.isArray(A);return A instanceof G||A instanceof Ze?[A.x,A.y,A.z]:A instanceof Y?[A.x,A.y,0]:b&&A.length===3?[A[0],A[1],A[2]]:b&&A.length===2?[A[0],A[1],0]:A});if(_.setPositions(R.flat()),e){t=16777215;const A=e.map(b=>b instanceof W?b.toArray():b);_.setColors(A.flat(),w)}return _},[s,l,e,w]);return f.useLayoutEffect(()=>{g.computeLineDistances()},[s,g]),f.useLayoutEffect(()=>{i?y.defines.USE_DASH="":delete y.defines.USE_DASH,y.needsUpdate=!0},[i,y]),f.useEffect(()=>()=>{v.dispose(),y.dispose()},[v]),f.createElement("primitive",st({object:g,ref:u},c),f.createElement("primitive",{object:v,attach:"geometry"}),f.createElement("primitive",st({object:y,attach:"material",color:t,vertexColors:!!e,resolution:[x.width,x.height],linewidth:(m=a??r)!==null&&m!==void 0?m:1,dashed:i,transparent:w===4},c)))}),vt=f.forwardRef(({threshold:o=15,geometry:s,...t},e)=>{const a=f.useRef(null);f.useImperativeHandle(e,()=>a.current,[]);const r=f.useMemo(()=>[0,0,0,1,0,0],[]),l=f.useRef(),i=f.useRef();return f.useLayoutEffect(()=>{const c=a.current.parent,u=s??(c==null?void 0:c.geometry);if(!u||l.current===u&&i.current===o)return;l.current=u,i.current=o;const m=new jo(u,o).attributes.position.array;a.current.geometry.setPositions(m),a.current.geometry.attributes.instanceStart.needsUpdate=!0,a.current.geometry.attributes.instanceEnd.needsUpdate=!0,a.current.computeLineDistances()}),f.createElement(Wa,st({segments:!0,points:r,ref:a,raycast:()=>null},t))}),Ha=f.forwardRef(({makeDefault:o,camera:s,regress:t,domElement:e,enableDamping:a=!0,keyEvents:r=!1,onChange:l,onStart:i,onEnd:c,...u},d)=>{const m=re(M=>M.invalidate),x=re(M=>M.camera),g=re(M=>M.gl),y=re(M=>M.events),w=re(M=>M.setEvents),v=re(M=>M.set),_=re(M=>M.get),R=re(M=>M.performance),A=s||x,b=e||y.connected||g.domElement,j=f.useMemo(()=>new Ia(A),[A]);return _t(()=>{j.enabled&&j.update()},-1),f.useEffect(()=>(r&&j.connect(r===!0?b:r),j.connect(b),()=>void j.dispose()),[r,b,t,j,m]),f.useEffect(()=>{const M=O=>{m(),t&&R.regress(),l&&l(O)},C=O=>{i&&i(O)},E=O=>{c&&c(O)};return j.addEventListener("change",M),j.addEventListener("start",C),j.addEventListener("end",E),()=>{j.removeEventListener("start",C),j.removeEventListener("end",E),j.removeEventListener("change",M)}},[l,i,c,j,m,w]),f.useEffect(()=>{if(o){const M=_().controls;return v({controls:j}),()=>v({controls:M})}},[o,j]),f.createElement("primitive",st({ref:d,object:j,enableDamping:a},u))}),Xa=()=>{};function qs({children:o}){const s=f.useRef(null);return f.useLayoutEffect(()=>{const t=s.current;t&&t.traverse(e=>{e.raycast=Xa})}),n.jsx("group",{ref:s,children:o})}const Qt=f.createContext(null);function ge(o,s){const t=f.useContext(Qt);_t((e,a)=>{t&&!t.current||o(e,a)},s)}const bt=new G(13.2,13.55,16.55),wt=new G(9.6,9.95,12.1),Va=new G(6.25,6.1,7.3),Za=new G(-3.55,1.15,-.5),Ys=new G(-2.8,1.5,-.45),qa=new G(-.75,2.2,-1.35),_e=[-.95,0,-.78],ot=[1.08,1.24,1.08],Ya=4.45,Ka=1.1;function Ks(o){const s=new G(4.85,4.45,5.75),t=1.05,e=_e[0],a=_e[2],r=e-s.x,l=a-s.z,i=Math.hypot(r,l)||1,c=l/i,u=-r/i,d=new G(e+c*o,2.1,a+u*o),m=s.clone().sub(d).normalize(),x=s.distanceTo(d)+t;return{camera:d.clone().add(m.multiplyScalar(x)),target:d}}function Qs({camera:o,target:s}){const t=o.clone().sub(s);t.multiplyScalar(1.16);const e=.18,a=Math.cos(e),r=Math.sin(e),l=t.x*a-t.z*r,i=t.x*r+t.z*a;return t.x=l,t.z=i,t.y+=.42,s.clone().add(t)}const Jt=Ks(Ya),Qa=Jt.camera,Js=Jt.target,$s=Qs(Jt),$t=Ks(Ka),Ja=$t.camera,eo=$t.target,to=Qs($t),$a=[_e[0],_e[1]+4.55*ot[1],_e[2]+.08*ot[2]],Ms=[-.5,-.5],Re=2.76,Le=.68,es=36,so=39,oo=32,no=so,ts=oo+so/2,er=oo-ts/2,nt=50,ao=nt/2-18,De=-5,Bt=5,Ft=11,_s=.28,ss=.26,tr=.66,sr=[no/_s,ts/_s],ro=tr/ss,As=[ro,nt/ss],Es=[es/ss,ro],or=.44;function at(o){const s=o-Le,t=Math.round(s/Re)*Re;return s-t}function Xe(o,s,t=or){const e=at(o),a=at(s),r=Math.abs(e)<t?o+Math.sign(e||1)*(t-Math.abs(e)):o,l=Math.abs(a)<t?s+Math.sign(a||1)*(t-Math.abs(a)):s;return[r,l]}function p(o){const s=Math.sin(o*928.371)*1e4;return s-Math.floor(s)}function ie(o){if(!o||(o.instanceMatrix.needsUpdate=!0,!o.instanceColor))return;o.instanceColor.needsUpdate=!0,(Array.isArray(o.material)?o.material:[o.material]).forEach(t=>{t.needsUpdate=!0})}const nr=new Y(.22,.22),Ss=new Y(.46,.46),ar=new Y(.32,.32),rr=new Y(.18,.18),ir=new Y(.16,.16),cr=new Y(.2,.2),lr=new Y(.24,.24),yt=6,Pe=6,Wt=["material-0","material-1","material-4","material-5"],js=.62,Rs=o=>{o.vertexShader=o.vertexShader.replace("#include <common>",`attribute vec2 aRoofUvScale;
#include <common>`).replace("#include <uv_vertex>",`#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv *= aRoofUvScale;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv *= aRoofUvScale;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv *= aRoofUvScale;
      #endif
      #ifdef USE_AOMAP
        vAoMapUv *= aRoofUvScale;
      #endif`)};function Cs(o,s){if(!o)return;const t=new Float32Array(s.length*2);s.forEach((e,a)=>{t[a*2]=e.scale[0]/js,t[a*2+1]=e.scale[2]/js}),o.geometry.setAttribute("aRoofUvScale",new Bs(t,2))}function H(o,s=!1,t=[1,1],e=8){return o.wrapS=hs,o.wrapT=hs,o.repeat.set(...t),o.anisotropy=e,o.colorSpace=s?Lo:zo,o.needsUpdate=!0,o}const ur=Object.assign({"./assets/hero-textures/facades/asset-tower-base.webp":Wo,"./assets/hero-textures/facades/asset-tower-emissive.webp":Ho,"./assets/hero-textures/facades/asset-tower-normal.webp":Xo,"./assets/hero-textures/facades/asset-tower-roughness.webp":Vo,"./assets/hero-textures/facades/concrete-office-base.webp":Zo,"./assets/hero-textures/facades/concrete-office-emissive.webp":qo,"./assets/hero-textures/facades/concrete-office-normal.webp":Yo,"./assets/hero-textures/facades/concrete-office-roughness.webp":Ko,"./assets/hero-textures/facades/dark-office-tower-base.webp":Qo,"./assets/hero-textures/facades/dark-office-tower-emissive.webp":Jo,"./assets/hero-textures/facades/dark-office-tower-normal.webp":$o,"./assets/hero-textures/facades/dark-office-tower-roughness.webp":en,"./assets/hero-textures/facades/mixed-use-residential-base.webp":tn,"./assets/hero-textures/facades/mixed-use-residential-emissive.webp":sn,"./assets/hero-textures/facades/mixed-use-residential-normal.webp":on,"./assets/hero-textures/facades/mixed-use-residential-roughness.webp":nn,"./assets/hero-textures/facades/modern-glass-office-base.webp":an,"./assets/hero-textures/facades/modern-glass-office-emissive.webp":rn,"./assets/hero-textures/facades/modern-glass-office-normal.webp":cn,"./assets/hero-textures/facades/modern-glass-office-roughness.webp":ln,"./assets/hero-textures/facades/retail-commercial-base.webp":un,"./assets/hero-textures/facades/retail-commercial-emissive.webp":dn,"./assets/hero-textures/facades/retail-commercial-normal.webp":fn,"./assets/hero-textures/facades/retail-commercial-roughness.webp":hn,"./assets/hero-textures/facades/stone-classic-base.webp":pn,"./assets/hero-textures/facades/stone-classic-emissive.webp":mn,"./assets/hero-textures/facades/stone-classic-normal.webp":gn,"./assets/hero-textures/facades/stone-classic-roughness.webp":xn,"./assets/hero-textures/foliage/bark-base.webp":bn,"./assets/hero-textures/foliage/bark-normal.webp":vn,"./assets/hero-textures/foliage/bark-roughness.webp":wn,"./assets/hero-textures/foliage/canopy-base.webp":yn,"./assets/hero-textures/foliage/canopy-normal.webp":Mn,"./assets/hero-textures/foliage/canopy-roughness.webp":_n,"./assets/hero-textures/rooftops/asset-tower-roof-ao.webp":An,"./assets/hero-textures/rooftops/asset-tower-roof-base.webp":En,"./assets/hero-textures/rooftops/asset-tower-roof-normal.webp":Sn,"./assets/hero-textures/rooftops/asset-tower-roof-roughness.webp":jn,"./assets/hero-textures/rooftops/commercial-skylights-ao.webp":Rn,"./assets/hero-textures/rooftops/commercial-skylights-base.webp":Cn,"./assets/hero-textures/rooftops/commercial-skylights-normal.webp":Tn,"./assets/hero-textures/rooftops/commercial-skylights-roughness.webp":On,"./assets/hero-textures/rooftops/flat-office-hvac-ao.webp":Pn,"./assets/hero-textures/rooftops/flat-office-hvac-base.webp":Ln,"./assets/hero-textures/rooftops/flat-office-hvac-normal.webp":zn,"./assets/hero-textures/rooftops/flat-office-hvac-roughness.webp":Un,"./assets/hero-textures/rooftops/industrial-metal-units-ao.webp":Dn,"./assets/hero-textures/rooftops/industrial-metal-units-base.webp":kn,"./assets/hero-textures/rooftops/industrial-metal-units-normal.webp":Nn,"./assets/hero-textures/rooftops/industrial-metal-units-roughness.webp":In,"./assets/hero-textures/rooftops/mixed-use-service-ao.webp":Gn,"./assets/hero-textures/rooftops/mixed-use-service-base.webp":Bn,"./assets/hero-textures/rooftops/mixed-use-service-normal.webp":Fn,"./assets/hero-textures/rooftops/mixed-use-service-roughness.webp":Wn,"./assets/hero-textures/rooftops/residential-simple-ao.webp":Hn,"./assets/hero-textures/rooftops/residential-simple-base.webp":Xn,"./assets/hero-textures/rooftops/residential-simple-normal.webp":Vn,"./assets/hero-textures/rooftops/residential-simple-roughness.webp":Zn,"./assets/hero-textures/rooftops/tar-roof-vents-ao.webp":qn,"./assets/hero-textures/rooftops/tar-roof-vents-base.webp":Yn,"./assets/hero-textures/rooftops/tar-roof-vents-normal.webp":Kn,"./assets/hero-textures/rooftops/tar-roof-vents-roughness.webp":Qn,"./assets/hero-textures/streets/dark-asphalt-ao.webp":Jn,"./assets/hero-textures/streets/dark-asphalt-base.webp":$n,"./assets/hero-textures/streets/dark-asphalt-normal.webp":ea,"./assets/hero-textures/streets/dark-asphalt-roughness.webp":ta,"./assets/hero-textures/streets/dark-pavement-ao.webp":sa,"./assets/hero-textures/streets/dark-pavement-base.webp":oa,"./assets/hero-textures/streets/dark-pavement-normal.webp":na,"./assets/hero-textures/streets/dark-pavement-roughness.webp":aa,"./assets/hero-textures/streets/tiled-concrete-sidewalk-ao.webp":ra,"./assets/hero-textures/streets/tiled-concrete-sidewalk-base.webp":ia,"./assets/hero-textures/streets/tiled-concrete-sidewalk-normal.webp":ca,"./assets/hero-textures/streets/tiled-concrete-sidewalk-roughness.webp":la,"./assets/hero-textures/streets/tiled-road-patchwork-ao.webp":ua,"./assets/hero-textures/streets/tiled-road-patchwork-base.webp":da,"./assets/hero-textures/streets/tiled-road-patchwork-normal.webp":fa,"./assets/hero-textures/streets/tiled-road-patchwork-roughness.webp":ha,"./assets/hero-textures/streets/tiled-wet-asphalt-ao.webp":pa,"./assets/hero-textures/streets/tiled-wet-asphalt-base.webp":ma,"./assets/hero-textures/streets/tiled-wet-asphalt-normal.webp":ga,"./assets/hero-textures/streets/tiled-wet-asphalt-roughness.webp":xa,"./assets/hero-textures/streets/tiled-worn-asphalt-ao.webp":ba,"./assets/hero-textures/streets/tiled-worn-asphalt-base.webp":va,"./assets/hero-textures/streets/tiled-worn-asphalt-normal.webp":wa,"./assets/hero-textures/streets/tiled-worn-asphalt-roughness.webp":ya});function I(o){const s=ur[`./assets/hero-textures/${o}`];if(!s)throw new Error(`Missing hero texture: ${o}`);return s}const dr=["modern-glass-office","concrete-office","stone-classic","mixed-use-residential","dark-office-tower","retail-commercial"],fr=["flat-office-hvac","tar-roof-vents","commercial-skylights","mixed-use-service","industrial-metal-units","residential-simple"],Ts=[["#a6cfe2","#8fbfd8","#bcdeec","#7cb0cd"],["#d8d3c8","#c9c3b6","#e4e0d7","#bab3a5"],["#e6d8bb","#d8c7a4","#f0e6cf","#c9b48d"],["#d9ae95","#c99a80","#e6c4ae","#b8876c"],["#b4c4d2","#9fb3c4","#c8d5df","#8aa2b6"],["#dfc9a6","#d0b691","#ece0c4","#c0a37c"]],Os=[["#c6c8c4","#b7bab5","#d3d5d1","#a9aca6"],["#b3b6b8","#a4a8aa","#c1c4c6","#95999c"],["#c9d2d4","#b9c3c6","#d6dee0","#aab5b8"],["#cbc4b8","#bcb4a7","#d8d2c8","#ada494"],["#c0c6cc","#b0b7be","#ced4d9","#a1a9b1"],["#cbbdae","#bcac9b","#d8ccc0","#ac9a87"]],io=dr.map(o=>({color:I(`facades/${o}-base.webp`),normal:I(`facades/${o}-normal.webp`),roughness:I(`facades/${o}-roughness.webp`),emissive:I(`facades/${o}-emissive.webp`)})),co=fr.map(o=>({color:I(`rooftops/${o}-base.webp`),normal:I(`rooftops/${o}-normal.webp`),roughness:I(`rooftops/${o}-roughness.webp`),ao:I(`rooftops/${o}-ao.webp`)})),hr=["dark-asphalt","tiled-wet-asphalt","tiled-worn-asphalt","tiled-road-patchwork"],lo=hr.map(o=>({color:I(`streets/${o}-base.webp`),normal:I(`streets/${o}-normal.webp`),roughness:I(`streets/${o}-roughness.webp`),ao:I(`streets/${o}-ao.webp`)})),mt={color:I("streets/tiled-concrete-sidewalk-base.webp"),normal:I("streets/tiled-concrete-sidewalk-normal.webp"),roughness:I("streets/tiled-concrete-sidewalk-roughness.webp"),ao:I("streets/tiled-concrete-sidewalk-ao.webp")},gt={color:I("streets/dark-pavement-base.webp"),normal:I("streets/dark-pavement-normal.webp"),roughness:I("streets/dark-pavement-roughness.webp"),ao:I("streets/dark-pavement-ao.webp")},pr=[I("foliage/canopy-base.webp"),I("foliage/canopy-normal.webp"),I("foliage/canopy-roughness.webp")],mr=[I("foliage/bark-base.webp"),I("foliage/bark-normal.webp"),I("foliage/bark-roughness.webp")],gr=[2.2,2.2],xr=[1,2.4],br=new Y(.85,.85),vr=new Y(.6,.6),wr=io.flatMap(o=>[o.color,o.emissive,o.normal,o.roughness]),yr=co.flatMap(o=>[o.color,o.normal,o.roughness,o.ao]),Mr=[I("facades/asset-tower-base.webp"),I("facades/asset-tower-emissive.webp"),I("facades/asset-tower-normal.webp"),I("facades/asset-tower-roughness.webp")],_r=[I("rooftops/asset-tower-roof-base.webp"),I("rooftops/asset-tower-roof-normal.webp"),I("rooftops/asset-tower-roof-roughness.webp"),I("rooftops/asset-tower-roof-ao.webp")],Ar=lo.flatMap(o=>[o.color,o.normal,o.roughness,o.ao]),Ps=[mt.color,mt.normal,mt.roughness,mt.ao],Er=[gt.color,gt.normal,gt.roughness,gt.ao];function Sr(){const o=Ne(Ie,wr);return f.useMemo(()=>io.map((s,t)=>{const e=t*4;return{color:H(o[e],!0),emissive:H(o[e+1],!0),normal:H(o[e+2]),roughness:H(o[e+3])}}),[o])}function jr(){const o=Ne(Ie,yr);return f.useMemo(()=>co.map((s,t)=>{const e=t*4;return{color:H(o[e],!0),normal:H(o[e+1]),roughness:H(o[e+2]),ao:H(o[e+3])}}),[o])}function Rr(){const o=Ne(Ie,Mr);return f.useMemo(()=>({color:H(o[0],!0),emissive:H(o[1],!0),normal:H(o[2]),roughness:H(o[3])}),[o])}function Cr(){const o=Ne(Ie,_r);return f.useMemo(()=>({color:H(o[0],!0),normal:H(o[1]),roughness:H(o[2]),ao:H(o[3])}),[o])}function Ls(o,s){const t=Ne(Ie,o);return f.useMemo(()=>({color:H(t[0].clone(),!0,s),normal:H(t[1].clone(),!1,s),roughness:H(t[2].clone(),!1,s)}),[s,t])}function Dt(o,s){const t=Ne(Ie,o);return f.useMemo(()=>({color:H(t[0].clone(),!0,s,16),normal:H(t[1].clone(),!1,s,16),roughness:H(t[2].clone(),!1,s,16),ao:H(t[3].clone(),!1,s,16)}),[s,t])}function zs(o){const s=Ne(Ie,Ar);return f.useMemo(()=>lo.map((t,e)=>{const a=e*4;return{color:H(s[a].clone(),!0,o,16),normal:H(s[a+1].clone(),!1,o,16),roughness:H(s[a+2].clone(),!1,o,16),ao:H(s[a+3].clone(),!1,o,16)}}),[o,s])}function Tr(){const o=es/2-1.1;return[{id:"east-west-core",axis:"x",fixed:.68,start:-o,end:o,offset:.095,primary:!0},{id:"east-west-south",axis:"x",fixed:-2.08,start:-o*.92,end:o,offset:-.085},{id:"north-south-core",axis:"z",fixed:.68,start:-o,end:o,offset:-.095,primary:!0},{id:"north-south-east",axis:"z",fixed:3.44,start:-o*.86,end:o*.96,offset:.085},{id:"asset-approach",axis:"z",fixed:.95,start:-2.95,end:1.45,offset:.07,primary:!0}].flatMap((t,e)=>{const a=t.primary?5:4;return Array.from({length:a},(r,l)=>({...t,id:`${t.id}-${l}`,offset:t.offset+(l-(a-1)/2)*.026,speed:(t.primary?.13:.105)+p(e*11+l)*.065,length:(t.primary?1.45:1.08)+p(e*17+l)*.82,color:l%4===0?"#d8fdff":l%4===1?"#68f1ff":l%4===2?"#18d4ff":"#8ff7ff",delay:p(e*23+l),opacity:(t.primary?.5:.38)+p(e*29+l)*.14}))})}const xt=(()=>{const o=-12.649999999999999,s=-.1-11.55,t=Math.hypot(o,s);return{x:o/t,z:s/t}})();function kt(o,s){const t=o- -3.05,e=s- -.1;return{screenX:t*-xt.z+e*xt.x,depth:-(t*xt.x+e*xt.z)}}const Ue=8.18,Us=-8.38,Or=[9.56,10.94],Pr=11.75,Lr=400,zr=700,Ur=3e3,Dr=2e3;function os(){const o=[];let s=0;for(let c=-7;c<=7;c+=1.38)for(let u=-7;u<=7;u+=1.38){const d=Math.hypot(c,u),m=d<2.55,x=Math.abs(c)<1.9&&Math.abs(u)<2,g=Math.abs((c+.68)%2.76)<.34||Math.abs((u+.68)%2.76)<.34;if(m||x||g||p(s+3)<.1){s+=1;continue}const y=.48+p(s+7)*2.62,w=d<4.8?Math.min(y,.58+p(s+13)*.94):y,_=c>1.7&&u>1.7&&Math.abs(u-c*1.16)<2.5?Math.min(w,.62+p(s+21)*.62):w,R=p(s+18)>.54,A=.54+p(s+4)*.54,b=.5+p(s+5)*.5;o.push({id:`lot-${s}`,x:c+(p(s+1)-.5)*.22,z:u+(p(s+2)-.5)*.22,width:R?b:A,depth:R?A:b,height:_,tone:p(s+9),profile:Math.floor(p(s+11)*4),roof:Math.floor(p(s+14)*4)}),s+=1}const t=new Set,e=(c,u)=>`${c.toFixed(2)}:${u.toFixed(2)}`;let a=Lr;for(let c=-7;c<=Ue+.01;c+=1.38)for(let u=-7;u<=Ue+.01;u+=1.38){if(c<=7&&u<=7)continue;const d=kt(c,u),m=d.depth>9,x=d.screenX<-1.5;if(!m&&!x){a+=1;continue}if(t.add(e(c,u)),p(a+3)<.08){a+=1;continue}const g=p(a+18)>.54,y=.54+p(a+4)*.54,w=.5+p(a+5)*.5,v=g?w:y,_=g?y:w,R=c+(p(a+1)-.5)*.22,A=u+(p(a+2)-.5)*.22,[b,j]=Xe(R,A,.36+Math.max(v,_)/2),M=.52+p(a+7)*2.3;o.push({id:`edge-lot-${a}`,x:b,z:j,width:v,depth:_,height:m?Math.min(M,.58+p(a+21)*.52):M,tone:p(a+9),profile:Math.floor(p(a+11)*4),roof:Math.floor(p(a+14)*4)}),a+=1}let r=zr;for(let c=-7;c<=Ue+.01;c+=1.38)for(let u=-7;u<=Ue+.01;u+=1.38){if(c<=7&&u<=7||t.has(e(c,u)))continue;const d=kt(c,u);if(Math.abs(d.screenX)<=4.5)continue;if(t.add(e(c,u)),p(r+3)<.04){r+=1;continue}const m=p(r+18)>.54,x=.54+p(r+4)*.54,g=.5+p(r+5)*.5,y=m?g:x,w=m?x:g,v=c+(p(r+1)-.5)*.22,_=u+(p(r+2)-.5)*.22,[R,A]=Xe(v,_,.36+Math.max(y,w)/2);o.push({id:`infill-lot-${r}`,x:R,z:A,width:y,depth:w,height:.42+p(r+7)*.66,tone:p(r+9),profile:Math.floor(p(r+11)*4),roof:Math.floor(p(r+14)*4)}),r+=1}let l=Ur;for(let c=Us;c<=Ue+.01;c+=1.38)for(let u=Us;u<=Ue+.01;u+=1.38){if(Math.abs(c)<=7&&Math.abs(u)<=7||t.has(e(c,u)))continue;if(t.add(e(c,u)),p(l+3)<.05){l+=1;continue}const d=p(l+18)>.54,m=.54+p(l+4)*.54,x=.5+p(l+5)*.5,g=d?x:m,y=d?m:x,w=c+(p(l+1)-.5)*.22,v=u+(p(l+2)-.5)*.22,[_,R]=Xe(w,v,.36+Math.max(g,y)/2);o.push({id:`perimeter-lot-${l}`,x:_,z:R,width:g,depth:y,height:.5+p(l+7)*1.6,tone:p(l+9),profile:Math.floor(p(l+11)*4),roof:Math.floor(p(l+14)*4)}),l+=1}let i=Dr;for(const c of Or)for(let u=-7;u<=Ue+.01;u+=1.38){if(kt(u,c).screenX>=-1.5||p(i+3)<.08){i+=1;continue}const d=p(i+18)>.54,m=.54+p(i+4)*.54,x=.5+p(i+5)*.5,g=d?x:m,y=d?m:x,w=u+(p(i+1)-.5)*.22,v=c+(p(i+2)-.5)*.22,[_,R]=Xe(w,v,.36+Math.max(g,y)/2);o.push({id:`left-lot-${i}`,x:_,z:R,width:g,depth:y,height:.5+p(i+7)*1.85,tone:p(i+9),profile:Math.floor(p(i+11)*4),roof:Math.floor(p(i+14)*4)}),i+=1}return o}function kr(o){const s={masses:[],roofs:[],windows:[],litWindows:[],lobbyLights:[],bands:[],verticals:[],beacons:[],details:[]};return o.forEach((t,e)=>{const r=[[{ratio:1,inset:0}],[{ratio:.58,inset:0},{ratio:.42,inset:.18,offsetX:t.width*.055}],[{ratio:.34,inset:0},{ratio:.42,inset:.1},{ratio:.24,inset:.28,offsetZ:-t.depth*.06}],[{ratio:.72,inset:0},{ratio:.28,inset:.32,offsetX:-t.width*.09}]][t.profile];let l=0,i=t.width,c=t.depth,u=t.x,d=t.z;const m=p(e+440)>.62,x=t.x>.4&&t.z>.4,g=(t.profile+Math.floor(t.tone*yt)+(p(e+510)>.68?1:0))%yt,y=(t.roof+Math.floor(p(e+615)*Pe))%Pe;m&&s.masses.push({id:`${t.id}-podium`,position:[t.x,.085,t.z],scale:[t.width*1.12,.17,t.depth*1.12],tone:Math.min(1,t.tone+.1),variant:g});const w=Math.min(.32,t.width*.42),v=t.z+t.depth*(m?.57:.5)+.008,_=t.z-t.depth*(m?.57:.5)-.008,R=t.x+t.width*(m?.57:.5)+.008,A=t.x-t.width*(m?.57:.5)-.008,b=p(e+710)>.62;if(b&&(s.lobbyLights.push({id:`${t.id}-front-lobby`,position:[t.x+(p(e+720)-.5)*t.width*.18,.145,v],scale:[w,.13,.004],tone:p(e+730)}),s.lobbyLights.push({id:`${t.id}-back-lobby`,position:[t.x+(p(e+735)-.5)*t.width*.18,.145,_],scale:[w,.13,.004],tone:p(e+738)})),b&&p(e+740)>.68&&(s.lobbyLights.push({id:`${t.id}-side-lobby`,position:[R,.145,t.z+(p(e+750)-.5)*t.depth*.18],scale:[.004,.13,Math.min(.28,t.depth*.38)],tone:p(e+760)}),s.lobbyLights.push({id:`${t.id}-left-lobby`,position:[A,.145,t.z+(p(e+755)-.5)*t.depth*.18],scale:[.004,.13,Math.min(.28,t.depth*.38)],tone:p(e+765)})),r.forEach((C,E)=>{const O=t.height*C.ratio,T=t.width*(1-C.inset),L=t.depth*(1-C.inset*.82),Z=t.x+(C.offsetX??0),U=t.z+(C.offsetZ??0),fe=l;s.masses.push({id:`${t.id}-mass-${E}`,position:[Z,fe+O/2,U],scale:[T,O,L],tone:Ce.clamp(t.tone+E*.07,0,1),variant:g});const F=Math.max(1,Math.floor(O/.27)),ae=Math.max(2,Math.min(5,Math.floor(T/.18))),q=Math.max(2,Math.min(5,Math.floor(L/.18))),he=O/(F+1);if(O>.46){const k=Math.max(2,Math.min(4,Math.floor(T/.24))),X=Math.max(2,Math.min(4,Math.floor(L/.24)));for(let D=1;D<k;D+=1)s.verticals.push({id:`${t.id}-front-vertical-${E}-${D}`,position:[Z-T/2+D/k*T,fe+O/2,U+L/2+.012],scale:[.012,O*.92,.018],tone:t.tone});for(let D=1;D<X;D+=1)s.verticals.push({id:`${t.id}-side-vertical-${E}-${D}`,position:[Z+T/2+.012,fe+O/2,U-L/2+D/X*L],scale:[.018,O*.92,.012],tone:t.tone})}const xe=g===3,me=g===2,Ae=g===5,pe=U+L/2,oe=Z+T/2;Ae&&E===0&&T>.5&&s.details.push({id:`${t.id}-awning-${E}`,position:[Z,.2,pe+.055],scale:[T*.62,.014,.105],tone:.82});for(let k=1;k<=F;k+=1){const X=fe+k*he;if(xe&&k>1&&T>.46){for(const D of[-.24,.24]){if(p(e*53+k*17+D*100+2900)<.32)continue;const ne=Z+T*D;s.details.push({id:`${t.id}-balcony-${E}-${k}-${D}`,position:[ne,X-.022,pe+.042],scale:[T*.28,.016,.082],tone:.34}),s.details.push({id:`${t.id}-balcony-rail-${E}-${k}-${D}`,position:[ne,X+.006,pe+.081],scale:[T*.28,.04,.01],tone:.58})}p(e*61+k*23+2950)>.68&&s.details.push({id:`${t.id}-ac-${E}-${k}`,position:[oe+.018,X+.012,U+L*.22],scale:[.03,.026,.024],tone:.46})}me&&L>.44&&(s.details.push({id:`${t.id}-escape-${E}-${k}`,position:[oe+.048,X-.018,U-L*.08],scale:[.088,.013,L*.24],tone:.24}),s.details.push({id:`${t.id}-escape-rail-${E}-${k}`,position:[oe+.09,X+.014,U-L*.08],scale:[.008,.046,L*.24],tone:.66})),s.bands.push({id:`${t.id}-front-band-${E}-${k}`,position:[Z,X,U+L/2+.009],scale:[T*.94,.012,.018],tone:t.tone}),s.bands.push({id:`${t.id}-side-band-${E}-${k}`,position:[Z+T/2+.009,X,U],scale:[.018,.012,L*.94],tone:t.tone});for(let D=0;D<ae;D+=1){const ne=Z-T*.36+D/Math.max(1,ae-1)*T*.72,ce=x?1.08:.92,le=Math.min(.105,T/(ae*2.1))*ce,V=Math.min(.115,he*.54)*ce,N=p(e*83+E*29+k*13+D),Q=p(e*107+E*37+k*19+D),J=E===0&&k===Math.min(2,F)&&D===e%ae,ue=x?.68:.8;s.windows.push({id:`${t.id}-front-window-${E}-${k}-${D}`,position:[ne,X+.025,U+L/2+.006],scale:[le,V,.003],tone:N}),s.windows.push({id:`${t.id}-back-window-${E}-${k}-${D}`,position:[ne,X+.025,U-L/2-.006],scale:[le,V,.003],tone:Q}),(N>ue||J)&&s.litWindows.push({id:`${t.id}-front-light-${E}-${k}-${D}`,position:[ne,X+.025,U+L/2+.009],scale:[le*.78,V*.76,.004],tone:N}),(Q>ue||J)&&s.litWindows.push({id:`${t.id}-back-light-${E}-${k}-${D}`,position:[ne,X+.025,U-L/2-.009],scale:[le*.78,V*.76,.004],tone:Q})}for(let D=0;D<q;D+=1){const ne=U-L*.36+D/Math.max(1,q-1)*L*.72,ce=x?1.08:.92,le=Math.min(.105,L/(q*2.1))*ce,V=Math.min(.115,he*.54)*ce,N=p(e*97+E*31+k*17+D),Q=p(e*113+E*41+k*23+D),J=E===0&&k===1&&D===(e+1)%q,ue=x?.7:.82;s.windows.push({id:`${t.id}-side-window-${E}-${k}-${D}`,position:[Z+T/2+.006,X+.025,ne],scale:[.003,V,le],tone:N}),s.windows.push({id:`${t.id}-left-window-${E}-${k}-${D}`,position:[Z-T/2-.006,X+.025,ne],scale:[.003,V,le],tone:Q}),(N>ue||J)&&s.litWindows.push({id:`${t.id}-side-light-${E}-${k}-${D}`,position:[Z+T/2+.009,X+.025,ne],scale:[.004,V*.76,le*.78],tone:N}),(Q>ue||J)&&s.litWindows.push({id:`${t.id}-left-light-${E}-${k}-${D}`,position:[Z-T/2-.009,X+.025,ne],scale:[.004,V*.76,le*.78],tone:Q})}}l+=O,i=T,c=L,u=Z,d=U}),s.roofs.push({id:`${t.id}-roof-cap`,position:[u,t.height+.035,d],scale:[i*1.035,.07,c*1.035],tone:t.tone,variant:y}),t.roof===1&&s.roofs.push({id:`${t.id}-roof-house`,position:[u+i*.08,t.height+.12,d-c*.06],scale:[i*.38,.14,c*.34],tone:Math.min(1,t.tone+.14),variant:y}),t.roof===2&&s.roofs.push({id:`${t.id}-roof-spine`,position:[u,t.height+.16,d],scale:[.035,.25,Math.max(.18,c*.44)],tone:Math.min(1,t.tone+.2),variant:y}),t.roof===3){const C=.2+p(e+610)*.12;for(const E of[-.3,.3])s.roofs.push({id:`${t.id}-roof-frame-post-x-${E}`,position:[u+i*E,t.height+C/2+.07,d],scale:[.025,C,c*.42],tone:Math.min(1,t.tone+.22),variant:y});s.roofs.push({id:`${t.id}-roof-frame-beam`,position:[u,t.height+C+.065,d],scale:[i*.64,.026,c*.46],tone:Math.min(1,t.tone+.28),variant:y})}if(p(e+1520)>.42){const C=.07+p(e+1525)*.11;s.roofs.push({id:`${t.id}-roof-plant`,position:[u+(p(e+1530)-.5)*i*.34,t.height+.07+C/2,d+(p(e+1535)-.5)*c*.34],scale:[i*(.2+p(e+1540)*.18),C,c*(.2+p(e+1545)*.18)],tone:Math.min(1,t.tone+.12),variant:y})}if(p(e+1550)>.72){const C=Math.min(i,c)*.24;s.roofs.push({id:`${t.id}-roof-tank`,position:[u-i*.28,t.height+.18,d+c*.26],scale:[C,.1,C],tone:Math.min(1,t.tone+.26),variant:y}),s.roofs.push({id:`${t.id}-roof-tank-frame`,position:[u-i*.28,t.height+.115,d+c*.26],scale:[C*.66,.05,C*.66],tone:t.tone,variant:y})}const j=t.height>1.85&&p(e+1560)>.5,M=.26+p(e+1565)*.52;j&&(s.roofs.push({id:`${t.id}-roof-mast`,position:[u+i*.12,t.height+.07+M/2,d],scale:[.018,M,.018],tone:Math.min(1,t.tone+.32),variant:y}),p(e+1570)>.42&&s.beacons.push({id:`${t.id}-roof-beacon`,position:[u+i*.12,t.height+.09+M,d],scale:[.038,.038,.038],tone:p(e+1575)}))}),s}function Nr(){const o={masses:[],roofs:[],windows:[],roads:[],beacons:[]};let s=0;for(let t=-18;t<=18;t+=1)for(let e=-18;e<=18;e+=1){const a=t*1.72+1.2,r=e*1.72+1.2,l=a>-9.3&&a<9&&r>-9.3&&r<Pr,i=t%4===0||e%4===0,c=p((t+24)*101+(e+24)*53);if(l||i||c<.04)continue;const u=a+(p(s+1040)-.5)*.24,d=r+(p(s+1050)-.5)*.24,m=Math.hypot(u,d),x=Math.hypot(u-wt.x,d-wt.z),g=.66+p(s+1060)*.58,y=.62+p(s+1070)*.58,w=p(s+1080)>.89?2.2+p(s+1090)*2.4:0;let v=.58+p(s+1100)*2.42+w;x<5.8&&(v=Math.min(v,.74+p(s+1110)*.82)),m>23&&(v*=.72);const _=p(s+1120)>.68&&v>1.35,R=_?v*.72:v,A=v-R,b=_?g*(.62+p(s+1130)*.18):g,j=_?y*(.62+p(s+1140)*.18):y,M=p(s+1150);o.masses.push({id:`distant-mass-${s}`,position:[u,R/2,d],scale:[g,R,y],tone:M}),_&&o.masses.push({id:`distant-upper-${s}`,position:[u,R+A/2,d],scale:[b,A,j],tone:Math.min(1,M+.12)}),o.roofs.push({id:`distant-roof-${s}`,position:[u,v+.04,d],scale:[(_?b:g)*.94,.08,(_?j:y)*.94],tone:Math.min(1,M+.16)});const C=_?b:g,E=_?j:y;if(p(s+1310)>.42){const U=.1+p(s+1320)*.17;o.roofs.push({id:`distant-crown-housing-${s}`,position:[u+(p(s+1330)-.5)*C*.32,v+.08+U/2,d+(p(s+1340)-.5)*E*.32],scale:[C*(.24+p(s+1350)*.22),U,E*(.24+p(s+1360)*.22)],tone:Math.min(1,M+.1)})}if(p(s+1370)>.76){const U=Math.min(C,E)*.28;o.roofs.push({id:`distant-crown-tank-${s}`,position:[u-C*.26,v+.19,d+E*.24],scale:[U,.13,U],tone:Math.min(1,M+.24)}),o.roofs.push({id:`distant-crown-tank-legs-${s}`,position:[u-C*.26,v+.1,d+E*.24],scale:[U*.72,.06,U*.72],tone:M})}const O=v>2.3&&p(s+1390)>.4,T=.36+p(s+1400)*.82;O&&o.roofs.push({id:`distant-crown-mast-${s}`,position:[u+C*.1,v+.08+T/2,d],scale:[.022,T,.022],tone:Math.min(1,M+.3)}),(O||v>3.05)&&o.beacons.push({id:`distant-beacon-${s}`,position:[u+(O?C*.1:0),v+.09+(O?T:.04),d],scale:[.052,.052,.052],tone:p(s+1410)});const L=Math.max(1,Math.min(8,Math.floor(v/.36))),Z=g>.94?3:2;for(let U=1;U<=L;U+=1){const fe=U/(L+1)*R;for(let F=0;F<Z;F+=1){const ae=p(s*59+U*17+F*7+1160);if(ae<.8)continue;const q=Z===2?F===0?-.2:.2:(F-1)*.23;o.windows.push({id:`distant-front-window-${s}-${U}-${F}`,position:[u+q*g,fe,d+y/2+.006],scale:[Math.min(.074,g*.11),.062,.003],tone:ae}),p(s*67+U*23+F+1170)>.4&&o.windows.push({id:`distant-side-window-${s}-${U}-${F}`,position:[u+g/2+.006,fe,d+q*y],scale:[.003,.062,Math.min(.074,y*.11)],tone:ae})}}s+=1}for(let t=-6;t<=6;t+=1){const e=t*5.16;o.roads.push({id:`distant-road-z-${t}`,position:[e,-.012,0],scale:[.32,.02,68],tone:p(t+1200)}),o.roads.push({id:`distant-road-x-${t}`,position:[0,-.012,e],scale:[68,.02,.32],tone:p(t+1220)})}return o}function Ve(o,s,t){if(!o)return;const e=new Float32Array(s);for(let a=0;a<s;a+=1)e[a]=t(a);o.geometry.setAttribute("aPhase",new Bs(e,1))}const Mt=`
  attribute float aPhase;
  varying float vPhase;

  void main() {
    vPhase = aPhase;
    vec4 localPosition = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      localPosition = instanceMatrix * localPosition;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * localPosition;
  }
`,uo=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vPhase;

  void main() {
    // ~1.6s period. The distance to the flash is measured the short way around the cycle
    // so the pulse wraps continuously instead of being clipped at fract()'s seam.
    // Squared by hand rather than with pow(): GLSL leaves pow() undefined for a negative
    // base, and the compilers that survive it only do so by folding the literal exponent.
    float cycle = fract(uTime * 0.62 + vPhase);
    float ramp = min(cycle, 1.0 - cycle) / 0.12;
    float flash = exp(-ramp * ramp);
    gl_FragColor = vec4(uColor, uOpacity * (0.1 + flash * 0.9));
  }
`,Ir=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vPhase;

  void main() {
    // The phase bias means most windows sit permanently lit or permanently dim, and only
    // a minority swing between the two over ~90s. A skyline where every window breathes
    // together reads as an effect; one where a few switch reads as occupied.
    float slow = sin(uTime * 0.068 + vPhase * 41.0);
    float gate = smoothstep(-0.3, 0.3, slow + (vPhase - 0.5) * 1.5);
    float breathe = 0.9 + 0.1 * sin(uTime * 0.42 + vPhase * 131.0);
    gl_FragColor = vec4(uColor, uOpacity * mix(0.32, 1.0, gate) * breathe);
  }
`;function Gr({dimmed:o}){const s=f.useMemo(Nr,[]),t=f.useMemo(()=>new de,[]),e=f.useRef(null),a=f.useRef(null),r=f.useRef(null),l=f.useRef(null),i=f.useRef(null),c=f.useMemo(()=>{var m;return typeof window<"u"&&((m=window.matchMedia)==null?void 0:m.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),u=f.useMemo(()=>({uColor:{value:new W("#ff6a52")},uOpacity:{value:.9},uTime:{value:0}}),[]),d=f.useMemo(()=>({uColor:{value:new W("#9ae8f7")},uOpacity:{value:.95},uTime:{value:0}}),[]);return f.useEffect(()=>{u.uColor.value.set(o?"#c2503f":"#ff6a52"),u.uOpacity.value=o?.62:.9,d.uColor.value.set(o?"#57a9bd":"#9ae8f7"),d.uOpacity.value=o?.6:.95},[u,o,d]),ge(({clock:m})=>{const x=c?4.2:m.elapsedTime;u.uTime.value=x,d.uTime.value=x}),f.useEffect(()=>{const m=["#3c545e","#4a6874","#5a7b88","#6c8f9c"],x=["#556d76","#647f89","#74919c","#85a2ad"],g=["#1e3944","#24444f","#294d58","#2f5661"],y=(v,_,R)=>{v&&(_.forEach((A,b)=>{t.position.set(...A.position),t.scale.set(...A.scale),t.updateMatrix(),v.setMatrixAt(b,t.matrix),v.setColorAt(b,new W(R[Math.min(R.length-1,Math.floor(A.tone*R.length))]))}),ie(v))},w=(v,_)=>{if(!v)return;_.forEach((A,b)=>{t.position.set(...A.position),t.scale.set(...A.scale),t.updateMatrix(),v.setMatrixAt(b,t.matrix)}),v.instanceColor=null,ie(v),(Array.isArray(v.material)?v.material:[v.material]).forEach(A=>{A.needsUpdate=!0})};y(e.current,s.masses,m),y(a.current,s.roofs,x),w(r.current,s.windows),y(l.current,s.roads,g),w(i.current,s.beacons),Ve(r.current,s.windows.length,v=>p(v*7+1500)),Ve(i.current,s.beacons.length,v=>s.beacons[v].tone)},[t,s]),n.jsxs("group",{children:[n.jsxs("mesh",{position:[0,-.09,0],receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[70,.1,70]}),n.jsx("meshStandardMaterial",{color:"#1c3038",roughness:.96,metalness:0})]}),n.jsxs("instancedMesh",{ref:l,args:[null,null,s.roads.length],frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{vertexColors:!0,transparent:!0,opacity:o?.12:.22,depthWrite:!1,blending:K,toneMapped:!1})]}),n.jsxs("instancedMesh",{ref:e,args:[null,null,s.masses.length],frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,color:o?"#74858b":"#a9babf",emissive:"#16374a",emissiveIntensity:o?.05:.1,roughness:.92,metalness:0})]}),n.jsxs("instancedMesh",{ref:a,args:[null,null,s.roofs.length],frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,color:o?"#8b9a9f":"#c9d7da",emissive:"#1e4552",emissiveIntensity:o?.05:.1,roughness:.9,metalness:0})]}),n.jsxs("instancedMesh",{ref:r,args:[null,null,s.windows.length],frustumCulled:!1,renderOrder:1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("shaderMaterial",{uniforms:d,vertexShader:Mt,fragmentShader:Ir,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]}),n.jsxs("instancedMesh",{ref:i,args:[null,null,s.beacons.length],frustumCulled:!1,renderOrder:2,children:[n.jsx("sphereGeometry",{args:[.5,6,5]}),n.jsx("shaderMaterial",{uniforms:u,vertexShader:Mt,fragmentShader:uo,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]}),n.jsxs("mesh",{position:[0,-.004,0],rotation:[-Math.PI/2,0,0],children:[n.jsx("ringGeometry",{args:[14,32,128]}),n.jsx("meshBasicMaterial",{color:"#2a6070",transparent:!0,opacity:o?.018:.035,depthWrite:!1})]})]})}const Br=`
  varying vec3 vDirection;

  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,Fr=`
  precision highp float;

  uniform float uTime;
  uniform float uIntensity;
  uniform float uNight;
  varying vec3 vDirection;

  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;

  float hash21(vec2 value) {
    value = fract(value * vec2(123.34, 456.21));
    value += dot(value, value + 45.32);
    return fract(value.x * value.y);
  }

  float noise21(vec2 value) {
    vec2 cell = floor(value);
    vec2 local = fract(value);
    local = local * local * (3.0 - 2.0 * local);

    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));

    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  float fbm(vec2 value) {
    float result = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      result += noise21(value) * amplitude;
      value = value * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return result;
  }

  // One star field. grid sets density, threshold how many cells hold a star, and
  // rateScale how hard they scintillate — the faint far layer twinkles less than the
  // bright near one, which is what keeps the two reading as different distances.
  vec3 starLayer(vec2 skyUv, vec2 grid, float threshold, float sizeLow, float sizeHigh, float rateScale, float time) {
    vec2 cell = floor(skyUv * grid);
    vec2 offset = fract(skyUv * grid) - 0.5;
    float seed = hash21(cell);
    float presence = smoothstep(threshold, threshold + 0.004, seed);
    if (presence <= 0.0) return vec3(0.0);

    float size = mix(sizeLow, sizeHigh, hash21(cell + 19.37));
    float core = 1.0 - smoothstep(0.0, size, length(offset));
    // Two incommensurate rates per star. A single sine makes the whole field settle into
    // one visible shared rhythm, which reads as a pulsing effect rather than as stars.
    float rateA = (1.35 + hash21(cell + 3.31) * 2.3) * rateScale;
    float rateB = (0.62 + hash21(cell + 8.17) * 1.15) * rateScale;
    float twinkle =
      0.52 + 0.3 * sin(time * rateA + seed * 61.0) + 0.18 * sin(time * rateB + seed * 23.0);
    vec3 tint = mix(vec3(0.58, 0.78, 1.0), vec3(0.94, 1.0, 1.0), hash21(cell + 7.9));
    return tint * core * presence * max(0.0, twinkle);
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float elevation = asin(clamp(direction.y, -1.0, 1.0));
    float longitude = atan(direction.z, direction.x);
    float skyHeight = smoothstep(-0.08, 0.78, elevation);

    vec3 darkZenith = vec3(0.008, 0.03, 0.068);
    vec3 darkHorizon = vec3(0.035, 0.205, 0.305);
    vec3 lightZenith = vec3(0.47, 0.66, 0.84);
    vec3 lightHorizon = vec3(0.69, 0.84, 0.94);
    vec3 zenith = mix(lightZenith, darkZenith, uNight);
    vec3 horizon = mix(lightHorizon, darkHorizon, uNight);
    vec3 color = mix(horizon, zenith, skyHeight);

    float horizonLine = exp(-abs(elevation + 0.005) * 13.0);
    color += mix(vec3(0.07, 0.13, 0.18), vec3(0.035, 0.35, 0.47), uNight) * horizonLine * 0.58;

    vec2 skyUv = vec2(longitude / TAU + 0.5, elevation / PI + 0.5);
    // The camera pitches down ~25.6 degrees with a 26-degree half-fov, so the top of the
    // frame sits at roughly +0.4 degrees of elevation and every visible scrap of sky is
    // in the first two degrees above the horizon. The old ramp only reached full
    // brightness at +5.4 degrees, which put the entire star field above the frame.
    // Fully lit by 0 degrees rather than above it: the whole visible strip lives in the
    // two degrees around the horizon, so any ramp that finishes above 0 leaves the strip
    // dim. Stars fading in slightly below 0 is harmless — the distant city and the ground
    // paint over the sky sphere, so they only ever show in the gaps between far towers.
    float starVisibility = smoothstep(-0.04, 0.0, elevation) * uNight;
    // Two layers rather than one: a single grid either reads as a scatter of lone dots or
    // as noise, while a sparse bright field over a denser faint one gives the sky depth.
    vec3 stars =
      starLayer(skyUv, vec2(680.0, 330.0), 0.978, 0.05, 0.13, 1.0, uTime) +
      starLayer(skyUv, vec2(1240.0, 590.0), 0.984, 0.055, 0.1, 0.72, uTime) * 0.5;
    // The visible band is also the brightest part of the sky — horizon glow plus aurora —
    // so the stars need far more punch here than they would against a zenith. These
    // coefficients were dialled in against the live hero, not derived.
    color += stars * starVisibility * (5.7 + 3.0 * uIntensity);

    float broadNoise = fbm(vec2(longitude * 1.55 + uTime * 0.003, elevation * 3.25));
    float fineNoise = fbm(vec2(longitude * 7.4 - uTime * 0.006, elevation * 2.1 + broadNoise));
    float auroraCurve =
      0.105 +
      sin(longitude * 1.55 + uTime * 0.018) * 0.045 +
      sin(longitude * 4.1 - uTime * 0.011 + broadNoise * 1.8) * 0.025;
    float auroraDistance = abs(elevation - auroraCurve);
    float mainRibbon = exp(-pow(auroraDistance / 0.072, 2.0));
    float softCurtain = exp(-pow(auroraDistance / 0.16, 2.0));
    float strands = pow(0.5 + 0.5 * sin(longitude * 38.0 + fineNoise * 6.0), 3.0);
    float auroraSector = smoothstep(-0.52, 0.52, cos(longitude + 2.36));
    float auroraSkyMask = smoothstep(-0.015, 0.055, elevation) * (1.0 - smoothstep(0.42, 0.68, elevation));
    float aurora =
      (mainRibbon * (0.38 + strands * 0.9) + softCurtain * strands * 0.22) *
      auroraSector *
      auroraSkyMask;

    float colorShift = smoothstep(0.22, 0.82, fineNoise + sin(longitude * 2.7) * 0.16);
    vec3 auroraTeal = vec3(0.05, 0.94, 0.69);
    vec3 auroraViolet = vec3(0.39, 0.49, 1.0);
    vec3 auroraColor = mix(auroraTeal, auroraViolet, colorShift);
    color += auroraColor * aurora * (0.2 + 0.2 * uNight) * uIntensity;

    float upperHaze = fbm(vec2(longitude * 2.4, elevation * 5.0 + uTime * 0.002));
    color += vec3(0.045, 0.2, 0.28) * upperHaze * smoothstep(0.03, 0.18, elevation) *
      (1.0 - smoothstep(0.42, 0.72, elevation)) * 0.16 * uNight;

    gl_FragColor = vec4(color, 1.0);
  }
`;function Wr({theme:o,focused:s}){const t=f.useRef(null),e=f.useMemo(()=>{var r;return typeof window<"u"&&((r=window.matchMedia)==null?void 0:r.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),a=f.useMemo(()=>({uTime:{value:e?7.5:0},uIntensity:{value:1},uNight:{value:o==="dark"?1:.08}}),[e,o]);return ge(({camera:r,clock:l},i)=>{if(!t.current)return;t.current.position.copy(r.position);const c=t.current.material;c.uniforms.uTime.value=e?7.5:l.elapsedTime,c.uniforms.uIntensity.value=Ce.lerp(c.uniforms.uIntensity.value,s?.58:1,1-Math.exp(-i*1.6))}),n.jsxs("mesh",{ref:t,renderOrder:-1e3,frustumCulled:!1,children:[n.jsx("sphereGeometry",{args:[48,72,40]}),n.jsx("shaderMaterial",{uniforms:a,vertexShader:Br,fragmentShader:Fr,side:Zt,depthWrite:!1,depthTest:!1,toneMapped:!1})]})}function Hr({focused:o,blockOrbit:s,frameMainBuildingRight:t=!1}){const e=f.useRef(null),a=t,r=f.useMemo(()=>{var b;return typeof window<"u"&&((b=window.matchMedia)==null?void 0:b.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),[l,i]=f.useState(()=>r),[c,u]=f.useState(!1),d=f.useRef(r?1:0),m=f.useRef(!1),x=l&&!c&&!s,g=re(b=>b.size),y=a&&g.width>0&&g.width<g.height,w=a?y?Ja:Qa:wt,v=a?y?to:$s:bt,_=a?y?eo:Js:Ys,R=a?_:Za,A=a?_:qa;return f.useEffect(()=>{r&&(d.current=1,i(!0))},[r]),f.useLayoutEffect(()=>{if(!a)return;let b=0,j=!1;const M=()=>{if(j)return;const C=e.current;if(!C){b=requestAnimationFrame(M);return}const E=!r&&d.current<1;C.object.position.copy(E?v:w),C.target.copy(_),C.update()};return M(),()=>{j=!0,cancelAnimationFrame(b)}},[a,w,_,r,v]),f.useEffect(()=>{if(!m.current){m.current=!0;return}u(!0);const b=window.setTimeout(()=>u(!1),o?1350:1050);return()=>window.clearTimeout(b)},[o]),ge(({camera:b,clock:j},M)=>{const C=e.current;if(!C)return;if(!l&&!o){const O=a?.32:.2;d.current=Math.min(1,d.current+M*O);const T=1-Math.pow(1-d.current,3);b.position.lerpVectors(v,w,T),a||(b.position.x+=Math.sin(j.elapsedTime*.2)*.08),C.target.lerpVectors(R,_,T),C.update(),d.current>=1&&(b.position.copy(w),C.target.copy(_),C.update(),i(!0));return}if(c){b.position.lerp(o?Va:w,o?.052:.045),C.target.lerp(o?A:_,o?.06:.05),C.update();return}if(a&&!o){C.update();return}const E=o?{x:1.85,z:1.45,yMin:1.4,yMax:2.5}:{x:3.25,z:1,yMin:.9,yMax:1.85};C.target.x=Ce.clamp(C.target.x,-E.x,E.x),C.target.z=Ce.clamp(C.target.z,-E.z,E.z),C.target.y=Ce.clamp(C.target.y,E.yMin,E.yMax),C.update()}),n.jsx(Ha,{ref:e,makeDefault:!0,enabled:x,...a?{target:[_.x,_.y,_.z]}:{},enablePan:x&&!a,enableRotate:x,enableZoom:!1,autoRotate:!a&&!r&&l&&!o&&!c&&!s,autoRotateSpeed:.08,dampingFactor:.075,enableDamping:!0,minDistance:o?7.4:a?7.6:10.6,maxDistance:o?10.2:a?13.4:15.3,minAzimuthAngle:o?-.32:a?-1.85:-.74,maxAzimuthAngle:o?.44:a?1.55:.66,minPolarAngle:o?.91:a?.78:.72,maxPolarAngle:o?1.24:1.28,panSpeed:.22,rotateSpeed:.36,zoomSpeed:.46})}function Xr({roads:o}){const s=f.useRef(null),t=f.useMemo(()=>new de,[]),e=f.useMemo(()=>o.filter(a=>a.width>=.5).flatMap(a=>{const r=[],l=Math.ceil(a.length/1.18);for(let i=0;i<l;i+=1){const c=a.center-a.length/2+.72+i*1.18;Math.abs(at(c))<.55||r.push({position:a.axis==="z"?[a.fixed,.052,c]:[c,.052,a.fixed],scale:a.axis==="z"?[.018,.008,.42]:[.42,.008,.018]})}return r}),[o]);return f.useEffect(()=>{s.current&&(e.forEach((a,r)=>{var l;t.position.set(...a.position),t.scale.set(...a.scale),t.updateMatrix(),(l=s.current)==null||l.setMatrixAt(r,t.matrix)}),s.current.instanceMatrix.needsUpdate=!0)},[e,t]),n.jsxs("instancedMesh",{ref:s,args:[null,null,e.length],children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{color:"#e4fbff",transparent:!0,opacity:.62,depthWrite:!1,blending:K,toneMapped:!1})]})}const Vr=`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,Zr=`
  precision highp float;

  uniform vec3 uCoreColor;
  uniform vec3 uWashColor;
  uniform float uAxis;
  uniform float uEdgePos;
  uniform float uOpacity;
  /** Maps this strip's 0..1 run onto its world coordinate: world = base + along * scale. */
  uniform float uAlongBase;
  uniform float uAlongScale;
  uniform float uGridStep;
  uniform float uGridOffset;
  varying vec2 vUv;

  void main() {
    float across = mix(vUv.x, vUv.y, uAxis);
    float along = mix(vUv.y, vUv.x, uAxis);
    float lateral = abs(across - 0.5) * 2.0;

    // Squared by hand. lateral - uEdgePos is negative across the entire carriageway
    // (uEdgePos sits out at the kerb, ~0.71) and GLSL leaves pow() undefined for a negative
    // base — the old form only survived because compilers fold a literal exponent into a
    // multiply. One driver that does not, and every road turns to NaN.
    float centreRamp = lateral / 0.05;
    float railRamp = (lateral - uEdgePos) / 0.052;
    float centre = exp(-centreRamp * centreRamp);
    float rails = exp(-railRamp * railRamp);
    float wash = pow(max(0.0, 1.0 - lateral), 2.4);
    float endFade = smoothstep(0.0, 0.05, along) * (1.0 - smoothstep(0.95, 1.0, along));

    // Each strip spans its whole street, so without this one road's kerb rails run straight
    // across the carriageway of every road it crosses, and two strips meeting drew a bright
    // square lattice at every junction. A real junction has no kerb through it: the rails
    // open up and only the centre line carries on.
    float world = uAlongBase + along * uAlongScale;
    float toCross = abs(mod(world - uGridOffset + uGridStep * 0.5, uGridStep) - uGridStep * 0.5);
    float junction = smoothstep(0.17, 0.45, toCross);
    rails *= junction;
    wash *= mix(0.42, 1.0, junction);
    centre *= mix(0.7, 1.0, junction);

    vec3 color = uCoreColor * (centre + rails * 0.92) + uWashColor * wash * 0.6;
    float alpha = (centre * 0.85 + rails * 0.72 + wash * 0.16) * endFade * uOpacity;

    gl_FragColor = vec4(color, alpha);
  }
`;function qr({road:o}){const s=o.width>=.5,t=o.width+.2,e=f.useMemo(()=>({uCoreColor:{value:new W(s?"#b6f6ff":"#93e2f4")},uWashColor:{value:new W("#3fb6d8")},uAxis:{value:o.axis==="z"?0:1},uEdgePos:{value:o.width/t},uOpacity:{value:s?.68:.46},uAlongBase:{value:o.axis==="z"?o.center+o.length/2:o.center-o.length/2},uAlongScale:{value:o.axis==="z"?-o.length:o.length},uGridStep:{value:Re},uGridOffset:{value:Le}}),[t,s,o.axis,o.center,o.length,o.width]);return n.jsxs("mesh",{position:o.axis==="z"?[o.fixed,.036,o.center]:[o.center,.036,o.fixed],rotation:[-Math.PI/2,0,0],renderOrder:1,children:[n.jsx("planeGeometry",{args:o.axis==="z"?[t,o.length]:[o.length,t]}),n.jsx("shaderMaterial",{uniforms:e,vertexShader:Vr,fragmentShader:Zr,transparent:!0,depthWrite:!1,blending:K,toneMapped:!1})]})}function Yr({intersections:o}){const s=f.useRef(null),t=f.useMemo(()=>new de,[]);return f.useEffect(()=>{s.current&&(o.forEach((e,a)=>{var r;t.position.set(e.x,.044,e.z),t.scale.set(1,1,1),t.updateMatrix(),(r=s.current)==null||r.setMatrixAt(a,t.matrix)}),s.current.instanceColor=null,ie(s.current))},[t,o]),n.jsxs("instancedMesh",{ref:s,args:[null,null,o.length],frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[.46,.008,.46]}),n.jsx("meshBasicMaterial",{color:"#5fc4e0",transparent:!0,opacity:.22,depthWrite:!1,blending:K,toneMapped:!1})]})}const Kr=`
  precision highp float;

  uniform float uTime;
  uniform float uOpacity;
  varying float vPhase;

  void main() {
    // One lamp per head rather than a three-lamp stack: a signal head is a couple of
    // pixels at this camera, so the colour itself has to carry the state.
    float cycle = fract(uTime * 0.105 + vPhase);
    vec3 green = vec3(0.24, 1.0, 0.51);
    vec3 amber = vec3(1.0, 0.68, 0.16);
    vec3 red = vec3(1.0, 0.26, 0.2);
    vec3 color = cycle < 0.44 ? green : (cycle < 0.54 ? amber : red);
    // Amber is the shortest phase, so give it a lift or it reads as a dropped frame.
    float punch = cycle >= 0.44 && cycle < 0.54 ? 1.25 : 1.0;
    gl_FragColor = vec4(color, uOpacity * punch);
  }
`;function Qr({intersections:o}){const s=f.useRef(null),t=f.useRef(null),e=f.useMemo(()=>new de,[]),a=f.useMemo(()=>{var i;return typeof window<"u"&&((i=window.matchMedia)==null?void 0:i.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),r=f.useMemo(()=>({uTime:{value:0},uOpacity:{value:.9}}),[]),l=f.useMemo(()=>{const i=[];return o.forEach((c,u)=>{if(Math.hypot(c.x,c.z)>11)return;const d=p(u+1900);i.push({x:c.x+.36,z:c.z+.36,phase:d}),i.push({x:c.x-.36,z:c.z-.36,phase:(d+.5)%1})}),i},[o]);return ge(({clock:i})=>{r.uTime.value=a?2.1:i.elapsedTime}),f.useEffect(()=>{l.forEach((i,c)=>{var u,d;e.position.set(i.x,.17,i.z),e.scale.set(1,1,1),e.updateMatrix(),(u=s.current)==null||u.setMatrixAt(c,e.matrix),e.position.set(i.x,.345,i.z),e.updateMatrix(),(d=t.current)==null||d.setMatrixAt(c,e.matrix)});for(const i of[s.current,t.current])i&&(i.instanceColor=null,ie(i));Ve(t.current,l.length,i=>l[i].phase)},[e,l]),n.jsxs("group",{children:[n.jsxs("instancedMesh",{ref:s,args:[null,null,l.length],castShadow:!0,children:[n.jsx("boxGeometry",{args:[.016,.34,.016]}),n.jsx("meshStandardMaterial",{color:"#4a5a63",roughness:.85,metalness:0})]}),n.jsxs("instancedMesh",{ref:t,args:[null,null,l.length],renderOrder:2,frustumCulled:!1,children:[n.jsx("sphereGeometry",{args:[.026,6,5]}),n.jsx("shaderMaterial",{uniforms:r,vertexShader:Mt,fragmentShader:Kr,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]})]})}const Jr=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    // Soft edges. A hard-edged rectangle on asphalt reads as a decal pasted on top; a
    // resurfacing patch feathers into the road around it.
    vec2 distanceFromCentre = abs(vUv - 0.5) * 2.0;
    float edge =
      (1.0 - smoothstep(0.5, 1.0, distanceFromCentre.x)) *
      (1.0 - smoothstep(0.5, 1.0, distanceFromCentre.y));
    if (edge < 0.01) discard;
    gl_FragColor = vec4(uColor, edge * uOpacity);
  }
`;function ns(o,s,t){const e=[],a=o.center-o.length/2+t,r=o.center+o.length/2-t;for(let l=a,i=0;l<=r;l+=s,i+=1)e.push({travel:l,index:i});return e}function rt(o,s,t){return o.axis==="z"?[o.fixed+t,s]:[s,o.fixed+t]}function $r({roads:o}){const s=f.useRef(null),t=f.useRef(null),e=f.useMemo(()=>new de,[]),a=f.useMemo(()=>({uColor:{value:new W("#131b20")},uOpacity:{value:.5}}),[]),{manholes:r,patches:l}=f.useMemo(()=>{const i=[],c=[];return o.forEach((u,d)=>{u.width<.4||ns(u,1.55,1.2).forEach(({travel:m,index:x})=>{const g=d*71+x*13;if(p(g+2500)>.62){const y=(p(g+2510)>.5?1:-1)*u.width*.26,[w,v]=rt(u,m,y);Math.hypot(w,v)<12&&i.push({x:w,z:v,size:.042+p(g+2520)*.016})}if(p(g+2530)>.72){const y=(p(g+2540)-.5)*u.width*.6,[w,v]=rt(u,m+.4,y);if(Math.hypot(w,v)<12){const _=.22+p(g+2550)*.36,R=.14+p(g+2560)*.2;c.push({x:w,z:v,width:u.axis==="z"?R:_,depth:u.axis==="z"?_:R,tone:p(g+2570)})}}})}),{manholes:i,patches:c}},[o]);return f.useEffect(()=>{s.current&&(r.forEach((i,c)=>{var u;e.position.set(i.x,.032,i.z),e.rotation.set(-Math.PI/2,0,0),e.scale.setScalar(i.size),e.updateMatrix(),(u=s.current)==null||u.setMatrixAt(c,e.matrix)}),s.current.instanceColor=null,ie(s.current)),t.current&&(l.forEach((i,c)=>{var u;e.position.set(i.x,.031,i.z),e.rotation.set(-Math.PI/2,0,0),e.scale.set(i.width,i.depth,1),e.updateMatrix(),(u=t.current)==null||u.setMatrixAt(c,e.matrix)}),t.current.instanceColor=null,ie(t.current))},[e,r,l]),n.jsxs("group",{children:[n.jsxs("instancedMesh",{ref:s,args:[null,null,r.length],frustumCulled:!1,children:[n.jsx("circleGeometry",{args:[1,12]}),n.jsx("meshStandardMaterial",{color:"#20282d",roughness:.52,metalness:.55})]}),n.jsxs("instancedMesh",{ref:t,args:[null,null,l.length],frustumCulled:!1,children:[n.jsx("planeGeometry",{args:[1,1]}),n.jsx("shaderMaterial",{uniforms:a,vertexShader:At,fragmentShader:Jr,transparent:!0,depthWrite:!1})]})]})}function ei({intersections:o}){const s=f.useRef(null),t=f.useMemo(()=>new de,[]),e=f.useMemo(()=>{const a=[];return o.forEach(i=>{if(!(Math.hypot(i.x,i.z)>11))for(let c=0;c<6;c+=1){const u=-.15+c*.06;for(const d of[-1,1])a.push({position:[i.x+u,.052,i.z+d*.44],scale:[.032,.008,.22]}),a.push({position:[i.x+d*.44,.052,i.z+u],scale:[.22,.008,.032]})}}),a},[o]);return f.useEffect(()=>{s.current&&(e.forEach((a,r)=>{var l;t.position.set(...a.position),t.scale.set(...a.scale),t.updateMatrix(),(l=s.current)==null||l.setMatrixAt(r,t.matrix)}),s.current.instanceColor=null,ie(s.current))},[t,e]),n.jsxs("instancedMesh",{ref:s,args:[null,null,e.length],frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{color:"#e8fbff",transparent:!0,opacity:.5,depthWrite:!1,blending:K,toneMapped:!1})]})}function ti({roads:o}){const s=f.useRef(null),t=f.useRef(null),e=f.useMemo(()=>new de,[]),a=f.useMemo(()=>{const r=[];return o.forEach((l,i)=>{l.width<.4||ns(l,.42,.9).forEach(({travel:c,index:u})=>{if(Math.abs(at(c))<.62)return;const d=i*97+u*29;for(const m of[-1,1]){if(p(d+(m>0?2600:2700))<.58)continue;const x=m*(l.width/2-.055),[g,y]=rt(l,c,x);Math.hypot(g,y)>11.5||r.push({x:g,z:y,alongZ:l.axis==="z",length:.1+p(d+2800)*.042,height:.042+p(d+2810)*.014,tone:p(d+2820),facing:m})}})}),r},[o]);return f.useEffect(()=>{const r=["#2b343c","#3a444d","#232c33","#46525c","#2f3a44","#525e69"];s.current&&(a.forEach((l,i)=>{var c,u;e.position.set(l.x,l.height/2+.031,l.z),e.rotation.set(0,0,0),e.scale.set(l.alongZ?.052:l.length,l.height,l.alongZ?l.length:.052),e.updateMatrix(),(c=s.current)==null||c.setMatrixAt(i,e.matrix),(u=s.current)==null||u.setColorAt(i,new W(r[Math.min(r.length-1,Math.floor(l.tone*r.length))]))}),ie(s.current)),t.current&&(a.forEach((l,i)=>{var u;const c=l.length/2*l.facing;e.position.set(l.x+(l.alongZ?0:c),l.height*.62+.031,l.z+(l.alongZ?c:0)),e.scale.set(l.alongZ?.042:.006,.009,l.alongZ?.006:.042),e.updateMatrix(),(u=t.current)==null||u.setMatrixAt(i,e.matrix)}),t.current.instanceColor=null,ie(t.current))},[a,e]),n.jsxs("group",{children:[n.jsxs("instancedMesh",{ref:s,args:[null,null,a.length],castShadow:!0,frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,roughness:.42,metalness:.32})]}),n.jsxs("instancedMesh",{ref:t,args:[null,null,a.length],frustumCulled:!1,renderOrder:2,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{color:"#ff6a52",transparent:!0,opacity:.42,depthWrite:!1,blending:K,toneMapped:!1})]})]})}function si({roads:o}){const s=f.useRef(null),t=f.useRef(null),e=f.useRef(null),a=f.useMemo(()=>new de,[]),{boxes:r,posts:l,panels:i}=f.useMemo(()=>{const c=[],u=[],d=[];return o.forEach((m,x)=>{if(m.width<.4)return;const g=m.axis==="z",y=(m.width+.16)/2+.1;ns(m,1.35,1.4).forEach(({travel:w,index:v})=>{if(Math.abs(at(w))<.55)return;const _=x*131+v*37,R=p(_+3e3)>.5?1:-1,[A,b]=rt(m,w,R*y);if(Math.hypot(A,b)>11)return;const j=C=>g?[.05,.02,C]:[C,.02,.05],M=p(_+3010);if(M>.82){c.push({position:[A,.2,b],scale:g?[.13,.018,.3]:[.3,.018,.13],tone:.7}),c.push({position:[A+(g?R*.058:0),.11,b+(g?0:R*.058)],scale:g?[.012,.17,.3]:[.3,.17,.012],tone:.42});for(const E of[-1,1])u.push({position:[A+(g?0:E*.3/2),.1,b+(g?E*.3/2:0)],scale:[.012,.2,.012],tone:.3});d.push({position:[A+(g?R*.052:0),.115,b+(g?0:R*.052)],scale:g?[.006,.12,.1]:[.1,.12,.006]})}else if(M>.6)c.push({position:[A,.048,b],scale:j(.15),tone:.5}),c.push({position:[A+(g?R*-.022:0),.072,b+(g?0:R*-.022)],scale:g?[.01,.045,.15]:[.15,.045,.01],tone:.62});else if(M>.44)u.push({position:[A,.032,b],scale:[.055,.064,.055],tone:.36});else if(M>.3)u.push({position:[A,.028,b],scale:[.032,.056,.032],tone:.86});else if(M>.12)for(const C of[-1,0,1]){const[E,O]=rt(m,w+C*.14,R*y);u.push({position:[E,.026,O],scale:[.02,.052,.02],tone:.2})}})}),{boxes:c,posts:u,panels:d}},[o]);return f.useEffect(()=>{const c=["#3b464d","#4c585f","#5e6a72","#78858d","#94a2a9"],u=(d,m,x)=>{d&&(m.forEach((g,y)=>{if(a.position.set(...g.position),a.scale.set(...g.scale),a.updateMatrix(),d.setMatrixAt(y,a.matrix),x){const w=g.tone??.5;d.setColorAt(y,new W(c[Math.min(c.length-1,Math.floor(w*c.length))]))}}),x||(d.instanceColor=null),ie(d))};u(s.current,r,!0),u(t.current,l,!0),u(e.current,i,!1)},[r,a,i,l]),n.jsxs("group",{children:[n.jsxs("instancedMesh",{ref:s,args:[null,null,r.length],castShadow:!0,frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,roughness:.72,metalness:.18})]}),n.jsxs("instancedMesh",{ref:t,args:[null,null,l.length],castShadow:!0,frustumCulled:!1,children:[n.jsx("cylinderGeometry",{args:[.5,.5,1,8]}),n.jsx("meshStandardMaterial",{vertexColors:!0,roughness:.66,metalness:.24})]}),n.jsxs("instancedMesh",{ref:e,args:[null,null,i.length],renderOrder:1,frustumCulled:!1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{color:"#9fe8ff",transparent:!0,opacity:.5,depthWrite:!1,blending:K,toneMapped:!1})]})]})}function oi(){const o=Dt(Er,sr),s=Dt(Ps,As),t=Dt(Ps,Es),e=zs(As),a=zs(Es),r=f.useMemo(()=>{const i=[],c=u=>{const d=p(u+1610);return d<.52?1:d<.74?2:d<.89?3:0};for(let u=De;u<=Bt;u+=1){const d=Math.abs(u)>3;i.push({id:`north-${u}`,axis:"z",fixed:u*Re+Le,length:nt,center:ao,width:d?.42:.5,variant:c(u*13)})}for(let u=De;u<=Ft;u+=1){const d=Math.abs(u)>3;i.push({id:`east-${u}`,axis:"x",fixed:u*Re+Le,length:es,center:0,width:d?.42:.5,variant:c(u*29+7)})}return i.push({id:"asset-approach",axis:"z",fixed:.97,length:6.4,center:0,width:.22,variant:1}),i},[]),l=f.useMemo(()=>Array.from({length:Bt-De+1},(i,c)=>Array.from({length:Ft-De+1},(u,d)=>({id:`intersection-${c}-${d}`,x:(c+De)*Re+Le,z:(d+De)*Re+Le}))).flat(),[]);return n.jsxs("group",{children:[n.jsxs("mesh",{rotation:[-Math.PI/2,0,0],position:[0,-.015,er],receiveShadow:!0,children:[n.jsx("planeGeometry",{args:[no,ts]}),n.jsx("meshStandardMaterial",{map:o.color,normalMap:o.normal,normalScale:ir,roughnessMap:o.roughness,aoMap:o.ao,aoMapIntensity:.18,color:"#b6c4c8",roughness:1,metalness:0})]}),r.map(i=>{const c=i.axis==="z",u=c?s:t,d=c?e:a,m=d[i.variant]??d[0],x=c?0:.0016;return n.jsxs("group",{children:[n.jsxs("mesh",{position:i.axis==="z"?[i.fixed,.002,i.center]:[i.center,.002+x,i.fixed],receiveShadow:!0,children:[n.jsx("boxGeometry",{args:i.axis==="z"?[i.width+.16,.022,i.length]:[i.length,.022,i.width+.16]}),n.jsx("meshStandardMaterial",{map:u.color,normalMap:u.normal,normalScale:cr,roughnessMap:u.roughness,aoMap:u.ao,aoMapIntensity:.16,color:"#7d888e",roughness:1,metalness:0})]}),n.jsxs("mesh",{position:i.axis==="z"?[i.fixed,.018,i.center]:[i.center,.018+x,i.fixed],receiveShadow:!0,children:[n.jsx("boxGeometry",{args:i.axis==="z"?[i.width,.024,i.length]:[i.length,.024,i.width]}),n.jsx("meshStandardMaterial",{map:m.color,normalMap:m.normal,normalScale:lr,roughnessMap:m.roughness,aoMap:m.ao,aoMapIntensity:.22,color:"#5f6a70",roughness:.64,metalness:0})]}),n.jsx(qr,{road:i})]},i.id)}),n.jsx(Yr,{intersections:l}),n.jsx(Qr,{intersections:l}),n.jsx(Xr,{roads:r}),n.jsx($r,{roads:r}),n.jsx(si,{roads:r}),n.jsx(ei,{intersections:l}),n.jsx(ti,{roads:r}),n.jsxs("mesh",{rotation:[-Math.PI/2,0,0],position:[0,.01,0],children:[n.jsx("ringGeometry",{args:[2.1,13.6,128]}),n.jsx("meshBasicMaterial",{color:"#4ecbe2",transparent:!0,opacity:.018,depthWrite:!1})]})]})}const Ht=`
  attribute float aPhase;
  varying vec2 vUv;
  varying float vPhase;

  void main() {
    vUv = uv;
    vPhase = aPhase;
    vec4 localPosition = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      localPosition = instanceMatrix * localPosition;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * localPosition;
  }
`,Xt=`
  precision highp float;

  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform float uOpacity;
  uniform float uTime;
  /** 1 = rooms switch on their own phase, 0 = permanently lit, as ground-floor lobbies are. */
  uniform float uSwitching;
  varying vec2 vUv;
  varying float vPhase;

  void main() {
    float edgeX = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
    float edgeY = smoothstep(0.0, 0.14, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
    float softFrame = edgeX * edgeY;
    float centerGlow = 1.0 - smoothstep(0.08, 0.72, length((vUv - 0.5) * vec2(0.9, 1.12)));
    float verticalWarmth = smoothstep(0.02, 0.96, vUv.y);
    vec3 roomColor = mix(uColorLow, uColorHigh, verticalWarmth * 0.56 + centerGlow * 0.24);
    // Same phase-bias trick as the backdrop windows: the bias leaves most rooms sitting
    // permanently lit or permanently low, and only a minority crossing between the two.
    // Slower here than in the distance — these are close enough that a visible blink
    // would read as a flicker bug rather than as someone leaving an office.
    float slow = sin(uTime * 0.055 + vPhase * 37.0);
    float gate = smoothstep(-0.3, 0.3, slow + (vPhase - 0.5) * 1.55);
    float occupancy = mix(1.0, mix(0.24, 1.0, gate), uSwitching);
    float alpha = softFrame * (0.7 + centerGlow * 0.3) * uOpacity * occupancy;

    if (alpha < 0.015) discard;
    gl_FragColor = vec4(roomColor, alpha);
  }
`;function ni({dimmed:o}){const s=f.useMemo(os,[]),t=f.useMemo(()=>kr(s),[s]),e=f.useMemo(()=>new de,[]),a=Sr(),r=jr(),l=f.useMemo(()=>Array.from({length:yt},(b,j)=>t.masses.filter(M=>(M.variant??0)%yt===j)),[t]),i=f.useMemo(()=>Array.from({length:Pe},(b,j)=>t.roofs.filter(M=>(M.variant??0)%Pe===j)),[t]),c=f.useRef([]),u=f.useRef([]),d=f.useRef(null),m=f.useRef(null),x=f.useRef(null),g=f.useRef(null),y=f.useRef(null),w=f.useRef(null),v=f.useMemo(()=>{var b;return typeof window<"u"&&((b=window.matchMedia)==null?void 0:b.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),_=f.useMemo(()=>({uColor:{value:new W("#ff7059")},uOpacity:{value:.95},uTime:{value:0}}),[]),R=f.useMemo(()=>({uColorLow:{value:new W("#5cc8e6")},uColorHigh:{value:new W("#dcf7ff")},uOpacity:{value:.9},uTime:{value:0},uSwitching:{value:1}}),[]),A=f.useMemo(()=>({uColorLow:{value:new W("#8fe0f4")},uColorHigh:{value:new W("#f0fdff")},uOpacity:{value:1},uTime:{value:0},uSwitching:{value:0}}),[]);return f.useEffect(()=>{_.uColor.value.set(o?"#c85543":"#ff7059"),_.uOpacity.value=o?.66:.95,R.uOpacity.value=o?.42:.9,A.uOpacity.value=o?.5:1},[_,o,R,A]),ge(({clock:b})=>{const j=v?4.2:b.elapsedTime;_.uTime.value=j,R.uTime.value=j,A.uTime.value=j}),f.useEffect(()=>{const b=(j,M,C)=>{j&&(M.forEach((E,O)=>{e.position.set(...E.position),e.scale.set(...E.scale),e.updateMatrix(),j.setMatrixAt(O,e.matrix)}),j.instanceMatrix.needsUpdate=!0,Ve(j,M.length,E=>p(E*13+C)))};b(g.current,t.litWindows,1700),b(y.current,t.lobbyLights,1800)},[e,t.litWindows,t.lobbyLights]),f.useEffect(()=>{x.current&&(t.beacons.forEach((b,j)=>{var M;e.position.set(...b.position),e.scale.set(...b.scale),e.updateMatrix(),(M=x.current)==null||M.setMatrixAt(j,e.matrix)}),x.current.instanceMatrix.needsUpdate=!0,Ve(x.current,t.beacons.length,b=>t.beacons[b].tone))},[e,t.beacons]),f.useEffect(()=>{const b=["#d8eef6","#e8f6fb","#cbe6f2","#f2fbfe"],j=["#d2ebf4","#e2f3f9","#c6e0ee","#eef9fd"],M=["#4a555c","#5b676f","#6d7a82","#84929b"],C=(E,O,T)=>{E&&(O.forEach((L,Z)=>{e.position.set(...L.position),e.scale.set(...L.scale),e.updateMatrix(),E.setMatrixAt(Z,e.matrix);const U=Math.min(T.length-1,Math.floor(L.tone*T.length));E.setColorAt(Z,new W(T[U]))}),ie(E))};l.forEach((E,O)=>{C(c.current[O],E,Ts[O]??Ts[0]),Cs(c.current[O],E)}),i.forEach((E,O)=>{C(u.current[O],E,Os[O]??Os[0]),Cs(u.current[O],E)}),C(d.current,t.bands,b),C(m.current,t.verticals,j),C(w.current,t.details,M)},[e,l,t.bands,t.details,t.verticals,i]),n.jsxs("group",{children:[a.map((b,j)=>n.jsxs("instancedMesh",{ref:M=>{c.current[j]=M},args:[null,null,(l[j]??[]).length],castShadow:!0,receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[1,1,1]}),Wt.map(M=>n.jsx("meshStandardMaterial",{attach:M,vertexColors:!0,map:b.color,normalMap:b.normal,normalScale:nr,roughnessMap:b.roughness,emissiveMap:b.emissive,color:o?"#c1ccd3":"#ffffff",emissive:o?"#1d4a63":"#4fc2f7",emissiveIntensity:o?.1:.26,roughness:1,metalness:0},M)),n.jsx("meshStandardMaterial",{attach:"material-2",vertexColors:!0,map:(r[j%Pe]??r[0]).color,normalMap:(r[j%Pe]??r[0]).normal,normalScale:Ss,roughnessMap:(r[j%Pe]??r[0]).roughness,aoMap:(r[j%Pe]??r[0]).ao,aoMapIntensity:.55,color:o?"#c3ced4":"#ffffff",emissive:"#1e4a66",emissiveIntensity:o?.04:.075,roughness:1,metalness:0,onBeforeCompile:Rs}),n.jsx("meshStandardMaterial",{attach:"material-3",vertexColors:!0,color:o?"#8b9ba3":"#aebfc7",emissive:"#14313d",emissiveIntensity:.035,roughness:.94,metalness:0})]},`mass-${j}`)),r.map((b,j)=>n.jsxs("instancedMesh",{ref:M=>{u.current[j]=M},args:[null,null,(i[j]??[]).length],castShadow:!0,receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[1,1,1]}),Wt.map(M=>n.jsx("meshStandardMaterial",{attach:M,vertexColors:!0,color:o?"#9aa8ae":"#ccd8dc",emissive:"#16323f",emissiveIntensity:.03,roughness:.95,metalness:0},M)),n.jsx("meshStandardMaterial",{attach:"material-2",vertexColors:!0,map:b.color,normalMap:b.normal,normalScale:Ss,roughnessMap:b.roughness,aoMap:b.ao,aoMapIntensity:.55,color:o?"#c3ced4":"#ffffff",emissive:"#1e4a66",emissiveIntensity:o?.045:.085,roughness:1,metalness:0,onBeforeCompile:Rs}),n.jsx("meshStandardMaterial",{attach:"material-3",vertexColors:!0,color:o?"#7d8a90":"#9caab0",roughness:.96,metalness:0})]},`roof-${j}`)),n.jsxs("instancedMesh",{ref:d,args:[null,null,t.bands.length],children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{vertexColors:!0,color:o?"#adc0c8":"#e6fbff",transparent:!0,opacity:o?.16:.3,depthWrite:!1})]}),n.jsxs("instancedMesh",{ref:m,args:[null,null,t.verticals.length],children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshBasicMaterial",{vertexColors:!0,color:o?"#a6b9c1":"#ddf5fa",transparent:!0,opacity:o?.14:.25,depthWrite:!1})]}),n.jsxs("instancedMesh",{ref:w,args:[null,null,t.details.length],castShadow:!0,receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,roughness:.78,metalness:.12})]}),n.jsxs("instancedMesh",{ref:x,args:[null,null,t.beacons.length],renderOrder:2,children:[n.jsx("sphereGeometry",{args:[.5,6,5]}),n.jsx("shaderMaterial",{uniforms:_,vertexShader:Mt,fragmentShader:uo,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]}),n.jsxs("instancedMesh",{ref:g,args:[null,null,t.litWindows.length],renderOrder:1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("shaderMaterial",{uniforms:R,vertexShader:Ht,fragmentShader:Xt,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]}),n.jsxs("instancedMesh",{ref:y,args:[null,null,t.lobbyLights.length],renderOrder:1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("shaderMaterial",{uniforms:A,vertexShader:Ht,fragmentShader:Xt,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]})]})}function ai(){const o=os(),s=[],t=[],e=[];o.forEach((c,u)=>{const d=[[c.x-c.width/2-.16,c.z-c.depth/2-.16],[c.x+c.width/2+.16,c.z-c.depth/2-.16],[c.x-c.width/2-.16,c.z+c.depth/2+.16],[c.x+c.width/2+.16,c.z+c.depth/2+.16]],m=p(u+820)>.48?2:1;for(let x=0;x<m;x+=1){const g=d[(Math.floor(p(u*17+x+830)*d.length)+x)%d.length],[y,w]=Xe(g[0],g[1]);s.push({id:`${c.id}-tree-${x}`,x:y,z:w,size:.78+p(u*23+x+840)*.42,tone:p(u*31+x+850)})}if(p(u+860)>.56){const x=d[Math.floor(p(u+870)*d.length)],[g,y]=Xe(x[0],x[1]);t.push({id:`${c.id}-planting-bed`,position:[g,.038,y],scale:[.34+p(u+880)*.22,.035,.25+p(u+890)*.18],tone:p(u+900)})}});const a=_e[0]-Ms[0],r=_e[2]-Ms[1];[[-1.34,.78,.94],[1.34,-.78,.88],[1.38,0,1.02],[1.34,.78,.9],[-.72,1.26,.84],[.72,1.26,.92]].forEach(([c,u,d],m)=>{s.push({id:`asset-tree-${m}`,x:c+a,z:u+r,size:d,tone:p(m+940)})}),[{id:"asset-bed-west",x:-1.65,z:0,scale:[.17,.03,1.72],tone:.28},{id:"asset-bed-east",x:1.38,z:0,scale:[.3,.03,1.72],tone:.62},{id:"asset-bed-front-west",x:-.68,z:1.27,scale:[.54,.03,.26],tone:.42},{id:"asset-bed-front-east",x:.68,z:1.27,scale:[.54,.03,.26],tone:.74}].forEach(c=>{t.push({id:c.id,position:[c.x+a,.035,c.z+r],scale:c.scale,tone:c.tone})});for(let c=-5;c<=5;c+=1){const u=c*Re+Le;for(let d=0;d<10;d+=1){const m=-15.6+d*3.45;e.push({id:`vertical-lamp-${c}-${d}`,x:u+(d%2===0?.36:-.36),z:m,size:1,tone:p(c*41+d+960)}),e.push({id:`horizontal-lamp-${c}-${d}`,x:m,z:u+(d%2===0?-.36:.36),size:1,tone:p(c*47+d+980)})}}return{trees:s,beds:t,lamps:e}}function ri({dimmed:o}){const{trees:s,beds:t,lamps:e}=f.useMemo(ai,[]),a=Ls(pr,gr),r=Ls(mr,xr),l=f.useMemo(()=>new de,[]),i=f.useRef(null),c=f.useRef(null),u=f.useRef(null),d=f.useRef(null),m=f.useRef(null);return f.useEffect(()=>{const x=["#7fc98b","#96d89b","#6fbd7f","#aae2a8"],g=["#5c9c72","#6cab7c","#7fbb8a","#8cc795"],y=["#f5b957","#ffd27b","#ffe1a1","#fff0ca"];s.forEach((w,v)=>{var _,R,A;l.position.set(w.x,.115*w.size,w.z),l.scale.set(.032*w.size,.23*w.size,.032*w.size),l.updateMatrix(),(_=i.current)==null||_.setMatrixAt(v,l.matrix),l.position.set(w.x,.3*w.size,w.z),l.scale.set(.15*w.size,.18*w.size,.15*w.size),l.updateMatrix(),(R=c.current)==null||R.setMatrixAt(v,l.matrix),(A=c.current)==null||A.setColorAt(v,new W(x[Math.min(x.length-1,Math.floor(w.tone*x.length))]))}),t.forEach((w,v)=>{var _,R;l.position.set(...w.position),l.scale.set(...w.scale),l.updateMatrix(),(_=u.current)==null||_.setMatrixAt(v,l.matrix),(R=u.current)==null||R.setColorAt(v,new W(g[Math.min(g.length-1,Math.floor(w.tone*g.length))]))}),e.forEach((w,v)=>{var _,R,A;l.position.set(w.x,.16,w.z),l.scale.set(.012,.32,.012),l.updateMatrix(),(_=d.current)==null||_.setMatrixAt(v,l.matrix),l.position.set(w.x,.33,w.z),l.scale.set(.035,.035,.035),l.updateMatrix(),(R=m.current)==null||R.setMatrixAt(v,l.matrix),(A=m.current)==null||A.setColorAt(v,new W(y[Math.min(y.length-1,Math.floor(w.tone*y.length))]))});for(const w of[i.current,c.current,u.current,d.current,m.current])ie(w)},[t,l,e,s]),n.jsxs("group",{children:[n.jsxs("instancedMesh",{ref:u,args:[null,null,t.length],receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,color:o?"#a8bfab":"#d8ecd9",emissive:"#28603a",emissiveIntensity:o?.08:.18,roughness:.94})]}),n.jsxs("instancedMesh",{ref:i,args:[null,null,s.length],castShadow:!0,children:[n.jsx("cylinderGeometry",{args:[1,1,1,8]}),n.jsx("meshStandardMaterial",{map:r.color,normalMap:r.normal,normalScale:vr,roughnessMap:r.roughness,color:"#b0a99f",roughness:1,metalness:0})]}),n.jsxs("instancedMesh",{ref:c,args:[null,null,s.length],castShadow:!0,receiveShadow:!0,children:[n.jsx("icosahedronGeometry",{args:[1,1]}),n.jsx("meshStandardMaterial",{vertexColors:!0,map:a.color,normalMap:a.normal,normalScale:br,roughnessMap:a.roughness,color:o?"#c3d6c4":"#eafaea",emissive:"#2f6b3f",emissiveIntensity:o?.1:.2,roughness:1,metalness:0})]}),n.jsxs("instancedMesh",{ref:d,args:[null,null,e.length],children:[n.jsx("cylinderGeometry",{args:[1,1,1,8]}),n.jsx("meshStandardMaterial",{color:"#9fb0b3",metalness:0,roughness:.62})]}),n.jsxs("instancedMesh",{ref:m,args:[null,null,e.length],renderOrder:4,children:[n.jsx("sphereGeometry",{args:[1,10,8]}),n.jsx("meshBasicMaterial",{vertexColors:!0,color:"#fff0c9",transparent:!0,opacity:o?.66:.94,depthWrite:!1,blending:K,toneMapped:!1})]})]})}const At=`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 localPosition = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      localPosition = instanceMatrix * localPosition;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * localPosition;
  }
`,ii=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float radius = length(vUv - 0.5) * 2.0;
    float falloff = pow(max(0.0, 1.0 - radius), 2.6);
    gl_FragColor = vec4(uColor, falloff * uOpacity);
  }
`,ci=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    // Rounded-box falloff, not radial: footprints are rectangular, and a circular blob
    // under a square block reads as a smudge rather than as contact.
    vec2 distanceFromCentre = abs(vUv - 0.5) * 2.0;
    float box = max(distanceFromCentre.x, distanceFromCentre.y);
    float falloff = pow(max(0.0, 1.0 - box), 1.35);
    if (falloff < 0.004) discard;
    gl_FragColor = vec4(uColor, falloff * uOpacity);
  }
`;function li({dimmed:o}){const s=f.useMemo(os,[]),t=f.useRef(null),e=f.useMemo(()=>new de,[]),a=f.useMemo(()=>({uColor:{value:new W("#08181f")},uOpacity:{value:.55}}),[]);f.useEffect(()=>{a.uColor.value.set(o?"#0b1d24":"#08181f"),a.uOpacity.value=o?.42:.55},[o,a]);const r=f.useMemo(()=>[...s.map(l=>({x:l.x,z:l.z,width:l.width,depth:l.depth})),{x:_e[0],z:_e[2]+.08,width:2.22*ot[0]*.5,depth:2.02*ot[2]*.5}],[s]);return f.useEffect(()=>{t.current&&(r.forEach((l,i)=>{var c;e.position.set(l.x,.006,l.z),e.rotation.set(-Math.PI/2,0,0),e.scale.set(l.width*2,l.depth*2,1),e.updateMatrix(),(c=t.current)==null||c.setMatrixAt(i,e.matrix)}),t.current.instanceColor=null,ie(t.current))},[e,r]),n.jsxs("instancedMesh",{ref:t,args:[null,null,r.length],frustumCulled:!1,children:[n.jsx("planeGeometry",{args:[1,1]}),n.jsx("shaderMaterial",{uniforms:a,vertexShader:At,fragmentShader:ci,transparent:!0,depthWrite:!1})]})}function ui({lights:o}){const s=f.useRef(null),t=f.useMemo(()=>new de,[]),e=f.useMemo(()=>({uColor:{value:new W("#7fe0ff")},uOpacity:{value:.18}}),[]);return f.useEffect(()=>{s.current&&(o.forEach((a,r)=>{var l;t.position.set(a.x,.042,a.z),t.rotation.set(-Math.PI/2,0,0),t.scale.setScalar(.52+a.tone*.22),t.updateMatrix(),(l=s.current)==null||l.setMatrixAt(r,t.matrix)}),s.current.instanceColor=null,ie(s.current))},[t,o]),n.jsxs("instancedMesh",{ref:s,args:[null,null,o.length],frustumCulled:!1,children:[n.jsx("planeGeometry",{args:[1,1]}),n.jsx("shaderMaterial",{uniforms:e,vertexShader:At,fragmentShader:ii,transparent:!0,depthWrite:!1,blending:K,toneMapped:!1})]})}function di(){const o=f.useRef(null),s=f.useMemo(()=>new de,[]),t=f.useMemo(()=>{const e=[],a=Math.ceil(nt/3.2);for(let r=De;r<=Ft;r+=1){const l=r*Re+Le;for(let i=0;i<a;i+=1){const c=i%2===0?-.31:.31,u=ao-nt/2+i*3.2;r<=Bt&&e.push({x:l+c,z:u,tone:p(r*41+i+420)});const d=-16+i*3.2;d<=16&&e.push({x:d,z:l-c,tone:p(r*47+i+520)})}}return e},[]);return f.useEffect(()=>{if(!o.current)return;const e=["#62ecff","#bffaff","#22d6ff","#e5feff"];t.forEach((a,r)=>{var l,i;s.position.set(a.x,.064,a.z),s.scale.set(1,1,1),s.updateMatrix(),(l=o.current)==null||l.setMatrixAt(r,s.matrix),(i=o.current)==null||i.setColorAt(r,new W(e[Math.min(3,Math.floor(a.tone*4))]))}),ie(o.current)},[s,t]),n.jsxs("group",{children:[n.jsx(ui,{lights:t}),n.jsxs("instancedMesh",{ref:o,args:[null,null,t.length],children:[n.jsx("cylinderGeometry",{args:[.024,.052,.022,10]}),n.jsx("meshBasicMaterial",{vertexColors:!0,transparent:!0,opacity:.78,depthWrite:!1,blending:K,toneMapped:!1})]})]})}const fi=`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,hi=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uAxis;
  varying vec2 vUv;

  void main() {
    float along = mix(vUv.x, 1.0 - vUv.y, uAxis);
    float across = mix(vUv.y, vUv.x, uAxis);
    float lateralDistance = abs(across - 0.5) * 2.0;
    float edgeFade = smoothstep(0.0, 0.16, along) * (1.0 - smoothstep(0.82, 1.0, along));
    float softGlow = pow(max(0.0, 1.0 - lateralDistance), 1.6);
    float brightCore = pow(max(0.0, 1.0 - lateralDistance), 8.0);
    float head = exp(-pow((along - 0.78) / 0.105, 2.0));
    float alpha = (softGlow * 0.2 + brightCore * 0.7 + head * brightCore * 0.34) * edgeFade * uOpacity;
    vec3 color = mix(uColor, vec3(0.94, 1.0, 1.0), brightCore * 0.34 + head * 0.18);

    gl_FragColor = vec4(color, alpha);
  }
`;function pi({trail:o,focused:s,reducedMotion:t}){const e=f.useRef(null),a=o.end-o.start,r=f.useMemo(()=>({uColor:{value:new W(o.color)},uOpacity:{value:0},uAxis:{value:o.axis==="z"?1:0}}),[o.axis,o.color]);ge(({clock:i})=>{const c=t?.18+o.delay*.64:(i.elapsedTime*o.speed+o.delay)%1,u=o.start+a*c,d=t?1:Math.min(1,c/.1,(1-c)/.1),m=o.opacity*d*(s?1.08:1);if(!e.current)return;e.current.position.x=o.axis==="x"?u:o.fixed+o.offset,e.current.position.z=o.axis==="x"?o.fixed+o.offset:u;const x=e.current.material;x.uniforms.uOpacity.value=m});const l=o.primary?.13:.105;return n.jsxs("mesh",{ref:e,position:[0,.078,0],rotation:[-Math.PI/2,0,0],scale:o.axis==="x"?[o.length,l,1]:[l,o.length,1],renderOrder:2,children:[n.jsx("planeGeometry",{args:[1,1]}),n.jsx("shaderMaterial",{uniforms:r,vertexShader:fi,fragmentShader:hi,transparent:!0,depthWrite:!1,blending:K,toneMapped:!1})]})}function mi({focused:o}){const s=f.useMemo(Tr,[]),t=f.useMemo(()=>{var e;return typeof window<"u"&&((e=window.matchMedia)==null?void 0:e.call(window,"(prefers-reduced-motion: reduce)").matches)},[]);return n.jsx("group",{children:s.map(e=>n.jsx(pi,{trail:e,focused:o,reducedMotion:t},e.id))})}function $e({args:o,position:s,active:t,focused:e,facadeTextures:a,roofTextures:r}){return n.jsxs("group",{position:s,children:[n.jsxs("mesh",{castShadow:!0,receiveShadow:!0,children:[n.jsx("boxGeometry",{args:o}),Wt.map(l=>n.jsx("meshPhysicalMaterial",{attach:l,map:a.color,normalMap:a.normal,normalScale:ar,roughnessMap:a.roughness,emissiveMap:a.emissive,color:e?"#baf4ff":t?"#c7eef4":"#9dc6d1",emissive:e?"#1599c2":t?"#11677f":"#0b3543",emissiveIntensity:e?.52:t?.28:.13,metalness:.18,roughness:.24,clearcoat:.72,clearcoatRoughness:.2},l)),n.jsx("meshPhysicalMaterial",{attach:"material-2",map:r.color,normalMap:r.normal,normalScale:rr,roughnessMap:r.roughness,aoMap:r.ao,aoMapIntensity:.45,color:e?"#c0eef5":t?"#c4e8ee":"#9eb8c2",emissive:e?"#0f6f86":t?"#0e5365":"#092b36",emissiveIntensity:e?.24:t?.14:.07,metalness:.14,roughness:.58,clearcoat:.32,clearcoatRoughness:.38}),n.jsx("meshPhysicalMaterial",{attach:"material-3",color:"#335361",emissive:"#061722",emissiveIntensity:.03,metalness:.08,roughness:.72}),n.jsx(vt,{color:e?"#d2fbff":t?"#8eeeff":"#6d99a7",scale:1.01,threshold:18,visible:!0})]}),(t||e)&&n.jsxs("mesh",{scale:[1.045,1.035,1.045],children:[n.jsx("boxGeometry",{args:o}),n.jsx("meshBasicMaterial",{color:"#4edcff",side:Zt,transparent:!0,opacity:e?.12:.07})]})]})}function gi({active:o,focused:s}){const t=f.useMemo(()=>Array.from({length:15},(r,l)=>({id:`floor-${l}`,y:.59+l*.185})),[]),e=f.useMemo(()=>Array.from({length:9},(r,l)=>({id:`front-mullion-${l}`,x:-.592+l*.148})),[]),a=f.useMemo(()=>Array.from({length:8},(r,l)=>({id:`side-mullion-${l}`,z:-.42+l*.143})),[]);return n.jsxs("group",{children:[t.map(r=>n.jsxs("group",{children:[n.jsxs("mesh",{position:[0,r.y,.666],children:[n.jsx("boxGeometry",{args:[1.25,.014,.018]}),n.jsx("meshBasicMaterial",{color:"#a4e7f2",transparent:!0,opacity:s?.38:o?.26:.16})]}),n.jsxs("mesh",{position:[.666,r.y,.08],children:[n.jsx("boxGeometry",{args:[.018,.014,1.1]}),n.jsx("meshBasicMaterial",{color:"#83cadb",transparent:!0,opacity:s?.3:o?.21:.13})]})]},r.id)),e.map(r=>n.jsxs("mesh",{position:[r.x,1.88,.67],children:[n.jsx("boxGeometry",{args:[.014,2.78,.018]}),n.jsx("meshBasicMaterial",{color:"#a6dce6",transparent:!0,opacity:s?.3:o?.21:.13})]},r.id)),a.map(r=>n.jsxs("mesh",{position:[.67,1.88,r.z],children:[n.jsx("boxGeometry",{args:[.018,2.78,.014]}),n.jsx("meshBasicMaterial",{color:"#89c3d1",transparent:!0,opacity:s?.26:o?.18:.11})]},r.id)),n.jsxs("mesh",{position:[0,.37,.946],children:[n.jsx("boxGeometry",{args:[.5,.34,.028]}),n.jsx("meshBasicMaterial",{color:"#e8fcff",transparent:!0,opacity:s?.72:o?.56:.42})]}),n.jsxs("mesh",{position:[0,.31,.968],children:[n.jsx("boxGeometry",{args:[.27,.2,.018]}),n.jsx("meshBasicMaterial",{color:"#0b2330",transparent:!0,opacity:.82})]})]})}const xi=.148,bi=.143,vi=.185,wi=-.518,yi=-.3485,Mi=.6825,_i=.652,Ai=.652;function Ei({active:o,focused:s}){const t=f.useRef(null),e=f.useMemo(()=>new de,[]),a=f.useMemo(()=>{var i;return typeof window<"u"&&((i=window.matchMedia)==null?void 0:i.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),r=f.useMemo(()=>{const i=[];for(let c=0;c<14;c+=1){const u=Mi+c*vi;for(let d=0;d<8;d+=1)p(c*31+d*17+2100)<.84||i.push({position:[wi+d*xi,u,_i],scale:[.118,.15,.014],phase:p(c*43+d*23+2200)});for(let d=0;d<7;d+=1)p(c*37+d*29+2300)<.86||i.push({position:[Ai,u,yi+d*bi],scale:[.014,.15,.114],phase:p(c*47+d*19+2400)})}return i},[]),l=f.useMemo(()=>({uColorLow:{value:new W("#7fd8ef")},uColorHigh:{value:new W("#eafcff")},uOpacity:{value:.6},uTime:{value:0},uSwitching:{value:1}}),[]);return f.useEffect(()=>{l.uOpacity.value=s?.82:o?.7:.55},[o,s,l]),ge(({clock:i})=>{l.uTime.value=a?3.1:i.elapsedTime}),f.useEffect(()=>{const i=t.current;i&&(r.forEach((c,u)=>{e.position.set(...c.position),e.scale.set(...c.scale),e.updateMatrix(),i.setMatrixAt(u,e.matrix)}),i.instanceMatrix.needsUpdate=!0,Ve(i,r.length,c=>r[c].phase))},[e,r]),n.jsxs("instancedMesh",{ref:t,args:[null,null,r.length],frustumCulled:!1,renderOrder:1,children:[n.jsx("boxGeometry",{args:[1,1,1]}),n.jsx("shaderMaterial",{uniforms:l,vertexShader:Ht,fragmentShader:Xt,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]})}function Si({active:o,focused:s}){const t=s?.46:o?.3:.16;return n.jsxs("group",{children:[n.jsxs("mesh",{position:[0,.035,.08],receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[2.22,.07,2.02]}),n.jsx("meshStandardMaterial",{color:"#4a7180",roughness:.62,metalness:.16}),n.jsx(vt,{color:"#86adba",threshold:18})]}),n.jsxs("mesh",{position:[0,.095,.08],receiveShadow:!0,children:[n.jsx("boxGeometry",{args:[2.02,.08,1.82]}),n.jsx("meshStandardMaterial",{color:"#668d99",roughness:.52,metalness:.18})]}),[-.65,.65].map(e=>n.jsxs("mesh",{position:[e,1.96,.676],children:[n.jsx("boxGeometry",{args:[.038,2.82,.045]}),n.jsx("meshStandardMaterial",{color:s?"#d7f9ff":"#9bc7d1",emissive:"#2e9fc0",emissiveIntensity:s?.36:o?.2:.1,roughness:.34,metalness:.32})]},`front-fin-${e}`)),[-.49,.65].map(e=>n.jsxs("mesh",{position:[.676,1.96,e],children:[n.jsx("boxGeometry",{args:[.045,2.82,.038]}),n.jsx("meshStandardMaterial",{color:s?"#c8f5ff":"#8db7c2",emissive:"#237b99",emissiveIntensity:s?.3:o?.17:.08,roughness:.36,metalness:.3})]},`side-fin-${e}`)),n.jsxs("mesh",{position:[0,.54,1.07],castShadow:!0,children:[n.jsx("boxGeometry",{args:[.86,.065,.34]}),n.jsx("meshPhysicalMaterial",{color:"#b5dbe3",emissive:"#2b9fc0",emissiveIntensity:t,roughness:.24,metalness:.24,clearcoat:.58}),n.jsx(vt,{color:"#d3f8ff",threshold:18})]}),[-.33,.33].map(e=>n.jsxs("mesh",{position:[e,.31,1.08],children:[n.jsx("boxGeometry",{args:[.035,.42,.035]}),n.jsx("meshStandardMaterial",{color:"#b8d7df",metalness:.36,roughness:.3})]},`canopy-column-${e}`)),n.jsxs("mesh",{position:[0,1.96,.69],children:[n.jsx("boxGeometry",{args:[.022,2.66,.018]}),n.jsx("meshBasicMaterial",{color:"#baf6ff",transparent:!0,opacity:t*.52,depthWrite:!1})]}),n.jsxs("mesh",{position:[.69,1.96,.08],children:[n.jsx("boxGeometry",{args:[.018,2.66,.022]}),n.jsx("meshBasicMaterial",{color:"#80d9eb",transparent:!0,opacity:t*.38,depthWrite:!1})]})]})}function ji({active:o,focused:s}){const t=f.useRef(null),e=f.useMemo(()=>{var r;return typeof window<"u"&&((r=window.matchMedia)==null?void 0:r.call(window,"(prefers-reduced-motion: reduce)").matches)},[]);ge(({clock:r})=>{if(!t.current)return;const l=t.current.material,i=s?.9:o?.68:.42;if(e){l.opacity=i;return}const c=r.elapsedTime*.58%1,u=Math.min(c,1-c)/.13;l.opacity=i*(.3+Math.exp(-u*u)*.7)});const a=[{id:"unit-a",position:[-.2,3.82,-.03],args:[.22,.09,.18]},{id:"unit-b",position:[.2,3.82,.17],args:[.18,.09,.22]},{id:"unit-c",position:[.01,3.93,.06],args:[.34,.06,.12]}];return n.jsxs("group",{children:[a.map(r=>n.jsxs("mesh",{position:r.position,children:[n.jsx("boxGeometry",{args:r.args}),n.jsx("meshStandardMaterial",{color:s?"#a7e6f4":o?"#86b4c0":"#7296a1",roughness:.42,metalness:.28,emissive:"#0b4a66",emissiveIntensity:s?.2:o?.1:.02}),n.jsx(vt,{color:s?"#d9fdff":o?"#82d7e8":"#6e9fac",scale:1.01,threshold:18,visible:!0})]},r.id)),n.jsxs("mesh",{position:[0,3.7,.402],children:[n.jsx("boxGeometry",{args:[.58,.06,.018]}),n.jsx("meshBasicMaterial",{color:"#d9fbff",transparent:!0,opacity:s?.82:o?.64:.44,toneMapped:!1})]}),n.jsxs("mesh",{position:[.382,3.7,.08],children:[n.jsx("boxGeometry",{args:[.018,.06,.46]}),n.jsx("meshBasicMaterial",{color:"#a9eaf6",transparent:!0,opacity:s?.7:o?.54:.36,toneMapped:!1})]}),n.jsxs("mesh",{position:[0,3.785,.08],rotation:[-Math.PI/2,0,0],children:[n.jsx("ringGeometry",{args:[.31,.43,48]}),n.jsx("meshBasicMaterial",{color:"#79eaff",transparent:!0,opacity:s?.3:o?.2:.1})]}),n.jsxs("mesh",{position:[.01,4.06,.06],children:[n.jsx("cylinderGeometry",{args:[.018,.026,.28,12]}),n.jsx("meshStandardMaterial",{color:"#b8dfe7",metalness:.46,roughness:.26})]}),n.jsxs("mesh",{ref:t,position:[.01,4.22,.06],children:[n.jsx("sphereGeometry",{args:[.038,16,12]}),n.jsx("meshBasicMaterial",{color:"#d9fbff",transparent:!0,opacity:s?.9:o?.68:.42,toneMapped:!1})]})]})}function Ri({active:o}){const s=f.useRef(null);return ge(({clock:t})=>{if(!s.current)return;const e=s.current.material,a=t.elapsedTime*.19%1;s.current.position.y=.48+a*3.08,e.opacity=o?.28*(1-Math.abs(a-.5)*.75):0}),n.jsxs("mesh",{ref:s,position:[0,.48,.7],visible:o,children:[n.jsx("boxGeometry",{args:[2.04,.026,.018]}),n.jsx("meshBasicMaterial",{color:"#d6fbff",transparent:!0,opacity:.24})]})}const Ci=`
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vHeight;

  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-viewPosition.xyz);
    vHeight = uv.y;
    gl_Position = projectionMatrix * viewPosition;
  }
`,Ti=`
  precision highp float;

  uniform vec3 uInnerColor;
  uniform vec3 uOuterColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vHeight;

  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.6);
    // Slow vertical drift so the aura breathes without reading as a strobe.
    float drift = 0.86 + 0.14 * sin(uTime * 0.9 - vHeight * 3.4);
    float verticalFade = smoothstep(0.0, 0.22, vHeight) * (1.0 - smoothstep(0.72, 1.0, vHeight) * 0.55);

    vec3 color = mix(uOuterColor, uInnerColor, rim);
    float alpha = rim * verticalFade * drift * uOpacity;

    gl_FragColor = vec4(color, alpha);
  }
`;function Oi({active:o,focused:s}){const t=f.useRef(null),e=f.useRef(null),a=f.useMemo(()=>{var i;return typeof window<"u"&&((i=window.matchMedia)==null?void 0:i.call(window,"(prefers-reduced-motion: reduce)").matches)},[]),r=f.useMemo(()=>({uInnerColor:{value:new W("#a9f2ff")},uOuterColor:{value:new W("#2f9fd8")},uOpacity:{value:0},uTime:{value:0}}),[]),l=s?1:o?.72:.34;return ge(({clock:i},c)=>{var d;r.uTime.value=a?1.4:i.elapsedTime,r.uOpacity.value=Ce.lerp(r.uOpacity.value,l,1-Math.exp(-c*3.4));const u=a?1:1+Math.sin(i.elapsedTime*.85)*.014;if((d=t.current)==null||d.scale.set(u,1,u),e.current){const m=e.current.material;m.opacity=r.uOpacity.value*(s?.3:.2)}}),n.jsxs("group",{position:[0,0,.08],children:[n.jsxs("mesh",{ref:t,position:[0,1.92,0],renderOrder:3,children:[n.jsx("cylinderGeometry",{args:[1.28,1.46,4.1,40,1,!0]}),n.jsx("shaderMaterial",{uniforms:r,vertexShader:Ci,fragmentShader:Ti,transparent:!0,depthWrite:!1,side:Zt,blending:K,toneMapped:!1})]}),n.jsxs("mesh",{ref:e,position:[0,.014,0],rotation:[-Math.PI/2,0,0],renderOrder:2,children:[n.jsx("ringGeometry",{args:[.98,2.9,72]}),n.jsx("meshBasicMaterial",{color:"#78e2ff",transparent:!0,opacity:0,depthWrite:!1,blending:K,toneMapped:!1})]})]})}function Pi({hovered:o,focused:s,onHoverChange:t,onSelect:e,interactive:a=!0}){const r=o||s,l=f.useRef(null),i=f.useRef(null),c=Rr(),u=Cr();f.useEffect(()=>()=>{i.current!==null&&window.clearTimeout(i.current)},[]),ge(({clock:g})=>{if(!l.current)return;const y=s?.026:r?.014:0;l.current.position.y=Ce.lerp(l.current.position.y,y,.08),l.current.rotation.y=Ce.lerp(l.current.rotation.y,s?-.035:Math.sin(g.elapsedTime*.26)*.012,.03)});const d=()=>{i.current!==null&&(window.clearTimeout(i.current),i.current=null)},m=g=>{g.stopPropagation(),d(),t(!0)},x=g=>{g.stopPropagation(),d(),i.current=window.setTimeout(()=>{i.current=null,t(!1)},60)};return n.jsxs("group",{ref:l,position:_e,scale:ot,children:[n.jsxs(qs,{children:[n.jsx($e,{args:[1.95,.28,1.72],position:[0,.16,.08],active:r,focused:s,facadeTextures:c,roofTextures:u}),n.jsx($e,{args:[1.68,.28,1.48],position:[0,.43,.08],active:r,focused:s,facadeTextures:c,roofTextures:u}),n.jsx($e,{args:[1.28,2.82,1.12],position:[0,1.98,.08],active:r,focused:s,facadeTextures:c,roofTextures:u}),n.jsx($e,{args:[1.12,.22,.96],position:[0,3.5,.08],active:r,focused:s,facadeTextures:c,roofTextures:u}),n.jsx($e,{args:[.74,.18,.62],position:[0,3.7,.08],active:r,focused:s,facadeTextures:c,roofTextures:u}),n.jsx(gi,{active:r,focused:s}),n.jsx(Ei,{active:r,focused:s}),n.jsx(Di,{active:r,focused:s}),n.jsx(Si,{active:r,focused:s}),n.jsx(ji,{active:r,focused:s}),n.jsx(Oi,{active:r,focused:s}),n.jsx(Ri,{active:r}),n.jsxs("mesh",{position:[0,.012,.08],rotation:[-Math.PI/2,0,0],children:[n.jsx("circleGeometry",{args:[1.64,72]}),n.jsx("meshBasicMaterial",{color:"#45cfe8",transparent:!0,opacity:s?.075:r?.045:.018,depthWrite:!1})]}),n.jsxs("mesh",{position:[0,.022,.08],rotation:[-Math.PI/2,0,0],children:[n.jsx("ringGeometry",{args:[1.12,1.42,72]}),n.jsx("meshBasicMaterial",{color:"#72e8fa",transparent:!0,opacity:s?.32:r?.22:.1,depthWrite:!1})]})]}),a?n.jsxs("mesh",{position:[0,2.05,.08],onPointerEnter:m,onPointerLeave:x,onClick:g=>{g.stopPropagation(),d(),e()},children:[n.jsx("boxGeometry",{args:[2.35,4.35,2.15]}),n.jsx("meshBasicMaterial",{transparent:!0,opacity:0,depthWrite:!1})]}):null]})}function Li({visible:o}){return n.jsx(Oa,{position:$a,center:!0,zIndexRange:[5,0],children:n.jsxs("button",{type:"button",className:"asset-hero-focus-cue","aria-label":"Scroll down","data-visible":o?"true":"false",onClick:()=>{var s;(s=document.querySelector("#before-you-invest"))==null||s.scrollIntoView({behavior:"smooth",block:"start"})},children:[n.jsx("span",{"aria-hidden":"true"}),n.jsx("span",{"aria-hidden":"true"}),n.jsx("span",{"aria-hidden":"true"})]})})}const zi=`
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    // Bright at the parapet and falling away down the shaft. Real crowns are floodlit from
    // below at the top of the facade, so an even wash reads as a glow effect instead.
    float rise = pow(clamp(vUv.y, 0.0, 1.0), 2.2);
    float lateral = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 3.0);
    gl_FragColor = vec4(uColor, rise * max(0.0, lateral) * uOpacity);
  }
`;function Ui({theme:o}){const s=re(e=>e.gl),t=re(e=>e.scene);return f.useEffect(()=>{const r=new Float32Array(8192),l=o==="dark"?1:.08,i=[.012,.05,.1],c=[.06,.28,.38],u=[.03,.06,.07];for(let g=0;g<32;g+=1){const y=(1-g/31-.5)*Math.PI,w=Math.max(0,Math.sin(y)),v=Math.max(0,-Math.sin(y));for(let _=0;_<64;_+=1){const R=(g*64+_)*4,A=_/64*Math.PI*2,b=Math.pow(Math.max(0,Math.cos(A-2.2)),24)*w;for(let j=0;j<3;j+=1){const M=i[j]*w+c[j]*(1-w);r[R+j]=(M*(1-v)+u[j]*v+b*.9)*l}r[R+3]=1}}const d=new Ro(r,64,32,Co,To);d.mapping=Oo,d.needsUpdate=!0;const m=new Po(s),x=m.fromEquirectangular(d);return t.environment=x.texture,t.environmentIntensity=.42,()=>{t.environment=null,x.dispose(),m.dispose(),d.dispose()}},[s,t,o]),null}function Di({active:o,focused:s}){const t=s?.72:o?.52:.34,e=f.useMemo(()=>({uColor:{value:new W("#a8ecff")},uOpacity:{value:t}}),[t]),a=[{id:"front",position:[0,3.06,.647],rotation:[0,0,0],size:[1.28,.62]},{id:"right",position:[.647,3.06,.08],rotation:[0,Math.PI/2,0],size:[1.12,.62]},{id:"left",position:[-.647,3.06,.08],rotation:[0,-Math.PI/2,0],size:[1.12,.62]}];return n.jsxs("group",{children:[a.map(r=>n.jsxs("mesh",{position:r.position,rotation:r.rotation,renderOrder:2,children:[n.jsx("planeGeometry",{args:r.size}),n.jsx("shaderMaterial",{uniforms:e,vertexShader:At,fragmentShader:zi,transparent:!0,blending:K,depthWrite:!1,toneMapped:!1})]},r.id)),n.jsxs("mesh",{position:[0,3.24,.658],children:[n.jsx("boxGeometry",{args:[.64,.08,.022]}),n.jsx("meshBasicMaterial",{color:"#e8fdff",transparent:!0,opacity:s?.86:o?.7:.52,toneMapped:!1})]}),n.jsxs("mesh",{position:[0,3.24,.672],children:[n.jsx("boxGeometry",{args:[.36,.042,.014]}),n.jsx("meshBasicMaterial",{color:"#0d2937",transparent:!0,opacity:.8})]})]})}const ki=3;function Ni(){const o=re(t=>t.gl),s=f.useRef(0);return f.useEffect(()=>(o.shadowMap.autoUpdate=!1,o.shadowMap.needsUpdate=!0,()=>{o.shadowMap.autoUpdate=!0}),[o]),_t(()=>{s.current+=1,s.current>=ki&&(s.current=0,o.shadowMap.needsUpdate=!0)}),null}const Ii=[1,1.5],Gi=[1,1.25];function Bi(){const[o]=f.useState(()=>{var s;return typeof window<"u"&&((s=window.matchMedia)!=null&&s.call(window,"(max-width: 900px), (pointer: coarse)").matches)?Gi:Ii});return o}function fo({theme:o,hovered:s,selected:t,onHoverChange:e,onSelect:a,frameMainBuildingRight:r=!1,interactive:l=!0}){const i=t,c=o==="light"?"#e7edf8":"#1a3d50";return n.jsxs(n.Fragment,{children:[n.jsx("color",{attach:"background",args:[o==="light"?"#f2f7fd":"#0b2033"]}),n.jsx("fog",{attach:"fog",args:[c,t?9.4:11.8,t?19.6:24.5]}),n.jsx(Ni,{}),n.jsx(Wr,{theme:o,focused:t}),n.jsx(Ui,{theme:o}),n.jsx("ambientLight",{intensity:o==="light"?1.22:1.06}),n.jsx("hemisphereLight",{args:[o==="light"?"#f9fdff":"#e2f8ff","#7d9ba7",o==="light"?1.05:1.02]}),n.jsx("directionalLight",{position:[-4.2,9.2,-5.4],intensity:o==="light"?3.12:2.9,color:"#f2fbff",castShadow:!0,"shadow-mapSize-width":2048,"shadow-mapSize-height":2048,"shadow-camera-left":-9,"shadow-camera-right":9,"shadow-camera-top":9,"shadow-camera-bottom":-9,"shadow-camera-near":1,"shadow-camera-far":28,"shadow-bias":-35e-5,"shadow-normalBias":.018,"shadow-radius":3.5,"shadow-intensity":.62}),n.jsx("directionalLight",{position:[7.2,4.6,6.4],intensity:t?.82:1,color:"#a8d9f2"}),n.jsx("directionalLight",{position:[-6.5,3.8,-3.8],intensity:t?1.72:1.52,color:"#9df4ff"}),n.jsx("directionalLight",{position:[3.4,2.4,-8.2],intensity:.62,color:"#bfe6ff"}),n.jsx("pointLight",{position:[0,3.1,1.8],intensity:t?32:s?24:14,color:"#71e3ff",distance:7.2}),n.jsx("pointLight",{position:[-2.5,5.8,-7.5],intensity:14,color:"#6c9dff",distance:22}),n.jsx("pointLight",{position:[5.6,4.2,5.2],intensity:11,color:"#8fd8ff",distance:20}),n.jsxs(qs,{children:[n.jsx(Gr,{dimmed:i}),n.jsx(oi,{}),n.jsx(li,{dimmed:i}),n.jsx(ni,{dimmed:i}),n.jsx(ri,{dimmed:i}),n.jsx(di,{}),n.jsx(mi,{focused:t})]}),n.jsx(Pi,{hovered:s,focused:t,onHoverChange:e,onSelect:a,interactive:l}),l?n.jsx(Li,{visible:!t}):null,n.jsx(Hr,{focused:t,blockOrbit:s&&!t,frameMainBuildingRight:r})]})}const Fi="creekside-offices",Ds="6.25%",Oe={raised:"$8.7M",target:"$14.0M",funded:62,minimum:"$10,000",investors:"184"},Nt={operating:"Operating costs",service:"Service charges",net:"Net rent kept"};function Wi(o){const s=o.annualGrossRent;return s<=0?[]:[{id:"operating",label:Nt.operating,amount:Math.max(0,o.annualOperatingCostsExService)},{id:"service",label:Nt.service,amount:Math.max(0,o.serviceCharges)},{id:"net",label:Nt.net,amount:Math.max(0,o.annualNetRent)}].filter(t=>t.amount>0).map(t=>({...t,pctOfGross:t.amount/s*100}))}function Hi(){const{formatCompact:o}=No(),[s,t]=f.useState(null),e=Do(Fi),a=f.useMemo(()=>e?Wi(e):[],[e]);if(!e||a.length===0)return null;const r=a.map(l=>`${l.label} ${o(l.amount)}, ${Math.round(l.pctOfGross)}% of gross`).join(", ");return n.jsxs("section",{className:"asset-hero-rent-breakdown","aria-label":"Annual rent composition",children:[n.jsxs("div",{className:"asset-hero-rent-breakdown-head",children:[n.jsx("span",{children:"Annual gross rent"}),n.jsx("strong",{children:o(e.annualGrossRent)})]}),n.jsxs("div",{className:Ot("asset-hero-rent-composition",s&&"asset-hero-rent-composition--hovering"),children:[n.jsx("div",{className:"asset-hero-rent-composition-bar",role:"img","aria-label":`Gross rent composition: ${r}`,children:a.map(l=>n.jsx("span",{className:Ot("asset-hero-rent-composition-segment",s===l.id&&"is-hovered"),"data-kind":l.id,style:{flexBasis:`${l.pctOfGross}%`},onMouseEnter:()=>t(l.id),onMouseLeave:()=>t(null)},l.id))}),n.jsx("div",{className:"asset-hero-rent-composition-legend",role:"list",children:a.map(l=>n.jsxs("div",{className:Ot("asset-hero-rent-composition-row",s===l.id&&"is-hovered"),"data-kind":l.id,role:"listitem","aria-label":`${l.label}, ${o(l.amount)}, ${Math.round(l.pctOfGross)}% of gross`,onMouseEnter:()=>t(l.id),onMouseLeave:()=>t(null),children:[n.jsx("span",{className:"asset-hero-rent-composition-dot","aria-hidden":"true"}),n.jsx("span",{className:"asset-hero-rent-composition-label",children:l.label}),n.jsxs("span",{className:"asset-hero-rent-composition-pct",children:[Math.round(l.pctOfGross),"%"]}),n.jsx("span",{className:"asset-hero-rent-composition-amount",children:o(l.amount)})]},l.id))})]})]})}function Xi({visible:o}){const{open:s}=ko();return n.jsxs("aside",{className:"asset-hero-panel","aria-hidden":!o,"data-visible":o?"true":"false",children:[n.jsxs("div",{className:"asset-hero-panel-head",children:[n.jsxs("div",{children:[n.jsx("h2",{children:"Lakeside Corporate Center"}),n.jsxs("div",{className:"asset-hero-panel-tags","aria-label":"Asset attributes",children:[n.jsxs("span",{className:"asset-hero-panel-tag",title:"Office · Commercial",children:[n.jsx(Uo,{assetClass:"Commercial",size:"inline"}),n.jsx("span",{className:"sr-only",children:"Office · Commercial"})]}),n.jsxs("span",{className:"asset-hero-panel-tag",title:"Primary market",children:[n.jsx(Io,{size:13,strokeWidth:1.85,"aria-hidden":"true"}),n.jsx("span",{className:"sr-only",children:"Primary market"})]}),n.jsxs("span",{className:"asset-hero-panel-tag asset-hero-panel-tag--up",title:"Trending up",children:[n.jsx(Go,{size:13,strokeWidth:1.85,"aria-hidden":"true"}),n.jsx("span",{className:"sr-only",children:"Trending up"})]})]}),n.jsxs("p",{children:[n.jsx(Bo,{size:13,"aria-hidden":"true"}),"Lakeside Drive, Chicago, IL"]})]}),n.jsxs("div",{className:"asset-hero-apr-tile","aria-label":`Est. APR ${Ds}`,children:[n.jsx("span",{className:"asset-hero-apr-tile-label",children:"Est. APR"}),n.jsx("strong",{className:"asset-hero-apr-tile-value",children:Ds})]})]}),n.jsxs("section",{className:"asset-hero-investment","aria-label":"Investment in progress",children:[n.jsxs("div",{className:"asset-hero-section-head",children:[n.jsx("span",{children:"Investment in progress"}),n.jsxs("strong",{children:[Oe.funded,"% funded"]})]}),n.jsxs("div",{className:"asset-hero-raise-row",children:[n.jsxs("div",{children:[n.jsx("span",{children:"Raised"}),n.jsx("strong",{children:Oe.raised})]}),n.jsxs("div",{children:[n.jsx("span",{children:"Target"}),n.jsx("strong",{children:Oe.target})]})]}),n.jsx("div",{className:"asset-hero-progress",role:"progressbar","aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":Oe.funded,"aria-label":`${Oe.funded}% funded`,children:n.jsx("span",{className:"asset-hero-progress-fill",style:{width:`${Oe.funded}%`}})}),n.jsxs("div",{className:"asset-hero-mini-grid",children:[n.jsxs("div",{children:[n.jsx("span",{children:"Minimum"}),n.jsx("strong",{children:Oe.minimum})]}),n.jsxs("div",{children:[n.jsx("span",{children:"Investors"}),n.jsx("strong",{children:Oe.investors})]})]})]}),n.jsx(Hi,{}),n.jsx("div",{className:"asset-hero-panel-actions",children:n.jsxs("button",{type:"button",className:"button button-primary asset-hero-panel-cta",onClick:()=>s("login"),children:["Login to explore",n.jsx(Fo,{size:16,"aria-hidden":"true"})]})})]})}function ic({theme:o,selected:s,onSelectedChange:t}){const e=f.useRef(null),[a,r]=f.useState(!1),[l,i]=f.useState(!1),c=Fs(e,"300px 0px"),u=f.useRef(c);u.current=c;const d=Bi(),m=(a||l)&&!s;return n.jsxs("div",{ref:e,className:"asset-hero-scene","data-onscreen":c?"true":"false","data-theme":o,"data-hovered":a||l?"true":"false","data-selected":s?"true":"false","aria-label":"Interactive WebGL city map featuring a OneAsset building",children:[n.jsx(Ns,{className:"asset-hero-canvas",camera:{position:[bt.x,bt.y,bt.z],fov:52,near:.1,far:100},dpr:d,shadows:"soft",gl:{antialias:!0,alpha:!1,powerPreference:"high-performance",toneMapping:Is,toneMappingExposure:1.78},children:n.jsxs(Qt.Provider,{value:u,children:[n.jsx(fo,{theme:o,hovered:a||l,selected:s,onHoverChange:r,onSelect:()=>t(!0)}),n.jsx(Gs,{active:c})]})}),n.jsx("div",{className:"asset-hero-scroll-zone",children:n.jsx("button",{type:"button",className:"asset-hero-scroll-cue","aria-label":"Scroll down",onClick:()=>{var x;(x=document.querySelector("#before-you-invest"))==null||x.scrollIntoView({behavior:"smooth",block:"start"})},children:n.jsxs("span",{className:"asset-hero-scroll-cue-chevrons","aria-hidden":"true",children:[n.jsx(Pt,{size:20,strokeWidth:2.25}),n.jsx(Pt,{size:20,strokeWidth:2.25}),n.jsx(Pt,{size:20,strokeWidth:2.25})]})})}),n.jsx("button",{type:"button",className:"asset-hero-marker","aria-label":"Explore Lakeside Corporate Center",onClick:()=>t(!0),onFocus:()=>i(!0),onBlur:()=>i(!1),onMouseEnter:()=>i(!0),onMouseLeave:()=>i(!1)}),n.jsx("div",{className:"asset-hero-hover-label","data-visible":m?"true":"false","aria-hidden":"true",children:"Explore asset"}),s?n.jsx("button",{type:"button",className:"asset-hero-panel-dismiss","aria-label":"Close asset details",onClick:()=>t(!1)}):null,n.jsx(Xi,{visible:s})]})}const Vi=1024;function Zi({size:o}){const s=re(t=>t.scene);return f.useLayoutEffect(()=>{s.traverse(t=>{var a;const e=t;!e.isDirectionalLight||!e.castShadow||(e.shadow.mapSize.set(o,o),(a=e.shadow.map)==null||a.dispose(),e.shadow.map=null)})},[s,o]),null}function cc({theme:o,frameMainBuildingRight:s=!1,lightOnTouch:t=!1}){const e=s&&typeof window<"u"&&window.innerWidth<window.innerHeight,a=s?e?to:$s:wt,r=s?e?eo:Js:Ys,l=f.useRef(null),i=Fs(l,"300px 0px"),c=f.useRef(i);c.current=i;const[u]=f.useState(()=>{var d;return t&&typeof window<"u"&&(((d=window.matchMedia)==null?void 0:d.call(window,"(pointer: coarse)").matches)??!1)});return n.jsx("div",{ref:l,className:"asset-hero-scene","aria-hidden":s?void 0:!0,children:n.jsx(Ns,{className:"asset-hero-canvas",camera:{position:[a.x,a.y,a.z],fov:52,near:.1,far:100},dpr:[1,1.25],shadows:"soft",gl:{antialias:!u,alpha:!1,powerPreference:"high-performance",toneMapping:Is,toneMappingExposure:1.78},onCreated:({camera:d})=>{d.position.set(a.x,a.y,a.z),d.lookAt(r.x,r.y,r.z),d.updateProjectionMatrix()},children:n.jsxs(Qt.Provider,{value:c,children:[n.jsx(fo,{theme:o,hovered:!1,selected:!1,onHoverChange:()=>{},onSelect:()=>{},frameMainBuildingRight:s,interactive:!1}),u?n.jsx(Zi,{size:Vi}):null,n.jsx(Gs,{active:i})]})})})}export{cc as AssetHeroAmbientBackdrop,ic as AssetHeroScene};
