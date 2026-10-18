// Procedural 3D devices for the cinema style, modelled from published dimensions (no Apple
// assets or logos): a 14" MacBook Pro and an iPhone 18 Pro. 1 unit = 10 cm.
// Used by cinema.js and by scripts/demo-video/export-models.mjs (writes .glb files).
//
//   const mac = buildMacBookPro({ finish: "spaceBlack", screen: (aspect, rTop, rBottom) => material });
//   mac.group, mac.lid (rotate .rotation.x: PI/2 closed, -0.24 open), mac.display, mac.SW, mac.SH, mac.MENU
//   const phone = buildIPhone({ finish: "silver", screen });  phone.group, phone.display, phone.DW, phone.DH
// `screen` builds each display's material (the plane is SW x SH); default is a black glossy panel.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const MAC_FINISH = {
  spaceBlack: { metal: 0x2c2d31, rough: 0.4, deck: "#26272b", well: "#17181b", key: "#0b0b0d", legend: "rgba(232,232,237,0.5)", grille: "#111215", pad: "#2b2c30", ring: "#46474d" },
  silver: { metal: 0xd4d6da, rough: 0.3, deck: "#c4c6cb", well: "#2b2c30", key: "#0e0f11", legend: "rgba(232,232,237,0.55)", grille: "#8f9196", pad: "#c9cbd0", ring: "#55565c" },
};
export const PHONE_FINISH = {
  silver: { metal: 0xdcdde1, rough: 0.28 },
  black: { metal: 0x2a2b2f, rough: 0.34 },
  glacier: { metal: 0xbfd2e2, rough: 0.3 },
  burgundy: { metal: 0x5b2029, rough: 0.32 },
};

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function flat(shape, depth, bevel, mat, seg = 4) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: 20 });
  return new THREE.Mesh(geo, mat);
}

// MacBook Pro top case: Magic Keyboard (full-height function row, inverted-T arrows) between
// two speaker grilles, and a large Force Touch trackpad. Drawn once into a canvas.
function keyboardTexture(finish) {
  const c = document.createElement("canvas");
  c.width = 2048; c.height = 1427;
  const g = c.getContext("2d");
  g.fillStyle = finish.deck; g.fillRect(0, 0, c.width, c.height);
  const well = { x: 238, y: 92, w: 1572, h: 664 };
  g.fillStyle = finish.well; g.beginPath(); g.roundRect(well.x - 12, well.y - 12, well.w + 24, well.h + 24, 18); g.fill();
  // Speaker grilles: fine perforation fields either side of the keyboard.
  g.fillStyle = finish.grille;
  for (const gx of [70, 1878]) for (let y = well.y; y < well.y + well.h; y += 11) for (let x = gx; x < gx + 100; x += 11) { g.beginPath(); g.arc(x + ((y / 11) % 2) * 5.5, y, 2.6, 0, 7); g.fill(); }
  const rows = [
    [["esc", 1.5], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 1]), ["", 1]],
    [["`", 1], ..."1234567890-=".split("").map((k) => [k, 1]), ["delete", 1.5]],
    [["tab", 1.5], ..."QWERTYUIOP[]\\".split("").map((k) => [k, 1])],
    [["caps", 1.8], ..."ASDFGHJKL;'".split("").map((k) => [k, 1]), ["return", 1.7]],
    [["shift", 2.3], ..."ZXCVBNM,./".split("").map((k) => [k, 1]), ["shift", 2.2]],
    [["fn", 1], ["control", 1], ["option", 1], ["command", 1.25], ["", 5], ["command", 1.25], ["option", 1], ["arrows", 3]],
  ];
  const gap = 10, kh = (well.h - gap * 5) / 6;
  const key = (x, y, w, h, label) => {
    g.fillStyle = finish.key; g.beginPath(); g.roundRect(x, y, w, h, 9); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.05)"; g.lineWidth = 2; g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, h - 2, 8); g.stroke();
    if (!label) return;
    g.fillStyle = finish.legend;
    const big = label.length === 1;
    g.font = `${big ? 500 : 400} ${big ? 30 : 19}px "Adwaita Sans", sans-serif`;
    g.textAlign = big ? "center" : "left";
    g.fillText(label, big ? x + w / 2 : x + 14, big ? y + h / 2 + 10 : y + h - 16);
  };
  rows.forEach((row, r) => {
    const units = row.reduce((a, [, u]) => a + u, 0);
    const unit = (well.w - gap * (row.length - 1)) / units;
    let x = well.x;
    const y = well.y + r * (kh + gap);
    for (const [label, u] of row) {
      const w = unit * u + (u > 1 ? gap * 0 : 0);
      if (label === "arrows") {
        const aw = (w - gap * 2) / 3, hh = (kh - gap) / 2;
        key(x, y + hh + gap, aw, hh, "");
        key(x + aw + gap, y, aw, hh, "");
        key(x + aw + gap, y + hh + gap, aw, hh, "");
        key(x + (aw + gap) * 2, y + hh + gap, aw, hh, "");
      } else if (r === 0 && label === "") {
        // Touch ID: a flat ring rather than a key cap.
        g.fillStyle = finish.key; g.beginPath(); g.roundRect(x, y, w, kh, 9); g.fill();
        g.strokeStyle = finish.ring; g.lineWidth = 3; g.beginPath(); g.roundRect(x + 5, y + 5, w - 10, kh - 10, 7); g.stroke();
      } else key(x, y, w, kh, label);
      x += w + gap;
    }
  });
  const pad = { w: 1010, h: 590 };
  g.fillStyle = finish.pad;
  g.beginPath(); g.roundRect((c.width - pad.w) / 2, 800, pad.w, pad.h, 22); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 3; g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const blackScreen = () => new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.18, metalness: 0 });

export function buildMacBookPro({ finish = "spaceBlack", screen = blackScreen } = {}) {
  // MacBook Pro 14": 31.3 x 22.1 x 1.55 cm (1 unit = 10 cm), anodised unibody, notched
  // 3024x1964 display with slim bezels, black hinge, keyboard between speaker grilles.
  const fin = MAC_FINISH[finish] || MAC_FINISH.spaceBlack;
  const metal = new THREE.MeshStandardMaterial({ color: fin.metal, metalness: 0.88, roughness: fin.rough, envMapIntensity: 1.15 });
  const BW = 3.126, BD = 2.212;
  const laptop = new THREE.Group();
  const base = flat(roundedRect(BW - 0.024, BD - 0.024, 0.085), 0.08, 0.012, metal);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.02;
  base.castShadow = true;
  laptop.add(base);
  const TOP = 0.112;
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.09), new THREE.MeshStandardMaterial({ map: keyboardTexture(fin), metalness: 0.55, roughness: 0.5 }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = TOP + 0.0005;
  laptop.add(deck);
  const hingeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, metalness: 0.6, roughness: 0.35 });
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 2.62, 24), hingeMat);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, TOP - 0.004, -BD / 2 + 0.03);
  laptop.add(hinge);

  const LH = 2.15;
  const lid = new THREE.Group();
  lid.position.set(0, TOP, -BD / 2 + 0.03);
  laptop.add(lid);
  const lidBody = flat(roundedRect(BW - 0.016, LH - 0.016, 0.085), 0.03, 0.008, metal, 3);
  lidBody.position.set(0, LH / 2, -0.046 + 0.008);
  lidBody.castShadow = true;
  lid.add(lidBody);
  const panel = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(BW - 0.03, LH - 0.03, 0.078), 20), new THREE.MeshStandardMaterial({ color: 0x030303, metalness: 0.1, roughness: 0.3 }));
  panel.position.set(0, LH / 2, 0.0015);
  lid.add(panel);
  const SW = 3.02, SH = 1.96, CHIN = 0.13, MENU = 37 / 982;
  const laptopDisplay = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), screen(SW / SH, 0.05 / SH, 0.012 / SH));
  laptopDisplay.position.set(0, CHIN + SH / 2, 0.003);
  lid.add(laptopDisplay);
  // The notch: sits in the menu-bar band; only visible when the screen shows a full-bleed image.
  const notchShape = new THREE.Shape();
  const nw = 0.31, nh = SH * MENU, nr = 0.022;
  notchShape.moveTo(-nw / 2, 0); notchShape.lineTo(nw / 2, 0); notchShape.lineTo(nw / 2, -nh + nr);
  notchShape.quadraticCurveTo(nw / 2, -nh, nw / 2 - nr, -nh); notchShape.lineTo(-nw / 2 + nr, -nh);
  notchShape.quadraticCurveTo(-nw / 2, -nh, -nw / 2, -nh + nr); notchShape.lineTo(-nw / 2, 0);
  const notch = new THREE.Mesh(new THREE.ShapeGeometry(notchShape, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  notch.position.set(0, CHIN + SH, 0.0035);
  lid.add(notch);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24), new THREE.MeshStandardMaterial({ color: 0x0a0c12, metalness: 0.2, roughness: 0.25, envMapIntensity: 0.5 }));
  lens.position.set(0, CHIN + SH - nh / 2, 0.004);
  lid.add(lens);
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(BW - 0.03, LH - 0.03, 0.078), 20), new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.1, envMapIntensity: 0.45 }));
  glass.position.set(0, LH / 2, 0.0045);
  lid.add(glass);
  laptopDisplay.name = "Screen";
  laptop.name = "MacBook Pro 14";
  lid.name = "Lid";
  return { group: laptop, lid, display: laptopDisplay, SW, SH, MENU };
}

export function buildIPhone({ finish = "silver", screen = blackScreen } = {}) {
  // iPhone 18 Pro: 150 x 71.9 x 8.75 mm (shown at 1.12x), aluminium unibody with flat
  // sides, full-width camera plateau, slim even bezels and the smaller Dynamic Island.
  const pf = PHONE_FINISH[finish] || PHONE_FINISH.silver;
  const PW = 0.805, PH = 1.68, PR = 0.13, PT = 0.098;
  const phone = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: pf.metal, metalness: 0.9, roughness: pf.rough, envMapIntensity: 1.25 });
  const body = flat(roundedRect(PW - 0.02, PH - 0.02, PR - 0.01), PT - 0.02, 0.01, alu, 3);
  body.position.z = -PT / 2 + 0.01;
  body.castShadow = true;
  phone.add(body);
  const front = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(PW - 0.012, PH - 0.012, PR - 0.006), 28), new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 0.15 }));
  front.position.z = PT / 2 + 0.0005;
  phone.add(front);
  const inset = 0.027, DW = PW - inset * 2, DH = PH - inset * 2;
  const phoneDisplay = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), screen(DW / DH, (PR - inset) / DH));
  phoneDisplay.position.z = PT / 2 + 0.001;
  phone.add(phoneDisplay);
  const islandW = DW * 0.22, islandH = 0.05;
  const island = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(islandW, islandH, islandH / 2), 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  island.position.set(0, DH / 2 - 0.03 - islandH / 2, PT / 2 + 0.0015);
  phone.add(island);
  const phoneGlass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(PW - 0.012, PH - 0.012, PR - 0.006), 28), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, transparent: true, opacity: 0.1, envMapIntensity: 0.7 }));
  phoneGlass.position.z = PT / 2 + 0.002;
  phone.add(phoneGlass);
  // Buttons: Action and volume on the left, side button and Camera Control on the right.
  const button = (x, y, h, mat = alu) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.014, h, 0.034, 2, 0.006), mat);
    m.position.set(x, y, 0);
    phone.add(m);
  };
  const L = -PW / 2 - 0.004, R = PW / 2 + 0.004;
  button(L, 0.5, 0.07); button(L, 0.33, 0.13); button(L, 0.17, 0.13);
  button(R, 0.3, 0.2);
  button(R, -0.2, 0.11, new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.3, roughness: 0.12 }));
  // Camera plateau across the top of the back, three lenses, flash and LiDAR.
  const plateau = flat(roundedRect(PW - 0.06, 0.4, 0.1), 0.008, 0.006, alu, 3);
  plateau.rotation.y = Math.PI;
  plateau.position.set(0, PH / 2 - 0.25, -PT / 2 + 0.002);
  phone.add(plateau);
  const lensGlass = new THREE.MeshStandardMaterial({ color: 0x07080c, metalness: 0.4, roughness: 0.08, envMapIntensity: 2.5 });
  const ringMat = new THREE.MeshStandardMaterial({ color: pf.metal, metalness: 0.95, roughness: 0.22 });
  for (const [x, y] of [[-0.2, PH / 2 - 0.15], [-0.2, PH / 2 - 0.35], [-0.04, PH / 2 - 0.25]]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.022, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-x, y, -PT / 2 - 0.016);
    phone.add(ring);
    const g2 = new THREE.Mesh(new THREE.CircleGeometry(0.06, 32), lensGlass);
    g2.rotation.y = Math.PI;
    g2.position.set(-x, y, -PT / 2 - 0.028);
    phone.add(g2);
  }
  for (const [x, y, r, c] of [[0.24, PH / 2 - 0.15, 0.03, 0xf1ead8], [0.24, PH / 2 - 0.35, 0.026, 0x0b0b0d]]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshStandardMaterial({ color: c, roughness: 0.2 }));
    d.rotation.y = Math.PI;
    d.position.set(-x, y, -PT / 2 - 0.016);
    phone.add(d);
  }
  phoneDisplay.name = "Screen";
  phone.name = "iPhone 18 Pro";
  return { group: phone, display: phoneDisplay, DW, DH };
}
