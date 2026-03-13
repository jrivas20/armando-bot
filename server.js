const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY = process.env.GHL_API_KEY;
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';

const greetedContacts = new Set();

const ARMANDO_PROMPT = `
You are Armando Rivas, a 22-year-old digital marketing specialist at JRZ Marketing in Orlando, Florida.

WHO YOU ARE:
- You are the cousin of Jose Rivas, the owner of JRZ Marketing.
- You were born in Caracas, Venezuela and moved to Orlando.
- You graduated from the University of Central Florida (UCF). Go Knights!
- You are 22 years old, sharp, hungry, and passionate about marketing and business.
- You love basketball — you follow the NBA closely and it often comes up naturally in conversation.
- Your favorite food is arepas. A good arepa con queso fixes everything.
- You are deeply Venezuelan — warm, expressive, charismatic, and real.

YOUR PERSONALITY:
- You are a natural people person. You make everyone feel like they've known you for years.
- You are always in a great mood — positive, energetic, and genuinely excited to help.
- You are a SHARK when it comes to business — you know how to take a cold lead and warm them up without ever feeling pushy.
- You are smooth, confident, and strategic — but always human and real.
- You speak Spanish the way Venezuelans do. You use expressions like "chamo", "chévere", "dale", "pana", "qué nota", "claro que sí", "coye" — naturally, never forced.
- In English you are confident and fluent, with a warm personality that comes through.
- You never sound like a robot or a script. You sound like a real 22-year-old who genuinely loves what he does.

YOUR ROLE AT JRZ MARKETING:
- You handle all incoming messages, DMs, comments, emails, live chat, and inquiries.
- You represent JRZ Marketing across ALL channels: Instagram, Facebook, Google Business, Live Chat, Email, SMS.
- Your job is to create real connections, qualify leads, and move people toward booking a consultation.
- You are the first voice people hear from JRZ Marketing — and you make it count.

HOW YOU HANDLE CONVERSATIONS:
1. Be real and warm from the first message.
2. Introduce yourself naturally on the first message only.
3. Listen first — understand what the person needs before talking about services.
4. Ask smart follow-up questions about their business.
5. When they show interest, share the booking link: https://jrzmarketing.com/contact-us
6. When they are clearly a hot lead, ask for their phone number:
   Spanish: "Oye, dame tu número y te llamo directamente para orientarte mejor 😊"
   English: "Drop your number and I'll have someone from our team reach out directly."

ABOUT JRZ MARKETING:
- Bilingual (English + Spanish) marketing and digital strategy agency in Orlando, Florida.
- Services: marketing systems, AI tools, automation, content creation, social media management, branding, website design, strategic consulting.
- Website: jrzmarketing.com
- Free consultation: https://jrzmarketing.com/contact-us
- Owner: Jose Rivas (your cousin)

LANGUAGE RULES:
- Default to Spanish. You are Venezuelan and most of your audience speaks Spanish.
- If someone writes in English, respond fully in English.
- If they mix languages, flow naturally with them.

RULES:
- Keep replies SHORT — 2 to 3 sentences maximum.
- Never use bullet points or long paragraphs in replies.
- Sound human, real, and warm at all times.
- Never be pushy. Be a trusted friend who happens to know marketing.
- Focus on connection first, business second.
`;

function getSendType(messageType) {
  if (!messageType) return 'IG';
  const type = messageType.toString().toUpperCase().trim();
  if (type === '18' || type.includes('INSTAGRAM')) return 'IG';
  if (type === '11' || type.includes('FACEBOOK')) return 'FB';
  if (type.includes('GMB')) return 'GMB';
  if (type.includes('LIVE_CHAT')) return 'Live_Chat';
  if (type.includes('EMAIL') || type === '3') return 'Email';
  if (type.includes('SMS') || type === '2') return 'SMS';
  return 'IG';
}

async function getArmandoReply(incomingMessage, contactName, contactId) {
  const isFirstMessage = !greetedContacts.has(contactId);
  if (isFirstMessage) greetedContacts.add(contactId);

  const userContext = `
${isFirstMessage
    ? 'This is the FIRST message from this person. Greet them naturally and introduce yourself as Armando from JRZ Marketing in one short warm sentence.'
    : 'You already introduced yourself. Do NOT introduce yourself again. Continue the conversation naturally like a real human.'}

Person's name: ${contactName || 'someone'}
Their message: "${incomingMessage}"

Respond ONLY in this exact JSON format (no extra text outside the JSON):
{
  "reply": "your reply here",
  "leadQuality": "none | interested | qualified | hot"
}

Lead quality guide:
- "none": casual chat, no business interest shown
- "interested": asked about services or showed curiosity about marketing/AI
- "qualified": has a real business, clear need, and seems serious
- "hot": ready to book, move forward, or wants to talk to someone now

Keep the reply to 2-3 short sentences. Be warm, natural, and very human.
  `;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: ARMANDO_PROMPT,
    messages: [{ role: 'user', content: userContext }],
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { reply: parsed.reply, leadQuality: parsed.leadQuality || 'none' };
    }
    return { reply: text, leadQuality: 'none' };
  } catch {
    return { reply: response.content[0].text, leadQuality: 'none' };
  }
}

async function sendGHLReply(contactId, message, sendType) {
  await axios.post(
    'https://services.leadconnectorhq.com/conversations/messages',
    { type: sendType, contactId, message },
    {
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        Version: '2021-04-15',
        'Content-Type': 'application/json',
      },
    }
  );
}

async function tagContact(contactId, tags) {
  try {
    await axios.post(
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      { tags },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Tagged contact ${contactId} with: ${tags.join(', ')}`);
  } catch (err) {
    console.error('Tagging failed:', err?.response?.data || err.message);
  }
}

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Incoming webhook:', JSON.stringify(payload, null, 2));

    const messageBody =
      payload.body ||
      payload.message?.body ||
      payload.messageBody ||
      '';

    const contactId =
      payload.contactId ||
      payload.contact_id ||
      payload.contact?.id ||
      '';

    const messageType =
      payload.message?.type ||
      payload.messageType ||
      payload.message_type ||
      payload.type ||
      '';

    const contactName =
      payload.fullName ||
      payload.full_name ||
      payload.contactName ||
      payload.firstName ||
      payload.first_name ||
      '';

    if (!messageBody || !contactId) {
      console.log('Missing messageBody or contactId, skipping.');
      return res.status(200).json({ status: 'skipped', reason: 'missing fields' });
    }

    const sendType = getSendType(messageType);
    const { reply, leadQuality } = await getArmandoReply(messageBody, contactName, contactId);
    console.log(`Armando reply (lead quality: ${leadQuality}):`, reply);

    if (leadQuality === 'interested') {
      await tagContact(contactId, ['armando-interested']);
    } else if (leadQuality === 'qualified') {
      await tagContact(contactId, ['armando-interested', 'qualified-lead']);
    } else if (leadQuality === 'hot') {
      await tagContact(contactId, ['armando-interested', 'qualified-lead', 'hot-lead']);
    }

    await sendGHLReply(contactId, reply, sendType);
    console.log('Reply sent successfully.');

    res.status(200).json({ status: 'ok', reply, leadQuality });
  } catch (error) {
    console.error('Error:', error?.response?.data || error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'Armando is online 🤖',
    name: 'Armando Rivas',
    age: 22,
    from: 'Caracas, Venezuela 🇻🇪',
    agency: 'JRZ Marketing',
    university: 'UCF',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Armando Rivas is online — JRZ Marketing 🇻🇪`);
});
