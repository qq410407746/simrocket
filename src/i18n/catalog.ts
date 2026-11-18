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
    summary: 'Take the Meteor-S sounding rocket above 100 km—the internationally recognized boundary of space.',
    briefing: [
      'The Kármán line is 100 km above sea level. Here the atmosphere is too thin for wings to provide enough lift, so a vehicle must rely on speed to stay aloft. This is conventionally the beginning of space.',
      'Meteor-S is a single-stage sounding rocket. Fly straight up; its engine burns out after about two minutes. Momentum then carries it to its highest point before it falls back to Earth.',
      'The rocket body has no recovery system, but the capsule on top has a parachute. Separate the capsule after burnout and deploy its parachute once subsonic to recover it intact (an optional objective).',
    ],
    objectives: { altitude: 'Reach a maximum altitude of 100 km', recover: 'Recover the capsule (parachute landing)' },
    scoring: {
      objectives: { label: 'Cross the Kármán Line', note: 'Reach a maximum altitude of 100 km.' },
      recover: { label: 'Capsule recovery', note: 'After burnout, press Space to separate the capsule. Press G to deploy the parachute once subsonic.' },
      apex: { label: 'Maximum altitude', note: 'Higher is better: full marks at 250 km or above. Stay vertical and keep full throttle throughout the burn.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. Stay vertical (do not use the attitude keys) and keep the throttle at 100%.',
      'The engine burns out after about two minutes. Press Space to separate the capsule.',
      'Coast upward past 100 km. Use . to speed up time if desired.',
      'The capsule falls back into the atmosphere nose-up, with its heat shield facing down. Deceleration can reach well over 10 g.',
      'At about 10 km, when the hint says "Subsonic", press G to deploy the parachute.',
    ],
  },
  'suborbital-hop': {
    title: 'Suborbital Flight and Recovery',
    summary: 'Fly a ballistic arc above 120 km and land several hundred kilometres downrange. The capsule must touch down safely.',
    briefing: [
      'A suborbital flight does not try to stay in space. Instead, it follows a high, long ballistic arc: tilt east during ascent to build horizontal speed while climbing, then land downrange of the launch site.',
      'Timing the tilt matters. Just after liftoff, the rocket is slow: even a small tilt lets gravity flatten its trajectory quickly. It then accelerates in dense air and breaks up under excessive dynamic pressure. Wait until 300 m/s; the same tilt then has much less effect on the trajectory.',
      'Tilting creates a new problem: the velocity direction keeps changing during descent, and the capsule will not automatically keep its heat shield facing forward. After separation, engage retrograde hold so the shield stays pointed into the airflow.',
      'More tilt makes a flatter arc: greater range and a gentler reentry, but a lower maximum altitude. Tilt more than about 20° and you will not reach 120 km.',
    ],
    objectives: { altitude: 'Reach a maximum altitude of 120 km', land: 'Land the capsule safely' },
    scoring: {
      objectives: { label: 'Flight and recovery', note: 'Pass 120 km and land the capsule by parachute.' },
      range: { label: 'Downrange distance', note: 'Farther from the launch site is better: full marks at 500 km or more. A tilt of about 15° gives the greatest range.' },
      g: { label: 'Reentry g-load', note: 'Full marks for a peak g-load of 10 g or less over the entire flight. A flatter arc gives a gentler reentry.' },
      landing: { label: 'Landing speed', note: 'Full marks at 7.5 m/s or less. After the main parachute opens, press H to jettison the heat shield and slow the descent further.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. Stay vertical at first.',
      'At 300 m/s (about 40 seconds after liftoff), hold D to tilt 10–15° east (pitch 75–80°). Release it, then press R for prograde hold.',
      'After engine burnout, press Space to separate the capsule. Press T for retrograde hold, with the heat shield facing forward.',
      'After passing the highest point, fall back into the atmosphere. Keep retrograde hold until deceleration is over.',
      'When the hint says "Subsonic", press G to deploy the parachute. Once the main parachute opens, you may press H to jettison the heat shield.',
    ],
  },
  'first-orbit': {
    title: 'First Orbit',
    summary: 'Fly Frontier 1 into low Earth orbit: periapsis at least 150 km, apoapsis no higher than 600 km.',
    briefing: [
      'Getting into orbit is about horizontal speed, not height. At 200 km altitude you need about 7.8 km/s horizontally to keep falling without ever reaching the ground.',
      'The rocket therefore cannot fly straight up throughout ascent. Tilt slightly east after liftoff and let gravity gradually bend the trajectory (a gravity turn). Once clear of dense air, the upper stage accelerates almost horizontally to orbital speed.',
      'Launching east gives you more than 400 m/s for free from Earth’s rotation. Raise periapsis above 150 km, shut down the engine and hold the orbit for 10 seconds to confirm the mission.',
      'This is a crewed spacecraft, so g-load also affects your score. Near first-stage burnout the rocket is light and full thrust produces more than 6 g. Throttle back to make the ride easier on the crew.',
    ],
    objectives: { orbit: 'Enter low Earth orbit (150–600 km)' },
    scoring: {
      objectives: { label: 'Orbit insertion', note: 'Periapsis ≥ 150 km and apoapsis ≤ 600 km. Hold for 10 seconds after engine shutdown.' },
      circular: { label: 'Orbit circularity', note: 'Full marks when apoapsis and periapsis differ by no more than 20 km. Keep vertical speed near zero during upper-stage flight.' },
      margin: { label: 'Propellant reserve', note: 'Full marks for at least 3.0 km/s of remaining Δv at orbit insertion. A well-timed gravity turn without detours leaves more in reserve.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5 g or less over the entire flight. Use ↓ to throttle back before first-stage burnout.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. At about 60 m/s, hold D to tilt 2–3° east (pitch 87–88°), then release.',
      'About 5 seconds later, press R for prograde hold. The rocket follows its velocity vector as gravity naturally bends the trajectory.',
      'Near first-stage burnout, g-load rises above 6 g. Use ↓ to throttle back if needed. At burnout, press Space to separate and ignite the second stage.',
      'Press R to return to manual control. Manage vertical speed with pitch: lower the nose if climbing too fast, raise it if descending, and bring vertical speed to zero near 200 km.',
      'When periapsis rises above 150 km, press X to shut down. Hold for 10 seconds to confirm the orbit.',
    ],
  },
  'crew-return': {
    title: 'Crew Return',
    summary: 'Start in a 200 km orbit: deorbit, reenter the atmosphere and bring the spacecraft safely home by parachute.',
    briefing: [
      'The spacecraft is already in a circular orbit at 200 km. Return in four steps: burn retrograde to lower periapsis (deorbit), separate the propulsion stage, enter the atmosphere heat-shield first, and deploy the parachute for landing.',
      'At reentry the spacecraft hits the atmosphere at 7.8 km/s, turning almost all its kinetic energy into heat. Only the ablative heat shield can withstand this. Reentering nose-first, side-first or with the propulsion stage still attached will destroy the spacecraft.',
      'Egret’s centre of mass is offset 11 cm from its symmetry axis. During reentry it trims at an angle of attack of about 20°, generating lift. Trimmed reentry keeps the lift upward and limits g-load to about 3 g; retrograde hold instead gives a ballistic, unlifted reentry of about 8 g.',
      'Crew g-load is the main scoring criterion. After the main parachute opens, you can also jettison the heat shield for a softer landing.',
    ],
    objectives: { land: 'Land the capsule safely' },
    scoring: {
      objectives: { label: 'Safe return', note: 'Land the capsule by parachute.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5 g or less. Press Y for trimmed reentry with lift upward (parachute deployment produces about 4–5 g). A ballistic reentry reaches about 8 g and earns no points here.' },
      shield: { label: 'Heat-shield reserve', note: 'Full marks with at least 85% of the ablator remaining. A gentler reentry consumes less ablator.' },
      landing: { label: 'Landing speed', note: 'Full marks at 7.6 m/s or less. After the main parachute opens, press H to jettison the heat shield.' },
    },
    flightPlan: [
      'Press T for retrograde hold and wait for the vehicle to turn around. You can use . to speed up time.',
      'Press Space to activate the second stage, then Z to ignite. When periapsis falls to 0–50 km, press X to shut down.',
      'Press Space to separate the second stage. Press Y for trimmed reentry (lift upward, about 3 g), or remain retrograde for a ballistic reentry (about 8 g).',
      'Use . to coast quickly to the atmosphere. Maintain attitude during reentry and watch the thermal-protection panel on the right.',
      'When the hint says "Subsonic", press G to deploy the parachute. After the main parachute opens, press H to jettison the heat shield.',
    ],
  },
  'orbital-flight': {
    title: 'Crewed Orbital Flight',
    summary: 'Fly a complete crewed mission: launch from the pad, enter low Earth orbit, then deorbit and land safely.',
    briefing: [
      'Put everything you have learned together: launch, gravity turn, staging and orbit insertion. After confirming the orbit, deorbit, reenter and land by parachute.',
      'The second stage still has plenty of propellant after orbit insertion—enough for the deorbit burn. Where you burn determines where you land: after the burn, the spacecraft travels a little less than half an orbit before reaching the atmosphere.',
      'This is a crewed flight. The highest g-load from liftoff to landing counts toward your score. Remember to throttle back during ascent and use trimmed reentry for the return.',
    ],
    objectives: { orbit: 'Enter low Earth orbit (150–600 km)', land: 'Land the capsule safely' },
    scoring: {
      objectives: { label: 'Orbit and safe return', note: 'Enter and confirm the orbit first, then land the capsule by parachute.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5 g or less over the entire flight. Throttle back during ascent and use trimmed reentry on return.' },
      circular: { label: 'Orbit circularity', note: 'Full marks when apoapsis and periapsis differ by no more than 20 km at orbit confirmation.' },
      shield: { label: 'Heat-shield reserve', note: 'Full marks with at least 85% of the ablator remaining.' },
      landing: { label: 'Landing speed', note: 'Full marks at 7.6 m/s or less. After the main parachute opens, press H to jettison the heat shield.' },
    },
    flightPlan: [
      'Follow the First Orbit procedure: tilt 2–3° east → prograde hold → stage → manage vertical speed with pitch → shut down above 150 km periapsis.',
      'After orbit confirmation, press T for retrograde hold. Once turned around, press Z to burn until periapsis falls to 0–50 km, then X to shut down.',
      'Press Space to separate the second stage, then Y for trimmed reentry.',
      'Reenter and slow down. When the hint says "Subsonic", press G to deploy the parachute. After the main parachute opens, press H to jettison the heat shield.',
    ],
  },
  'inclined-orbit': {
    title: 'Target Inclination',
    summary: 'Enter low Earth orbit at 51.6° inclination. This launch is no longer due east.',
    briefing: [
      'Orbital inclination is the angle between the orbital plane and the equator. Launching from latitude φ at azimuth β gives cos i = cos φ · sin β. Due east gives the minimum inclination, equal to the launch-site latitude. For a higher inclination, launch farther north (or south).',
      'From Cape Canaveral (28.5°N), a 51.6° orbit needs an inertial azimuth of about 45°. After subtracting the eastward speed from Earth’s rotation, the vehicle must fly a ground-relative heading of about 43°—northeast.',
      'The keyboard gives only eight directions: W and D together point exactly northeast (45°). This initial turn alone gives an inclination of about 47°, still a few degrees short. Watch the inclination during upper-stage flight and steer farther north. Earlier corrections cost less: the faster you fly, the more propellant a plane change needs (about 140 m/s per degree once in orbit).',
      'The rocket does not automatically roll to align with its flight direction, so diagonal flight also needs diagonal key combinations: W + D lowers the nose, S + A raises it, W + A steers north and S + D steers east.',
    ],
    objectives: { orbit: 'Enter low Earth orbit at 51.6° ± 2° inclination' },
    scoring: {
      objectives: { label: 'Target orbit insertion', note: 'Periapsis ≥ 150 km, apoapsis ≤ 600 km and inclination 51.6° ± 2°.' },
      inclination: { label: 'Inclination accuracy', note: 'Full marks within 0.3° of 51.6°. Watch the inclination during upper-stage flight and correct heading with W + A / S + D.' },
      circular: { label: 'Orbit circularity', note: 'Full marks when apoapsis and periapsis differ by no more than 20 km.' },
      margin: { label: 'Propellant reserve', note: 'Full marks for at least 2.9 km/s of remaining Δv at orbit insertion.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5 g or less over the entire flight. Use ↓ to throttle back before first-stage burnout.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. At about 60 m/s, hold W and D together to tilt about 2° northeast (pitch 88°, heading about 045°), then release.',
      'About 5 seconds later, press R for prograde hold and wait for first-stage burnout. Press Space to stage, then R to return to manual control.',
      'Use W + D to lower the nose and S + A to raise it, managing vertical speed as in First Orbit.',
      'Watch the inclination readout on the left. Below 51.6°, tap W + A to steer north; above it, tap S + D. Make larger corrections for larger errors, then return toward the original heading as you approach the target.',
      'When periapsis is above 150 km and inclination is within 51.6° ± 2°, press X to shut down and hold for 10 seconds.',
    ],
  },
  'polar-orbit': {
    title: 'Polar Orbit',
    summary: 'Launch south from Vandenberg into a polar orbit at 90° inclination.',
    briefing: [
      'A polar orbit passes over both poles. Earth rotates beneath it, so the satellite sees a different longitude on each revolution and can scan the whole surface in a few days. This makes such orbits useful for Earth-observation satellites.',
      'Vandenberg lies on the California coast, with open Pacific Ocean to the south. A 90° orbit needs an inertial velocity pointing due south. At liftoff, however, Earth’s rotation already gives the rocket 380 m/s eastward. Cancelling it requires a slightly westward heading—the theoretical value is about 183°.',
      'Tilting due south with S and making no later corrections gives an inclination of about 84°: that 380 m/s of eastward speed remains in the orbit. During upper-stage flight, steer farther west until inclination approaches 90°.',
      'A polar launch gets no benefit from Earth’s rotation and even spends extra propellant cancelling it. The same rocket can carry much less payload to polar orbit than on an eastward launch. Here this appears as about 400 m/s less remaining Δv at orbit insertion.',
    ],
    objectives: { orbit: 'Enter low Earth orbit at 90° ± 3° inclination' },
    scoring: {
      objectives: { label: 'Polar orbit insertion', note: 'Periapsis ≥ 150 km, apoapsis ≤ 600 km and inclination 90° ± 3°.' },
      inclination: { label: 'Inclination accuracy', note: 'Full marks within 0.3° of 90°. Watch the inclination during upper-stage flight and correct heading with A / D.' },
      circular: { label: 'Orbit circularity', note: 'Full marks when apoapsis and periapsis differ by no more than 20 km.' },
      margin: { label: 'Propellant reserve', note: 'Full marks for at least 2.6 km/s of remaining Δv at orbit insertion.' },
      g: { label: 'Crew g-load', note: 'Full marks for a peak g-load of 5 g or less over the entire flight. Use ↓ to throttle back before first-stage burnout.' },
    },
    flightPlan: [
      'Press Space to ignite and lift off. At about 60 m/s, hold S to tilt 2–3° south (pitch 87–88°, heading about 180°), then release.',
      'About 5 seconds later, press R for prograde hold and wait for first-stage burnout. Press Space to stage, then R to return to manual control.',
      'When flying south, S lowers the nose and W raises it. Manage vertical speed as in First Orbit.',
      'Watch the inclination. Below 90° means some eastward speed remains: tap A to steer west. Above 90°, tap D instead.',
      'When periapsis is above 150 km and inclination is within 90° ± 3°, press X to shut down and hold for 10 seconds.',
    ],
  },  'geo-deployment': {
    title: 'Orbital Frontier: Geostationary Communications Satellite',
    summary: 'Zenith-3: parking orbit → GTO → apoapsis circularization and inclination correction → satellite deployment.',
    briefing: [
      'Launch east from Kourou and deliver a communications satellite to geostationary orbit.',
      'Use the maneuver planner on the map. A node is an instantaneous-burn preview, but a real engine needs time to burn: center the burn on the node, then correct using the orbit readouts after shutdown.',
      'GEO requires a period close to one sidereal day, low eccentricity, low inclination, and a sub-satellite longitude that stays essentially fixed over the next sidereal day. A GSO that only matches the period is not enough.',
      'Rocket parameters and the scoring of earlier missions are unchanged. The satellite has no engine, so finish all orbit corrections before deployment.',
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
      'Launch east. At about 60 m/s tilt 1°, then use prograde hold for the gravity turn; separate each stage and jettison the fairing.',
      'On the upper stage, use pitch to control vertical speed. Shut down once periapsis reaches 150 km and wait for the parking orbit to be confirmed.',
      'Open the map and create a GTO injection node. Point at the maneuver and ignite half the estimated burn time before the node. When the remaining Δv is near 0, check apoapsis; if it is low, burn prograde until about 35,793 km, then shut down.',
      'Clear the old node and create an equatorial circularization node. At the equator crossing near apoapsis, change the velocity to that of an equatorial circular orbit.',
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
