/* v2 studio (/agence): the illustrations of the "Improve my website" stepper (agence-checkout.js). 2026-10-18.
   One scene per step, starring the mascot (the ink sprite of the logo): it inspects your site with a magnifier,
   points at the package, paints the page standing on a paint pot, waves hello, holds the receipt, and jumps
   when the order is in. Hand-authored SVG, 480 × 360, no ids (several scenes can sit on one page).
   Technique borrowed from the bold-pop illustration skill, in this site's own colours: one ink outline (3 units)
   on every shape, solid ink extrusions stepped down-right, flat fills from the logo's multicolour and the paper.
   Decorative: the step's heading and text say the same thing, so every scene is aria-hidden. */
(function () {
  'use strict';

  const INK = '#15190f';
  const PAPER = '#f8f2e4';
  const WHITE = '#ffffff';
  const MINT = '#a5f0d3';
  const SKY = '#9cc9f2';
  const LILAC = '#c3a8f2';
  const PINK = '#f4a9c4';
  const GOLD = '#f7d58e';

  /* ── Marks ── */
  // Extrusion: copies of the shape in ink, one unit at a time toward the bottom right, drawn under the face.
  const ext = (shape, depth, tf) => `<g fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"${tf ? ` transform="${tf}"` : ''}>`
    + Array.from({ length: depth }, (_, i) => `<g transform="translate(${i + 1} ${i + 1})">${shape}</g>`).join('') + '</g>';
  const face = (shape, fill, tf, sw = 3) => `<g fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"${tf ? ` transform="${tf}"` : ''}>${shape}</g>`;
  const block = (shape, fill, depth, tf) => ext(shape, depth, tf) + face(shape, fill, tf);
  // A tube: an ink stroke under a thinner coloured one (handles, legs, shackles).
  const tube = (d, color, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const plus = (x, y, c = INK) => `<path d="M${x - 6} ${y}h12M${x} ${y - 6}v12" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  const dot = (x, y, r = 3, c = INK) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  const ring = (x, y, r = 5, c = INK) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="2.4"/>`;
  const check = (d, w = 3) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  /* ── The mascot, in its own 64 × 64 space (same paths as the logo) ── */
  const TUFT = 'M28.5 16C28.8 11.6 32.4 8 37.2 6.4C39.6 5.6 42.4 5.6 43 7.4C43.6 9.3 41.4 10.2 39.6 10.6C37.8 11 37 13.4 37.6 16Z';
  const BODY = 'M32 14C42.5 14 50.6 20.5 51.3 30.5C51.9 38.5 51 44.6 49 48.4C47.9 50.6 47 53.2 44.8 53.4C42.6 53.6 41.6 51.6 40 51.2C35.5 50.4 28.5 50.6 24.6 51.4C22.4 51.9 21.6 55.2 19 55.2C16.2 55.2 14.9 53 14.6 50.4C14.2 47.2 12.2 41.4 12.6 34C13 22 21.4 14 32 14Z';
  /* o.look [dx, dy] moves the pupils (±2); o.happy closes the eyes into arcs; o.blush adds cheeks; o.tip colours
     the brush tip; o.arms is a list of [x1, y1, x2, y2] stubby arms (local units); o.flip mirrors it;
     o.motion is 'bob' (idle) or 'jump'. */
  function mascot(x, y, s, o = {}) {
    const [lx, ly] = o.look || [0, 0];
    const flip = o.flip ? ' translate(64 0) scale(-1 1)' : '';
    const arms = (o.arms || []).map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${INK}" stroke-width="4.6" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="3.1" fill="${INK}"/>`).join('');
    const eyes = o.happy
      ? `<path d="M25.6 33.3Q28.2 30.7 30.8 33.3M35 32.2Q37.6 29.6 40.2 32.2" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`
      : `<g transform="translate(${lx} ${ly})"><circle cx="28.2" cy="32.5" r="2.7" fill="${INK}"/><circle cx="29.1" cy="31.6" r=".95" fill="${WHITE}"/><circle cx="37.6" cy="31.5" r="2.7" fill="${INK}"/><circle cx="38.5" cy="30.6" r=".95" fill="${WHITE}"/></g>`;
    const cheeks = o.blush ? `<g fill="#ec9c92"><ellipse cx="24.1" cy="36.4" rx="2.4" ry="1.4"/><ellipse cx="41.1" cy="35.4" rx="2.4" ry="1.4"/></g>` : '';
    return `<g transform="translate(${x} ${y}) scale(${s})${flip}"><g class="oa-${o.motion || 'bob'}">`
      + arms
      + `<path d="${TUFT}" fill="${INK}"/><circle cx="41.4" cy="8.3" r="2.2" fill="${o.tip || LILAC}"/>`
      + `<path d="${BODY}" fill="${INK}"/>`
      + `<path d="M18.6 25.4C19.4 21.4 22.5 18.3 26.6 17.2" fill="none" stroke="${WHITE}" stroke-opacity=".45" stroke-width="1.6" stroke-linecap="round"/>`
      + `<ellipse cx="32.5" cy="32" rx="12.5" ry="9" transform="rotate(-6 32.5 32)" fill="${PAPER}"/>`
      + cheeks + eyes
      + '</g></g>';
  }
  const svg = (body) => `<svg class="oa" viewBox="0 0 480 360" aria-hidden="true" focusable="false">${body}</svg>`;

  /* 1. Your site: the mascot holds a magnifier over the page's button. */
  function site() {
    let b = plus(70, 72, LILAC) + plus(446, 300) + dot(124, 120, 3.2, PINK) + ring(452, 64, 6, SKY) + dot(150, 40, 2.6);
    b += block('<rect x="176" y="62" width="256" height="184" rx="16"/>', WHITE, 8);
    b += face('<path d="M192 62H416A16 16 0 0 1 432 78V96H176V78A16 16 0 0 1 192 62Z"/>', SKY);
    b += face('<circle cx="196" cy="79" r="4.6"/><circle cx="212" cy="79" r="4.6"/><circle cx="228" cy="79" r="4.6"/>', WHITE, '', 2.2);
    b += face('<rect x="250" y="71" width="160" height="16" rx="8"/>', WHITE, '', 2);
    b += face('<rect x="198" y="114" width="146" height="15" rx="7.5"/>', LILAC, '', 2.2);
    b += face('<rect x="198" y="140" width="190" height="8" rx="4"/><rect x="198" y="156" width="156" height="8" rx="4"/>', PAPER, '', 1.8);
    b += face('<rect x="198" y="182" width="88" height="28" rx="14"/>', PINK, '', 2.4);
    b += face('<rect x="336" y="178" width="80" height="54" rx="9"/>', MINT, '', 2.2);
    b += face('<path d="M344 224L362 204L374 216L384 207L408 224Z"/>', WHITE, '', 1.8);
    b += face('<circle cx="396" cy="192" r="5.5"/>', GOLD, '', 1.6);
    b += tube('M196 226L158 262', PINK, 10);
    b += `<circle cx="224" cy="196" r="38" fill="${WHITE}" fill-opacity=".5"/>`
      + `<circle cx="224" cy="196" r="38" fill="none" stroke="${INK}" stroke-width="13"/>`
      + `<circle cx="224" cy="196" r="38" fill="none" stroke="${GOLD}" stroke-width="6.5"/>`
      + `<path d="M203 182A25 25 0 0 1 220 170" fill="none" stroke="${WHITE}" stroke-width="3.2" stroke-linecap="round"/>`;
    b += mascot(6, 196, 2.1, { look: [1.8, -1.2], arms: [[49, 38, 71.5, 31]], tip: MINT });
    return svg(b);
  }

  /* 2. Package: three package cards, the middle one picked; the mascot points at it. */
  function pack() {
    const card = (cx, cy, a, band, picked) => {
      const tf = `translate(${cx} ${cy}) rotate(${a})`;
      let s = block('<rect x="-55" y="-75" width="110" height="150" rx="14"/>', WHITE, 6, tf);
      s += face('<path d="M-41 -75H41A14 14 0 0 1 55 -61V-42H-55V-61A14 14 0 0 1 -41 -75Z"/>', band, tf);
      s += face('<rect x="-38" y="-28" width="62" height="16" rx="8"/>', PAPER, tf, 2);
      s += face('<rect x="-38" y="0" width="76" height="7" rx="3.5"/><rect x="-38" y="14" width="58" height="7" rx="3.5"/><rect x="-38" y="28" width="68" height="7" rx="3.5"/>', PAPER, tf, 1.6);
      s += face('<rect x="-38" y="46" width="76" height="18" rx="9"/>', band, tf, 2);
      if (picked) {
        s += face('<circle cx="46" cy="-72" r="17"/>', PINK, tf, 3);
        s += `<g transform="${tf}">${check('M38 -72l6 6 11-12', 3.6)}</g>`;
      }
      return s;
    };
    let b = plus(420, 70) + dot(70, 92, 3.2, PINK) + ring(434, 252, 6, LILAC) + plus(58, 172, SKY) + dot(404, 322, 2.6);
    b += card(150, 198, -9, MINT, false) + card(330, 198, 9, GOLD, false) + card(240, 168, 0, LILAC, true);
    b += mascot(18, 232, 1.5, { look: [1.6, -1.8], arms: [[48, 32, 63, 19]], tip: PINK });
    return svg(b);
  }

  /* 3. How we build it: half the page is still a wireframe, the other half painted; the mascot paints with its
     tuft, standing on a paint pot. A calendar shows Day 2, the day you approve the direction. */
  function build() {
    let b = plus(54, 74) + dot(118, 150, 3, LILAC) + ring(446, 58, 6, PINK) + plus(436, 120, SKY) + dot(30, 210, 2.6);
    b += tube('M265 232L265 302', GOLD, 6) + tube('M196 232L172 314', GOLD, 7) + tube('M334 232L356 314', GOLD, 7);
    b += block('<rect x="150" y="54" width="230" height="178" rx="10"/>', WHITE, 7);
    b += `<g fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round">`
      + '<rect x="168" y="76" width="82" height="13" rx="6.5"/><rect x="168" y="100" width="88" height="7" rx="3.5"/><rect x="168" y="114" width="68" height="7" rx="3.5"/><rect x="168" y="136" width="86" height="58" rx="8"/><rect x="168" y="204" width="56" height="14" rx="7"/></g>';
    b += face('<rect x="280" y="76" width="82" height="13" rx="6.5"/>', LILAC, '', 2);
    b += face('<rect x="280" y="100" width="86" height="7" rx="3.5"/><rect x="280" y="114" width="64" height="7" rx="3.5"/>', PAPER, '', 1.6);
    b += face('<rect x="280" y="136" width="84" height="58" rx="8"/>', SKY, '', 2);
    b += face('<path d="M288 186L304 168L314 178L324 170L356 186Z"/>', WHITE, '', 1.6);
    b += face('<rect x="280" y="204" width="56" height="14" rx="7"/>', PINK, '', 2);
    b += tube('M266 64C258 96 274 128 264 160C256 190 272 210 266 224', MINT, 7);
    b += block('<rect x="138" y="226" width="254" height="12" rx="6"/>', GOLD, 3);
    // the paint pot the mascot stands on
    b += block('<path d="M368 244H448L440 316H376Z"/>', SKY, 5);
    b += face('<rect x="360" y="234" width="96" height="14" rx="7"/>', WHITE, '', 3);
    b += face('<path d="M384 248C384 262 392 262 392 252C392 270 402 270 402 248Z"/>', MINT, '', 2);
    b += mascot(332, 133, 1.9, { flip: true, look: [1.5, -1], tip: MINT });
    // the calendar: Day 2
    b += block('<rect x="56" y="216" width="98" height="86" rx="12"/>', WHITE, 5);
    b += face('<path d="M68 216H142A12 12 0 0 1 154 228V242H56V228A12 12 0 0 1 68 216Z"/>', PINK);
    b += face('<rect x="80" y="208" width="6" height="16" rx="3"/><rect x="124" y="208" width="6" height="16" rx="3"/>', WHITE, '', 2);
    b += `<text x="105" y="290" text-anchor="middle" font-size="42" font-weight="800" fill="${INK}" font-family="'Cabinet Grotesk', system-ui, sans-serif">2</text>`;
    b += face('<circle cx="150" cy="222" r="14"/>', MINT, '', 2.6) + check('M143 222l5 5 9-10', 3);
    return svg(b);
  }

  /* 4. About you: a profile card for the invoice, a hello bubble, the mascot waving. */
  function you() {
    let b = plus(442, 70, LILAC) + dot(300, 52, 3, SKY) + ring(458, 300, 6, PINK) + plus(170, 316) + dot(96, 120, 2.6);
    b += block('<path d="M150 58H222A22 22 0 0 1 244 80V94A22 22 0 0 1 222 116H170L144 136L152 116H150A22 22 0 0 1 128 94V80A22 22 0 0 1 150 58Z"/>', PINK, 4);
    b += face('<circle cx="162" cy="87" r="5"/><circle cx="186" cy="87" r="5"/><circle cx="210" cy="87" r="5"/>', WHITE, '', 2);
    b += block('<rect x="196" y="128" width="236" height="150" rx="16"/>', WHITE, 8);
    b += face('<path d="M212 128H416A16 16 0 0 1 432 144V160H196V144A16 16 0 0 1 212 128Z"/>', SKY);
    b += face('<circle cx="250" cy="214" r="30"/>', LILAC);
    b += face('<circle cx="250" cy="204" r="10"/><path d="M231 234C233 221 267 221 269 234"/>', WHITE, '', 2.2);
    b += `<rect x="296" y="188" width="108" height="13" rx="6.5" fill="${INK}"/>`;
    b += face('<rect x="298" y="216" width="16" height="12" rx="2.5"/>', PAPER, '', 1.8) + `<path d="M299 218l7 5 7-5" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    b += face('<rect x="320" y="217" width="84" height="9" rx="4.5"/><rect x="296" y="240" width="96" height="9" rx="4.5"/>', PAPER, '', 1.6);
    b += face('<circle cx="422" cy="132" r="15"/>', MINT, '', 2.6) + check('M415 132l5 5 9-10', 3);
    // waving: a raised arm and two motion ticks
    b += `<path d="M138 196q8 -4 10 -14M146 210q10 -2 14 -10" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    b += mascot(4, 200, 2, { happy: true, blush: true, arms: [[50, 30, 61, 12]], tip: GOLD });
    return svg(b);
  }

  /* 5. Review and pay: the receipt (with its total), the card, the padlock; the mascot holds the receipt. */
  function pay() {
    let zig = 'M168 80A14 14 0 0 1 182 66H284A14 14 0 0 1 298 80V272';
    for (let i = 0; i < 10; i++) zig += `L${298 - 13 * i - 6.5} 282L${298 - 13 * (i + 1)} 272`;
    zig += 'Z';
    let b = plus(80, 70) + ring(140, 112, 5, SKY) + dot(452, 250, 3.2, PINK) + plus(440, 304, LILAC) + dot(112, 172, 3, GOLD);
    const tf = 'rotate(12 330 190)';
    b += block('<rect x="250" y="138" width="160" height="104" rx="14"/>', LILAC, 6, tf);
    b += `<g transform="${tf}"><rect x="251.5" y="158" width="157" height="18" fill="${INK}"/></g>`;
    b += face('<rect x="268" y="194" width="30" height="22" rx="5"/>', GOLD, tf, 2);
    b += `<g transform="${tf}" fill="${INK}">${[0, 1, 2, 3].map((k) => `<circle cx="${320 + k * 10}" cy="224" r="2.4"/>`).join('')}</g>`;
    b += block(`<path d="${zig}"/>`, WHITE, 6);
    b += `<rect x="184" y="86" width="70" height="12" rx="6" fill="${INK}"/>`;
    b += face('<rect x="184" y="112" width="98" height="7" rx="3.5"/><rect x="184" y="126" width="78" height="7" rx="3.5"/>', PAPER, '', 1.6);
    b += face('<rect x="184" y="150" width="64" height="8" rx="4"/><rect x="258" y="150" width="26" height="8" rx="4"/><rect x="184" y="166" width="54" height="8" rx="4"/><rect x="262" y="166" width="22" height="8" rx="4"/>', PAPER, '', 1.6);
    b += `<path d="M184 188H284" stroke="${INK}" stroke-width="2" stroke-dasharray="4 5" stroke-linecap="round"/>`;
    b += `<rect x="184" y="200" width="40" height="10" rx="5" fill="${INK}"/>`;
    b += face('<rect x="236" y="197" width="48" height="16" rx="8"/>', MINT, '', 2);
    b += face('<circle cx="262" cy="244" r="19"/>', PINK, '', 2.6) + check('M253 244l6 6 11-12', 3.4);
    b += tube('M374 112V96A18 18 0 0 1 410 96V112', WHITE, 6);
    b += block('<rect x="358" y="108" width="68" height="56" rx="12"/>', GOLD, 5);
    b += `<circle cx="392" cy="130" r="6" fill="${INK}"/><rect x="389" y="132" width="6" height="15" rx="3" fill="${INK}"/>`;
    b += mascot(48, 206, 1.9, { happy: true, blush: true, arms: [[50, 32, 64, 16]], tip: MINT });
    return svg(b);
  }

  /* Done: a big tick and the mascot jumping in a burst of paint dabs. */
  function done() {
    const dabs = [[214, 70, MINT, 18], [392, 62, PINK, -24], [420, 170, GOLD, 12], [380, 262, SKY, -10], [236, 252, LILAC, 30], [190, 150, PINK, -16], [436, 112, LILAC, 40], [152, 54, GOLD, -30]];
    let b = dabs.map(([x, y, c, r]) => face(`<rect x="${x - 8}" y="${y - 5}" width="16" height="10" rx="5"/>`, c, `rotate(${r} ${x} ${y})`, 2.2)).join('');
    b += plus(64, 90, LILAC) + dot(460, 300, 3) + ring(60, 300, 6, MINT);
    b += block('<circle cx="306" cy="160" r="60"/>', MINT, 6);
    b += check('M276 162l20 20 40-44', 11);
    b += `<ellipse cx="128" cy="314" rx="44" ry="7" fill="${INK}" fill-opacity=".16"/>`;
    b += `<path d="M92 300h14M150 300h14M120 304h10" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    b += mascot(62, 150, 2.1, { happy: true, blush: true, arms: [[16, 30, 6, 13], [48, 30, 58, 13]], tip: PINK, motion: 'jump' });
    return svg(b);
  }

  /* Package icons for the package cards, same technique in an 80 × 80 box: Redesign is a page with a brush on it,
     Build is a stack of blocks. Any other package gets the page. */
  function icon(id) {
    let b;
    if (id === 'creation') {
      b = block('<rect x="8" y="46" width="32" height="20" rx="5"/>', SKY, 4);
      b += block('<rect x="42" y="46" width="28" height="20" rx="5"/>', MINT, 4);
      b += block('<rect x="22" y="24" width="34" height="20" rx="5"/>', LILAC, 4);
      b += block('<rect x="32" y="6" width="14" height="16" rx="4"/>', GOLD, 3);
    } else {
      b = block('<rect x="8" y="14" width="56" height="46" rx="8"/>', WHITE, 4);
      b += face('<path d="M16 14H56A8 8 0 0 1 64 22V27H8V22A8 8 0 0 1 16 14Z"/>', SKY);
      b += face('<rect x="16" y="35" width="26" height="6" rx="3"/>', LILAC, '', 2);
      b += face('<rect x="16" y="47" width="18" height="6" rx="3"/>', PINK, '', 2);
      b += tube('M72 18L54 44', GOLD, 5);
      b += face('<rect x="45" y="40" width="12" height="18" rx="6"/>', PINK, 'rotate(34 51 49)', 2.6);
    }
    return `<svg class="oa-ico" viewBox="0 0 80 80" aria-hidden="true" focusable="false">${b}</svg>`;
  }

  window.agenceOrderArt = { site, pack, build, you, pay, done, icon };
})();
