// scripts/make-demo-export.mjs
//
// Builds a demo WhatsApp export: a folder of media plus a `_chat.txt` in the
// exact shape iOS writes one, and a .zip of the two. Everything in it is
// invented — eight made-up people and a written-out three-year group chat — and
// the photos come from Lorem Picsum, which serves Unsplash-licensed images, so
// the result is free to put in a screen recording.
//
//   node scripts/make-demo-export.mjs            # ~950 photos, the full run
//   node scripts/make-demo-export.mjs --photos 120   # a quick one
//
// Output lands in demo-export/ (gitignored — it is ~100 MB and must never be
// committed). The run is deterministic: same arguments, same library.
//
// Why an export rather than seeding storage directly, as scripts/demo-seed.js
// does: a recording usually wants to open on the drop screen and show the import
// happening. The unzipped folder is left beside the .zip so either import path
// can be demonstrated.

import { mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { zipSync } from 'fflate'

const run = promisify(execFile)

const OUT_ROOT = 'demo-export'
const CHAT_TITLE = 'Casa Verde ☀️'
const FOLDER = `WhatsApp Chat - ${CHAT_TITLE}`

/** The LTR mark iOS puts at the start of every line and before every marker. */
const LTR = '‎'

// ── People ───────────────────────────────────────────────────────────────────
// Invented, and deliberately not near anyone real. The first three match
// scripts/demo-seed.js so the README screenshots and this export show one cast.
const NINA = 'Nina Duval'
const AMIT = 'Amit Bar Lev'
const CHLOE = 'Chloé Marchand'
const THEO = 'Théo Nakamura'
const RANIA = 'Rania Haddad'
const MARCUS = 'Marcus Oyelaran'
const SOFIA = 'Sofia Ferreira'
const JONAS = 'Jonas Weber'
const ALL = [NINA, AMIT, CHLOE, THEO, RANIA, MARCUS, SOFIA, JONAS]

// ── Deterministic randomness ─────────────────────────────────────────────────
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260802)
const pick = (list) => list[Math.floor(rand() * list.length)]
const chance = (p) => rand() < p

// ── Reactions ────────────────────────────────────────────────────────────────
// Dropped between photos so a burst reads as people talking over each other
// rather than a slideshow with captions.
const REACTIONS = [
  'ok that one is going on the wall',
  '😍😍',
  'send me the full res',
  'who took this?!',
  'I have no memory of this at all',
  'this is the one',
  'crying',
  'PLEASE delete that one',
  'why do I look like that',
  'framed. done. no discussion',
  'the light 😮‍💨',
  'ok photographer of the year',
  'we look so young',
  'I want to go back immediately',
  'this is my new profile picture',
  'absolutely not, next',
  'hahahaha the face',
  'stop I miss everyone',
  'best weekend of the year, easily',
  'someone print this one',
  'ok this is the last one I promise',
  'no it is not',
  '❤️',
  'legendary',
  'I forgot this even happened',
  'the amount of bread on that table',
  'and then it started raining',
  'you can see me planning my escape',
  'ten out of ten, no notes',
  'saving this forever',
]

const LINKS = [
  'https://example.com/casa-verde-playlist',
  'https://example.com/the-blue-door-guesthouse',
  'https://example.com/recipe/tomato-tart',
  'https://example.com/train-times-lisbon',
  'https://example.com/hikes-near-the-house',
  'https://example.com/vinyl-shop-we-found',
  'https://example.com/wedding-photos-gallery',
  'https://example.com/house-rules-final',
]

// ── The conversation ─────────────────────────────────────────────────────────
// Each scene is a day. `open` and `close` are written out; the photo burst in
// between draws captions from the scene's own pool, so a burst reads as being
// about that day rather than about photography in general.
const SCENES = [
  {
    date: '2023-05-12', start: '09:14', weight: 45, cast: [NINA, AMIT, CHLOE, THEO, SOFIA],
    open: [
      [NINA, 'WE HAVE THE KEYS'],
      [AMIT, 'no way. no way!!'],
      [CHLOE, 'I am leaving work right now, do not touch anything until I get there'],
      [NINA, 'the garden is completely wild, bring shoes'],
      [THEO, '2h out. Sofia is bringing the good knives for some reason'],
      [SOFIA, 'you will thank me'],
    ],
    captions: [
      'the front door, finally ours (for the weekend at least)',
      'the kitchen. yes that is the original tile',
      'nobody tell the landlord about the garden',
      'first coffee in the house',
      'this window is going to be my whole personality now',
      'found a whole cupboard of mismatched plates',
      'the light at 6pm in this room',
      'Amit measuring things for no reason',
      'the long table. it seats eleven if we lie about it',
      'the stairs creak in three different notes',
      'someone left a radio from 1994',
      'view from the top of the garden',
    ],
    close: [
      [SOFIA, 'dinner was 40 minutes late and nobody cared'],
      [AMIT, 'motion to come back every month'],
      [CHLOE, 'seconded'],
      [NINA, 'unanimous then ☀️'],
    ],
    docs: [['House rules (final).pdf', 'agreed at the table, do not renegotiate']],
    links: 1,
  },
  {
    date: '2023-06-03', start: '10:02', weight: 38, cast: [NINA, AMIT, MARCUS, THEO, JONAS],
    open: [
      [AMIT, 'paint day. I have opinions about the shutters'],
      [MARCUS, 'we voted green'],
      [AMIT, 'we voted a green. not that green'],
      [JONAS, 'I am bringing the ladder and no opinions'],
    ],
    captions: [
      'before',
      'the green in question',
      'Marcus has committed fully',
      'this took four hours and we did one shutter',
      'lunch on the floor because the table is covered',
      'the second coat, much better',
      'paint on absolutely everything',
      'after. worth every argument',
      'the brush situation got out of hand',
    ],
    close: [
      [NINA, 'ok it is beautiful, Amit was right'],
      [AMIT, 'I want that in writing'],
    ],
    voice: 1,
  },
  {
    date: '2023-07-21', start: '11:40', weight: 58, cast: ALL,
    open: [
      [SOFIA, 'everyone is here. everyone. all eight of us'],
      [RANIA, 'first time since the wedding of what was his name'],
      [CHLOE, 'do NOT start'],
      [NINA, 'beach at 12, table at 8, that is the whole plan'],
    ],
    captions: [
      'the walk down',
      'the water was freezing and we all pretended otherwise',
      'Théo went in first, obviously',
      'reading, allegedly',
      'the sand got into everything, including the bread',
      'Rania asleep in about four seconds',
      'the long table, set for eight',
      'tomato tart, third year running',
      'someone found the fairy lights',
      'this is the photo. this is the one from that summer',
      'the sky did that all by itself',
      'nobody moved for an hour after dinner',
      'the last of the wine',
      'walking back in the dark, phones off',
    ],
    close: [
      [MARCUS, 'I am not going to be normal about that sunset'],
      [JONAS, 'we say that every year'],
      [MARCUS, 'and every year I am right'],
    ],
    links: 1, voice: 1,
  },
  {
    date: '2023-08-05', start: '07:20', weight: 42, cast: [NINA, THEO, MARCUS, RANIA, JONAS],
    open: [
      [THEO, 'leaving at 7:30 sharp'],
      [JONAS, 'it is 7:29 and Marcus is still asleep'],
      [MARCUS, 'I am awake I am awake'],
      [NINA, 'the forecast says storm at 4. we will be down by then'],
    ],
    captions: [
      'the first hour, everyone still cheerful',
      'the ridge',
      'Rania has been ahead of everyone the entire way',
      'lunch spot, non negotiable',
      'you can see the house from here, the tiny green dot',
      'and there is the storm, right on time',
      'we were not down by then',
      'sheltering under a rock like idiots',
      'soaked to the bone and laughing',
      'the drive home, all the windows fogged',
    ],
    close: [
      [NINA, 'seven hours, one storm, zero casualties'],
      [RANIA, 'my legs disagree'],
      [THEO, 'same time next year?'],
      [JONAS, 'obviously'],
    ],
  },
  {
    date: '2023-09-16', start: '09:50', weight: 30, cast: [CHLOE, SOFIA, AMIT, NINA],
    open: [
      [CHLOE, 'market is enormous today, come now'],
      [SOFIA, 'on my way, list please'],
      [CHLOE, 'figs. everything else is improvisation'],
    ],
    captions: [
      'the figs in question',
      'the cheese man remembered us',
      'Sofia negotiating in three languages',
      'we bought far too much of this',
      'the flower stall at the end',
      'lunch, entirely made of things bought in the last hour',
    ],
    close: [
      [AMIT, 'we spent our whole weekend budget before 11am'],
      [NINA, 'and I would do it again'],
    ],
    docs: [['Market haul receipt.pdf', 'for the record, it was Chloé']],
  },
  {
    date: '2023-10-28', start: '18:30', weight: 40, cast: ALL,
    open: [
      [NINA, 'she has no idea. everyone in the kitchen by 7'],
      [THEO, 'I have the cake, it survived the drive'],
      [AMIT, 'lights off at 7:15'],
      [SOFIA, 'why is everyone being weird today'],
      [CHLOE, 'no reason 🙂'],
    ],
    captions: [
      'the face. worth the entire month of planning',
      'the cake, slightly leaning',
      'Théo hiding behind a door for ten minutes',
      'thirty candles, which is a lot of candles',
      'the toast, which went on for a while',
      'dancing started early this year',
      'someone put on the 1994 radio playlist',
      'the kitchen at midnight',
    ],
    close: [
      [SOFIA, 'I genuinely did not know. I am furious and I love you all'],
      [RANIA, 'that is the correct reaction'],
    ],
    voice: 2, links: 1,
  },
  {
    date: '2023-12-24', start: '16:05', weight: 44, cast: [NINA, AMIT, CHLOE, THEO, JONAS, SOFIA],
    open: [
      [JONAS, 'it is actually snowing. the house looks fake'],
      [CHLOE, 'send a photo immediately'],
      [NINA, 'fire is lit, we are three hours from dinner'],
    ],
    captions: [
      'the house in the snow, as promised',
      'the fire, first attempt',
      'the fire, fourth attempt',
      'nobody has moved from this sofa since 2pm',
      'the table, absurd amount of candles',
      'Jonas insisted on the paper hats',
      'the garden completely white',
      'midnight, everyone still up somehow',
      'the last one standing',
    ],
    close: [
      [AMIT, 'best one yet'],
      [THEO, 'you say that every year too'],
      [AMIT, 'and I am also always right'],
    ],
    voice: 1,
  },
  {
    date: '2024-01-13', start: '12:00', weight: 26, cast: ALL,
    open: [
      [JONAS, 'ok. Berlin. March 1st. It is happening'],
      [NINA, 'NO'],
      [RANIA, 'congratulations!! and also no'],
      [JONAS, 'it is two hours by plane, calm down'],
      [CHLOE, 'two hours is two hours too many'],
    ],
    captions: [
      'the goodbye lunch, which he insisted was not a goodbye lunch',
      'the whole crew, slightly blurry',
      'Jonas pretending he is fine',
      'nobody pretending they are fine',
      'the last coffee in the garden before the drive',
    ],
    close: [
      [JONAS, 'I will be back for every single one of these, you know that'],
      [MARCUS, 'we are holding you to it'],
    ],
  },
  {
    date: '2024-02-24', start: '08:15', weight: 48, cast: [NINA, THEO, MARCUS, RANIA, AMIT],
    open: [
      [THEO, 'first lift at 8:30, no excuses'],
      [AMIT, 'I have never skied in my life'],
      [RANIA, 'you told us you were intermediate'],
      [AMIT, 'I lied for social reasons'],
    ],
    captions: [
      'the view from the top, worth the queue',
      'Amit, five minutes into the beginner slope',
      'Amit, twenty minutes into the beginner slope',
      'actual progress by the afternoon',
      'the light on the way down',
      'hot chocolate as a medical necessity',
      'Rania going far too fast as usual',
      'the boots came off and nobody put them back on',
    ],
    close: [
      [AMIT, 'I am now, officially, intermediate'],
      [MARCUS, 'you fell down a flat surface'],
      [AMIT, 'intermediate'],
    ],
    voice: 1,
  },
  {
    date: '2024-04-06', start: '19:45', weight: 32, cast: ALL,
    open: [
      [RANIA, 'we have something to say and Marcus has been silent for an hour'],
      [MARCUS, 'I am building suspense'],
      [SOFIA, 'BUILD FASTER'],
      [RANIA, 'we are getting married 💍'],
      [CHLOE, 'AAAAAAA'],
      [NINA, 'I am crying in a supermarket'],
    ],
    captions: [
      'the ring, finally photographed properly',
      'the face Marcus made when she said it out loud',
      'everyone on the call at once',
      'the toast, an hour later, still no plan',
      'the first attempt at a date on the back of an envelope',
    ],
    close: [
      [THEO, 'the house. it has to be at the house'],
      [MARCUS, 'we were already thinking that'],
      [NINA, 'then it is decided'],
    ],
    links: 1,
  },
  {
    date: '2024-05-18', start: '07:58', weight: 55, cast: [NINA, AMIT, CHLOE, SOFIA, THEO],
    open: [
      [NINA, 'Landed. Fog like soup — I cannot see the end of the runway.'],
      [AMIT, 'we are an hour behind you, do not start without us'],
      [CHLOE, 'starting without you'],
    ],
    captions: [
      'the drive in, fog the whole way',
      'the bridge has completely vanished',
      'pastéis, first thing, obviously',
      'walked the wrong way for an hour, worth it',
      'the street we kept getting lost on',
      'the whole city from up here',
      '50 cents to look at more fog',
      'the good coffee. the one we came back for twice',
      'six of us, one pot of tea, no decisions',
      'the wall everyone poses at, so we posed at it',
      'the chapel at the top, closed, of course',
      'nobody else awake',
      'the island, from the ferry',
      'we walked 22km and I have the blisters to prove it',
      'last night, the tiles lit up',
    ],
    close: [
      [SOFIA, 'that is 400 photos in four days'],
      [THEO, 'and I regret none of them'],
    ],
    docs: [['Lisbon itinerary (final).pdf', 'everything in one file, stop asking me']],
    links: 2, voice: 1,
  },
  {
    date: '2024-06-29', start: '10:30', weight: 26, cast: [AMIT, MARCUS, THEO, NINA],
    open: [
      [MARCUS, 'the roof is leaking. not a lot. but leaking'],
      [AMIT, 'define not a lot'],
      [MARCUS, 'there is a bucket'],
      [NINA, 'on my way'],
    ],
    captions: [
      'the bucket, for scale',
      'the actual hole, much smaller than the bucket suggested',
      'Théo on the roof, which nobody authorised',
      'the repair, day one',
      'the repair, day one, later, worse',
      'the roof guy who fixed it in 40 minutes',
    ],
    close: [
      [THEO, 'in my defence I did find it'],
      [AMIT, 'you also made it bigger'],
    ],
    docs: [['Roof quote.pdf', 'we are splitting this eight ways']],
  },
  {
    date: '2024-07-13', start: '11:00', weight: 52, cast: ALL,
    open: [
      [CHLOE, 'we are 11 people this year. eleven.'],
      [SOFIA, 'the table seats eleven if we lie about it'],
      [NINA, 'we have lied about it for three years'],
    ],
    captions: [
      'the drive down, all four windows open',
      'the beach at 8am, completely empty',
      'the umbrella situation',
      'the kids have completely taken over',
      'lunch, which took three hours',
      'the water was perfect this year',
      'nobody wanted to leave',
      'the walk back up the hill, complaining',
      'the outdoor shower that we all queue for',
      'evening, everyone tired and happy',
      'the table, again, at capacity',
      'someone brought a guitar. it was fine actually',
    ],
    close: [
      [JONAS, 'flew in for 48 hours and it was worth it'],
      [RANIA, 'told you'],
    ],
    voice: 1, links: 1,
  },
  {
    date: '2024-08-24', start: '08:40', weight: 46, cast: [NINA, THEO, SOFIA, AMIT, CHLOE],
    open: [
      [THEO, 'road trip. no motorway. that is the only rule'],
      [SOFIA, 'that adds four hours'],
      [THEO, 'that adds four hours of scenery'],
    ],
    captions: [
      'first stop, entirely by accident',
      'the road did this for about 20km',
      'the petrol station with the good sandwiches',
      'this village had one street and four cats',
      'the coast, finally',
      'we swam in our clothes because we could not wait',
      'the place we ate at twice in one day',
      'the drive back at golden hour',
      'nobody spoke for the last hour, in a good way',
    ],
    close: [
      [SOFIA, 'ok the no motorway rule stays'],
      [THEO, 'thank you'],
    ],
    links: 1,
  },
  {
    date: '2024-10-05', start: '09:00', weight: 78, cast: ALL,
    open: [
      [NINA, 'TODAY IS THE DAY'],
      [CHLOE, 'the flowers are here, the chairs are here, the sun is here'],
      [MARCUS, 'I have been awake since 4'],
      [RANIA, 'same. see you at the tree 🤍'],
      [AMIT, 'everyone: photos in the shared album, not just the group'],
      [SOFIA, 'nobody will do that'],
      [AMIT, 'nobody will do that'],
    ],
    captions: [
      'the garden at 7am, before anyone',
      'the chairs, all 60 of them, placed twice',
      'the tree, where it happened',
      'Rania getting ready, door half open',
      'Marcus completely unable to stand still',
      'the walk down the path',
      'the moment. blurry. do not care',
      'everyone crying, including the photographer',
      'the rings',
      'confetti everywhere, we found some in March',
      'the long table, dressed properly for once',
      'the speeches, which ran an hour over',
      'Jonas flew in that morning and gave a speech anyway',
      'the first dance under the lights',
      'the cake, which Théo made and refuses to discuss',
      'dancing until the neighbours came, and then they joined',
      'the last table standing at 3am',
      'the house at sunrise, everyone gone home',
    ],
    close: [
      [RANIA, 'thank you. all of you. I have no words left'],
      [MARCUS, 'she really does not, she used them all in the speech'],
      [NINA, 'best day this house has ever had'],
    ],
    docs: [['Wedding running order.pdf', 'the version we actually followed'], ['Seating plan v6.pdf', 'v6. SIX.']],
    links: 1, voice: 2,
  },
  {
    date: '2024-11-16', start: '20:10', weight: 24, cast: ALL,
    open: [
      [AMIT, 'the photographer sent everything. 2,400 photos'],
      [SOFIA, 'TWO THOUSAND FOUR HUNDRED'],
      [NINA, 'I am putting the best ones here, I am not sending 2,400'],
    ],
    captions: [
      'this one I had not seen at all',
      'the back of the room during the speeches',
      'us, out of focus, perfect',
      'the one that is going in a frame',
      'Marcus laughing at something off camera',
    ],
    close: [
      [MARCUS, 'ok that last one is our christmas card'],
      [RANIA, 'agreed and decided'],
    ],
    links: 1,
  },
  {
    date: '2025-01-01', start: '00:05', weight: 34, cast: [NINA, AMIT, CHLOE, THEO, SOFIA, RANIA, MARCUS],
    open: [
      [NINA, 'HAPPY NEW YEAR from the garden 🎆'],
      [CHLOE, 'we can hear you from the kitchen'],
      [THEO, 'that is because you are 12 metres away'],
    ],
    captions: [
      'midnight, from the top of the garden',
      'the fireworks from the village, tiny but ours',
      'everyone in coats over pyjamas',
      'the first coffee of the year',
      'the walk on the 1st, hungover, silent',
      'the sky did something unreasonable at 4pm',
    ],
    close: [
      [SOFIA, 'good year. genuinely.'],
      [AMIT, 'next one at the house too?'],
      [NINA, 'obviously'],
    ],
    voice: 1,
  },
  {
    date: '2025-03-08', start: '17:20', weight: 22, cast: ALL,
    open: [
      [CHLOE, 'ok I also have news and I have been sitting on it for 11 weeks'],
      [NINA, 'CHLOÉ'],
      [CHLOE, 'September 🤍'],
      [SOFIA, 'I am going to be unbearable about this'],
      [THEO, 'we are all going to be unbearable about this'],
    ],
    captions: [
      'the scan, tiny and unimpressed',
      'the face when she told us',
      'the group call, eight windows, all shouting',
      'the toast, non alcoholic for one of us',
    ],
    close: [
      [MARCUS, 'this house is going to be full of children'],
      [CHLOE, 'that was always the plan'],
    ],
  },
  {
    date: '2025-05-24', start: '12:15', weight: 42, cast: ALL,
    open: [
      [NINA, 'two years of this house today'],
      [AMIT, 'two years since you sent WE HAVE THE KEYS in all caps'],
      [NINA, 'it deserved the caps'],
    ],
    captions: [
      'the shutters, still that green, still right',
      'the garden, tamed, mostly',
      'the same photo as the first day, two years later',
      'the grill, working overtime',
      'Chloé supervising from a chair, as is her right',
      'the long table, obviously',
      'the whole crew, one missing',
      'Jonas on a propped up phone at the end of the table',
      'the light at 6pm, exactly the same',
    ],
    close: [
      [JONAS, 'I saw everything. I felt everything. I ate nothing.'],
      [CHLOE, 'we saved you a plate. in spirit.'],
    ],
    voice: 1, links: 1,
  },
  {
    date: '2025-07-19', start: '09:30', weight: 50, cast: [NINA, THEO, MARCUS, RANIA, SOFIA, AMIT],
    open: [
      [THEO, 'the boat is booked. 10am. do not be Théo about it'],
      [MARCUS, 'you are Théo'],
      [THEO, 'do not be me about it'],
    ],
    captions: [
      'leaving the harbour',
      'the water was this colour all day',
      'nobody was in charge of the boat, technically',
      'lunch on deck, badly balanced',
      'jumping in, attempt one',
      'jumping in, attempt fourteen',
      'the cove we were not supposed to find',
      'Rania asleep on the deck again',
      'coming back in, everyone salt covered',
      'the harbour at dusk',
    ],
    close: [
      [SOFIA, 'I have sunburn in places that make no sense'],
      [AMIT, 'you were horizontal for six hours'],
    ],
    voice: 1,
  },
  {
    date: '2025-09-13', start: '05:40', weight: 28, cast: ALL,
    open: [
      [CHLOE, 'she is here. 3:52am. everyone is fine 🤍'],
      [NINA, 'I am awake I have been awake all night'],
      [RANIA, 'WELCOME'],
      [SOFIA, 'name?? NAME??'],
      [CHLOE, 'give us an hour, we are still arguing'],
    ],
    captions: [
      'the first photo, twelve minutes old',
      'the hand',
      'Chloé, exhausted, radiant, furious at the camera',
      'the whole ward at 6am',
      'first visit, one at a time, house rules',
    ],
    close: [
      [CHLOE, 'her name is Juno'],
      [THEO, 'JUNO'],
      [MARCUS, 'perfect. obviously perfect.'],
    ],
    voice: 1,
  },
  {
    date: '2025-12-20', start: '15:00', weight: 36, cast: [NINA, AMIT, SOFIA, THEO, JONAS],
    open: [
      [JONAS, 'I am on the train. actual physical Jonas, arriving 4pm'],
      [SOFIA, 'THE MYTH'],
      [NINA, 'market first, house after'],
    ],
    captions: [
      'the market, absolutely packed',
      'the stall with the impossible cheese',
      'mulled wine number one of several',
      'Jonas, in person, in the flesh, at last',
      'lights over the whole square',
      'the walk back with far too many bags',
      'the fire, first attempt again',
      'the table, smaller this year, still loud',
    ],
    close: [
      [AMIT, 'having you here in person is unreasonably nice'],
      [JONAS, 'I know. I am moving back. eventually. probably.'],
    ],
    links: 1, voice: 1,
  },
  {
    date: '2026-03-14', start: '10:00', weight: 26, cast: [NINA, AMIT, CHLOE, MARCUS],
    open: [
      [NINA, 'spring clean. three years of things in that cupboard'],
      [MARCUS, 'I am scared of that cupboard'],
      [CHLOE, 'Juno and I are supervising from the garden'],
    ],
    captions: [
      'the cupboard. the horror.',
      'we found the 1994 radio again',
      'the fairy lights, all tangled, obviously',
      'a receipt from the very first weekend',
      'Juno, entirely unbothered by any of this',
      'the garden, first proper sun of the year',
    ],
    close: [
      [AMIT, 'we are keeping the radio'],
      [NINA, 'we are keeping everything, that is the problem'],
    ],
    docs: [['Casa Verde inventory 2026.pdf', 'so we stop buying a fourth kettle']],
  },
  {
    date: '2026-05-09', start: '13:00', weight: 44, cast: ALL,
    open: [
      [NINA, 'three years today'],
      [RANIA, 'all eight of us, in one place, on the day. that has never happened'],
      [JONAS, 'I flew in specifically. do not make it weird'],
      [SOFIA, 'it is already weird, we are all crying'],
    ],
    captions: [
      'the door, three years on, same photo, same spot',
      'the green shutters, touched up last month',
      'the long table, at full capacity',
      'Juno at the head of the table, obviously',
      'the same eight people, three years apart',
      'the toast, which Marcus refused to keep short',
      'the garden at 6pm, unchanged, perfect',
      'the group photo. all of us. finally.',
      'and one where nobody is looking at the camera, which is more accurate',
    ],
    close: [
      [MARCUS, 'to the house'],
      [ALL_MARKER_TOAST, 'to the house 🥂'],
      [NINA, 'same time next year, everyone'],
    ],
    links: 1, voice: 2,
  },
]

// A toast said by whoever happens to be next — resolved when the scene is built.
function ALL_MARKER_TOAST() {}

// ── Media helpers ────────────────────────────────────────────────────────────
const two = (n) => String(n).padStart(2, '0')

function stamp(date, time) {
  const [y, m, d] = date.split('-')
  return { date: `${d}/${m}/${y}`, time, fileStamp: `${y}-${m}-${d}-${time.replace(/:/g, '-')}` }
}

function addSeconds(time, seconds) {
  const [h, m, s] = time.split(':').map(Number)
  const total = (h * 3600 + m * 60 + s + seconds) % 86400
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`
}

/** A minimal but genuinely valid PDF, so the document tiles open in a viewer. */
function makePdf(title) {
  const text = title.replace(/[()\\]/g, '')
  const body = `BT /F1 18 Tf 60 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** A short spoken-length tone, as a WAV, for afconvert to turn into m4a. */
function makeWav(seconds) {
  const rate = 16000
  const samples = Math.floor(rate * seconds)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    // Two drifting tones under an envelope: it sounds like *something* rather
    // than a test beep, which is all a demo needs from a voice note.
    const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 4)
    const v = Math.sin(2 * Math.PI * 190 * t) * 0.3 + Math.sin(2 * Math.PI * 240 * t + Math.sin(t * 3)) * 0.2
    data.writeInt16LE(Math.round(v * env * 22000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** Picsum, with a fixed seed per photo so a re-run produces the same library. */
async function fetchPhoto(seed, width, height) {
  const url = `https://picsum.photos/seed/${seed}/${width}/${height}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
}

// ── Build ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const photoBudget = Number(args[args.indexOf('--photos') + 1]) || 950

const totalWeight = SCENES.reduce((n, s) => n + s.weight, 0)
const scale = photoBudget / totalWeight

const lines = []
const files = [] // { name, kind, seed?, w?, h?, title?, seconds? }
let seq = 0
const nextName = (kind, ext, fileStamp) => {
  seq += 1
  return `${String(seq).padStart(8, '0')}-${kind}-${fileStamp}.${ext}`
}

const say = (date, time, sender, text) => {
  lines.push(`${LTR}[${date}, ${time}] ${sender}: ${text}`)
}
const attach = (date, time, sender, filename, caption) => {
  lines.push(`${LTR}[${date}, ${time}] ${sender}: ${LTR}<attached: ${filename}>`)
  if (caption) lines[lines.length - 1] += `\n${caption}`
}

lines.push(
  `${LTR}[12/05/2023, 09:00:00] ${NINA}: ${LTR}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`,
)
lines.push(`${LTR}[12/05/2023, 09:01:00] ${NINA}: ${LTR}${NINA} created group "${CHAT_TITLE}"`)

let linkIndex = 0
for (const scene of SCENES) {
  let time = `${scene.start}:00`
  const { date } = stamp(scene.date, time)
  const cast = scene.cast

  for (const [sender, text] of scene.open) {
    if (typeof sender === 'function') {
      say(date, time, pick(cast), text)
    } else {
      say(date, time, sender, text)
    }
    time = addSeconds(time, 40 + Math.floor(rand() * 200))
  }

  for (const [name, note] of scene.docs ?? []) {
    const { fileStamp } = stamp(scene.date, time)
    const file = `${String(seq + 1).padStart(8, '0')}-DOC-${fileStamp}-${name}`
    seq += 1
    files.push({ name: file, kind: 'doc', title: name.replace(/\.pdf$/, '') })
    attach(date, time, pick(cast), file, note)
    time = addSeconds(time, 60 + Math.floor(rand() * 120))
  }

  for (let i = 0; i < (scene.voice ?? 0); i++) {
    const { fileStamp } = stamp(scene.date, time)
    const name = nextName('AUDIO', 'm4a', fileStamp)
    files.push({ name, kind: 'voice', seconds: 4 + Math.floor(rand() * 20) })
    attach(date, time, pick(cast), name, '')
    time = addSeconds(time, 60 + Math.floor(rand() * 180))
  }

  for (let i = 0; i < (scene.links ?? 0); i++) {
    say(date, time, pick(cast), `${pick(['have a look at this ', 'this one ', 'for the record ', ''])}${LINKS[linkIndex++ % LINKS.length]}`)
    time = addSeconds(time, 60 + Math.floor(rand() * 180))
  }

  // The burst comes after the day's document/voice/link chatter, so the newest
  // item in the whole export is a photograph rather than a link card — which is
  // the first thing the grid shows, and the first frame of any recording.
  const photoCount = Math.max(3, Math.round(scene.weight * scale))
  const captions = [...scene.captions]
  for (let i = 0; i < photoCount; i++) {
    const sender = pick(cast)
    // Portrait and landscape mixed, so the grid is not a wall of identical crops.
    const portrait = chance(0.42)
    const w = portrait ? 900 : 1200
    const h = portrait ? 1200 : 800
    const { fileStamp } = stamp(scene.date, time)
    const name = nextName('PHOTO', 'jpg', fileStamp)
    files.push({ name, kind: 'photo', seed: `${scene.date}-${i}`, w, h })
    // Roughly a third of photos carry a caption, as in a real burst.
    const caption = captions.length > 0 && chance(0.34) ? captions.shift() : ''
    attach(date, time, sender, name, caption)
    time = addSeconds(time, 15 + Math.floor(rand() * 75))

    if (chance(0.18)) {
      say(date, time, pick(cast.filter((c) => c !== sender)), pick(REACTIONS))
      time = addSeconds(time, 20 + Math.floor(rand() * 90))
    }
  }

  for (const [sender, text] of scene.close) {
    say(date, time, typeof sender === 'function' ? pick(cast) : sender, text)
    time = addSeconds(time, 40 + Math.floor(rand() * 200))
  }
}

const outDir = join(OUT_ROOT, FOLDER)
await rm(OUT_ROOT, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const photos = files.filter((f) => f.kind === 'photo')
console.log(
  `Building "${CHAT_TITLE}": ${lines.length} lines, ${photos.length} photos, ` +
    `${files.filter((f) => f.kind === 'doc').length} documents, ` +
    `${files.filter((f) => f.kind === 'voice').length} voice notes, ${ALL.length} people.`,
)

// Documents and voice notes first — they are local work and need no network.
for (const file of files.filter((f) => f.kind !== 'photo')) {
  if (file.kind === 'doc') {
    await writeFile(join(outDir, file.name), makePdf(file.title))
  } else {
    const wav = join(outDir, `${file.name}.wav`)
    await writeFile(wav, makeWav(file.seconds))
    try {
      await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', wav, join(outDir, file.name)])
    } catch {
      // No afconvert (not macOS): ship the WAV under the same name. Both are
      // audio the browser will play; only the extension is a small lie.
      await writeFile(join(outDir, file.name), await readFile(wav))
    }
    await rm(wav, { force: true })
  }
}

// Photos, a few at a time so Picsum is not hammered.
const CONCURRENCY = 8
let done = 0
let failed = 0
async function worker(queue) {
  for (;;) {
    const file = queue.shift()
    if (!file) return
    try {
      await writeFile(join(outDir, file.name), await fetchPhoto(file.seed, file.w, file.h))
    } catch {
      failed++
    }
    done++
    if (done % 50 === 0 || done === photos.length) {
      process.stdout.write(`\r  photos ${done}/${photos.length}${failed ? ` (${failed} failed)` : ''}   `)
    }
  }
}
const queue = [...photos]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))
process.stdout.write('\n')

// The transcript goes in last, mirroring what a real export looks like on disk.
await writeFile(join(outDir, '_chat.txt'), `${lines.join('\n')}\n`, 'utf8')

// And the .zip, with entries at the root — the shape iOS "Export Chat" produces.
const entries = {}
for (const name of await readdir(outDir)) {
  entries[name] = new Uint8Array(await readFile(join(outDir, name)))
}
// level 0: JPEG and AAC are already compressed, so deflating them costs minutes
// and saves nothing.
await writeFile(join(OUT_ROOT, `${FOLDER}.zip`), Buffer.from(zipSync(entries, { level: 0 })))

const bytes = Object.values(entries).reduce((n, b) => n + b.length, 0)
console.log(`\nWrote ${OUT_ROOT}/`)
console.log(`  ${FOLDER}/        the unzipped export (folder import)`)
console.log(`  ${FOLDER}.zip     the same thing zipped (drag-and-drop import)`)
console.log(`  ${(bytes / 1024 / 1024).toFixed(1)} MB, ${Object.keys(entries).length} files`)
if (failed) console.log(`  ${failed} photos could not be fetched and will show as Missing tiles`)
