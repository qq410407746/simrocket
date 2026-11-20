import type { MissionDefinition, ScoreItemDefinition } from '@/game/missions/types';
import type { Language } from './locale';

type MissionPresentation = Pick<MissionDefinition, 'title' | 'summary' | 'briefing' | 'flightPlan'> & {
  readonly objectives: Readonly<Record<string, string>>;
  readonly scoring: Readonly<Record<string, Pick<ScoreItemDefinition, 'label' | 'note'>>>;
};

/** Handwritten presentation text only; never passed to the simulator or mission tracker. */
const ENGLISH_MISSIONS: Readonly<Record<string, MissionPresentation>> = {
  'karman-line': {
    title: 'Cross the Kármán Line',
    summary: 'Fly a Mercury spacecraft above 100 km on a Mercury-Redstone—the internationally recognized boundary of space.',
    briefing: [
      'The Kármán line is 100 km above sea level. Here the atmosphere is too thin for wings to provide enough lift, so a vehicle must rely on speed to stay aloft. This is conventionally the beginning of space.',
      'Mercury-Redstone is a single-stage rocket. Its A-7 engine has fixed thrust and cannot be throttled; it shuts down after about 143 seconds, and the spacecraft then coasts up to its highest point before falling back to Earth. Freedom 7 flew this way to 187 km in 1961.',
      'The booster has no recovery system, but the Mercury spacecraft on top has a parachute. Separate the spacecraft after engine shutdown and deploy its parachute once subsonic to recover it intact (an optional objective).',
    ],
    objectives: { altitude: 'Reach a maximum altitude of 100 km', recover: 'Recover the Mercury spacecraft (parachute landing)' },
    scoring: {
      objectives: { label: 'Cross the Kármán Line', note: 'Reach a maximum altitude of 100 km.' },
      recover: { label: 'Spacecraft recovery', note: 'After engine shutdown, press Space to separate the spacecraft. Press G to deploy the parachute once subsonic.' },
      apex: { label: 'Maximum altitude', note: 'Higher is better: full marks at 250 km or above. Stay vertical throughout.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. Stay vertical (do not use the attitude keys). The A-7 engine has fixed thrust, so leave the throttle alone.',
      'The engine shuts down after about 143 seconds. Press Space to separate the Mercury spacecraft.',
      'Coast upward past 100 km. Use . to speed up time if desired.',
      'The spacecraft falls back into the atmosphere nose-up, with its heat shield facing down. Deceleration can reach well over 10 g.',
      'At about 10 km, when the hint says "Subsonic", press G to deploy the parachute.',
    ],
  },
  'suborbital-hop': {
    title: 'Suborbital Flight and Recovery',
    summary: 'Re-fly Freedom 7: pass 120 km and land about 500 km downrange. The spacecraft must splash down safely.',
    briefing: [
      'On 5 May 1961, Alan Shepard flew Freedom 7 on a suborbital arc: 187 km high, splashing down 487 km away in the Atlantic. A suborbital flight does not try to stay in space. Instead, it tilts east during ascent to build horizontal speed while climbing, then lands downrange of the launch site.',
      'Timing the tilt matters. Just after liftoff, the rocket is slow: even a small tilt lets gravity flatten its trajectory quickly. Wait until 300 m/s; the same tilt then has much less effect. But do not overdo it: tilting too far into the airflow in dense air snaps the slender rocket under side loads.',
      'The velocity direction keeps changing during descent, and the spacecraft will not automatically keep its heat shield facing forward. After separation, engage retrograde hold so the shield stays pointed into the airflow.',
      'More tilt makes a flatter arc: greater range and a gentler reentry, but a lower maximum altitude.',
    ],
    objectives: { altitude: 'Reach a maximum altitude of 120 km', land: 'Splash down the Mercury spacecraft safely' },
    scoring: {
      objectives: { label: 'Flight and recovery', note: 'Pass 120 km and splash down the spacecraft by parachute.' },
      range: { label: 'Downrange distance', note: 'Farther from the launch site is better: full marks at 450 km or more (Freedom 7 reached 487 km). A tilt of about 15° gives the greatest range.' },
      g: { label: 'Reentry g-load', note: 'Full marks for a peak g-load of 12 g or less over the entire flight (Freedom 7 saw about 11 g on reentry). A flatter arc gives a gentler reentry.' },
      landing: { label: 'Splashdown speed', note: 'Full marks at 8.8 m/s or less. The Mercury spacecraft descends at about 9 m/s under its main parachute (Freedom 7 measured 30 ft/s); after the main parachute opens, press H to jettison the heat shield and slow down a little more.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. Stay vertical at first.',
      'At 300 m/s (about 50 seconds after liftoff), hold D to tilt 10–15° east (pitch 75–80°). Release it, then press R for prograde hold.',
      'After engine shutdown, press Space to separate the spacecraft. Press T for retrograde hold, with the heat shield facing forward.',
      'After passing the highest point, fall back into the atmosphere. Keep retrograde hold until deceleration is over.',
      'When the hint says "Subsonic", press G to deploy the parachute. Once the main parachute opens, you may press H to jettison the heat shield.',
    ],
  },
  'first-orbit': {
    title: 'First Orbit',
    summary: 'Fly a Soyuz-2.1a from Baikonur into low Earth orbit: periapsis at least 150 km, apoapsis no higher than 600 km.',
    briefing: [
      'The key to orbit is not altitude but horizontal speed: at 200 km you need about 7.8 km/s horizontally to keep "falling without ever hitting the ground".',
      'So the rocket cannot fly straight up the whole way. Tilt slightly east after liftoff and let gravity gradually bend the trajectory (a gravity turn); once out of the dense atmosphere, the upper stage accelerates almost horizontally to orbital speed.',
      'At liftoff, Soyuz burns its four strap-on boosters and the core stage together. After about two minutes the boosters burn out; jettison them while the core keeps firing. When the core burns out, the third stage takes over and reaches orbit. Baikonur is at 45.9°N, so an eastward launch gives an orbital inclination of 45.9°.',
      'Soyuz has very little margin: putting a 7 t crewed spacecraft into orbit nearly empties the third stage. A turn that is too sharp or too gentle wastes propellant. If you fall slightly short, the spacecraft service module engine can still add a few tens of metres per second.',
    ],
    objectives: { orbit: 'Enter low Earth orbit (150–600 km)' },
    scoring: {
      objectives: { label: 'Orbit insertion', note: 'Periapsis ≥ 150 km and apoapsis ≤ 600 km. After shutdown, hold for 10 seconds.' },
      circular: { label: 'Orbit circularity', note: 'Full marks if apoapsis and periapsis are within 20 km. Keep vertical speed near zero during upper-stage flight.' },
      margin: { label: 'Propellant margin', note: 'Full marks with at least 330 m/s of Δv remaining at orbit insertion (i.e. reaching orbit on the third stage alone, without touching the spacecraft propellant). A well-judged turn without detours leaves more.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. At about 60 m/s, hold D to tilt 2–3° east (pitch 87–88°), then release.',
      'About 5 seconds later, press R for prograde hold. The rocket follows its velocity while gravity bends the trajectory.',
      'At about 2 minutes the four boosters burn out: press Space to jettison them while the core keeps firing. Press R to return to manual control.',
      'Use pitch to manage vertical speed: lower the nose if climbing too fast, raise it if starting to descend, and bring vertical speed to 0 near 200 km. When the core burns out, press Space to separate it and ignite the third stage.',
      'Press X to shut down when periapsis reaches 150 km or more. Hold for 10 seconds to confirm the orbit. If the third stage runs dry just short, press Space to drop it and ignite the service module engine to finish.',
    ],
  },
  'crew-return': {
    title: 'Crew Return',
    summary: 'Start in a 200 km orbit aboard Soyuz MS: deorbit, reenter the atmosphere, deploy the parachute, and bring the crew home safely.',
    briefing: [
      'The spacecraft is already in a 200 km circular orbit. Returning takes four steps: fire the service module engine retrograde to lower periapsis (deorbit), jettison the service and orbital modules, keep the descent module heat shield facing forward through the atmosphere, and land under parachute.',
      'The descent module hits the atmosphere at 7.8 km/s, and almost all of that kinetic energy turns into heat. Only the ablative heat shield can survive it: entering apex-first or side-first burns up the module, and so does reentering with the service module still attached.',
      'The Soyuz descent module’s center of mass is offset from its axis, so during reentry it trims at about 17° angle of attack with a lift-to-drag ratio of about 0.27 (the offset is an estimate). In trimmed-reentry mode, with lift up, the g-load is about 4–5 g; retrograde hold gives a lift-free ballistic entry of about 8 g—a real Soyuz also falls back to a ballistic entry when its guidance fails.',
      'The KTDU-80 main engine produces only 2.95 kN, so the deorbit burn takes a minute or two. Crew g-load is the main scoring item.',
    ],
    objectives: { land: 'Land the descent module safely' },
    scoring: {
      objectives: { label: 'Safe return', note: 'Land the descent module by parachute.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5.5 g or less: press Y for trimmed reentry and keep lift up. A ballistic entry pulls about 8 g and earns almost nothing here.' },
      shield: { label: 'Heat shield margin', note: 'Full marks with at least 60% of the ablator remaining. A gentler reentry burns away less.' },
      landing: { label: 'Landing speed', note: 'Full marks at 7 m/s or less: press H to jettison the heat shield after the main parachute opens. (A real Soyuz fires soft-landing engines 1 m above the ground; these are not modelled.)' },
    },
    flightPlan: [
      'Press T for retrograde hold and wait for the spacecraft to turn around. Use . to speed up time if desired.',
      'Press Space to enable the service module engine and Z to ignite. When periapsis drops to 0–50 km, press X to shut down.',
      'Press Space to jettison the service and orbital modules. Press Y for trimmed reentry (lift up, about 4–5 g), or keep retrograde hold (ballistic, about 8 g).',
      'Use . to speed up the coast to the atmosphere. Hold attitude during reentry and watch the thermal panel on the right.',
      'When the hint says "Subsonic", press G to deploy the parachute. After the main parachute opens, press H to jettison the heat shield.',
    ],
  },
  'orbital-flight': {
    title: 'Crewed Orbital Flight',
    summary: 'A complete Soyuz crewed mission: launch from Baikonur, enter low Earth orbit, then deorbit and land safely.',
    briefing: [
      'Combine everything you have learned: launch, gravity turn, booster jettison, staging and orbit insertion. Once orbit is confirmed, deorbit, reenter and land under parachute.',
      'The deorbit burn uses the 800 kg of propellant in the spacecraft service module. If you dipped into it to finish orbit insertion, less is left for deorbit—fortunately deorbiting needs only a few tens of metres per second. Where you fire determines where you land: after the burn the spacecraft still travels almost half an orbit before entering the atmosphere.',
      'This is a crewed flight: the maximum g-load from liftoff to landing counts toward your score. Soyuz engines cannot be throttled, so ascent peaks at about 4.4 g; keep reentry g-load down with trimmed reentry.',
    ],
    objectives: { orbit: 'Enter low Earth orbit (150–600 km)', land: 'Land the descent module safely' },
    scoring: {
      objectives: { label: 'Orbit and safe return', note: 'First reach and confirm orbit, then land the descent module by parachute.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5.5 g or less: use trimmed reentry on the way home.' },
      circular: { label: 'Orbit circularity', note: 'Full marks if apoapsis and periapsis are within 20 km when the orbit is confirmed.' },
      shield: { label: 'Heat shield margin', note: 'Full marks with at least 60% of the ablator remaining.' },
      landing: { label: 'Landing speed', note: 'Full marks at 7 m/s or less: press H to jettison the heat shield after the main parachute opens.' },
    },
    flightPlan: [
      'Reach orbit as in First Orbit: tilt 2–3° east → prograde hold → jettison boosters → manage vertical speed with pitch → stage → shut down once periapsis is above 150 km.',
      'After the orbit is confirmed, press Space to drop the third stage (if still attached), press T for retrograde hold, and once turned around press Z to fire the service module engine. Lower periapsis to 0–50 km, then press X to shut down.',
      'Press Space to jettison the service and orbital modules, then press Y for trimmed reentry.',
      'Reenter and decelerate. When the hint says "Subsonic", press G to deploy the parachute. After the main parachute opens, press H to jettison the heat shield.',
    ],
  },
  'inclined-orbit': {
    title: 'Target Inclination',
    summary: 'Reach the International Space Station’s 51.6° orbit: the launch azimuth is no longer due east.',
    briefing: [
      'Orbital inclination is the angle between the orbital plane and the equator. Launching from latitude φ at azimuth β gives an inclination satisfying cos i = cos φ · sin β. Launching due east gives the smallest inclination, equal to the launch-site latitude; a larger inclination requires launching more northward (or southward).',
      'The International Space Station orbits at 51.6°, and Soyuz flies there from Baikonur (45.9°N). The inertial azimuth is about 60°; after subtracting the eastward speed from Earth’s rotation, the rocket must fly toward about 062° relative to the ground—east by north.',
      'The keyboard offers only eight directions: D is due east (090°) and W + D is northeast (045°), both far off. Hold D to tilt east while tapping W on and off (about half the time), so that the navball heading settles at 060–065°. During upper-stage flight, fine-tune using the inclination readout.',
      'The earlier you line up, the cheaper it is: the faster you go, the more propellant a plane change costs (about 140 m/s per degree once in orbit). Soyuz has only one or two hundred metres per second to spare—if the launch direction is off, there is little room to recover later.',
    ],
    objectives: { orbit: 'Enter a 51.6° ± 2° low Earth orbit' },
    scoring: {
      objectives: { label: 'Target orbit', note: 'Periapsis ≥ 150 km, apoapsis ≤ 600 km, inclination 51.6° ± 2°.' },
      inclination: { label: 'Inclination accuracy', note: 'Full marks within 0.3° of 51.6°. During upper-stage flight, watch the inclination readout and use W / S to adjust heading.' },
      circular: { label: 'Orbit circularity', note: 'Full marks if apoapsis and periapsis are within 20 km.' },
      margin: { label: 'Propellant margin', note: 'Full marks with at least 250 m/s of Δv remaining at orbit insertion.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 4.5 g or less. Soyuz engines cannot be throttled; a normal flight peaks at about 4.4 g.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. At about 60 m/s, hold D to tilt east while tapping W on and off. At 2–3° of tilt (pitch 87–88°) the heading should read 060–065°; release.',
      'About 5 seconds later, press R for prograde hold. When the boosters burn out, press Space to jettison them, then press R to return to manual control.',
      'Use D to lower the nose and A to raise it, managing vertical speed as in First Orbit. When the core burns out, press Space to stage.',
      'Watch the inclination readout on the left: below 51.6°, tap W to steer north; above it, tap S. Steer more for a large error and straighten as it closes.',
      'When periapsis is above 150 km and inclination is within 51.6° ± 2°, press X to shut down and hold for 10 seconds.',
    ],
  },
  'polar-orbit': {
    title: 'Polar Orbit',
    summary: 'Launch an Atlas V 401 south from Vandenberg and place a satellite into a 90° polar orbit.',
    briefing: [
      'A polar orbit passes over both poles. As Earth rotates beneath it, each pass crosses a different longitude, covering the whole surface within days—so Earth-observation satellites use these orbits. Atlas V 401 has launched satellites such as Landsat from Vandenberg into near-polar Sun-synchronous orbits.',
      'Vandenberg is on the California coast, with open Pacific Ocean to the south. A 90° orbit needs inertial velocity pointing due south, but the rocket lifts off with 380 m/s of eastward speed from Earth’s rotation. That speed must be cancelled, so the rocket must fly slightly west of south—a theoretical heading of about 183°. Tilt due south with S and never correct, and that 380 m/s of eastward speed stays in the orbit.',
      'Atlas V 401 lifts off with a thrust-to-weight ratio of only about 1.2: tilt late and gently (1.5° at about 100 m/s). Otherwise gravity flattens the trajectory too much and the rocket breaks up from excessive dynamic pressure in dense air. Its RD-180 engine can throttle down to 47%: near core burnout the rocket is light, and full thrust would exceed 9 g. Throttling down protects the satellite.',
      'A polar orbit cannot use Earth’s rotation at all, and must even pay to cancel it: the same rocket can carry less to a polar orbit than to an eastward one.',
    ],
    objectives: { orbit: 'Enter a 90° ± 3° low Earth orbit' },
    scoring: {
      objectives: { label: 'Polar orbit', note: 'Periapsis ≥ 150 km, apoapsis ≤ 600 km, inclination 90° ± 3°.' },
      inclination: { label: 'Inclination accuracy', note: 'Full marks within 0.3° of 90°. During upper-stage flight, watch the inclination readout and use A / D to adjust heading.' },
      circular: { label: 'Orbit circularity', note: 'Full marks if apoapsis and periapsis are within 20 km.' },
      margin: { label: 'Propellant margin', note: 'Full marks with at least 3.8 km/s of Δv remaining at orbit insertion.' },
      g: { label: 'Peak g-load', note: 'Full marks for a peak g-load of 5 g or less. Near core burnout, press ↓ to throttle down (RD-180 minimum 47%).' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. At about 100 m/s, hold S to tilt about 1.5° south (pitch 88.5°, heading about 180°), then release. Too little tilt lofts the trajectory and pushes apoapsis above 600 km.',
      'About 5 seconds later, press R for prograde hold. Near core burnout the g-load climbs above 5 g: press ↓ to throttle down. After burnout, press Space to stage, then press R to return to manual control.',
      'When flying south, S lowers the nose and W raises it. Manage vertical speed as in First Orbit. Press F to jettison the fairing once out of the atmosphere.',
      'Watch the inclination. Below 90° means some eastward speed remains: tap A to steer west. Above 90°, tap D instead.',
      'When periapsis is above 150 km and inclination is within 90° ± 3°, press X to shut down and hold for 10 seconds.',
    ],
  },
  'geo-deployment': {
    title: 'Orbital Frontier: Geostationary Communications Satellite',
    summary: 'Atlas V 401: parking orbit → GTO → apoapsis circularization and inclination correction → satellite deployment.',
    briefing: [
      'Launch east from Cape Canaveral and use the Centaur upper stage to place a communications satellite directly into geostationary orbit.',
      'Use the maneuver planner on the map. A node is an instantaneous-burn preview, but a real engine needs time to burn: center the burn on the node, then correct using the orbit readouts after shutdown.',
      'GEO requires a period close to one sidereal day, low eccentricity, low inclination, and a sub-satellite longitude that stays essentially fixed over the next sidereal day. A GSO that only matches the period is not enough. Cape Canaveral is at 28.5°N, so the parking orbit is inclined about 28.5°; removing that at apoapsis costs even more propellant than the circularization itself.',
      'The satellite has no engine, so finish all orbit corrections before deployment. This 1.8 t satellite is fictional; its mass is set by what Atlas V 401 with Centaur can deliver directly to GEO (real geostationary satellites usually carry their own apogee engine, and the rocket only delivers them to GTO).',
    ],
    objectives: {
      parking: 'Establish a parking orbit',
      gto: 'Inject into geostationary transfer orbit',
      geo: 'Circularize and correct to geostationary orbit',
      deploy: 'Deploy the communications satellite',
      confirm: 'Confirm GEO after deployment',
    },
    scoring: {
      objectives: { label: 'Complete orbital mission', note: 'Complete all five steps.' },
      period: { label: 'Period accuracy', note: 'Full marks within 10 seconds of a sidereal day.' },
      longitude: { label: 'Ground-track stability', note: 'Full marks if the longitude drift over the next sidereal day is within 0.1°.' },
    },
    flightPlan: [
      'Launch east. At about 100 m/s tilt 1°, then use prograde hold for the gravity turn; throttle down near core burnout to keep the g-load under 5 g, then stage and jettison the fairing.',
      'On the upper stage, use pitch to control vertical speed. Shut down once periapsis reaches 150 km and wait for the parking orbit to be confirmed.',
      'Open the map and create a GTO injection node. Point at the maneuver and ignite half the estimated burn time before the node. When the remaining Δv is near 0, check apoapsis; if it is low, burn prograde until about 35,793 km, then shut down.',
      'Clear the old node and create an equatorial circularization node. At the equator crossing near apoapsis, change the velocity to that of an equatorial circular orbit, removing the 28.5° inclination at the same time.',
      'After shutdown, check the synchronous diagnostics. Refine with circularization, synchronous-altitude and inclination-correction nodes as needed.',
      'Once the GEO objective is complete, deploy the satellite and wait for post-deployment GEO confirmation.',
    ],
  },
};

/** Translate rendering fields, preserving all identifiers, physical settings and rules. */
export const localizeMission = (mission: MissionDefinition, language: Language): MissionDefinition => {
  if (language === 'zh') return mission;
  const text = ENGLISH_MISSIONS[mission.id];
  if (!text) return mission;
  return {
    ...mission,
    title: text.title,
    summary: text.summary,
    briefing: text.briefing,
    flightPlan: text.flightPlan,
    objectives: mission.objectives.map((objective) => ({
      ...objective,
      title: text.objectives[objective.id] ?? objective.title,
    })),
    scoring: mission.scoring.map((item) => ({ ...item, ...text.scoring[item.id] })),
  };
};
