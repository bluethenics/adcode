const ROUTES = [
  "M-60 136H112L176 200H362L426 136H552", "M24 454H140V378H244L310 312H466L540 238H716",
  "M490 -30V92L552 154H718V268H906L972 334H1180", "M690 606V498H812L888 422H1034V330H1184",
  "M898 696V578L966 510H1116L1194 432H1354", "M-20 678H124L196 606V504H332L402 434",
  "M1062 76H950L886 140H804V230H662", "M280 770V648L354 574H490V502H590",
  "M1320 188H1212L1152 248H1042V358H920", "M-32 314H78L142 250H258V156H390",
  "M102 42V112H222L286 176H512", "M1210 -8V104L1136 178H858L790 246H650",
  "M-40 548H92L162 478H374L446 406H574", "M1322 558H1174L1096 480H874L806 412H682",
  "M508 748V640L572 576V468", "M772 748V642L708 578V468",
  "M-28 226H126L194 294H384L452 362H572", "M1308 272H1150L1082 340H890L820 410H696",
  "M252 -20V82L322 152H472L548 228V338", "M1006 -20V78L932 152H786L712 226V338",
] as const;

const PULSES = [[0, "pulse-one"], [1, "pulse-two"], [2, "pulse-three"], [3, "pulse-four"], [5, "pulse-five"], [7, "pulse-six"], [14, "pulse-seven"], [17, "pulse-eight"]] as const;

export function HeroCircuit() {
  return <div className="hero-circuit" aria-hidden="true"><svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" role="presentation"><g className="hero-circuit__traces">{ROUTES.map((route, index) => <path className="hero-circuit__trace" d={route} key={index} />)}</g><g className="hero-circuit__nodes">{["112 136", "176 200", "426 136", "140 378", "310 312", "552 154", "718 268", "888 422", "966 510", "196 606", "354 574", "1152 248", "142 250"].map((point) => { const [cx, cy] = point.split(" "); return <circle cx={cx} cy={cy} r="5" key={point} />; })}</g><g className="hero-circuit__signals">{PULSES.map(([routeIndex, name]) => <path className={`hero-circuit__pulse ${name}`} d={ROUTES[routeIndex]} key={name} />)}</g></svg></div>;
}
