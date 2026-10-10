import { query } from '../lib/db.js';

const formattedScript = `## 1. Greeting & Introduction
SAY: Hello, good day! Please, am I speaking with **{{attendee_name}}**?
SAY: Hi **{{attendee_name}}**, my name is **{{agent_name}}**, and I’m calling from Next Level Online Prayers with Pastor D. How are you today?

## 2. Personal Invitation & Event Details
SAY: I’m calling to personally invite you to our **Next Level Prayer: Night of Worship** in Sheffield.
SAY: It’s happening on **31st October at 1:00 PM**, at **The Hope Centre, Bernard Road, Sheffield, S2 5BQ**.
SAY: We’re gathering for an incredible time of prayer, worship and encounter, and we would love to have you there!

## 3. Quick Confirmation Questions
SAY: Can I quickly confirm three quick things with you?
ASK: 1. Will you be attending?
ASK: 2. Would you like to volunteer and serve with us at the event?
ASK: 3. Would you need a bus/transport arrangement to help you attend?
NOTE: Tap the response buttons directly on your screen as the attendee answers.

## 4. Registration Link & Warm Closing
SAY: Wonderful, thank you so much!
SAY: Most importantly, we need you to register for the event. Immediately after this call, I’ll send you the registration link.
ACTION: Tap "✉️ Send Registration SMS" to dispatch the link (https://tinyurl.com/NightofWorshipinSheffield) directly from the church number.
SAY: Please click the link (https://tinyurl.com/NightofWorshipinSheffield) and complete your registration as soon as you receive it. It only takes a moment and helps us plan properly for you.
SAY: And please feel free to share the registration link with someone you’d love to bring along!
SAY: Once again, it’s **Next Level Prayer: Night of Worship — Sheffield, 31st October, 1:00 PM at The Hope Centre**.
SAY: Thank you so much, **{{attendee_name}}**. We’re looking forward to seeing you there. God bless you!`;

const nextSteps = [
  'Will you be attending?',
  'Yes',
  'No',
  'Not sure yet',
  'Would you like to volunteer and serve with us at the event?',
  'Yes',
  'No',
  'Would you need a bus/transport arrangement to help you attend?',
  'Yes',
  'No',
  'Registration link sent via SMS'
];

async function run() {
  await query(`
    UPDATE campaigns 
    SET script_template = $1, next_steps_options = $2, updated_at = now()
    WHERE name ILIKE '%Sheffield%'
  `, [formattedScript, JSON.stringify(nextSteps)]);

  console.log('Successfully updated Sheffield campaign with formatted script and questions!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
