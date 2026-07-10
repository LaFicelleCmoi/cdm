/* =========================================================================
   lanyard.js — Lanyard 3D (badge d'accréditation qui pend et se balance)
   Portage vanilla / Three.js du composant ReactBits "Lanyard".
   - PAS de React, PAS de Rapier/WASM : physique de corde "verlet" maison
     (léger, déterministe) + un ressort de "banking" pour le ressenti 3D.
   - Chargé en module ESM ; Three.js vient de l'importmap "three".
   - API exposée :  window.CDMLanyard.mount(stage, opts) / .unmount()
     opts = { country, iso, group, flag, compLabel, roleLabel, groupLabel,
              serial, onClick }
   - Discipline perf (comme les paillettes) : la boucle rAF DORT dès que le
     badge est immobile, quand l'onglet est caché, ou quand le stage est hors
     écran. Elle se réveille au drag / au montage / au redimensionnement.
   ========================================================================= */
import * as THREE from 'three';

(function () {
  'use strict';

  const REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---- Constantes du monde (unités Three arbitraires) --------------------
  const SEG = 0.7;            // longueur d'un segment de corde (cordon court → badge haut)
  const N_ROPE = 4;           // points de corde : P0 (ancre) .. P3
  const CLIP_GAP = 0.3;       // "joint sphérique" entre P3 et le haut du badge
  const CARD_W = 2.5, CARD_H = 3.75;  // badge AGRANDI (ratio 2:3)
  const ANCHOR_Y = 4.0;       // hauteur de l'ancre fixe (= bord haut du stage)
  const GRAV = -19;           // gravité (u/s²)
  const DAMP = 0.955;         // amortissement verlet (settle ~3 s puis sommeil = 0 % CPU)
  const ITER = 6;             // itérations de contraintes / frame
  const DT = 1 / 60;
  const SLEEP_EPS = 0.0000045; // énergie cinétique sous laquelle on s'endort
  const SLEEP_FRAMES = 45;     // frames calmes consécutives avant sommeil
  const FIT_HEIGHT = 6.6;      // hauteur monde visible (badge plus gros à l'écran)
  const LOOK_Y = 0.7;          // centre caméra : bord haut = LOOK_Y+FIT/2 = 4.0 = ANCHOR_Y
                               // → l'ancre du cordon est pile au bord haut du stage

  let S = null;  // scène active (une seule à la fois)
  const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // scratch réutilisé
  const _dragOut = new THREE.Vector3();

  // ------------------------------------------------------------------ utils
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function pt(x, y) { return { x, y, px: x, py: y, pinned: false }; }

  // ========================================================== DESSIN DU BADGE
  // Dessine l'accréditation sur un canvas 2D → CanvasTexture pour la face avant.
  function drawBadge(cnv, opts, flagImg) {
    const W = cnv.width, H = cnv.height;
    const ctx = cnv.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // fond arrondi + liseré or
    const r = W * 0.06;
    roundRect(ctx, 4, 4, W - 8, H - 8, r);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#142233'); g.addColorStop(0.55, '#0c1622'); g.addColorStop(1, '#16301e');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = W * 0.02; ctx.strokeStyle = 'rgba(251,197,49,0.9)'; ctx.stroke();

    // clip au contour arrondi pour tout ce qui suit
    ctx.save();
    roundRect(ctx, 4, 4, W - 8, H - 8, r); ctx.clip();

    // texture : fines rayures diagonales (peintes UNE fois, coût nul ensuite)
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.022)'; ctx.lineWidth = 6;
    for (let d = -H; d < W + H; d += 26) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke(); }
    ctx.restore();

    // bandeau haut (compétition)
    const headH = H * 0.115;
    const hg = ctx.createLinearGradient(0, 0, W, 0);
    hg.addColorStop(0, '#fbc531'); hg.addColorStop(1, '#ffe08a');
    ctx.fillStyle = hg; ctx.fillRect(0, 0, W, headH);
    ctx.fillStyle = '#10202f';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(H * 0.042)}px 'Inter', Arial, sans-serif`;
    ctx.fillText(spaced(opts.compLabel || 'COUPE DU MONDE 2026'), W / 2, headH * 0.52);

    // drapeau (si chargé & non-tainted), un peu plus grand + ombre portée
    const flagY = headH + H * 0.04, flagW = W * 0.56, flagH = flagW * 0.66, flagX = (W - flagW) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    roundRect(ctx, flagX, flagY, flagW, flagH, flagW * 0.05);
    ctx.fillStyle = '#1e3145'; ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, flagX, flagY, flagW, flagH, flagW * 0.05); ctx.clip();
    if (flagImg && flagImg.complete && flagImg.naturalWidth) {
      // "cover" dans le cadre
      const s = Math.max(flagW / flagImg.naturalWidth, flagH / flagImg.naturalHeight);
      const dw = flagImg.naturalWidth * s, dh = flagImg.naturalHeight * s;
      ctx.drawImage(flagImg, flagX + (flagW - dw) / 2, flagY + (flagH - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `700 ${Math.round(H * 0.05)}px 'Inter', Arial, sans-serif`;
      ctx.fillText((opts.iso || '').toUpperCase(), W / 2, flagY + flagH / 2);
    }
    ctx.restore();
    ctx.lineWidth = W * 0.008; ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    roundRect(ctx, flagX, flagY, flagW, flagH, flagW * 0.05); ctx.stroke();

    // pile de texte sous le drapeau (curseur vertical : les lignes optionnelles
    // rang/prochain match décalent proprement le reste)
    let y = flagY + flagH + H * 0.075;

    // nom du pays
    ctx.fillStyle = '#ffffff';
    let fs = H * 0.082;
    ctx.font = `700 ${Math.round(fs)}px 'Bebas Neue', 'Inter', Arial, sans-serif`;
    const name = (opts.country || '').toUpperCase();
    // réduit la police si le nom déborde
    while (ctx.measureText(name).width > W * 0.86 && fs > H * 0.045) {
      fs *= 0.92; ctx.font = `700 ${Math.round(fs)}px 'Bebas Neue', 'Inter', Arial, sans-serif`;
    }
    ctx.fillText(name, W / 2, y);
    y += H * 0.055;

    // groupe
    ctx.fillStyle = 'rgba(251,197,49,0.95)';
    ctx.font = `800 ${Math.round(H * 0.036)}px 'Inter', Arial, sans-serif`;
    ctx.fillText(spaced(`${opts.groupLabel || 'GROUPE'} ${opts.group || ''}`.trim()), W / 2, y);
    y += H * 0.055;

    // rang mondial + points FIFA (en direct) — pastille dorée
    if (opts.rankLine) {
      ctx.font = `800 ${Math.round(H * 0.032)}px 'Inter', Arial, sans-serif`;
      const tw = ctx.measureText(opts.rankLine).width;
      const pw = tw + W * 0.09, ph = H * 0.052;
      ctx.fillStyle = 'rgba(251,197,49,0.14)';
      roundRect(ctx, W / 2 - pw / 2, y - ph / 2, pw, ph, ph / 2); ctx.fill();
      ctx.strokeStyle = 'rgba(251,197,49,0.55)'; ctx.lineWidth = 2;
      roundRect(ctx, W / 2 - pw / 2, y - ph / 2, pw, ph, ph / 2); ctx.stroke();
      ctx.fillStyle = '#ffd966';
      ctx.fillText(opts.rankLine, W / 2, y + 1);
      y += H * 0.062;
    }

    // prochain match (si connu)
    if (opts.subLine) {
      ctx.fillStyle = 'rgba(200,210,221,0.85)';
      ctx.font = `700 ${Math.round(H * 0.026)}px 'Inter', Arial, sans-serif`;
      ctx.fillText(opts.subLine, W / 2, y);
      y += H * 0.05;
    }

    // rôle
    ctx.fillStyle = 'rgba(200,210,221,0.75)';
    ctx.font = `700 ${Math.round(H * 0.028)}px 'Inter', Arial, sans-serif`;
    ctx.fillText(spaced(opts.roleLabel || 'SUPPORTER'), W / 2, y);

    // faux code-barres + série en bas
    const barY = H * 0.895, barH = H * 0.05;
    let bx = W * 0.14; ctx.fillStyle = '#e8eef4';
    while (bx < W * 0.86) { const bw = 1 + (Math.floor(bx * 13) % 5); ctx.fillRect(bx, barY, bw, barH); bx += bw + (2 + (Math.floor(bx * 7) % 4)); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'right';
    ctx.font = `600 ${Math.round(H * 0.024)}px 'Inter', Arial, sans-serif`;
    ctx.fillText(opts.serial || 'FWC-2026', W * 0.86, H * 0.972);
    ctx.textAlign = 'center';

    // reflet « verre » : bande diagonale claire en haut-gauche (peinte une fois)
    const sh = ctx.createLinearGradient(0, 0, W * 0.9, H * 0.55);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)');
    sh.addColorStop(0.45, 'rgba(255,255,255,0.025)');
    sh.addColorStop(0.72, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(W * 0.85, 0); ctx.lineTo(W * 0.3, H * 0.62); ctx.lineTo(0, H * 0.45);
    ctx.closePath(); ctx.fill();

    ctx.restore();

    // trou de perforation (clip) en haut — transparent
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.ellipse(W / 2, H * 0.028, W * 0.055, H * 0.014, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const spaced = (s) => String(s).split('').join(' '); // léger interlettrage

  // Face arrière du badge (sobre)
  function drawBack(cnv, opts) {
    const W = cnv.width, H = cnv.height, ctx = cnv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const r = W * 0.06;
    roundRect(ctx, 4, 4, W - 8, H - 8, r);
    ctx.fillStyle = '#0c1622'; ctx.fill();
    ctx.lineWidth = W * 0.018; ctx.strokeStyle = 'rgba(251,197,49,0.5)'; ctx.stroke();
    ctx.save(); roundRect(ctx, 4, 4, W - 8, H - 8, r); ctx.clip();
    ctx.fillStyle = 'rgba(251,197,49,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(H * 0.07)}px 'Bebas Neue','Inter',Arial,sans-serif`;
    ctx.fillText('CDM 2026', W / 2, H * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `600 ${Math.round(H * 0.03)}px 'Inter',Arial,sans-serif`;
    ctx.fillText('worldcup.tracker', W / 2, H * 0.58);
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.ellipse(W / 2, H * 0.028, W * 0.055, H * 0.014, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Texture du cordon (sangle) — motif tissé or/vert + petit texte répété
  function makeStrapTexture(opts) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#0b8f4e'); g.addColorStop(0.5, '#12b866'); g.addColorStop(1, '#0b8f4e');
    x.fillStyle = g; x.fillRect(0, 0, 512, 64);
    x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 2;
    for (let i = -64; i < 512; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); }
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = "800 26px 'Inter',Arial,sans-serif";
    x.fillText('★ CDM 2026 ★ CDM 2026', 256, 34);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  // ======================================================= CHARGEMENT DRAPEAU
  // crossOrigin='anonymous' : si le CDN n'envoie pas les en-têtes CORS, l'image
  // échoue (onerror) et le canvas ne devient JAMAIS "tainted" → texture sûre.
  function loadFlag(url, cb) {
    if (!url) { cb(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => cb(img);
    img.onerror = () => cb(null);
    img.src = url;
  }

  // ================================================================= MONTAGE
  function mount(stage, opts) {
    if (!stage || !opts || !opts.country) return;
    // idempotent : même clé (pays + langue) + canvas encore en place → pas de
    // reconstruction (sinon fuite de contexte WebGL à chaque refresh live).
    const key = opts.key || opts.country;
    if (S && S.key === key && S.canvas && S.canvas.isConnected && S.stage === stage) return;
    unmount();
    try { build(stage, opts); }
    catch (e) { console.warn('[lanyard] build échoué', e); unmount(); }
  }

  function build(stage, opts) {
    const W = stage.clientWidth || 320, H = stage.clientHeight || 320;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(W, H, false);
    const canvas = renderer.domElement;
    canvas.style.width = '100%'; canvas.style.height = '100%';
    canvas.style.display = 'block'; canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    stage.appendChild(canvas);

    try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 100);
    camera.position.set(0, LOOK_Y, camZfor(28, FIT_HEIGHT));
    camera.lookAt(0, LOOK_Y, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1); dir.position.set(-2, 3, 4); scene.add(dir);
    const glint = new THREE.PointLight(0xfff4d0, 0.7, 40); glint.position.set(2.5, 2, 6); scene.add(glint);

    // ---- textures badge ----
    const front = document.createElement('canvas'); front.width = 512; front.height = 768;
    const back = document.createElement('canvas'); back.width = 512; back.height = 768;
    drawBadge(front, opts, null);
    drawBack(back, opts);
    const frontTex = new THREE.CanvasTexture(front); frontTex.colorSpace = THREE.SRGBColorSpace; frontTex.anisotropy = 8;
    const backTex = new THREE.CanvasTexture(back); backTex.colorSpace = THREE.SRGBColorSpace; backTex.anisotropy = 8;

    // ---- badge (groupe : face avant + face arrière + liseré tranche) ----
    const cardGroup = new THREE.Group();
    const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, transparent: true, roughness: 0.35, metalness: 0.12, emissive: 0x0a0f16, emissiveIntensity: 0.35 });
    const backMat = new THREE.MeshStandardMaterial({ map: backTex, transparent: true, roughness: 0.45, metalness: 0.1 });
    const frontMesh = new THREE.Mesh(geo, frontMat); frontMesh.position.z = 0.03;
    const backMesh = new THREE.Mesh(geo, backMat); backMesh.position.z = -0.03; backMesh.rotation.y = Math.PI;
    cardGroup.add(frontMesh, backMesh);
    // petit clip métal en haut
    const clip = new THREE.Mesh(
      new THREE.BoxGeometry(CARD_W * 0.13, CARD_H * 0.05, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xcfd6dc, roughness: 0.3, metalness: 0.9 })
    );
    clip.position.set(0, CARD_H * 0.5 + CARD_H * 0.02, 0);
    cardGroup.add(clip);
    scene.add(cardGroup);

    // cible de raycast (plan invisible un peu plus large, pour attraper facilement)
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 1.15, CARD_H * 1.1), new THREE.MeshBasicMaterial({ visible: false }));
    cardGroup.add(hit);

    // ---- cordon (ruban) ----
    const strapTex = makeStrapTexture(opts);
    const M = 24;                    // nb d'échantillons le long du ruban
    const strapGeo = new THREE.BufferGeometry();
    const posArr = new Float32Array(M * 2 * 3);
    const uvArr = new Float32Array(M * 2 * 2);
    const idx = [];
    for (let i = 0; i < M; i++) {
      uvArr[(i * 2) * 2] = 0; uvArr[(i * 2) * 2 + 1] = i / (M - 1) * 4;      // répète 4× sur la longueur
      uvArr[(i * 2 + 1) * 2] = 1; uvArr[(i * 2 + 1) * 2 + 1] = i / (M - 1) * 4;
      if (i < M - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    strapGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    strapGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    strapGeo.setIndex(idx);
    // normales constantes (0,0,1) : le ruban est plan et face +Z → inutile de les
    // recalculer chaque frame (DoubleSide gère la face arrière).
    const normArr = new Float32Array(M * 2 * 3);
    for (let k = 0; k < M * 2; k++) { normArr[k * 3 + 2] = 1; }
    strapGeo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    const strapMat = new THREE.MeshStandardMaterial({ map: strapTex, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.0 });
    const strap = new THREE.Mesh(strapGeo, strapMat);
    strap.frustumCulled = false;
    scene.add(strap);

    // ---- état physique (verlet) ----
    // corde : P[0] ancre fixe .. P[3] ; T = haut du badge, B = bas du badge.
    const P = [];
    for (let i = 0; i < N_ROPE; i++) P.push(pt(0, ANCHOR_Y - i * SEG));
    P[0].pinned = true;
    const T = pt(0, P[N_ROPE - 1].y - CLIP_GAP);
    const B = pt(0, T.y - CARD_H);

    S = {
      country: opts.country, key: opts.key || opts.country, opts, stage, renderer, scene, camera, canvas,
      cardGroup, frontMesh, hit, strap, strapGeo, posArr, curvePts: null,
      frontTex, front, P, T, B,
      raycaster: new THREE.Raycaster(), ndc: new THREE.Vector2(),
      dragging: false, grabTop: null, calm: 0, active: false, raf: 0,
      bankY: 0, bankYv: 0, bankX: 0, bankXv: 0, prevCx: 0, prevCy: (T.y + B.y) / 2,
      alive: true,
    };
    S.curvePts = [P[0], P[1], P[2], P[3], T].map(p => V(p.x, p.y, 0));
    // courbe + points de sortie pré-alloués (réutilisés chaque frame → 0 alloc)
    S.curve = new THREE.CatmullRomCurve3(S.curvePts, false, 'chordal');
    S.curveOut = Array.from({ length: 24 }, () => new THREE.Vector3());

    // scene0 = identité de CE build : un drapeau qui arrive tard pour un build
    // périmé (switch rapide de favori) ne doit pas repeindre le badge courant.
    const scene0 = S;
    // drapeau (async) → mémorise l'image puis redessine la texture
    loadFlag(opts.flag, (img) => {
      if (S !== scene0 || !scene0.alive) return;
      scene0.flagImg = img;
      drawBadge(scene0.front, scene0.opts, img); scene0.frontTex.needsUpdate = true;
      renderOnce();
    });
    // repolices : redessine (SANS re-télécharger) une fois les webfonts prêtes
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (S !== scene0 || !scene0.alive) return;
      drawBadge(scene0.front, scene0.opts, scene0.flagImg || null); scene0.frontTex.needsUpdate = true;
      renderOnce();
    });

    // ---- events ----
    S.onDown = onPointerDown; S.onMove = onPointerMove; S.onUp = onPointerUp; S.onVis = onVisibility;
    canvas.addEventListener('pointerdown', S.onDown);
    window.addEventListener('pointermove', S.onMove);
    window.addEventListener('pointerup', S.onUp);
    document.addEventListener('visibilitychange', S.onVis);
    S.onScreen = true;
    if (typeof ResizeObserver !== 'undefined') { S.ro = new ResizeObserver(onResize); S.ro.observe(stage); }
    if (typeof IntersectionObserver !== 'undefined') {
      S.io = new IntersectionObserver((ents) => {
        const vis = ents[0] && ents[0].isIntersecting;
        S.onScreen = vis; if (vis) wake(); else sleep();
      }, { threshold: 0.05 });
      S.io.observe(stage);
    }

    // clic (sans drag) → ouvre la carte pays
    S.downXY = null;
    canvas.addEventListener('click', () => {
      if (S && S.movedFar) return; // c'était un drag
      if (opts.onClick) opts.onClick();
    });

    // premier rendu + petite impulsion de réveil (se balance puis s'endort)
    solveGeometry();
    updateMeshes();
    renderOnce();
    if (!REDUCE) { T.px = T.x + 0.14; B.px = B.x + 0.10; wake(); }
    } catch (e) {
      // échec en cours de construction (S peut être encore null → unmount() ne
      // suffirait pas) : libère explicitement le contexte WebGL + le canvas.
      try { renderer.dispose(); renderer.forceContextLoss(); } catch (_) {}
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      S = null;
      throw e;
    }
  }

  const camZfor = (fovDeg, height) => (height / 2) / Math.tan((fovDeg * Math.PI / 180) / 2);

  // -------------------------------------------------------- boucle & sommeil
  function wake() {
    if (!S || !S.alive || S.active) return;
    if (document.hidden || S.onScreen === false) return;
    S.active = true; S.calm = 0; S.awakeFrames = 0;
    S.raf = requestAnimationFrame(frame);
  }
  function sleep() {
    if (!S) return;
    S.active = false;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  }
  function onVisibility() { if (!S) return; if (document.hidden) sleep(); else wake(); }

  function frame() {
    if (!S || !S.alive || !S.active) return;
    step();
    updateMeshes();
    S.renderer.render(S.scene, S.camera);
    // énergie cinétique → sommeil quand tout est calme
    const ke = kinetic();
    if (!S.dragging && ke < SLEEP_EPS) { if (++S.calm >= SLEEP_FRAMES) { sleep(); return; } }
    else S.calm = 0;
    // garde-fou dur : jamais plus de ~12 s de boucle d'affilée sans drag
    // (si l'énergie stagnait juste au-dessus du seuil → 0 % CPU garanti)
    if (!S.dragging && ++S.awakeFrames > 720) { sleep(); return; }
    S.raf = requestAnimationFrame(frame);
  }
  function renderOnce() { if (S) S.renderer.render(S.scene, S.camera); }

  function kinetic() {
    let e = 0; const all = [S.P[1], S.P[2], S.P[3], S.T, S.B];
    for (const p of all) { const dx = p.x - p.px, dy = p.y - p.py; e += dx * dx + dy * dy; }
    e += S.bankYv * S.bankYv + S.bankXv * S.bankXv;
    return e;
  }

  // ------------------------------------------------------------- PHYSIQUE
  function step() {
    const P = S.P, T = S.T, B = S.B;
    // Pendant le drag, fige la vitesse "par frame" (et non par événement pointeur) :
    // T.px = position au début de la frame précédente → lancer cohérent quelle que
    // soit la fréquence de la souris (125 Hz … 1000 Hz).
    if (S.dragging) { T.px = S.dragFrameX; T.py = S.dragFrameY; S.dragFrameX = T.x; S.dragFrameY = T.y; }

    // intégration verlet (points libres : P1..P3, T, B ; T figé si drag)
    integrate(P[1]); integrate(P[2]); integrate(P[3]);
    if (!(S.dragging)) integrate(T);
    integrate(B);

    solveGeometry();

    // banking 3D : la vitesse horizontale/verticale du centre → petites
    // rotations Y/X avec ressort de rappel (donne le relief sans rigid-body).
    const cx = (T.x + B.x) / 2, cy = (T.y + B.y) / 2;
    const vx = cx - S.prevCx, vy = cy - S.prevCy;
    S.prevCx = cx; S.prevCy = cy;
    spring('bankY', clamp(vx * 2.6, -0.7, 0.7), 0.10, 0.80);
    spring('bankX', clamp(-vy * 1.8, -0.4, 0.4), 0.10, 0.80);
  }

  function integrate(p) {
    if (p.pinned) return;
    const vx = (p.x - p.px) * DAMP, vy = (p.y - p.py) * DAMP;
    p.px = p.x; p.py = p.y;
    p.x += vx; p.y += vy + GRAV * DT * DT;
    if (!isFinite(p.x) || !isFinite(p.y)) { p.x = p.px = 0; p.y = p.py = 0; } // garde-fou NaN
  }

  function spring(key, target, k, damp) {
    const vk = key + 'v';
    S[vk] = (S[vk] + (target - S[key]) * k) * damp;
    S[key] += S[vk];
  }

  // contraintes de distance (corde + joint + rigidité du badge)
  function solveGeometry() {
    const P = S.P, T = S.T, B = S.B;
    for (let it = 0; it < ITER; it++) {
      P[0].x = 0; P[0].y = ANCHOR_Y;                       // ancre fixe
      for (let i = 1; i < N_ROPE; i++) constrain(P[i - 1], P[i], SEG);
      constrain(P[N_ROPE - 1], T, CLIP_GAP);               // joint P3 ↔ haut badge
      constrain(T, B, CARD_H);                             // badge rigide
    }
    // met à jour la courbe du ruban
    const cp = S.curvePts;
    cp[0].set(P[0].x, P[0].y, 0); cp[1].set(P[1].x, P[1].y, 0);
    cp[2].set(P[2].x, P[2].y, 0); cp[3].set(P[3].x, P[3].y, 0);
    cp[4].set(T.x, T.y, 0);
  }

  // rapproche/écarte deux points pour respecter la distance de repos
  function constrain(a, b, rest) {
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy); if (d < 1e-6) d = 1e-6;
    const diff = (d - rest) / d;
    const aMove = a.pinned ? 0 : (b.pinned ? 1 : 0.5);
    const bMove = b.pinned ? 0 : (a.pinned ? 1 : 0.5);
    a.x += dx * diff * aMove; a.y += dy * diff * aMove;
    b.x -= dx * diff * bMove; b.y -= dy * diff * bMove;
  }

  // --------------------------------------------------------- rendu meshes
  function updateMeshes() {
    const T = S.T, B = S.B;
    const cx = (T.x + B.x) / 2, cy = (T.y + B.y) / 2;
    S.cardGroup.position.set(cx, cy, 0);
    // rotation en plan (Z) : l'axe "haut" du badge pointe de B vers T
    const ux = T.x - B.x, uy = T.y - B.y;
    S.cardGroup.rotation.z = Math.atan2(-ux, uy);
    S.cardGroup.rotation.y = S.bankY;
    S.cardGroup.rotation.x = S.bankX;

    // ruban : ré-échantillonne la courbe pré-allouée (0 alloc) et pose 2 sommets
    // par section (offset ⟂ dans XY). S.curve pointe sur S.curvePts, muté par frame.
    const pts = S.curveOut;
    for (let i = 0; i < 24; i++) S.curve.getPoint(i / 23, pts[i]);
    const arr = S.posArr, hw = 0.16;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty * hw, ny = tx * hw;
      const o = i * 6;
      arr[o] = p.x - nx; arr[o + 1] = p.y - ny; arr[o + 2] = p.z;
      arr[o + 3] = p.x + nx; arr[o + 4] = p.y + ny; arr[o + 5] = p.z;
    }
    S.strapGeo.attributes.position.needsUpdate = true;
    // (normales constantes posées au build → pas de recalcul par frame)
  }

  // ------------------------------------------------------------- pointer
  function setNDC(e) {
    const r = S.canvas.getBoundingClientRect();
    S.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    S.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  // projette le pointeur sur le plan z=0 (monde)
  function pointerWorld(e) {
    setNDC(e);
    S.raycaster.setFromCamera(S.ndc, S.camera);
    S.raycaster.ray.intersectPlane(_dragPlane, _dragOut); // scratch réutilisé (lu aussitôt)
    return _dragOut;
  }
  function onPointerDown(e) {
    if (!S) return;
    setNDC(e);
    S.raycaster.setFromCamera(S.ndc, S.camera);
    const hits = S.raycaster.intersectObject(S.hit, false);
    if (!hits.length) return;
    e.preventDefault();
    const w = pointerWorld(e);
    S.dragging = true; S.movedFar = false; S.downXY = { x: e.clientX, y: e.clientY };
    S.grabTop = { dx: S.T.x - w.x, dy: S.T.y - w.y };
    S.dragFrameX = S.T.x; S.dragFrameY = S.T.y; // ancre de vitesse par frame
    S.T.pinned = true;
    S.canvas.style.cursor = 'grabbing';
    try { S.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    wake();
  }
  function onPointerMove(e) {
    if (!S || !S.dragging) return;
    const w = pointerWorld(e);
    S.T.x = w.x + S.grabTop.dx; S.T.y = w.y + S.grabTop.dy;
    // (px/py de T sont figés PAR FRAME dans step() → lancer indépendant du taux d'événements)
    if (S.downXY) { const d = Math.abs(e.clientX - S.downXY.x) + Math.abs(e.clientY - S.downXY.y); if (d > 6) S.movedFar = true; }
    wake();
  }
  function onPointerUp(e) {
    if (!S || !S.dragging) return;
    S.dragging = false; S.T.pinned = false;
    S.canvas.style.cursor = 'grab';
    try { S.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    S.awakeFrames = 0; // le plafond 12 s compte depuis la dernière interaction
    wake();
  }

  // ------------------------------------------------------------- resize
  function onResize() {
    if (!S) return;
    const W = S.stage.clientWidth || 1, H = S.stage.clientHeight || 1;
    S.renderer.setSize(W, H, false);
    S.camera.aspect = W / H;
    S.camera.position.z = camZfor(28, FIT_HEIGHT); // framing vertical constant
    S.camera.updateProjectionMatrix();
    renderOnce(); wake();
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ------------------------------------------------------------- unmount
  function unmount() {
    if (!S) return;
    S.alive = false;
    sleep();
    try { S.ro && S.ro.disconnect(); } catch (_) {}
    try { S.io && S.io.disconnect(); } catch (_) {}
    document.removeEventListener('visibilitychange', S.onVis);
    window.removeEventListener('pointermove', S.onMove);
    window.removeEventListener('pointerup', S.onUp);
    if (S.canvas) S.canvas.removeEventListener('pointerdown', S.onDown);
    try {
      S.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); });
        }
      });
      S.renderer.dispose();
      S.renderer.forceContextLoss();
    } catch (_) {}
    if (S.canvas && S.canvas.parentNode) S.canvas.parentNode.removeChild(S.canvas);
    S = null;
  }

  // ---- API + auto-init si le favori a été rendu avant ce module ----------
  // Met à jour le CONTENU du badge (rang FIFA, prochain match…) sans reconstruire
  // la scène 3D : fusion des opts + redessin de la texture avant (coût : 1 canvas 2D).
  function updateBadge(extra) {
    if (!S || !S.alive || !extra) return;
    Object.assign(S.opts, extra);
    drawBadge(S.front, S.opts, S.flagImg || null);
    S.frontTex.needsUpdate = true;
    renderOnce();
  }

  window.CDMLanyard = { mount, unmount, updateBadge, _debug: () => S ? { active: S.active, calm: S.calm, awakeFrames: S.awakeFrames, dragging: S.dragging } : null };
  if (typeof window.syncLanyard === 'function') { try { window.syncLanyard(); } catch (_) {} }
})();
