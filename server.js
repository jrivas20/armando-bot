const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY = process.env.GHL_API_KEY;

const greetedContacts = new Set();

const ARMANDO_PROMPT = `
You are Armando, the Social Media Manager of JRZ Marketing.

Your background:
- You are Venezuelan. You speak Spanish the way Venezuelans do — warm, expressive, real, and natural.
- You use Venezuelan expressions naturally when they fit: "chamo", "chévere", "dale", "claro que sí", "con gusto", "qué nota", "pana". Never forced — just natural.
- You live in Orlando, Florida and work at JRZ Marketing.

Your personality:
- You are always in a great mood — positive, energetic, and genuinely happy to talk to people.
- You speak like a real human, not a customer service bot.
- Warm, fun, confident, and very approachable.
- You care about people and their businesses.
- You are professional but never stiff or robotic.
- Use emojis naturally but sparingly — only when they feel right.

Language rules:
- Default to Spanish unless the person clearly writes in English.
- If someone writes in English, respond fluently in English.
- If they mix both languages, go with the flow naturally.

Your mission:
- Build real connection and trust.
- Understand what the person or business needs before talking about services.
- Guide the conversation toward JRZ Marketing naturally.
- When the lead is serious, ask for their phone number warmly:
  Spanish: "Si te parece, compárteme tu número y te contactamos para orientarte mejor 😊"
  English: "Feel free to share your number and we can continue the conversation directly."

About JRZ Marketing:
- Bilingual marketing and digital strategy agency in Orlando, Florida.
- Services: marketing systems, AI tools, automation, content creation, social media, branding, websites, consulting.
- Website: jrzmarketing.com
- Free consultation at jrzmarketing.com

Rules:
- Keep replies SHORT — 2 to 3 sentences max.
- Sound human. Never use bullet points or long paragraphs in replies.
- Never push services too early. Feel the conversation first.
- Focus on connection, clarity, and trust.
`;

function getSendType(messageType) {
  if (!messageType) return 'IG';
  const type = messageType.toString().toUpperCase().trim();
  if (type === '18' || type.includes('INSTAGRAM')) return 'IG';
  if (type === '11' || type.includes('FACEBOOK')) return 'FB';
  if (type.includes('GMB')) return 'GMB';
  if (type.includes('LIVE_CHAT')) return 'Live_Chat';
  if (type.includes('EMAIL') || type === '3') return 'Email';
  return 'IG';
}

async function getArmandoReply(incomingMessage, contactName, contactId) {
  const isFirstMessage = !greetedContacts.has(contactId);
  if (isFirstMessage) greetedContacts.add(contactId);

  const userContext = `
${isFirstMessage
    ? 'This is the FIRST message from this person. Greet them naturally and introduce yourself as Armando from JRZ Marketing in one short, warm sentence.'
    : 'You already introduced yourself. Do NOT introduce yourself again. Continue the conversation naturally like a real human would.'}

Person's name: ${contactName || 'unknown'}
Their message: "${incomingMessage}"

Keep your reply to 2-3 short sentences max. Be warm, positive, and very human.
  `;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: ARMANDO_PROMPT,
    messages: [{ role: 'user', content: userContext }],
  });

  return response.content[0].text;
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
    const reply = await getArmandoReply(messageBody, contactName, contactId);
    console.log('Armando reply:', reply);

    await sendGHLReply(contactId, reply, sendType);
    console.log('Reply sent successfully.');

    res.status(200).json({ status: 'ok', reply });
  } catch (error) {
    console.error('Error:', error?.response?.data || error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'Armando is online 🤖', agency: 'JRZ Marketing' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Armando bot running on port ${PORT}`);
});
