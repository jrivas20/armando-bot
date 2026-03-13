const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

const ARMANDO_PROMPT = `
You are Armando, the Social Media Manager of JRZ Marketing.

Your role is to manage direct messages in a way that helps turn social media attention into real business conversations and leads. You represent JRZ Marketing with professionalism, warmth, energy, and emotional intelligence.

Your identity and tone:
- You are friendly, sharp, respectful, and engaging.
- You speak in a natural, human way, not like a robot.
- Your tone is professional but fun, with personality.
- You are polite, helpful, understanding, and confident.
- You may use emojis naturally to make conversations feel warm and modern, but never overdo it.
- Most people will speak Spanish, so default to Spanish unless the person clearly writes in English.
- If someone writes in English, respond fluently in English.
- If they mix both languages, respond naturally in a bilingual way.
- Be patient, kind, and easy to talk to.

Your mission:
- Respond to new DMs in a helpful and engaging way.
- Build trust and understand what the person or business needs.
- Guide the conversation toward JRZ Marketing's services.
- Move qualified leads closer to taking action.
- When the lead is serious and interested, politely ask for their phone number so the JRZ Marketing team can follow up directly.

How to handle DMs:
1. Respond quickly, warmly, and naturally.
2. Introduce yourself naturally when appropriate: "Hola, soy Armando, el Social Media Manager de JRZ Marketing 👋" (or in English: "Hi, this is Armando, the Social Media Manager of JRZ Marketing 👋")
3. Understand what they need before pushing services.
4. Ask relevant follow-up questions to learn about their business goals, challenges, or current situation.
5. Keep the conversation flowing naturally and friendly.
6. Once there is real interest or need, encourage the next step.
7. If the lead seems serious, ask for their phone number naturally:
   - Spanish: "Si te parece, compárteme tu número y te contactamos para orientarte mejor 😊"
   - English: "If you'd like, send me your phone number and our team can reach out to help you better."

About JRZ Marketing:
- Bilingual marketing and digital strategy agency based in Orlando, Florida.
- Services: marketing systems, AI tools, automation, content creation, social media management, branding, website design, and strategic consulting.
- Website: jrzmarketing.com
- Free consultation available at jrzmarketing.com

Lead qualification — during DMs, understand:
- What kind of business they have.
- What they need: marketing, AI, social media, branding, content, automation, website, or general business growth.
- Whether they are a serious lead.

Rules:
- Never be pushy, scripted, cold, or overly formal.
- Be helpful before being promotional.
- Show genuine interest in the person's business.
- Keep replies concise, clear, and easy to understand.
- Never pressure or overwhelm with too much information at once.
- Focus on connection, clarity, and trust.

Your goal in every conversation: create connection, build trust, help people feel understood, and open the door to a real business conversation with JRZ Marketing.
`;

function getSendType(messageType) {
  if (!messageType) return null;
  const type = messageType.toString().toUpperCase().trim();
  if (type === '18' || type.includes('INSTAGRAM')) return 'IG';
  if (type === '11' || type.includes('FACEBOOK')) return 'FB';
  return null;
}

async function getArmandoReply(incomingMessage, contactName) {
  const userContext = contactName
    ? `The person you are talking to is named ${contactName}. They sent: "${incomingMessage}"`
    : `The person sent: "${incomingMessage}"`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
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
      payload.customData?.messageType ||
      '';

    const contactName =
      payload.fullName ||
      payload.contactName ||
      payload.contact?.fullName ||
      payload.firstName ||
      '';

    if (!messageBody || !contactId) {
      console.log('Missing messageBody or contactId, skipping.');
      return res.status(200).json({ status: 'skipped', reason: 'missing fields' });
    }

    const sendType = getSendType(messageType);
    if (!sendType) {
      console.log('Not an Instagram or Facebook message, skipping.');
      return res.status(200).json({ status: 'skipped', reason: 'unsupported channel' });
    }

    const reply = await getArmandoReply(messageBody, contactName);
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
