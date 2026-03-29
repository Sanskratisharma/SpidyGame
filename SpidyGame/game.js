'use strict';

/* ================================================================
   SECTION 1 — CONSTANTS & CONFIG
================================================================ */
const VW = 800, VH = 500;
const PX = 150;
const GRAV    = 0.42;
const JUMP_V  = -11.5;
const DT60    = 1000 / 60;
const HS_KEY  = 'spm_kills_hs_v3';   // CHANGED: new key so old score doesn't interfere

/* ================================================================
   SECTION 2 — CANVAS SETUP & SCALING
================================================================ */
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let CW, CH, SCALE, OX, OY;

function resize() {
  CW = canvas.width  = window.innerWidth;
  CH = canvas.height = window.innerHeight;
  SCALE = Math.min(CW / VW, CH / VH);
  OX = (CW - VW * SCALE) / 2;
  OY = (CH - VH * SCALE) / 2;
}
resize();
window.addEventListener('resize', resize);

/* ================================================================
   SECTION 3 — AUDIO ENGINE (Web Audio API)
   UNCHANGED — all original SFX kept except coin sfx removed
================================================================ */
let AC = null;

function initAudio() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
}

function tone(freq, type, start, dur, vol) {
  if (!AC) return;
  try {
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.start(start); o.stop(start + dur + 0.02);
  } catch(e) {}
}

function sfx(id) {
  if (!AC) return;
  const t = AC.currentTime;
  if (id === 'start') {
    [261,329,392,523].forEach((f,i) => tone(f,'sine',t+i*.1,.18,.2));
  } else if (id === 'kill') {
    tone(280,'sawtooth',t,.06,.3); tone(140,'sawtooth',t+.07,.14,.25);
    tone(70,'square',t+.14,.1,.18);
  } else if (id === 'hit') {
    /* ADDED: player hit sound */
    tone(150,'square',t,.08,.35); tone(100,'sawtooth',t+.08,.12,.3);
  } else if (id === 'over') {
    [400,300,200,110].forEach((f,i) => tone(f,'sine',t+i*.22,.22,.3));
  } else if (id === 'win') {
    [523,659,784,1046,1318].forEach((f,i) => tone(f,'sine',t+i*.13,.28,.26));
  }
  // REMOVED: 'coin' sfx — not needed anymore
}

/* ================================================================
   SECTION 4 — HIGH SCORE
   CHANGED: stores best kills-based score
================================================================ */
let HS = parseInt(localStorage.getItem(HS_KEY) || '0');
document.getElementById('el-hs').textContent = HS;

/* ================================================================
   SECTION 5 — GAME STATE VARIABLES
   CHANGED: added health / no score (kills×10 = score)
================================================================ */
const IS_MOB = ('ontouchstart' in window) || window.innerWidth <= 768;
let STATE    = 'home';
let kills    = 0;
let score    = 0;           // ADDED: score = kills × 10
let health   = 3;           // ADDED: 3 lives
/* REMOVED: coins variable — no coin collecting */
let timeLeft = 30;          // CHANGED: 30 seconds
let elapsed  = 0;
let gameWon  = false;
let accumT   = 0, rafId = null, lastT = 0;
let scrollX  = 0, lastBldg = -8, lastEnemy = 0;

/* ================================================================
   SECTION 6 — PLAYER
================================================================ */
let P = {};

function makePlayer() {
  P = { x:PX, y:VH/2-23, w:38, h:46, vy:0,
        frame:0, ft:0, wingUp:false, alive:true,
        invincible:0 };   // ADDED: invincibility frames after hit
}

function doJump() {
  if (!P.alive || STATE !== 'play') return;
  P.vy = JUMP_V;
  P.wingUp = true;
  setTimeout(() => P && (P.wingUp = false), 210);
}

function doShoot() {
  if (!P.alive || STATE !== 'play') return;
  WEBS.push({ x:P.x+P.w*.65, y:P.y+P.h*.28, vx:15, vy:-.3, alive:true, trail:[] });
  P.wingUp = true;
  setTimeout(() => P && (P.wingUp = false), 170);
  /* Play thwip sound on every web shot */
  const thwip = document.getElementById('thwip-sfx');
  if (thwip) { thwip.currentTime = 0; thwip.play().catch(()=>{}); }
}

/* ================================================================
   SECTION 7 — WORLD OBJECT ARRAYS
   CHANGED: removed COINS array
================================================================ */
let BLDGS=[], ENEMIES=[], WEBS=[], PARTS=[];
let BG1={}, BG2={};

/* ================================================================
   SECTION 8 — DIFFICULTY SCALING
   CHANGED: time reference is 30 seconds max
================================================================ */
function diff() {
  const t = Math.min(elapsed / 28, 1);   // CHANGED: scaled to 30s
  const e = t * t * (3 - 2*t);
  return {
    spd:   2   + e * 3.8,
    gap:   268 - e * 98,
    bInt:  3.4 - e * 2.0,
    eInt:  6   - e * 4.5,   // CHANGED: enemies spawn faster (was 10-7.5)
    eSpd:  1.4 + e * 2.8,
  };
}

/* ================================================================
   SECTION 9 — BACKGROUND LAYER GENERATOR (UNCHANGED)
================================================================ */
function genBGLayer(n, minW, maxW, minH, maxH, spc) {
  const bs = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const w = minW + Math.random()*(maxW-minW);
    const h = minH + Math.random()*(maxH-minH);
    const wins = [];
    for (let wy = VH-h+10; wy < VH-12; wy += 18)
      for (let rx = 6; rx < w-6; rx += 14)
        if (Math.random() > .38) wins.push([rx, wy]);
    bs.push({ x, w, h, shade:Math.floor(Math.random()*3), wins });
    x += w + spc + Math.random()*spc;
  }
  return { bs, total: Math.max(x, 1) };
}

function initBG() {
  BG1 = genBGLayer(32, 42, 92,  72, 185, 22);
  BG2 = genBGLayer(24, 30, 70,  52, 135, 14);
}

/* ================================================================
   SECTION 10 — BUILDING STYLES (UNCHANGED)
================================================================ */
const BSTYLE = [
  { main:'#1E3A5F', win:'#F5F2D8', acc:'#2A4F7A', stud:'#162D47' },
  { main:'#2D1B4E', win:'#B0C4DE', acc:'#3A236A', stud:'#200F38' },
  { main:'#1A3A2A', win:'#90EE90', acc:'#225036', stud:'#142820' },
  { main:'#3A2010', win:'#FFE4B5', acc:'#50320A', stud:'#281408' },
];

/* ================================================================
   SECTION 11 — SPAWN FUNCTIONS
   CHANGED: removed coin spawning from spawnBuilding
================================================================ */
function spawnBuilding() {
  const d   = diff();
  const gp  = d.gap + (Math.random()-.5)*48;
  const cy  = VH*.22 + Math.random()*(VH*.52);
  const bw  = 82 + Math.random()*46;
  const sx  = VW + 96;
  const st  = Math.floor(Math.random()*4);
  const topY = cy - gp/2, botY = cy + gp/2;

  BLDGS.push({ x:sx, y:botY, w:bw, h:VH-botY+18, style:st, top:false });
  if (topY > 48 && Math.random() > .28)
    BLDGS.push({ x:sx, y:-18, w:bw, h:topY+18, style:st, top:true });

  /* REMOVED: coin spawning — no coins in this version */
}

function spawnEnemy() {
  const d = diff();
  ENEMIES.push({
    x:VW+72, y:VH*.18+Math.random()*(VH*.6),
    w:34, h:40, spd:d.eSpd, alive:true, fr:0, ft:0
  });
}

function preSpawnLevel() {
  [480, 860, 1240, 1620].forEach((sx, i) => {
    const cy = VH*.38 + (i%2===0 ? -30 : 30);
    const gp = 268, bw = 90, st = i % 4;
    BLDGS.push({ x:sx, y:cy+gp/2, w:bw, h:VH-cy-gp/2, style:st, top:false });
    if (cy-gp/2 > 50)
      BLDGS.push({ x:sx, y:-18, w:bw, h:cy-gp/2+18, style:st, top:true });
    /* REMOVED: coin spawning in pre-spawn */
  });
}

/* ================================================================
   SECTION 12 — UPDATE LOGIC
   CHANGED:
   - removed coin collision logic
   - added 3-hit health system for enemy contact
   - score = kills × 10
   - timeLeft starts at 30
================================================================ */

/* ADDED: update heart display */
function updateHearts() {
  for (let i = 1; i <= 2; i++) {
    const el = document.getElementById('heart-' + i);
    if (i <= health) {
      el.classList.remove('lost');
    } else {
      el.classList.add('lost');
    }
  }
}

/* ADDED: handle player taking a hit from enemy contact */
function playerHit() {
  if (P.invincible > 0) return;  // still invincible from last hit
  health--;
  updateHearts();
  sfx('hit');
  burst(P.x+P.w/2, P.y+P.h/2, '#E8272B', 10);
  P.invincible = 90;  // ~1.5s at 60fps of invincibility after hit
  if (health <= 0) {
    doGameOver();
  }
}

function update(dt) {
  const dtF = dt / DT60;
  const d   = diff();

  /* 1-second timer tick */
  accumT += dt;
  if (accumT >= 1000) {
    accumT -= 1000;
    elapsed++;
    timeLeft = Math.max(0, 30 - elapsed);   // CHANGED: 30 seconds
    document.getElementById('el-time').textContent = timeLeft;
    if (timeLeft <= 8) document.getElementById('p-time').classList.add('urgent');  // urgent sooner
    if (timeLeft === 0) { doWin(); return; }

    if (elapsed - lastBldg >= d.bInt)           { lastBldg = elapsed;  spawnBuilding(); }
    if (elapsed > 2 && elapsed - lastEnemy >= d.eInt) { lastEnemy = elapsed; spawnEnemy(); }
  }

  /* Player physics */
  if (P.alive) {
    P.vy += GRAV * dtF;
    P.y  += P.vy * dtF;

    /* Invincibility countdown */
    if (P.invincible > 0) P.invincible -= dtF;

    if (P.y < 0) { P.y = 0; P.vy = Math.abs(P.vy)*.3; }
    if (P.y + P.h > VH) {
      /* CHANGED: hitting floor loses a life instead of instant death */
      playerHit();
      P.y  = VH - P.h - 2;
      P.vy = JUMP_V * .5;   // small bounce up
      if (STATE !== 'play') return;
    }
    P.ft += dt;
    if (P.ft > 140) { P.ft = 0; P.frame = (P.frame+1)%4; }
  }

  /* World scroll */
  scrollX += d.spd * dtF;

  /* Move objects */
  const mspd = d.spd * dtF;
  BLDGS   = BLDGS.filter(b => b.x+b.w > -60);
  ENEMIES = ENEMIES.filter(e => e.x+e.w > -60 && e.alive);
  WEBS    = WEBS.filter(w => w.x < VW+70 && w.alive);
  PARTS   = PARTS.filter(p => p.life > 0);

  BLDGS.forEach(b   => b.x -= mspd);
  ENEMIES.forEach(e => {
    e.x -= (mspd + e.spd*dtF);
    e.ft += dt; if (e.ft>185) { e.ft=0; e.fr=(e.fr+1)%4; }
  });
  WEBS.forEach(w => {
    w.trail.unshift({x:w.x,y:w.y}); if(w.trail.length>5) w.trail.pop();
    w.x += w.vx*dtF; w.y += w.vy*dtF;
  });
  PARTS.forEach(p => {
    p.x+=p.vx*dtF; p.y+=p.vy*dtF; p.vy+=.18*dtF;
    p.life-=p.dec*dtF; p.sz*=Math.pow(.95,dtF);
  });

  /* Collisions */
  if (!P.alive) return;
  const pr = pRect();

  /* vs buildings — buildings are obstacles only: bounce player, NO health damage */
  for (const b of BLDGS) {
    if (rHit(pr, {x:b.x,y:b.y,w:b.w,h:b.h})) {
      /* Just push player away — no life lost */
      P.vy = JUMP_V * .6;
      break;
    }
  }

  /* REMOVED: coin collision — no coins */

  /* vs enemies — CHANGED: contact loses a life, doesn't kill player outright */
  for (const e of ENEMIES) {
    if (e.alive && rHit(pr, eRect(e))) {
      playerHit();
      e.alive = false;   // enemy also dies on contact (so it doesn't keep hitting)
      burst(e.x+e.w/2, e.y+e.h/2, '#BB44FF', 8);
      if (STATE !== 'play') return;
      break;
    }
  }

  /* web vs enemies — UNCHANGED logic, ADDED score update */
  WEBS.forEach(w => {
    if (!w.alive) return;
    const wr = {x:w.x-10, y:w.y-5, w:20, h:10};
    ENEMIES.forEach(e => {
      if (e.alive && rHit(wr, eRect(e))) {
        e.alive = false; w.alive = false;
        kills++;
        score = kills * 10;   // ADDED: 10 points per kill
        /* Update HUD */
        document.getElementById('el-kills').textContent = kills;
        document.getElementById('el-score').textContent = score;
        sfx('kill');
        burst(e.x+e.w/2, e.y+e.h/2, '#BB44FF', 18);
        burst(e.x+e.w/2, e.y+e.h/2, '#7700CC', 9);
      }
    });
  });
}

/* Collision helpers (UNCHANGED) */
function pRect() { const m=6; return {x:P.x+m,y:P.y+m,w:P.w-m*2,h:P.h-m*2}; }
function eRect(e){ const m=4; return {x:e.x+m,y:e.y+m,w:e.w-m*2,h:e.h-m*2}; }
function rHit(a,b){ return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y; }

/* ================================================================
   SECTION 13 — PARTICLE SYSTEM (UNCHANGED)
================================================================ */
function burst(x,y,col,n) {
  for (let i=0;i<n;i++) {
    const a=Math.random()*Math.PI*2, s=2+Math.random()*6;
    PARTS.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,sz:4+Math.random()*5,col,life:1,dec:.036+Math.random()*.04});
  }
}

/* ================================================================
   SECTION 14 — RENDER ENGINE (UNCHANGED except removed drawCoins)
================================================================ */
function render() {
  ctx.clearRect(0,0,CW,CH);
  ctx.fillStyle='#060610'; ctx.fillRect(0,0,CW,CH);

  ctx.save();
  ctx.translate(OX,OY); ctx.scale(SCALE,SCALE);
  ctx.beginPath(); ctx.rect(0,0,VW,VH); ctx.clip();

  drawBG();
  /* REMOVED: drawCoins() — no coins */
  drawBldgs();
  drawWebs();
  drawEnemies();
  drawPlayer();
  drawParticles();
  drawWebCornerCanvas();

  ctx.restore();
}

/* Background (UNCHANGED) */
function drawBG() {
  const sk = ctx.createLinearGradient(0,0,0,VH);
  sk.addColorStop(0,'#18103A'); sk.addColorStop(.38,'#2E1850');
  sk.addColorStop(.68,'#6B3468'); sk.addColorStop(1,'#C45068');
  ctx.fillStyle=sk; ctx.fillRect(0,0,VW,VH);

  drawBGLayer(BG1, scrollX*.14, ['#1B1040','#211350','#160E34']);
  drawBGLayer(BG2, scrollX*.36, ['#2C1550','#361A64','#221040']);

  ctx.fillStyle='#080620'; ctx.fillRect(0,VH-18,VW,18);
  ctx.fillStyle='#110D30'; ctx.fillRect(0,VH-18,VW,3);
}

function drawBGLayer(layer,sc,cols) {
  const off = sc % layer.total;
  layer.bs.forEach(b => {
    let dx = b.x - off;
    if (dx < -b.w) dx += layer.total;
    if (dx > VW)   dx -= layer.total;
    if (dx+b.w < 0 || dx > VW) return;
    ctx.fillStyle = cols[b.shade%cols.length];
    ctx.fillRect(dx, VH-b.h, b.w, b.h);
    ctx.fillStyle='rgba(255,230,100,.26)';
    b.wins.forEach(([rx,wy]) => ctx.fillRect(dx+rx,wy,6,9));
  });
}

function drawWebCornerCanvas() {
  ctx.save(); ctx.globalAlpha=.15; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
  [[VW-100,0],[VW-60,62],[VW,105],[VW-82,82]].forEach(([tx,ty])=>{
    ctx.beginPath(); ctx.moveTo(VW,0); ctx.lineTo(tx,ty); ctx.stroke();
  });
  [30,60,90,120].forEach(r=>{
    ctx.beginPath(); ctx.arc(VW,0,r,Math.PI*.4,Math.PI,false); ctx.stroke();
  });
  ctx.restore();
}

/* Buildings (UNCHANGED) */
function drawBldgs() { BLDGS.forEach(drawBldg); }
function drawBldg(b) {
  const c = BSTYLE[b.style%4];
  ctx.fillStyle='rgba(0,0,0,.28)'; ctx.fillRect(b.x+3,b.y+3,b.w,b.h);
  ctx.fillStyle=c.main; ctx.fillRect(b.x,b.y,b.w,b.h);
  ctx.fillStyle=c.acc;
  ctx.fillRect(b.x,b.y,4,b.h); ctx.fillRect(b.x+b.w-4,b.y,4,b.h);
  ctx.fillStyle=c.win;
  for (let wy=b.y+14;wy<b.y+b.h-12;wy+=18)
    for (let wx=b.x+8;wx<b.x+b.w-8;wx+=13)
      ctx.fillRect(wx,wy,7,10);
  ctx.fillStyle=c.stud;
  const ey=b.top?b.y+b.h:b.y;
  for (let sx=b.x+12;sx<b.x+b.w-10;sx+=16) {
    ctx.beginPath(); ctx.arc(sx+4, ey+(b.top?-3:3), 4,0,Math.PI*2); ctx.fill();
  }
  ctx.strokeStyle='rgba(0,0,0,.44)'; ctx.lineWidth=1.5;
  ctx.strokeRect(b.x,b.y,b.w,b.h);
}

/* REMOVED: drawCoins function entirely */

/* Webs (UNCHANGED) */
function drawWebs() {
  WEBS.forEach(w => {
    if (!w.alive) return;
    if (w.x - (P.x+P.w) < 130) {
      ctx.save(); ctx.strokeStyle='#C8C8C8'; ctx.lineWidth=2.4; ctx.lineCap='round';
      ctx.shadowColor='rgba(200,200,255,.55)'; ctx.shadowBlur=5;
      ctx.beginPath(); ctx.moveTo(P.x+P.w*.65,P.y+P.h*.28); ctx.lineTo(w.x,w.y); ctx.stroke();
      ctx.restore();
    }
    ctx.save(); ctx.shadowColor='rgba(200,220,255,1)'; ctx.shadowBlur=14;
    ctx.fillStyle='#FFFFFF'; ctx.beginPath(); ctx.arc(w.x,w.y,7,0,Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

/* Enemies (UNCHANGED) */
function drawEnemies() { ENEMIES.forEach(e => e.alive && drawAlien(e)); }
function drawAlien(e) {
  const px=e.w/10, py=e.h/10;
  const art=[
    [0,0,1,1,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,1,1,0],
    [1,1,2,1,1,1,1,2,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [0,1,1,1,1,1,1,1,1,0],
    [0,0,1,3,1,1,3,1,0,0],
    [0,1,1,1,1,1,1,1,1,0],
    [1,1,0,1,1,1,1,0,1,1],
    [1,0,0,1,1,1,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,1],
  ];
  const CM={0:null,1:'#6A0DAD',2:'#39FF14',3:'#4A0080'};
  art.forEach((row,ri) => {
    const wave=(ri>=7)?Math.sin(e.fr*.9+ri)*2:0;
    row.forEach((v,ci) => {
      const col=CM[v]; if(!col) return;
      ctx.fillStyle=col;
      ctx.fillRect(e.x+ci*px+wave, e.y+ri*py, px+.5, py+.5);
    });
  });
  ctx.fillStyle='rgba(106,13,173,.26)';
  ctx.beginPath(); ctx.ellipse(e.x+e.w/2,e.y+e.h+4,e.w*.38,4,0,0,Math.PI*2); ctx.fill();
}

/* Player — CHANGED: flash when invincible */
function drawPlayer() {
  if (!P.alive) return;
  /* Flicker during invincibility */
  if (P.invincible > 0 && Math.floor(P.invincible / 6) % 2 === 0) return;
  const bob = Math.sin(P.frame*.78)*1.5;
  drawSpiderman(P.x, P.y+bob, P.w, P.h, P.wingUp);
}

function drawSpiderman(x,y,w,h,wingUp) {
  const cx=x+w/2;
  const RED='#CC0000',DRD='#8B0000',BLU='#1565C0',DBL='#0D47A1',WHT='#FFFFFF',BLK='#111';
  const headH=h*.32, bodyH=h*.36, legH=h*.32;
  const headW=w*.72, bodyW=w*.64;

  ctx.fillStyle='rgba(0,0,0,.2)';
  ctx.beginPath(); ctx.ellipse(cx,y+h+5,w*.44,5,0,0,Math.PI*2); ctx.fill();

  const legY=y+headH+bodyH;
  ctx.fillStyle=RED;
  ctx.fillRect(cx-bodyW*.36,legY,bodyW*.28,legH);
  ctx.fillRect(cx+bodyW*.08,legY,bodyW*.28,legH);
  ctx.fillStyle=DRD;
  ctx.fillRect(cx-bodyW*.38,legY+legH-5,bodyW*.35,5);
  ctx.fillRect(cx+bodyW*.04,legY+legH-5,bodyW*.35,5);

  const bY=y+headH;
  ctx.fillStyle=BLU; ctx.fillRect(cx-bodyW/2,bY,bodyW,bodyH);
  ctx.strokeStyle=DBL; ctx.lineWidth=1.5; ctx.strokeRect(cx-bodyW/2,bY,bodyW,bodyH);

  const spX=cx, spY=bY+bodyH*.38;
  ctx.fillStyle=BLK;
  ctx.fillRect(spX-4,spY-6,8,3); ctx.fillRect(spX-7,spY-3,14,3); ctx.fillRect(spX-4,spY,8,3);
  ctx.lineWidth=1; ctx.strokeStyle=BLK;
  [-1,1].forEach(s=>{
    ctx.beginPath(); ctx.moveTo(spX,spY); ctx.lineTo(spX+s*9,spY-5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(spX,spY+1); ctx.lineTo(spX+s*11,spY+1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(spX,spY+2); ctx.lineTo(spX+s*9,spY+7); ctx.stroke();
  });

  const aY=bY+bodyH*.18, aShift=wingUp?-h*.09:0;
  ctx.fillStyle=BLU;
  ctx.fillRect(cx-bodyW/2-w*.22, aY+aShift,      w*.22, h*.09);
  ctx.fillRect(cx+bodyW/2,       aY+aShift+h*.03, w*.22, h*.09);
  ctx.fillStyle=RED;
  ctx.beginPath(); ctx.arc(cx-bodyW/2-w*.22-4,aY+aShift+h*.04,5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+bodyW/2+w*.22+4,aY+aShift+h*.07,5,0,Math.PI*2); ctx.fill();

  ctx.fillStyle=RED; ctx.fillRect(cx-headW/2,y,headW,headH);
  ctx.strokeStyle=DRD; ctx.lineWidth=1.5; ctx.strokeRect(cx-headW/2,y,headW,headH);

  ctx.strokeStyle='rgba(139,0,0,.48)'; ctx.lineWidth=.7;
  ctx.beginPath(); ctx.moveTo(cx,y); ctx.lineTo(cx,y+headH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-headW/2,y+headH*.45); ctx.lineTo(cx+headW/2,y+headH*.45); ctx.stroke();
  [-headW*.28,headW*.28].forEach(ox=>{
    ctx.beginPath(); ctx.moveTo(cx+ox,y); ctx.lineTo(cx,y+headH*.45); ctx.stroke();
  });

  const eY=y+headH*.32, ew=headW*.3, eh=headH*.32;
  ctx.fillStyle=WHT;
  ctx.beginPath(); ctx.ellipse(cx-headW*.19,eY,ew/2,eh/2,-.22,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx+headW*.19,eY,ew/2,eh/2, .22,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=BLK; ctx.lineWidth=1;
  ctx.beginPath(); ctx.ellipse(cx-headW*.19,eY,ew/2,eh/2,-.22,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx+headW*.19,eY,ew/2,eh/2, .22,0,Math.PI*2); ctx.stroke();
}

/* Particles (UNCHANGED) */
function drawParticles() {
  PARTS.forEach(p => {
    ctx.save(); ctx.globalAlpha=p.life;
    ctx.fillStyle=p.col; ctx.shadowColor=p.col; ctx.shadowBlur=8;
    ctx.fillRect(p.x-p.sz/2, p.y-p.sz/2, p.sz, p.sz);
    ctx.restore();
  });
}

/* ================================================================
   SECTION 15 — GAME FLOW
   CHANGED: startGame resets health + new score system,
            showEnd shows only kills + score
================================================================ */
function startGame() {
  initAudio();

  /* Reset all state */
  kills    = 0;
  score    = 0;
  health   = 2;       // 2 hits from enemies = game over
  elapsed  = 0;
  timeLeft = 30;      // CHANGED
  accumT   = 0;
  lastBldg = -8;
  lastEnemy = 0;
  scrollX  = 0;
  gameWon  = false;

  BLDGS=[]; ENEMIES=[]; WEBS=[]; PARTS=[];
  /* REMOVED: COINS=[] */

  /* Reset HUD displays */
  document.getElementById('el-kills').textContent = '0';
  document.getElementById('el-score').textContent = '0';  // ADDED
  document.getElementById('el-time').textContent  = '30'; // CHANGED
  document.getElementById('p-time').classList.remove('urgent');

  /* Reset hearts */
  updateHearts();  // ADDED

  makePlayer();
  initBG();
  preSpawnLevel();

  document.getElementById('home').classList.add('off');
  document.getElementById('end').classList.add('off');
  document.getElementById('hud').classList.add('on');
  if (IS_MOB) document.getElementById('mob').classList.add('on');

  STATE = 'play';
  sfx('start');
  lastT = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  loop(performance.now());
}

function doGameOver() {
  if (STATE !== 'play') return;
  STATE='end'; P.alive=false;
  burst(P.x+P.w/2, P.y+P.h/2, '#E8272B', 24);
  burst(P.x+P.w/2, P.y+P.h/2, '#FF8888', 12);
  sfx('over');
  setTimeout(()=>showEnd(false, 'Better luck next time'), 1400);
}

function doWin() {
  if (STATE !== 'play') return;
  /* Must kill at least 1 enemy — otherwise it's a loss */
  if (kills === 0) {
    STATE='end'; P.alive=false;
    burst(P.x+P.w/2, P.y+P.h/2, '#E8272B', 24);
    burst(P.x+P.w/2, P.y+P.h/2, '#FF8888', 12);
    sfx('over');
    setTimeout(()=>showEnd(false, 'You Lose — you needed at least 1!'), 1400);
    return;
  }
  STATE='end'; gameWon=true;
  burst(P.x+P.w/2, P.y+P.h/2, '#FFD700', 30);
  burst(P.x+P.w/2, P.y+P.h/2, '#FFFFFF', 15);
  sfx('win');
  setTimeout(()=>showEnd(true, 'Mission Complete!'), 1600);
}

/* showEnd — displays Total Kills + Total Score */
function showEnd(won, subMsg) {
  let hsMsg = '';

  /* High score is based on kills-based score */
  if (score > HS) {
    HS = score;
    localStorage.setItem(HS_KEY, HS);
    document.getElementById('el-hs').textContent = HS;
    hsMsg = '🏆 NEW BEST KILLS SCORE!';
  } else {
    hsMsg = 'Best Kills Score: ' + HS;
  }

  document.getElementById('el-badge').innerHTML    = won ? '&#x2605;' : '&#x2715;';
  document.getElementById('el-etitle').textContent = won ? 'YOU WIN!' : 'GAME OVER';
  document.getElementById('el-etitle').className   = 'end-title ' + (won ? 'win' : 'lose');
  /* subMsg is set by caller — each path provides its own message */
  document.getElementById('el-esub').textContent   = subMsg;

  /* CHANGED: only kills + score, no coins */
  document.getElementById('el-ek').textContent = kills;
  document.getElementById('el-es').textContent = score;
  /* REMOVED: el-ec (coins) */

  document.getElementById('el-ehs').textContent = hsMsg;

  document.getElementById('hud').classList.remove('on');
  document.getElementById('mob').classList.remove('on');
  document.getElementById('end').classList.remove('off');
}

/* ================================================================
   SECTION 16 — MAIN LOOP (UNCHANGED)
================================================================ */
function loop(ts) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(ts - lastT, 50); lastT = ts;

  if (STATE === 'play') {
    update(dt);
  } else if (STATE === 'end') {
    const dtF = dt/DT60;
    PARTS = PARTS.filter(p => p.life>0);
    PARTS.forEach(p => {
      p.x+=p.vx*dtF; p.y+=p.vy*dtF; p.vy+=.18*dtF;
      p.life-=p.dec*dtF; p.sz*=Math.pow(.95,dtF);
    });
  }
  render();
}

/* ================================================================
   SECTION 17 — INPUT HANDLING (UNCHANGED)
================================================================ */
document.addEventListener('keydown', e => {
  if (e.code==='Space'||e.key===' ') {
    e.preventDefault();
    if (STATE==='home') startGame();
    else if (STATE==='play') doJump();
  }
  if ((e.code==='KeyF'||e.code==='KeyZ') && STATE==='play') doShoot();
});

canvas.addEventListener('click', () => {
  if (STATE==='home') startGame();
  else if (STATE==='play') doShoot();
});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (STATE==='home') startGame();
  else if (STATE==='play') doJump();
}, {passive:false});

const $mj = document.getElementById('mb-jump');
const $ms = document.getElementById('mb-shoot');

$mj.addEventListener('touchstart', e => {
  e.preventDefault(); e.stopPropagation();
  doJump(); $mj.classList.add('press');
},{passive:false});
$mj.addEventListener('touchend', () => $mj.classList.remove('press'));

$ms.addEventListener('touchstart', e => {
  e.preventDefault(); e.stopPropagation();
  doShoot(); $ms.classList.add('press');
},{passive:false});
$ms.addEventListener('touchend', () => $ms.classList.remove('press'));

document.getElementById('btn-play').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);

/* ================================================================
   SECTION 18 — STARTUP (UNCHANGED)
================================================================ */
initBG();
STATE = 'home';
loop(performance.now());
