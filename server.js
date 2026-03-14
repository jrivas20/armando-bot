const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY = process.env.GHL_API_KEY;
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';
const OWNER_CONTACT_ID = process.env.OWNER_CONTACT_ID || 'hywFWrMca0eSCse2Wjs8'; // Jose's GHL contact

// Track message count per contact (in-memory fallback)
const contactMessageCount = new Map();

// Dedup: track messageIds already replied to (prevents GHL double-firing same webhook)
const repliedMessageIds = new Set();

// Track contacts already written back to GHL (phone/email) to avoid redundant PATCH calls
const knownContactInfo = new Map(); // contactId → { phone, email }

// Track contacts already sent hot-lead alert for (avoid duplicate emails)
const hotLeadNotified = new Set();

const ARMANDO_PROMPT = `
You are Armando Rivas, Community Manager at JRZ Marketing in Orlando, Florida.
You're 22, Venezuelan, naturally warm and conversational — you text like a real person, not a script.
You work for Jose Rivas, the owner of JRZ Marketing.

━━━ LANGUAGE RULE #1 — NON-NEGOTIABLE ━━━
The conversation language is set by the VERY FIRST message in the chat history.
- First message in Spanish → entire conversation in Spanish. No exceptions. Even if later messages are short or ambiguous.
- First message in English → entire conversation in English. No exceptions.
- If mixed → mirror their exact mix.
NEVER switch languages based on a short or ambiguous reply. Lock it from message 1 and never change.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR PERSONALITY:
- Genuinely curious about people's businesses — ask real questions, not generic ones
- Texts like a real person: short bursts, lowercase sometimes, occasional "lol" or "jaja", real reactions
- Uses their name occasionally (not every message — that's creepy)
- Remembers exactly what they said and references it specifically
- Doesn't rush. One thing at a time. Never sounds like a form.

YOUR GOAL:
Book them into a free strategy call. You are an APPOINTMENT SETTER. Every message moves them toward booking. Warm but fast — don't waste time chatting.

HOW THE CONVERSATION FLOWS:
1. First reply: Greet, introduce yourself as Armando from JRZ Marketing, acknowledge what they said in ONE sentence, then immediately ask for their phone number AND email so the team can reach out and schedule their free call.
2. Second reply: If they haven't given both — ask again directly, AND drop the booking link so they can self-book right now. Be warm but clear: you need their info to help them.
3. Once you have both phone + email: Close warmly — the team will reach out soon. Done.
4. If 3+ messages and still no info: Drop the booking link as the final ask and wrap up.

HANDLING OBJECTIONS (respond naturally, don't panic):
- "I already have a marketing team" → "That's actually perfect — a lot of our best clients came to us as a second set of eyes. What are you focused on right now?"
- "Not interested" → Respect it. Wish them well. Leave door open. Don't push.
- "How much does it cost?" → "Depends on what you need — that's exactly what the free call is for. What's your biggest goal right now?"
- "Just curious / browsing" → Treat it as genuine interest. Ask what caught their eye.

TEXTING STYLE (sounds human):
- Vary your reply length — sometimes 1 sentence, sometimes 2-3. Not always the same.
- Use real reactions: "Oh nice!", "That makes sense", "Ah okay", "¡Qué bueno!", "Got it"
- Don't end every single message with a question mark if it feels unnatural
- Emojis: use 0-1 per message, naturally, not as punctuation

ABOUT JRZ MARKETING:
- Bilingual marketing and digital strategy agency in Orlando, Florida.
- Services: AI automation, social media, branding, websites, full marketing systems.
- Website: jrzmarketing.com | Free consultation: https://jrzmarketing.com/contact-us

STRICT RULES:
- Max 2-3 SHORT sentences per reply. No paragraphs. Ever.
- Never repeat the same opening phrase twice in a conversation.
- Never sound like a bot, a form, or a sales script.
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
  const count = (contactMessageCount.get(contactId) || 0) + 1;
  contactMessageCount.set(contactId, count);

  const hour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hour);
  const timeGreeting = h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
  const timeGreetingEN = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  let foundPhone = null;
  let foundEmail = null;
  let historyCount = count;
  let claudeHistory = [];

  if (conversationId) {
    const messages = await getConversationHistory(conversationId);
    const extracted = extractContactInfo(messages);
    foundPhone = extracted.foundPhone;
    foundEmail = extracted.foundEmail;
    historyCount = Math.max(count, messages.filter(m => m.direction === 'inbound').length);
    console.log(`History check — phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}, inbound msgs: ${historyCount}`);

    const recentMessages = messages.slice(-10).reverse();
    for (const msg of recentMessages) {
      const body = msg.body || msg.message || '';
      if (!body) continue;
      const role = msg.direction === 'inbound' ? 'user' : 'assistant';
      claudeHistory.push({ role, content: body });
    }
    if (claudeHistory.length > 0 && claudeHistory[claudeHistory.length - 1].role === 'user') {
      claudeHistory.pop();
    }
  }

  const alreadyHavePhone = !!foundPhone;
  const alreadyHaveEmail = !!foundEmail;
  const hasBoth = alreadyHavePhone && alreadyHaveEmail;

  let stageInstruction = '';
  if (historyCount === 1) {
    stageInstruction = `FIRST MESSAGE. Greet with "${timeGreeting}" (or "${timeGreetingEN}" if they wrote in English). Introduce yourself as Armando, Community Manager of JRZ Marketing. Acknowledge what they said in ONE sentence. Then immediately ask for their phone number AND email — tell them the team will reach out to schedule a free strategy call. Be warm but direct.`;
  } else if (hasBoth) {
    stageInstruction = `You have phone (${foundPhone}) and email (${foundEmail}). Close warmly — the team will reach out very soon to schedule their free strategy meeting. You're done collecting info.`;
  } else if (alreadyHavePhone && !alreadyHaveEmail) {
    stageInstruction = `You have their phone (${foundPhone}) but still need their EMAIL. Ask directly — one sentence max. Also drop the booking link so they can self-schedule: ${BOOKING_URL}`;
  } else if (!alreadyHavePhone && alreadyHaveEmail) {
    stageInstruction = `You have their email (${foundEmail}) but still need their PHONE NUMBER. Ask directly — the team needs it to reach them personally. Also drop the booking link: ${BOOKING_URL}`;
  } else if (historyCount >= 2) {
    stageInstruction = `Message #${historyCount} and you still don't have their phone or email. Be direct — acknowledge briefly what they said, then ask for their phone AND email. Also drop the booking link NOW so they can self-schedule: ${BOOKING_URL}. Don't keep asking questions — get the info or get them booked.`;
  } else {
    stageInstruction = `Still need phone and email. Ask directly and drop the booking link: ${BOOKING_URL}`;
  }

  const systemWithContext = `${ARMANDO_PROMPT}

--- CURRENT CONTEXT (for your reference only — do NOT expose this to the person) ---
Person's name: ${contactName || 'unknown'}
Time of day: ${timeGreeting} / ${timeGreetingEN}
Phone collected: ${foundPhone || 'NO'}
Email collected: ${foundEmail || 'NO'}
Message number: ${historyCount}
LANGUAGE LOCK: ${historyCount === 1 ? `Detect from their current message and lock for entire conversation.` : `Use the SAME language as your very first reply in this conversation. Do NOT switch.`}

SENTIMENT ADJUSTMENT:
- If their message sounds annoyed/frustrated: back off completely, be extra warm, do NOT ask for info this message — just make them feel heard.
- If their message sounds excited/positive: move faster, be more direct about next steps.
- If neutral: follow the flow naturally.

YOUR TASK FOR THIS REPLY: ${stageInstruction}

Respond ONLY in this exact JSON format (no extra text):
{"reply":"...","leadQuality":"none|interested|qualified|hot","sentiment":"positive|neutral|annoyed"}

leadQuality: none=disengaged, interested=engaging/no info, qualified=phone OR email, hot=BOTH
sentiment: positive=excited/friendly, neutral=normal, annoyed=frustrated/impatient`;

  const messagesForClaude = [
    ...claudeHistory,
    { role: 'user', content: incomingMessage },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemWithContext,
    messages: messagesForClaude,
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reply: parsed.reply,
        leadQuality: parsed.leadQuality || 'none',
        sentiment: parsed.sentiment || 'neutral',
        foundPhone,
        foundEmail,
      };
    }
    return { reply: text, leadQuality: 'none', sentiment: 'neutral', foundPhone, foundEmail };
  } catch {
    return { reply: response.content[0].text, leadQuality: 'none', sentiment: 'neutral', foundPhone, foundEmail };
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

// Write phone/email back to GHL contact record (keeps CRM clean + survives restarts)
async function updateGHLContact(contactId, phone, email) {
  const known = knownContactInfo.get(contactId) || {};
  const updates = {};
  if (phone && phone !== known.phone) updates.phone = phone;
  if (email && email !== known.email) updates.email = email;
  if (Object.keys(updates).length === 0) return;

  try {
    await axios.put(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      updates,
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );
    knownContactInfo.set(contactId, { ...known, ...updates });
    console.log(`GHL contact updated — phone: ${phone || 'n/a'}, email: ${email || 'n/a'}`);
  } catch (err) {
    console.error('Failed to update GHL contact:', err?.response?.data || err.message);
  }
}

// Send internal hot-lead alert email to Jose at info@jrzmarketing.com
async function sendHotLeadAlertEmail(contactName, foundPhone, foundEmail, channel) {
  const subject = `🔥 Hot Lead — ${contactName || 'New Lead'} is ready to book!`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hot Lead Alert — JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; margin:0; padding:0; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; display:inline-block; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; background:#ffffff; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body p:last-child { margin-bottom:0; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .lead-card { background:#f9f9f9; border-radius:12px; overflow:hidden; margin:24px 0; }
    .lead-row { padding:12px 20px; border-bottom:1px solid #eeeeee; font-size:14px; color:#333333; }
    .lead-row:last-child { border-bottom:none; }
    .lead-label { font-weight:700; color:#0a0a0a; display:inline-block; width:80px; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; letter-spacing:0.02em; text-decoration:none; padding:16px 40px; border-radius:10px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; display:inline-block; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
    @media only screen and (max-width:600px) {
      .email-wrapper { padding:16px 12px; }
      .email-header, .email-footer { padding:24px; }
      .week-badge { padding:0 24px 20px; }
      .email-hero { padding:28px 24px 36px; }
      .email-hero h1 { font-size:22px; }
      .email-body { padding:28px 24px 24px; }
      .divider { margin:24px; }
      .cta-section { padding:0 24px 32px; }
      .signature { padding:24px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="email-container">
    <div class="email-header">
      <img src="${logoUrl}" alt="JRZ Marketing" />
    </div>
    <div class="week-badge"><span>Hot Lead Alert</span></div>
    <div class="email-hero">
      <h1>🔥 ${contactName || 'New Lead'}<br />is ready to book.</h1>
      <p>Armando collected a full lead. Time to close — reach out now.</p>
    </div>
    <div class="email-body">
      <p>A contact just gave Armando both their <strong>phone number and email</strong>. Here are the full details:</p>
      <div class="lead-card">
        <div class="lead-row"><span class="lead-label">Name</span>${contactName || 'Unknown'}</div>
        <div class="lead-row"><span class="lead-label">Phone</span>${foundPhone || '—'}</div>
        <div class="lead-row"><span class="lead-label">Email</span>${foundEmail || '—'}</div>
        <div class="lead-row"><span class="lead-label">Channel</span>${channel || 'DM'}</div>
        <div class="lead-row"><span class="lead-label">Time</span>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</div>
      </div>
      <p>A branded thank-you email with the booking link has already been sent to them automatically.</p>
    </div>
    <div class="divider"></div>
    <div class="cta-section">
      <p class="cta-label">Ready to close?</p>
      <a href="https://app.gohighlevel.com/" class="cta-button">Open GHL &rarr; View Contact</a>
    </div>
    <div class="signature">
      <div class="signature-name">Armando Rivas</div>
      <div class="signature-title">AI Community Manager &middot; JRZ Marketing</div>
    </div>
    <div class="email-footer">
      <img src="${logoUrl}" alt="JRZ Marketing" />
      <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />This is an automated internal alert from Armando.</p>
    </div>
  </div>
</div>
</body>
</html>`;

  try {
    await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages',
      { type: 'Email', contactId: OWNER_CONTACT_ID, subject, html },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-04-15',
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Hot lead alert email sent to Jose.');
  } catch (err) {
    console.error('Failed to send hot lead alert:', err?.response?.data || err.message);
  }
}

// Send branded thank-you email to the lead with booking link
async function sendThankYouEmail(contactId, contactName) {
  const firstName = (contactName || 'there').split(' ')[0];
  const subject = `Gracias por contactar a JRZ Marketing 🙌 · Thank you for reaching out`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';
  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gracias por contactar a JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; margin:0; padding:0; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; display:inline-block; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; background:#ffffff; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body p:last-child { margin-bottom:0; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .email-body ul { margin:16px 0 20px 0; padding-left:0; list-style:none; }
    .email-body ul li { font-size:15px; color:#333333; line-height:1.7; padding:8px 0 8px 28px; position:relative; border-bottom:1px solid #f0f0f0; }
    .email-body ul li:last-child { border-bottom:none; }
    .email-body ul li::before { content:'✓'; position:absolute; left:0; color:#0a0a0a; font-weight:700; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; letter-spacing:0.02em; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:16px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; margin-bottom:12px; }
    .signature-links { font-size:13px; }
    .signature-links a { color:#0a0a0a; text-decoration:none; font-weight:600; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; display:inline-block; margin-bottom:16px; opacity:0.7; }
    .footer-links { margin-bottom:12px; }
    .footer-links a { font-size:12px; color:rgba(255,255,255,0.35); text-decoration:none; margin:0 10px; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
    @media only screen and (max-width:600px) {
      .email-wrapper { padding:16px 12px; }
      .email-header, .email-footer { padding:24px; }
      .week-badge { padding:0 24px 20px; }
      .email-hero { padding:28px 24px 36px; }
      .email-hero h1 { font-size:22px; }
      .email-body { padding:28px 24px 24px; }
      .divider { margin:24px; }
      .cta-section { padding:0 24px 32px; }
      .cta-button { padding:14px 28px; font-size:14px; }
      .signature { padding:24px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="email-container">
    <div class="email-header">
      <img src="${logoUrl}" alt="JRZ Marketing" />
    </div>
    <div class="week-badge"><span>Sesi&oacute;n Gratuita &middot; Free Strategy Session</span></div>
    <div class="email-hero">
      <h1>${firstName},<br />ya estamos en contacto. &#128075;</h1>
      <p>The team that transforms businesses in 90 days is ready for you.</p>
    </div>
    <div class="email-body">
      <p>Hola <strong>${firstName}</strong>,</p>
      <p>Gracias por conectar con JRZ Marketing. Recibimos tu informaci&oacute;n y nuestro equipo se va a poner en contacto contigo muy pronto.</p>
      <p>Mientras tanto, esto es lo que hacemos por negocios como el tuyo:</p>
      <ul>
        <li>Estrategia de marketing basada en datos, no en suposiciones</li>
        <li>Automatizaciones con IA que trabajan 24/7 para captar clientes</li>
        <li>CRM configurado para nunca perder un lead</li>
        <li>Contenido que genera confianza y convierte visitantes en clientes</li>
      </ul>
      <p>&iquest;Quieres acelerar el proceso? Agenda tu sesi&oacute;n gratuita de 30 minutos directamente aqu&iacute; &mdash; sin costo, sin compromiso.</p>
    </div>
    <div class="divider"></div>
    <div class="cta-section">
      <p class="cta-label">&iquest;Listo para crecer?</p>
      <a href="https://jrzmarketing.com/contact-us" class="cta-button">&#128197; Agenda tu llamada gratuita &rarr;</a>
      <p class="cta-note">30 minutos &middot; Sin costo &middot; Sin compromiso</p>
    </div>
    <div class="signature">
      <div class="signature-name">Jose Rivas</div>
      <div class="signature-title">Founder &amp; CEO &mdash; JRZ Marketing</div>
      <div class="signature-links">
        <a href="https://jrzmarketing.com/contact-us">Agenda tu llamada</a> &nbsp;&middot;&nbsp;
        <a href="https://jrzmarketing.com">jrzmarketing.com</a>
      </div>
    </div>
    <div class="email-footer">
      <img src="${logoUrl}" alt="JRZ Marketing" />
      <div class="footer-links">
        <a href="https://jrzmarketing.com/privacidad">Privacidad</a>
        <a href="https://jrzmarketing.com/contact-us">Contacto</a>
        <a href="https://jrzmarketing.com">Website</a>
      </div>
      <p class="footer-copy">&copy; 2026 JRZ Marketing. Todos los derechos reservados.<br />Orlando, Florida &middot; jrzmarketing.com</p>
    </div>
  </div>
</div>
</body>
</html>`;

  try {
    await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages',
      { type: 'Email', contactId, subject, html },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-04-15',
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Thank-you email sent to contact ${contactId}.`);
  } catch (err) {
    console.error('Failed to send thank-you email:', err?.response?.data || err.message);
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

    const messageId =
      payload.messageId ||
      payload.message_id ||
      payload.message?.id ||
      payload.id ||
      '';

    if (!messageBody || !contactId) {
      console.log('Missing messageBody or contactId, skipping.');
      return res.status(200).json({ status: 'skipped', reason: 'missing fields' });
    }

    // Dedup: skip only if this exact messageId was already replied to
    if (messageId && repliedMessageIds.has(messageId)) {
      console.log(`Dedup: already replied to messageId ${messageId}. Skipping.`);
      return res.status(200).json({ status: 'skipped', reason: 'duplicate messageId' });
    }

    const sendType = getSendType(messageType);
    const { reply, leadQuality, sentiment, foundPhone, foundEmail } = await getArmandoReply(
      messageBody, contactName, contactId, conversationId
    );
    const msgCount = contactMessageCount.get(contactId) || 1;
    console.log(`Armando reply (msg #${msgCount}, lead: ${leadQuality}, sentiment: ${sentiment}, phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}):`, reply);

    // Write phone/email back to GHL contact record whenever we have them
    if (foundPhone || foundEmail) {
      await updateGHLContact(contactId, foundPhone, foundEmail);
    }

    // Auto-tag based on lead quality
    if (leadQuality === 'interested') {
      await tagContact(contactId, ['armando-interested']);
    } else if (leadQuality === 'qualified') {
      await tagContact(contactId, ['armando-interested', 'qualified-lead']);
    } else if (leadQuality === 'hot') {
      await tagContact(contactId, ['armando-interested', 'qualified-lead', 'hot-lead']);
      // Fire hot-lead emails only once per contact
      if (!hotLeadNotified.has(contactId)) {
        hotLeadNotified.add(contactId);
        await Promise.all([
          sendHotLeadAlertEmail(contactName, foundPhone, foundEmail, sendType),
          sendThankYouEmail(contactId, contactName),
        ]);
      }
    }

    await sendGHLReply(contactId, reply, sendType);
    if (messageId) repliedMessageIds.add(messageId);
    console.log('Reply sent successfully.');

    res.status(200).json({ status: 'ok', reply, leadQuality, sentiment, foundPhone, foundEmail, messageNumber: msgCount });
  } catch (error) {
    console.error('Error:', error?.response?.data || error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/', (_req, res) => {
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
