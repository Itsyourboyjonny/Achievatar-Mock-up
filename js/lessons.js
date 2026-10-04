// Duolingo-style learning path. Unit 1 is universal; units 2–3 are generated
// from the user's dream physique (top priority regions and phase).
import { REGION_NAME } from './model.js';

const info = (title, body) => ({ type: 'info', title, body });
const quiz = (q, options, answer, why) => ({ type: 'quiz', q, options, answer, why });

const FOUNDATIONS = [
  { id: 'f1', icon: '📈', title: 'How muscle grows', cards: [
    info('Progressive overload', 'Muscle grows when you give it a reason to. Each week, aim to beat last time: one more rep, a little more weight, or cleaner form.'),
    info('Close to failure', 'Most growth comes from the last few hard reps. Finish most sets with only 1–3 reps left "in the tank".'),
    quiz('You did 3×8 at 40 kg last week. What is the best next step?', ['Same weight, same reps', '3×9 at 40 kg', 'Jump to 60 kg', 'Switch exercise'], 1, 'Small, repeatable progress is how you overload: one more rep or a small weight jump.'),
  ] },
  { id: 'f2', icon: '🍗', title: 'Protein 101', cards: [
    info('Your daily target', 'For building or keeping muscle, aim for roughly 1.6–2.2 g of protein per kg of bodyweight every day.'),
    info('Spread it out', '3–5 meals with 25–50 g each makes the target easy: eggs, Greek yoghurt, chicken, fish, tofu, lentils, whey.'),
    quiz('A 80 kg lifter wants to build muscle. A good daily protein target is…', ['40 g', '80 g', '150 g', '400 g'], 2, '80 kg × ~1.8 g/kg ≈ 145 g. 400 g is far more than you can use.'),
  ] },
  { id: 'f3', icon: '⚖️', title: 'Calories & energy balance', cards: [
    info('The rule that never breaks', 'Eat less than you burn and you lose weight. Eat more and you gain. Food quality decides how good you feel and look while doing it.'),
    info('Lean bulk vs cut', 'Lean bulk: ~5–10% above maintenance. Cut: ~15–25% below. Bigger swings mostly add fat or cost muscle.'),
    quiz('Your weight is flat for 3 weeks during a cut. What should you change first?', ['Stop training', 'Drop ~150–200 kcal/day', 'Eat 800 kcal/day', 'Cut out protein'], 1, 'Small adjustments keep you losing fat without sacrificing muscle or energy.'),
  ] },
  { id: 'f4', icon: '😴', title: 'Sleep & recovery', cards: [
    info('Growth happens after the gym', 'Training is the signal; recovery is when you build. 7–9 hours of sleep improves strength, appetite control and muscle gain.'),
    quiz('Which is MOST likely to stall your progress?', ['Sleeping 8 hours', 'Rest days', 'Sleeping 5 hours most nights', 'Stretching'], 2, 'Chronic short sleep reduces recovery and makes fat loss tilt toward muscle loss.'),
  ] },
];

const REGION_LESSONS = {
  shoulders: [info('Width comes from the side delts', 'Lateral raises are the #1 tool for wider shoulders. They respond well to high reps (12–20) and frequent training (2–3×/week).'), quiz('Best exercise for shoulder WIDTH?', ['Front raise', 'Lateral raise', 'Shrug', 'Crunch'], 1, 'Side delts build width; front delts already get lots of work from pressing.')],
  chest: [info('Angle matters', 'Incline pressing (~30°) targets the upper chest, which gives a fuller look from the front. Control the bottom stretch.'), quiz('Upper chest is best targeted by…', ['Decline press', 'Incline press', 'Leg press', 'Dips only'], 1, 'An incline of ~30° shifts emphasis to the clavicular (upper) chest.')],
  back: [info('The V-taper engine', 'Lats make your waist look smaller. Pull with your elbows, not your hands, and take a full stretch at the top of every rep.'), quiz('Wide lats mainly come from…', ['Vertical pulls & rows', 'Bicep curls', 'Squats', 'Calf raises'], 0, 'Pull-ups, pulldowns and rows are the core lat builders.')],
  arms: [info('Triceps are two-thirds of your arm', 'For bigger arms, train triceps as hard as biceps. Overhead extensions stretch the long head for extra growth.'), quiz('Which muscle makes up most of the upper arm size?', ['Biceps', 'Triceps', 'Forearms', 'Deltoids'], 1, 'Triceps are about 2/3 of upper-arm muscle mass.')],
  forearms: [info('Grip is trainable', 'Hammer curls, farmer carries and wrist curls grow the forearms, and stronger grip helps all your pulling lifts.'), quiz('Hammer curls emphasise…', ['Brachioradialis (forearm)', 'Chest', 'Calves', 'Lats'], 0, 'The neutral grip loads the brachioradialis, a big forearm muscle.')],
  core: [info('Abs are made in the kitchen…', '…and revealed by low body fat. Train abs like any muscle (weighted, 8–15 reps), but visible abs mostly need body fat around 10–14% (men) or 18–22% (women).'), quiz('To SEE your abs, the biggest factor is…', ['1000 crunches a day', 'Overall body fat', 'Ab belts', 'Sweating more'], 1, 'You can\'t spot-reduce belly fat; overall fat loss reveals abs.')],
  glutes: [info('Hips drive the glutes', 'Hip thrusts and RDLs load the glutes at different lengths. Use both for complete development.'), quiz('Romanian deadlifts load glutes and hamstrings mainly in a…', ['Stretched position', 'Shortened position', 'Static hold', 'Jump'], 0, 'RDLs load the muscles while they\'re stretched, which strongly drives growth.')],
  legs: [info('Depth = growth', 'Squatting and leg pressing through a full range of motion grows the quads much more than partial reps.'), quiz('For bigger quads, prioritise…', ['Quarter squats', 'Full-depth squats / leg press', 'Only cardio', 'Leg extensions only, no squats'], 1, 'A full range of motion puts more stretch and tension on the quads.')],
  calves: [info('Pause in the stretch', 'Calves are stubborn and genetic. Your best chance: a 2-second pause at the bottom of every rep, high frequency, and patience.'), quiz('The key calf-raise technique is…', ['Fast bouncing', 'Pausing in the bottom stretch', 'Half reps at the top', 'Never training them'], 1, 'Bouncing uses the Achilles tendon like a spring; pausing makes the muscle work.')],
};

function phaseLessons(plan) {
  const m = plan.macros;
  const phaseText = {
    Cut: `You'll eat about ${m.kcal} kcal/day (~${Math.round(-m.adj * 100)}% below maintenance) and keep training heavy so the weight you lose is fat, not muscle.`,
    'Cut → Lean bulk': `First a cut at ~${m.kcal} kcal/day to reveal your shape, then a lean bulk at ~${Math.round(m.tdee * 1.1)} kcal/day to build.`,
    Recomp: `You'll eat about ${m.kcal} kcal/day, just under maintenance, with high protein (${m.protein} g). You can lose fat and build muscle at the same time.`,
    'Lean bulk': `You'll eat about ${m.kcal} kcal/day (~10% above maintenance), aiming to gain ~0.25–0.5% bodyweight per week, mostly as muscle.`,
    Maintain: `You'll eat around maintenance (${m.kcal} kcal/day) and focus on performance and small shape changes.`,
  }[plan.phase];
  return [
    { id: 'p1', icon: '🧭', title: `Your phase: ${plan.phase}`, cards: [
      info(`Why ${plan.phase}?`, phaseText),
      info('Your estimated timeline', `Based on natural rates of muscle gain and fat loss, your dream physique is roughly ${plan.weeks} weeks of consistent work away. Consistency beats intensity.`),
      quiz('What decides most of your progress week to week?', ['One perfect workout', 'Being consistent with training, protein and sleep', 'Supplements', 'Luck'], 1, 'The plan only works if you show up, which is why your streak matters.'),
    ] },
    { id: 'p2', icon: '🎯', title: 'No spot reduction', cards: [
      info('Fat leaves from everywhere', 'Your body decides where fat comes off first, mostly based on genetics. That\'s why the Dream sliders spread fat changes across your whole body.'),
      quiz('You want a slimmer waist. The most effective approach is…', ['Only doing crunches', 'An overall calorie deficit + training', 'Waist trainers', 'Sauna suits'], 1, 'Overall fat loss shrinks the waist; crunches build the muscle underneath.'),
    ] },
    { id: 'p3', icon: '📸', title: 'Photos that measure', cards: [
      info('Same photo, every day', 'Same spot, same light, same time (morning, before eating), fitted clothes, arms ~30° out, whole body in frame. Achievatar normalises size, but lighting and pose still matter.'),
      quiz('When is the most consistent time for progress photos?', ['Right after a pump workout', 'Morning, before eating', 'After a big dinner', 'Random times'], 1, 'A morning routine removes pump, food and water swings.'),
    ] },
    { id: 'p4', icon: '🔁', title: 'Plateaus & deloads', cards: [
      info('Stalls are normal', 'If lifts stall for 2–3 weeks, take a deload week (about half the sets), then build back up. Fatigue hides fitness.'),
      quiz('Your lifts have stalled for 3 weeks and you feel beat up. Best move?', ['Train twice a day', 'Deload for a week', 'Quit', 'Max out daily'], 1, 'A short deload clears fatigue so progress can resume.'),
    ] },
  ];
}

export function buildPath(plan) {
  const top = plan.priorities.filter((r) => plan.musEff[r] > 0).slice(0, 3);
  const focus = (top.length ? top : ['back', 'shoulders', 'legs']).map((r, i) => ({
    id: `r-${r}`, icon: ['💪', '🦾', '🏆'][i], title: `Build: ${REGION_NAME[r]}`, cards: REGION_LESSONS[r],
  }));
  return [
    { title: 'Unit 1 · Foundations', color: '#58cc02', lessons: FOUNDATIONS },
    { title: `Unit 2 · Your dream build: ${focus.map((l) => l.title.slice(7)).join(', ')}`, color: '#1cb0f6', lessons: focus },
    { title: `Unit 3 · ${plan.phase} playbook`, color: '#ce82ff', lessons: phaseLessons(plan) },
  ];
}
