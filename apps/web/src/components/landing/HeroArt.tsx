/**
 * Cinematic hero artwork — a CSS/SVG homage to the NOVI reference:
 * a glowing puzzle piece built from messaging / channel icons that connects,
 * across a bright seam, to a low-poly wireframe hand. Pure SVG + CSS glow,
 * no JS. Decorative only.
 */

const ICONS: Record<string, string> = {
  // simple single-path glyphs, drawn inside a 24x24 box
  whatsapp:
    "M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Zm4.3 12.2c-.2.5-1 1-1.5 1-.4 0-.9.2-2.9-.6-2.4-1-4-3.4-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.7.8-2c.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.5.2.5.7 1.7.7 1.8.1.1.1.3 0 .4l-.3.5-.3.3c-.1.1-.3.3-.1.5.1.3.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2 0 .4 0 .5-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3.1.1.1.6-.1 1.1Z",
  chat: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  calendar:
    "M6 3v2M18 3v2M4 7h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  users:
    "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8M13.7 20a2 2 0 0 1-3.4 0",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  phone:
    "M6 3h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z",
  star: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9L12 3Z",
  check: "M20 6 9 17l-5-5",
};

// grid layout of the puzzle mosaic — [col, row, icon]
const TILES: [number, number, keyof typeof ICONS][] = [
  [0, 0, "star"], [1, 0, "chat"], [2, 0, "mail"],
  [0, 1, "users"], [1, 1, "whatsapp"], [2, 1, "calendar"], [3, 1, "phone"],
  [0, 2, "bell"], [1, 2, "bolt"], [2, 2, "check"], [3, 2, "chat"],
  [1, 3, "calendar"], [2, 3, "users"],
];

const CELL = 46;
const GAP = 8;

export function HeroArt() {
  return (
    <div className="hero-art relative mx-auto w-full max-w-[560px]">
      <svg
        viewBox="0 0 560 460"
        className="w-full"
        role="img"
        aria-label="איקונים של ערוצי תקשורת מתחברים כמו פאזל אל יד"
      >
        <defs>
          <linearGradient id="tileFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0e3a44" />
            <stop offset="1" stopColor="#062028" />
          </linearGradient>
          <radialGradient id="seam" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#a5f3fc" stopOpacity="0.95" />
            <stop offset="0.4" stopColor="#22d3ee" stopOpacity="0.55" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* faint circuit dots backdrop */}
        <g opacity="0.35">
          {Array.from({ length: 8 }).map((_, r) =>
            Array.from({ length: 11 }).map((_, c) => (
              <circle
                key={`${r}-${c}`}
                cx={20 + c * 52}
                cy={24 + r * 56}
                r="1.4"
                fill="#164e5b"
              />
            )),
          )}
        </g>

        {/* the seam glow where puzzle meets hand */}
        <circle cx="330" cy="250" r="120" fill="url(#seam)" className="seam-pulse" />

        {/* PUZZLE MOSAIC of channel icons */}
        <g transform="translate(28,70)" filter="url(#glow)">
          {TILES.map(([col, row, icon], i) => {
            const x = col * (CELL + GAP);
            const y = row * (CELL + GAP);
            return (
              <g key={i} className="tile" style={{ animationDelay: `${i * 0.12}s` }}>
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx="11"
                  fill="url(#tileFill)"
                  stroke="#22d3ee"
                  strokeOpacity="0.5"
                  strokeWidth="1"
                />
                <g
                  transform={`translate(${x + CELL / 2 - 12},${y + CELL / 2 - 12})`}
                  fill="none"
                  stroke="#67e8f9"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={ICONS[icon]} />
                </g>
              </g>
            );
          })}
          {/* interlocking puzzle knob poking toward the hand */}
          <circle cx={4 * (CELL + GAP) + 6} cy={1.5 * (CELL + GAP) + CELL / 2} r="15" fill="#0e3a44" stroke="#22d3ee" strokeOpacity="0.6" />
        </g>

        {/* WIREFRAME HAND (low-poly, reaching from lower right) */}
        <g
          className="hand"
          fill="none"
          stroke="#67e8f9"
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter="url(#glow)"
        >
          {/* palm */}
          <path d="M360 430 L372 356 L410 340 L470 348 L520 372 L540 420 L520 452 L430 460 Z" strokeOpacity="0.85" />
          {/* internal wireframe triangulation */}
          <path d="M372 356 L470 348 M410 340 L430 460 M470 348 L520 452 M410 340 L520 372 M372 356 L430 460" strokeOpacity="0.4" />
          {/* index finger reaching to the seam */}
          <path d="M372 356 L340 300 L322 258 L330 246 L352 254 L376 320 L410 340" strokeOpacity="0.85" />
          {/* fingertip node touching the puzzle */}
          <circle cx="326" cy="252" r="6" fill="#a5f3fc" stroke="none" className="tip-pulse" />
          {/* thumb */}
          <path d="M470 348 L512 330 L544 340 L540 366 L520 372" strokeOpacity="0.75" />
          {/* knuckle dots */}
          {[
            [372, 356], [410, 340], [470, 348], [520, 372], [430, 460],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="2.6" fill="#22d3ee" stroke="none" />
          ))}
        </g>

        {/* connecting energy line from puzzle knob to fingertip */}
        <path
          d="M250 165 C 290 200, 300 230, 326 252"
          fill="none"
          stroke="#a5f3fc"
          strokeWidth="1.6"
          strokeDasharray="4 6"
          className="energy"
          opacity="0.8"
        />
      </svg>
    </div>
  );
}
