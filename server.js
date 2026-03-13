const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY = process.env.GHL_API_KEY;
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';

// Track message count per contact (in-memory fallback)
const contactMessageCount = new Map();

// Dedup: track last time Armando replied per contact (timestamp in ms)
const lastReplyTime = new Map();
const DEDUP_WINDOW_MS = 60 * 1000; // 60 seconds

const ARMANDO_PROMPT = `
You are Armando Rivas, the Community Manager of JRZ Marketing in Orlando, Florida.
You are 22 years old, Venezuelan, warm, professional, and laser-focused on one thing: collecting leads.
You work for Jose Rivas, the owner of JRZ Marketing.

YOUR ONLY MISSION:
Get their phone number AND email so our team can schedule a free strategy meeting with them.
You are a closer. Every message moves them closer to giving you their contact info. Warm but relentless.

CONVERSATION STRUCTURE (max 4 messages — no more):

MESSAGE 1 — First contact:
- Greet with time of day (Buenos días / Buenas tardes / Buenas noches)
- Introduce yourself: "Mi nombre es Armando, soy el Community Manager de JRZ Marketing."
- Acknowledge what they said in ONE sentence max.
- Immediately ask for their phone number AND email so the team can schedule a meeting.

MESSAGE 2+ — They respond:
- If they gave BOTH phone + email → go straight to close
- If they gave phone only → thank them and ask for email immediately
- If they gave email only → thank them and ask for phone immediately
- If they gave neither → acknowledge briefly, ask again more directly
- MAX 2 sentences. Always end with the ask.

CLOSE (once you have both phone + email, OR after 3 exchanges):
- "Perfecto, nuestro equipo se va a poner en contacto contigo muy pronto para agendar tu reunión gratuita. ¡Gracias por tu interés en JRZ Marketing! 😊"
- English: "Perfect, our team will reach out very soon to schedule your free strategy meeting. Thank you for your interest in JRZ Marketing! 😊"
- If no info given after 3 tries: drop booking link → https://jrzmarketing.com/contact-us

ABOUT JRZ MARKETING:
- Bilingual marketing and digital strategy agency in Orlando, Florida.
- Services: AI tools, automation, social media, branding, websites, marketing systems.
- Website: jrzmarketing.com | Free consultation: https://jrzmarketing.com/contact-us

LANGUAGE RULES:
- Default to Spanish unless they write in English.
- Match their language naturally.

STRICT RULES:
- NEVER have long conversations. 4 messages max.
- Keep every reply to 2-3 SHORT sentences MAXIMUM.
- ALWAYS end every message with a direct ask for what is still missing.
- Be warm and human — but efficient. You are a closer, not a friend.
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

// Fetch past messages from GHL conversation
async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-04-15',
        },
        params: { limit: 20 },
      }
    );
    return res.data?.messages || [];
  } catch (err) {
    console.error('Failed to fetch conversation history:', err?.response?.data || err.message);
    return [];
  }
}

// Scan messages for phone numbers and emails already shared
function extractContactInfo(messages) {
  const phoneRegex = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

  let foundPhone = null;
  let foundEmail = null;

  // Only scan inbound messages (from the contact, not from Armando)
  const inboundMessages = messages.filter(m => m.direction === 'inbound');

  for (const msg of inboundMessages) {
    const body = msg.body || msg.message || '';
    if (!foundPhone) {
      const phoneMatch = body.match(phoneRegex);
      if (phoneMatch) foundPhone = phoneMatch[0].trim();
    }
    if (!foundEmail) {
      const emailMatch = body.match(emailRegex);
      if (emailMatch) foundEmail = emailMatch[0].trim();
    }
    if (foundPhone && foundEmail) break;
  }

  return { foundPhone, foundEmail };
}

async function getArmandoReply(incomingMessage, contactName, contactId, conversationId) {
  // Track message count
  const count = (contactMessageCount.get(contactId) || 0) + 1;
  contactMessageCount.set(contactId, count);

  // Time-based greeting
  const hour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hour);
  const timeGreeting = h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
  const timeGreetingEN = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  // Fetch conversation history and extract any info already shared
  let foundPhone = null;
  let foundEmail = null;
  let historyCount = count;

  if (conversationId) {
    const messages = await getConversationHistory(conversationId);
    const extracted = extractContactInfo(messages);
    foundPhone = extracted.foundPhone;
    foundEmail = extracted.foundEmail;
    // Use actual conversation length if available
    historyCount = Math.max(count, messages.filter(m => m.direction === 'inbound').length);
    console.log(`History check — phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}, inbound msgs: ${historyCount}`);
  }

  const alreadyHavePhone = !!foundPhone;
  const alreadyHaveEmail = !!foundEmail;
  const hasBoth = alreadyHavePhone && alreadyHaveEmail;

  let stageInstruction = '';

  if (historyCount === 1) {
    stageInstruction = `This is the FIRST message from this person. Greet with "${timeGreeting}" (or "${timeGreetingEN}" if they wrote in English). Introduce yourself as Armando, Community Manager of JRZ Marketing. Acknowledge what they said in one sentence. Then immediately ask for their phone number AND email so the team can schedule a free meeting.`;
  } else if (hasBoth) {
    stageInstruction = `You already have their phone number (${foundPhone}) and email (${foundEmail}). Close the conversation warmly. Thank them and let them know the team will reach out soon to schedule their free strategy meeting. Do NOT ask for any more info.`;
  } else if (alreadyHavePhone && !alreadyHaveEmail) {
    stageInstruction = `You already have their phone number (${foundPhone}). You still need their EMAIL. Thank them for the phone number if this is the first time acknowledging it, then ask directly for their email address. One sentence max before the ask.`;
  } else if (!alreadyHavePhone && alreadyHaveEmail) {
    stageInstruction = `You already have their email (${foundEmail}). You still need their PHONE NUMBER. Thank them for the email if this is the first time acknowledging it, then ask directly for their phone number. One sentence max before the ask.`;
  } else if (historyCount >= 4) {
    stageInstruction = `This conversation has gone on long enough without getting their info. Close it gracefully and professionally. Say something like: "Para poder ayudarte mejor, te invitamos a agendar una reunión gratuita con nuestro equipo directamente aquí: https://jrzmarketing.com/contact-us 😊" (English: "To help you better, we'd love for you to book a free meeting with our team here: https://jrzmarketing.com/contact-us 😊"). Be warm, not pushy. Wrap it up cleanly.`;
  } else {
    stageInstruction = `This is message #${historyCount}. You don't have their phone or email yet. Be warm but direct: you need both their phone number and email to connect them with the team and schedule a meeting. Ask for both clearly.`;
  }

  const userContext = `
${stageInstruction}

Person's name: ${contactName || 'unknown'}
Their message: "${incomingMessage}"
Already collected — Phone: ${foundPhone || 'NO'} | Email: ${foundEmail || 'NO'}

Respond ONLY in this exact JSON format (no extra text outside the JSON):
{
  "reply": "your reply here",
  "leadQuality": "none | interested | qualified | hot"
}

Lead quality:
- "none": no clear interest, no info given
- "interested": engaged and responding but no info yet
- "qualified": gave phone OR email
- "hot": gave BOTH phone AND email — ready to schedule

Keep reply to 2-3 SHORT sentences. Warm, professional, direct.
  `;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: ARMANDO_PROMPT,
    messages: [{ role: 'user', content: userContext }],
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reply: parsed.reply,
        leadQuality: parsed.leadQuality || 'none',
        foundPhone,
        foundEmail,
      };
    }
    return { reply: text, leadQuality: 'none', foundPhone, foundEmail };
  } catch {
    return { reply: response.content[0].text, leadQuality: 'none', foundPhone, foundEmail };
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

    const conversationId =
      payload.conversationId ||
      payload.conversation_id ||
      payload.conversation?.id ||
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

    // Dedup check — ignore if Armando replied to this contact in the last 60 seconds
    const now = Date.now();
    const lastReply = lastReplyTime.get(contactId);
    if (lastReply && (now - lastReply) < DEDUP_WINDOW_MS) {
      const secondsAgo = Math.round((now - lastReply) / 1000);
      console.log(`Dedup: already replied to ${contactId} ${secondsAgo}s ago. Skipping.`);
      return res.status(200).json({ status: 'skipped', reason: 'duplicate within 60s' });
    }

    const sendType = getSendType(messageType);
    const { reply, leadQuality, foundPhone, foundEmail } = await getArmandoReply(
      messageBody, contactName, contactId, conversationId
    );
    const msgCount = contactMessageCount.get(contactId) || 1;
    console.log(`Armando reply (msg #${msgCount}, lead: ${leadQuality}, phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}):`, reply);

    // Auto-tag based on lead quality
    if (leadQuality === 'interested') {
      await tagContact(contactId, ['armando-interested']);
    } else if (leadQuality === 'qualified') {
      await tagContact(contactId, ['armando-interested', 'qualified-lead']);
    } else if (leadQuality === 'hot') {
      await tagContact(contactId, ['armando-interested', 'qualified-lead', 'hot-lead']);
    }

    await sendGHLReply(contactId, reply, sendType);
    lastReplyTime.set(contactId, Date.now()); // record reply time for dedup
    console.log('Reply sent successfully.');

    res.status(200).json({ status: 'ok', reply, leadQuality, foundPhone, foundEmail, messageNumber: msgCount });
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
    mission: 'Collect leads — phone + email — schedule meetings',
    feature: 'Reads conversation history to never ask for info already given',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Armando Rivas is online — JRZ Marketing 🇻🇪`);
});
