const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY = process.env.GHL_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY || 'dff54f64e9eb4087aa7c215a1c674644';
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';
const OWNER_CONTACT_ID = process.env.OWNER_CONTACT_ID || 'hywFWrMca0eSCse2Wjs8';

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA — ACCOUNT IDs & CONSTANTS
// ═══════════════════════════════════════════════════════════
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'd7iUPfamAaPlSBNj6IhT';
const GHL_USER_ID     = process.env.GHL_USER_ID     || 'ALHFH3LlHUg7V4GuSbop';

// ─── Blog constants ───────────────────────────────────────
const BLOG_ID        = 'BSFKLAs40udrWd6XM0Tw';
const BLOG_AUTHOR_ID = '69b556769166961ed4d1ce43';
const BLOG_CATEGORIES = {
  ai:         '69b5568a6704163c27f63acf',
  automation: '69b556980fecd748ab1e5260',
  marketing:  '69b556a40fecd79c4e1e52f2',
  business:   '69b556c30fecd71ad71e5485',
  ghl:        '69b556b49166960cf8d1d167',
};

const SOCIAL_ACCOUNTS = {
  instagram:    '69571d8023b2d14504f42a08_d7iUPfamAaPlSBNj6IhT_17841419446338150',
  facebook:     '69571d90f8b327442fd7c7ff_d7iUPfamAaPlSBNj6IhT_106416250738350_page',
  linkedinJose: '69571db227f36db5a4c941a7_d7iUPfamAaPlSBNj6IhT_rzdo30Vn11_profile',
  linkedinJRZ:  '69571db227f36db5a4c941a7_d7iUPfamAaPlSBNj6IhT_59796032_page',
  google:       '69571da123b2d16f33f435a2_d7iUPfamAaPlSBNj6IhT_9708635617980992827',
  youtube:      '69571dd027f36d280fc94983_d7iUPfamAaPlSBNj6IhT_UCz-cQ8MvL74r83op8SvuSHw_profile',
};

// Facebook, LinkedIn, YouTube, Google Business accept text-only posts
const TEXT_POST_ACCOUNTS = [
  SOCIAL_ACCOUNTS.facebook,
  SOCIAL_ACCOUNTS.linkedinJose,
  SOCIAL_ACCOUNTS.linkedinJRZ,
  SOCIAL_ACCOUNTS.youtube,
  SOCIAL_ACCOUNTS.google,
];

// Instagram carousel accounts — always posts with images
const INSTAGRAM_ACCOUNTS = [SOCIAL_ACCOUNTS.instagram];

// ─── Cloudinary Carousel Images — 7 days × 4 slides ────────────────────────
// URLs without version = always serve latest uploaded image (overwrite weekly)
// Mapping: JS getDay() 0=Sun → day7, 1=Mon → day1, ..., 6=Sat → day6
const CLOUDINARY_BASE = 'https://res.cloudinary.com/dbsuw1mfm/image/upload/jrz';
const CAROUSEL_IMAGES = {
  0: [ // Sunday
    `${CLOUDINARY_BASE}/day7_slide1.png`,
    `${CLOUDINARY_BASE}/day7_slide2.png`,
    `${CLOUDINARY_BASE}/day7_slide3.png`,
    `${CLOUDINARY_BASE}/day7_slide4.png`,
  ],
  1: [ // Monday
    `${CLOUDINARY_BASE}/day1_slide1.png`,
    `${CLOUDINARY_BASE}/day1_slide2.png`,
    `${CLOUDINARY_BASE}/day1_slide3.png`,
    `${CLOUDINARY_BASE}/day1_slide4.png`,
  ],
  2: [ // Tuesday
    `${CLOUDINARY_BASE}/day2_slide1.png`,
    `${CLOUDINARY_BASE}/day2_slide2.png`,
    `${CLOUDINARY_BASE}/day2_slide3.png`,
    `${CLOUDINARY_BASE}/day2_slide4.png`,
  ],
  3: [ // Wednesday
    `${CLOUDINARY_BASE}/day3_slide1.png`,
    `${CLOUDINARY_BASE}/day3_slide2.png`,
    `${CLOUDINARY_BASE}/day3_slide3.png`,
    `${CLOUDINARY_BASE}/day3_slide4.png`,
  ],
  4: [ // Thursday
    `${CLOUDINARY_BASE}/day4_slide1.png`,
    `${CLOUDINARY_BASE}/day4_slide2.png`,
    `${CLOUDINARY_BASE}/day4_slide3.png`,
    `${CLOUDINARY_BASE}/day4_slide4.png`,
  ],
  5: [ // Friday
    `${CLOUDINARY_BASE}/day5_slide1.png`,
    `${CLOUDINARY_BASE}/day5_slide2.png`,
    `${CLOUDINARY_BASE}/day5_slide3.png`,
    `${CLOUDINARY_BASE}/day5_slide4.png`,
  ],
  6: [ // Saturday
    `${CLOUDINARY_BASE}/day6_slide1.png`,
    `${CLOUDINARY_BASE}/day6_slide2.png`,
    `${CLOUDINARY_BASE}/day6_slide3.png`,
    `${CLOUDINARY_BASE}/day6_slide4.png`,
  ],
};

// Stories: Instagram + Facebook only
const STORY_ACCOUNTS = [
  SOCIAL_ACCOUNTS.instagram,
  SOCIAL_ACCOUNTS.facebook,
];

// ─────────────────────────────────────────────────────────
// PLATFORM CHARACTER LIMITS (enforced when building captions)
// Instagram: 2,200 | Facebook: 63,206 | LinkedIn: 3,000
// YouTube Community: 500 | Google Business: 1,500
// The main caption is optimized for Instagram (≤2,200 chars).
// ─────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════
// 14 PRE-WRITTEN CAROUSEL SCRIPTS — WEEKS 1 & 2
// (Week 3+ → NewsAPI + Claude generates fresh content daily)
// Theme: Jose Rivas as THE AI/Automation Guru for Latino entrepreneurs
// ═══════════════════════════════════════════════════════════
const CAROUSEL_SCRIPTS = [
  // ── WEEK 1 ─────────────────────────────────────────────
  {
    title: '5 herramientas de IA que están usando los negocios más exitosos',
    caption: `¿Todavía haciendo todo a mano? 😅

En 2026, la IA ya no es una ventaja — es una necesidad.

Aquí las 5 herramientas que estoy implementando con mis clientes:

1️⃣ CRM con IA → cero leads perdidos
2️⃣ Chatbot 24/7 → responde mientras duermes
3️⃣ Email automation → nutre a tus clientes solo
4️⃣ Scheduler de redes → publica sin pensar
5️⃣ Analytics con IA → toma decisiones con datos reales

¿Tu negocio ya usa alguna? 👇 Comenta cuál y te digo cómo optimizarla.

Guarda este post — lo vas a necesitar. 🔖

#MarketingDigital #InteligenciaArtificial #NegociosLatinos #Emprendedores #AutomatizaciónIA #JRZMarketing #IA2026 #HerramientasIA`,
  },
  {
    title: 'Tu negocio está perdiendo clientes HOY por esto',
    caption: `La realidad que nadie te quiere decir:

Cada vez que tardas más de 5 minutos en responder un mensaje, pierdes ese cliente. ❌

Estadística real: el 78% de los clientes compra al primero que responde.

¿Cuántos leads pierdes por semana porque no tienes un sistema?

En JRZ Marketing resolvemos eso con IA que responde en segundos:
→ DMs de Instagram
→ Mensajes de Facebook
→ WhatsApp y más

24 horas. 7 días. Sin descanso.

¿Quieres ver cómo funciona para tu negocio?
Agenda gratis → ${BOOKING_URL}

💬 Comenta "QUIERO" y te cuento más.

#AutomatizaciónIA #ChatbotIA #NegociosLatinos #MarketingDigital #JRZMarketing #Emprendedores #LeadGeneration`,
  },
  {
    title: 'Cómo generé 50+ leads en 30 días sin gastar en publicidad',
    caption: `Te voy a ser 100% honesto sobre cómo funciona el crecimiento real. 🎯

No fue suerte. Fue sistema.

Lo que hicimos:
✅ Contenido que educa (como este)
✅ CRM conectado a todas las redes
✅ IA que califica leads automáticamente
✅ Follow-up en menos de 60 segundos
✅ Proceso de ventas claro y repetible

El resultado: 50+ leads calificados. En un mes.

El secreto no es gastar más en ads.
Es convertir mejor lo que ya tienes.

¿Cuántos leads estás dejando ir esta semana?

Dime tu industria abajo y te doy un tip específico para la tuya 👇

#LeadGeneration #MarketingOrgánico #NegociosLatinos #Emprendedores2026 #JRZMarketing #SistemaDeMarketing`,
  },
  {
    title: 'El error #1 que destruye el marketing de los emprendedores',
    caption: `Lo veo todo el tiempo con negocios latinos... 😬

Están en Instagram, Facebook, TikTok, LinkedIn, Twitter...

Pero en ninguna están convirtiendo.

El problema: PRESENCIA sin ESTRATEGIA.

Estar en todas partes pero no profundizar en ninguna es el error más caro que existe.

Lo que funciona de verdad:
→ 2 plataformas bien trabajadas
→ Contenido que educa Y vende
→ Sistema de captura de leads
→ Follow-up automatizado
→ CTA claro en cada post

¿En cuántas redes estás? ¿Cuántas ventas te generan?

Sé honesto en los comentarios 👇

#EstrategiaDigital #MarketingLatino #Emprendedores #NegociosExitosos #JRZMarketing #MarketingDigital`,
  },
  {
    title: 'El vendedor que nunca duerme: así funciona nuestra IA',
    caption: `Las 2am. Alguien te escribe por Instagram.

Si no tienes sistema: ese lead se va.
Si tienes nuestra IA: responde en 10 segundos. 🤖

Así funciona Armando, nuestra IA de ventas:

🧠 Entiende lo que el cliente necesita
💬 Responde en español o inglés
📋 Califica si es un buen lead
📲 Pide teléfono y email
📅 Los manda a agendar una llamada

Todo automático. Sin intervención humana.

¿Cuánto te está costando no tener esto?

Escríbeme "IA" en los comentarios y te cuento cómo funciona para tu tipo de negocio 👇

#ChatbotIA #VentasAutomáticas #NegociosLatinos #AutomatizaciónIA #JRZMarketing #InteligenciaArtificial`,
  },
  {
    title: 'Negocio que crece vs negocio que se estanca: la diferencia real',
    caption: `Después de trabajar con 50+ negocios latinos, identificé el patrón.

Los que CRECEN hacen esto:
✅ Tienen sistema (CRM, automatización, seguimiento)
✅ Miden todo — toman decisiones con datos
✅ Crean contenido consistente semana tras semana
✅ Responden rápido a cada lead
✅ Invierten antes de que lo necesiten

Los que se ESTANCAN hacen esto:
❌ Trabajan por intuición, sin datos
❌ Publican cuando tienen ganas
❌ No tienen sistema de seguimiento
❌ Esperan resultados sin consistencia
❌ Esperan el "momento perfecto"

¿En cuál grupo está tu negocio hoy?

No hay juicio — hay solución.
Agenda una sesión gratuita y lo vemos juntos:
${BOOKING_URL}

#CrecimientoNegocio #NegociosLatinos #Emprendedores #MarketingDigital #JRZMarketing`,
  },
  {
    title: 'El sistema de marketing que usamos con cada cliente',
    caption: `No hay magia. Solo sistema. 💡

Esto es exactamente lo que implementamos en JRZ Marketing:

📍 FASE 1 — Diagnóstico
Analizamos tu situación real, tus competidores, tu cliente ideal.

📍 FASE 2 — Estrategia
Diseñamos un plan personalizado (no genérico, no copiado).

📍 FASE 3 — Implementación
CRM + automatización + contenido + IA todo conectado.

📍 FASE 4 — Crecimiento
Contenido 7 días/semana, ads cuando aplique, seguimiento constante.

📍 FASE 5 — Optimización
Medimos, ajustamos, escalamos. Mes a mes.

¿Quieres verlo en acción para tu negocio?
30 minutos. Sin costo. Sin compromiso.

Agenda aquí → ${BOOKING_URL}

#SistemaMarketing #MarketingDigital #NegociosLatinos #Emprendedores #JRZMarketing #AutomatizaciónIA`,
  },

  // ── WEEK 2 ─────────────────────────────────────────────
  {
    title: '7 procesos que puedes automatizar esta semana en tu negocio',
    caption: `¿Cuántas horas a la semana gastas en tareas repetitivas? ⏰

Aquí 7 cosas que ya deberían estar automatizadas:

1️⃣ Respuestas a DMs → IA 24/7
2️⃣ Seguimiento a leads → email + SMS automático
3️⃣ Confirmación de citas → sin llamadas manuales
4️⃣ Recordatorios de pago → sin perseguir a nadie
5️⃣ Reseñas de clientes → solicitud automática post-servicio
6️⃣ Publicación en redes → programado una vez, publica solo
7️⃣ Reportes de marketing → datos listos sin buscarlos

Cada hora que gastas en estas tareas es una hora que no estás creciendo.

¿Cuál automatizarías primero?
Dímelo abajo 👇

#AutomatizaciónNegocio #EficienciaEmpresarial #NegociosLatinos #IA #JRZMarketing #Emprendedores`,
  },
  {
    title: '¿Qué es un CRM y por qué tu negocio pierde dinero sin uno?',
    caption: `Un CRM no es lujo. Es lo mínimo para crecer. 💼

Sin CRM:
❌ Leads que se te olvidan
❌ Clientes que no regresan
❌ Oportunidades perdidas por seguimiento tardío
❌ Tu equipo desorganizado
❌ Cero visibilidad de tu negocio

Con el CRM correcto:
✅ Cada lead capturado y seguido automáticamente
✅ Clientes que regresan solos
✅ Pipeline claro y predecible
✅ Equipo alineado con un solo sistema
✅ Datos reales para tomar decisiones

El CRM que usamos con clientes: Go High Level.
Implementación completa hecha por nosotros.

¿Ya tienes uno? ¿Lo estás usando bien?
Cuéntame abajo 👇

#CRM #GoHighLevel #NegociosDigitales #AutomatizaciónIA #JRZMarketing #MarketingDigital #NegociosLatinos`,
  },
  {
    title: 'Instagram vs Facebook vs LinkedIn vs YouTube: ¿Dónde está tu cliente?',
    caption: `La pregunta que me hacen siempre: "¿En qué red debo estar?"

Mi respuesta honesta: depende de quién es tu cliente. 🎯

📱 INSTAGRAM
→ Negocios locales, servicios, estilo de vida
→ Edad 18-40. Visual y emocional.
→ Reels + Carruseles + Stories = crecimiento

👥 FACEBOOK
→ Comunidades locales, 30-60 años
→ Grupos, eventos, ads muy segmentados

💼 LINKEDIN
→ B2B, servicios de alto valor, profesionales
→ Empresarios y tomadores de decisión

▶️ YOUTUBE
→ Contenido de valor largo plazo
→ Posicionamiento como experto
→ Búsquedas orgánicas que nunca paran

Mi recomendación para emprendedores latinos:
Empieza en 2. Hazlo bien. Luego expande.

¿Cuál es tu red principal ahora mismo?

#RedesSociales #EstrategiaDigital #MarketingLatino #Emprendedores #JRZMarketing`,
  },
  {
    title: 'El embudo de ventas que todo emprendedor latino necesita',
    caption: `Sin embudo de ventas estás dejando dinero en la mesa. 💸

El embudo que funciona para negocios latinos:

🔝 ATRACCIÓN
→ Contenido en redes que educa y engancha
→ Reel/carrusel 7 días a la semana

⬇️ CAPTURA
→ Lead magnet (guía, consulta gratis, etc.)
→ Landing page optimizada con CTA claro

⬇️ NUTRICIÓN
→ Email automation con valor real
→ Follow-up con IA en segundos

⬇️ CONVERSIÓN
→ Llamada de estrategia gratuita
→ Propuesta personalizada

⬇️ RETENCIÓN
→ Servicio que supera expectativas
→ Programa de referidos

¿En cuál etapa está fallando tu negocio?
Dímelo abajo y te doy un consejo específico 🎯

#EmbudoVentas #EstrategiaMarketing #NegociosLatinos #Emprendedores #JRZMarketing`,
  },
  {
    title: 'Cómo crear contenido viral sin ser influencer',
    caption: `No necesitas millones de seguidores para que tu contenido impacte. ✋

La fórmula del contenido que funciona:

💡 HOOK — Las primeras 3 palabras detienen el scroll
📚 VALOR — Un aprendizaje accionable que puedan usar HOY
🎭 EMOCIÓN — Que inspire, enseñe o conecte
🔄 COMPARTIBLE — Que lo guarden o lo manden a alguien
📣 CTA — Diles exactamente qué hacer después

El contenido viral no es suerte.
Es fórmula aplicada consistentemente.

¿Cuál de estos elementos le falta más a tu contenido?

Dime abajo y te doy feedback específico 👇

Guarda este post 🔖 — te lo vas a agradecer.

#ContenidoViral #MarketingContenidos #CreadorContenido #NegociosLatinos #JRZMarketing #EstrategiaContenido`,
  },
  {
    title: '3 tipos de contenido que SIEMPRE generan ventas',
    caption: `No todo el contenido vende igual.

Después de manejar decenas de cuentas, estos 3 nunca fallan:

1️⃣ PRUEBA SOCIAL
"Mira lo que logramos para este cliente..."
→ Resultados reales + historia = confianza instantánea

2️⃣ EDUCACIÓN + PROBLEMA
"El error que te está costando clientes..."
→ Identifies el dolor, ofreces la solución

3️⃣ TRANSFORMACIÓN
"Antes vs Después — 90 días de trabajo"
→ Muestra el viaje, no solo el destino

¿Cuál usas menos?
Ese es tu punto ciego. Ese es donde más oportunidad tienes.

Empieza a publicar estos 3 y verás la diferencia en 30 días.

¿Quieres una estrategia de contenido para tu negocio específico?
Escríbenos un DM 📩

#EstrategiaContenido #MarketingDigital #Ventas #NegociosLatinos #JRZMarketing`,
  },
  {
    title: 'El ROI real del marketing digital (números sin mentiras)',
    caption: `La pregunta que siempre me hacen: "¿Cuánto voy a ganar si invierto en marketing?"

La respuesta honesta: depende. Pero aquí los números reales:

📊 Email marketing: $36 por cada $1 invertido (promedio global)
📊 SEO local: 5-10x ROI en 6-12 meses
📊 Redes sociales orgánicas: depende de tu sistema de conversión
📊 Facebook/IG Ads bien optimizados: 3-8x ROAS

Lo que NADIE te dice:
→ El marketing digital SÍ funciona
→ Pero necesita mínimo 90 días de consistencia
→ Necesita sistema (CRM + automatización)
→ Necesita estrategia, no solo "post y reza"

¿Cuánto llevas invirtiendo en marketing y qué resultado tienes?
Dime honestamente abajo 👇

#ROIMarketing #MarketingDigital #NegociosLatinos #Inversión #JRZMarketing #Emprendedores`,
  },
];

// ═══════════════════════════════════════════════════════════
// DAILY STORY TEMPLATES — Rotate by day of week (0=Sun…6=Sat)
// Platform: Instagram + Facebook | Type: story
// Character limit: aim for ≤500 chars (short & punchy)
// ═══════════════════════════════════════════════════════════
const STORY_TEMPLATES = [
  // Sunday (0)
  {
    text: `Nueva semana. Nueva oportunidad de crecer. 🌟\n\n¿Tu negocio tiene el sistema para captarlo?\n\nAgenda tu sesión estratégica GRATIS esta semana 👇\n${BOOKING_URL}\n\nJRZ Marketing · Orlando, FL`,
    cta: 'Agenda esta semana',
  },
  // Monday (1)
  {
    text: `¿Listo para transformar tu negocio esta semana? 🚀\n\nTe regalamos 30 minutos de estrategia gratis.\nSin costo. Sin compromiso.\n\n👉 ${BOOKING_URL}\n\nJRZ Marketing · jrzmarketing.com`,
    cta: 'Agenda tu llamada gratuita',
  },
  // Tuesday (2)
  {
    text: `¿Tu negocio está captando todos los leads que podría? 🎯\n\nNosotros te ayudamos a que no se te escape ninguno.\n\n💬 Escríbenos un DM y hablamos.\nO agenda directo → ${BOOKING_URL}`,
    cta: 'Escríbenos por DM',
  },
  // Wednesday (3)
  {
    text: `💡 Dato: el 78% de los clientes compra al primero que responde.\n\n¿Cuántos leads pierdes por responder tarde?\n\nPide tu cotización gratis 👇\n📩 info@jrzmarketing.com\n\n#AutomatizaciónIA #NegociosLatinos`,
    cta: 'Pide tu cotización',
  },
  // Thursday (4)
  {
    text: `🤖 IA + Marketing + Automatización =\nResultados que trabajan mientras duermes.\n\nEso hacemos en JRZ Marketing.\n\n¿Tu negocio está listo para el siguiente nivel?\n👉 ${BOOKING_URL}`,
    cta: 'Habla con el equipo',
  },
  // Friday (5)
  {
    text: `¡Viernes! Termina la semana con un plan para la próxima. 📋\n\nAgenda hoy tu sesión estratégica gratuita.\nCupos limitados esta semana.\n\n→ ${BOOKING_URL}\n\nJRZ Marketing · Orlando, FL 🇺🇸`,
    cta: 'Reserva tu espacio',
  },
  // Saturday (6)
  {
    text: `El fin de semana es perfecto para planear tu próximo nivel. 🎯\n\nSi tu marketing no trabaja para ti, nosotros sí podemos.\n\nJRZ Marketing · Orlando, FL\n🌐 jrzmarketing.com\n📩 info@jrzmarketing.com`,
    cta: 'Visita jrzmarketing.com',
  },
];

// ═══════════════════════════════════════════════════════════
// ARMANDO DM BOT — EXISTING LOGIC (unchanged)
// ═══════════════════════════════════════════════════════════
const contactMessageCount = new Map();
const repliedMessageIds = new Set();
const knownContactInfo = new Map();
const thankYouEmailSent = new Set();
const alertEmailSent = new Set();

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
- Website: jrzmarketing.com | Free consultation: ${BOOKING_URL}

STRICT RULES:
- Max 2-3 SHORT sentences per reply. No paragraphs. Ever.
- Never ask for phone AND email in the same message.
- Never repeat the same opening phrase twice in a conversation.
- Never sound like a bot, a form, or a sales script.
- NEVER re-introduce yourself after the first message. If there is conversation history, you have already said who you are — never say "soy Armando" or "I'm Armando from JRZ" again. Jump straight into the conversation.
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

async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      {
        headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15' },
        params: { limit: 20 },
      }
    );
    return res.data?.messages || [];
  } catch (err) {
    console.error('Failed to fetch conversation history:', err?.response?.data || err.message);
    return [];
  }
}

function extractContactInfo(messages) {
  const phoneRegex = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let foundPhone = null;
  let foundEmail = null;
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  for (const msg of inboundMessages) {
    const body = msg.body || msg.message || '';
    if (!foundPhone) { const m = body.match(phoneRegex); if (m) foundPhone = m[0].trim(); }
    if (!foundEmail) { const m = body.match(emailRegex); if (m) foundEmail = m[0].trim(); }
    if (foundPhone && foundEmail) break;
  }
  return { foundPhone, foundEmail };
}

async function getArmandoReply(incomingMessage, contactName, contactId, conversationId) {
  const count = (contactMessageCount.get(contactId) || 0) + 1;
  contactMessageCount.set(contactId, count);

  const hour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hour);
  const timeGreeting   = h < 12 ? 'Buenos días'   : h < 18 ? 'Buenas tardes'   : 'Buenas noches';
  const timeGreetingEN = h < 12 ? 'Good morning'  : h < 18 ? 'Good afternoon'  : 'Good evening';

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
    const recentMessages = messages.slice(-10).reverse();
    for (const msg of recentMessages) {
      const body = msg.body || msg.message || '';
      if (!body) continue;
      claudeHistory.push({ role: msg.direction === 'inbound' ? 'user' : 'assistant', content: body });
    }
    if (claudeHistory.length > 0 && claudeHistory[claudeHistory.length - 1].role === 'user') {
      claudeHistory.pop();
    }
  }

  const phoneRegex = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  if (!foundPhone) { const m = incomingMessage.match(phoneRegex); if (m) foundPhone = m[0].trim(); }
  if (!foundEmail) { const m = incomingMessage.match(emailRegex); if (m) foundEmail = m[0].trim(); }
  console.log(`Contact info — phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}, msg #: ${historyCount}`);

  const alreadyHavePhone = !!foundPhone;
  const alreadyHaveEmail = !!foundEmail;
  const hasBoth = alreadyHavePhone && alreadyHaveEmail;

  const noReintro = historyCount > 1 ? `Do NOT re-introduce yourself — you already did that. ` : '';
  let stageInstruction = '';
  if (historyCount === 1) {
    stageInstruction = `FIRST MESSAGE. Greet with "${timeGreeting}" (or "${timeGreetingEN}" if they wrote in English). Introduce yourself as Armando, Community Manager of JRZ Marketing. Acknowledge what they said in ONE sentence. Then immediately ask for their phone number AND email — tell them the team will reach out to schedule a free strategy call. Be warm but direct.`;
  } else if (hasBoth) {
    stageInstruction = `${noReintro}You have phone (${foundPhone}) and email (${foundEmail}). Close warmly — the team will reach out very soon to schedule their free strategy meeting. You're done collecting info.`;
  } else if (alreadyHavePhone && !alreadyHaveEmail) {
    stageInstruction = `${noReintro}You have their phone (${foundPhone}) but still need their EMAIL. Ask directly — one sentence max. Also drop the booking link so they can self-schedule: ${BOOKING_URL}`;
  } else if (!alreadyHavePhone && alreadyHaveEmail) {
    stageInstruction = `${noReintro}You have their email (${foundEmail}) but still need their PHONE NUMBER. Ask directly — the team needs it to reach them personally. Also drop the booking link: ${BOOKING_URL}`;
  } else if (historyCount >= 2) {
    stageInstruction = `${noReintro}Message #${historyCount} and you still don't have their phone or email. Be direct — acknowledge briefly what they said, then ask for their phone AND email. Also drop the booking link NOW so they can self-schedule: ${BOOKING_URL}. Don't keep asking questions — get the info or get them booked.`;
  } else {
    stageInstruction = `${noReintro}Still need phone and email. Ask directly and drop the booking link: ${BOOKING_URL}`;
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

  const messagesForClaude = [...claudeHistory, { role: 'user', content: incomingMessage }];

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
      return { reply: parsed.reply, leadQuality: parsed.leadQuality || 'none', sentiment: parsed.sentiment || 'neutral', foundPhone, foundEmail };
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
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
  );
}

async function tagContact(contactId, tags) {
  try {
    await axios.post(
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      { tags },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    );
    console.log(`Tagged contact ${contactId} with: ${tags.join(', ')}`);
  } catch (err) {
    console.error('Tagging failed:', err?.response?.data || err.message);
  }
}

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
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    );
    knownContactInfo.set(contactId, { ...known, ...updates });
    console.log(`GHL contact updated — phone: ${phone || 'n/a'}, email: ${email || 'n/a'}`);
  } catch (err) {
    console.error('Failed to update GHL contact:', err?.response?.data || err.message);
  }
}

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
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .lead-card { background:#f9f9f9; border-radius:12px; overflow:hidden; margin:24px 0; }
    .lead-row { padding:12px 20px; border-bottom:1px solid #eeeeee; font-size:14px; color:#333333; }
    .lead-row:last-child { border-bottom:none; }
    .lead-label { font-weight:700; color:#0a0a0a; display:inline-block; width:80px; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Hot Lead Alert</span></div>
  <div class="email-hero">
    <h1>🔥 ${contactName || 'New Lead'}<br />is ready to book.</h1>
    <p>Armando collected a full lead. Time to close — reach out now.</p>
  </div>
  <div class="email-body">
    <p>A contact just gave Armando their <strong>contact information</strong>. Full details:</p>
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
</div></div>
</body></html>`;

  try {
    await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages',
      { type: 'Email', contactId: OWNER_CONTACT_ID, subject, html },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
    );
    console.log('Hot lead alert email sent to Jose.');
  } catch (err) {
    console.error('Failed to send hot lead alert:', err?.response?.data || err.message);
  }
}

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
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .email-body ul { margin:16px 0 20px 0; padding-left:0; list-style:none; }
    .email-body ul li { font-size:15px; color:#333333; line-height:1.7; padding:8px 0 8px 28px; position:relative; border-bottom:1px solid #f0f0f0; }
    .email-body ul li:last-child { border-bottom:none; }
    .email-body ul li::before { content:'✓'; position:absolute; left:0; color:#0a0a0a; font-weight:700; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:16px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; margin-bottom:12px; }
    .signature-links a { color:#0a0a0a; text-decoration:none; font-weight:600; font-size:13px; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-links a { font-size:12px; color:rgba(255,255,255,0.35); text-decoration:none; margin:0 10px; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; margin-top:12px; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Sesión Gratuita &middot; Free Strategy Session</span></div>
  <div class="email-hero">
    <h1>${firstName},<br />ya estamos en contacto. &#128075;</h1>
    <p>The team that transforms businesses in 90 days is ready for you.</p>
  </div>
  <div class="email-body">
    <p>Hola <strong>${firstName}</strong>,</p>
    <p>Gracias por conectar con JRZ Marketing. Recibimos tu información y nuestro equipo se va a poner en contacto contigo muy pronto.</p>
    <p>Mientras tanto, esto es lo que hacemos por negocios como el tuyo:</p>
    <ul>
      <li>Estrategia de marketing basada en datos, no en suposiciones</li>
      <li>Automatizaciones con IA que trabajan 24/7 para captar clientes</li>
      <li>CRM configurado para nunca perder un lead</li>
      <li>Contenido que genera confianza y convierte visitantes en clientes</li>
    </ul>
    <p>¿Quieres acelerar el proceso? Agenda tu sesión gratuita de 30 minutos directamente aquí — sin costo, sin compromiso.</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Listo para crecer?</p>
    <a href="${BOOKING_URL}" class="cta-button">&#128197; Agenda tu llamada gratuita &rarr;</a>
    <p class="cta-note">30 minutos &middot; Sin costo &middot; Sin compromiso</p>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">Founder &amp; CEO &mdash; JRZ Marketing</div>
    <div class="signature-links">
      <a href="${BOOKING_URL}">Agenda tu llamada</a> &nbsp;&middot;&nbsp;
      <a href="https://jrzmarketing.com">jrzmarketing.com</a>
    </div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <div class="footer-links">
      <a href="${BOOKING_URL}">Contacto</a>
      <a href="https://jrzmarketing.com">Website</a>
    </div>
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Todos los derechos reservados.<br />Orlando, Florida &middot; jrzmarketing.com</p>
  </div>
</div></div>
</body></html>`;

  try {
    await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages',
      { type: 'Email', contactId, subject, html },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
    );
    console.log(`Thank-you email sent to contact ${contactId}.`);
  } catch (err) {
    console.error('Failed to send thank-you email:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA AUTOMATION FUNCTIONS
// ═══════════════════════════════════════════════════════════

// Schedule a post via GHL Social Media API
// Pass media = [{ url, type: 'photo' }] array for Instagram image posts
async function schedulePost({ caption, accountIds, type = 'post', scheduleDate, media }) {
  const body = {
    accountIds,
    type,
    userId: GHL_USER_ID,
    status: 'scheduled',
    summary: caption,
    scheduleDate: scheduleDate.toISOString(),
    scheduleTimeUpdated: true,
  };
  if (media && media.length) body.media = media;
  const res = await axios.post(
    `https://services.leadconnectorhq.com/social-media-posting/${GHL_LOCATION_ID}/posts`,
    body,
    {
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
    }
  );
  return res.data;
}

// Get today's carousel script — cycles through 14 pre-written, then uses NewsAPI + Claude
function getTodaysScript() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((now - start) / 86400000);
  const scriptIndex = (dayOfYear - 1) % CAROUSEL_SCRIPTS.length;
  return { script: CAROUSEL_SCRIPTS[scriptIndex], index: scriptIndex, usedPrewritten: true };
}

// Use NewsAPI + Claude to generate fresh Spanish content (week 3+ fallback)
async function generateNewsCaption() {
  try {
    const newsRes = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'inteligencia artificial negocios automatizacion marketing digital',
        language: 'es',
        sortBy: 'popularity',
        pageSize: 5,
        apiKey: NEWS_API_KEY,
      },
    });

    let articles = newsRes.data?.articles || [];
    if (!articles.length) {
      // Fallback: search in English
      const fallbackRes = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: 'artificial intelligence business automation marketing',
          language: 'en',
          sortBy: 'popularity',
          pageSize: 5,
          apiKey: NEWS_API_KEY,
        },
      });
      articles = fallbackRes.data?.articles || [];
    }

    const headlines = articles.slice(0, 3).map(a => `• ${a.title}`).join('\n');
    if (!headlines) throw new Error('No articles found');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Eres el Social Media Manager de JRZ Marketing (agencia de marketing digital y automatización con IA en Orlando, FL). José Rivas es el CEO — su misión es ser EL GURÚ de IA y automatización para emprendedores latinos.

Noticias trending hoy sobre IA y negocios:
${headlines}

Escribe un post VIRAL en español para Instagram/Facebook/LinkedIn (máx 1,800 caracteres) que:
- Use UN dato o ángulo de las noticias como GANCHO en la primera línea
- Eduque sobre cómo la IA/automatización ayuda a negocios latinos
- Posicione a José como experto que ya está implementando esto
- Tenga estructura de carrusel: punto 1, punto 2, punto 3... (usa emojis numerados)
- Termine con pregunta que genere COMENTARIOS
- Incluya un CTA sutil al final: "Agenda gratis → ${BOOKING_URL}"
- Termine con 8-10 hashtags relevantes

Solo el texto del post. Sin explicaciones.`,
      }],
    });

    return response.content[0].text.trim();
  } catch (err) {
    console.error('News content generation failed:', err.message, '— using pre-written fallback');
    const { script } = getTodaysScript();
    return script.caption;
  }
}

// Generate and publish a daily English blog post via GHL Blogs API
async function createDailyBlog(topic, caption) {
  try {
    console.log(`[Blog] Generating English blog post for: "${topic}"...`);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are the content writer for JRZ Marketing, a bilingual AI automation and digital marketing agency in Orlando, FL. José Rivas is the founder and CEO.

Write a complete, SEO-optimized blog post in ENGLISH about:
"${topic}"

The post should:
- Be 600-900 words
- Have a compelling H2 introduction
- Include 3-4 H3 subheadings with practical content
- Position Jose Rivas / JRZ Marketing as the AI automation authority for Latino entrepreneurs
- Include a clear CTA at the end: "Book your free strategy call at jrzmarketing.com/contact-us"
- Be educational, not salesy
- Include real, actionable advice

Format: Return ONLY the HTML body content (no <html>, <head>, or <body> tags). Start with <h2>. Include <p>, <ul>, <li>, <h3>, <strong> tags as needed.`,
      }],
    });

    const rawHTML = response.content[0].text.trim();

    // Build SEO-friendly slug from topic
    const urlSlug = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
      + '-' + Date.now().toString(36);

    // Pick categories based on content
    const categories = [
      BLOG_CATEGORIES.marketing,
      BLOG_CATEGORIES.ai,
      BLOG_CATEGORIES.business,
    ];

    const publishedAt = new Date();
    publishedAt.setUTCHours(13, 0, 0, 0); // 8am EST

    const res = await axios.post(
      'https://services.leadconnectorhq.com/blogs/posts',
      {
        title: topic,
        locationId: GHL_LOCATION_ID,
        blogId: BLOG_ID,
        description: caption.slice(0, 200).replace(/[#\n]/g, ' ').trim(),
        imageUrl: 'https://msgsndr-private.storage.googleapis.com/locationPhotos/bf4cfbc0-6359-4e62-a0fa-de3af69d3218.png',
        imageAltText: `JRZ Marketing — ${topic}`,
        author: BLOG_AUTHOR_ID,
        categories,
        tags: ['JRZ Marketing', 'AI automation', 'marketing', 'digital marketing'],
        urlSlug,
        status: 'PUBLISHED',
        publishedAt: publishedAt.toISOString(),
        rawHTML,
      },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`[Blog] ✅ Blog post published: "${topic}" — ID: ${res.data?.blogPost?._id}`);
    return { success: true, title: topic, id: res.data?.blogPost?._id };
  } catch (err) {
    console.error('[Blog] ❌ Failed to create blog post:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// Schedule today's carousel post on all platforms at 8am EST + publish daily blog
async function runDailyPost() {
  console.log('[Social] Running daily post scheduler...');

  // Pick content: pre-written scripts cycle first, then NewsAPI + Claude
  const { script } = getTodaysScript();
  let caption = script.caption;
  let title   = script.title;

  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((now - start) / 86400000);
  if (dayOfYear > CAROUSEL_SCRIPTS.length * 2) {
    console.log('[Social] Generating fresh content via NewsAPI + Claude...');
    caption = await generateNewsCaption();
    title   = 'AI-generated — ' + new Date().toLocaleDateString('en-US');
  }

  // Schedule for 8am EST (12:00 UTC during EDT, 13:00 during EST)
  const postTime = new Date();
  postTime.setUTCHours(12, 0, 0, 0); // 8am EDT (UTC-4, Mar–Nov)
  if (postTime < new Date()) {
    postTime.setDate(postTime.getDate() + 1);
  }

  // ── Get today's carousel images from Cloudinary ──
  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const todayImages = CAROUSEL_IMAGES[dayIdx >= 0 ? dayIdx : new Date().getDay()];
  const instagramMedia = todayImages.map(url => ({ url, type: 'photo' }));

  // ── Social post — Facebook, LinkedIn, YouTube, Google (text only) ──
  let socialResult = { success: false };
  try {
    const result = await schedulePost({
      caption,
      accountIds: TEXT_POST_ACCOUNTS,
      type: 'post',
      scheduleDate: postTime,
    });
    console.log(`[Social] ✅ Text post scheduled for ${postTime.toISOString()} — "${title}"`);
    socialResult = { success: true, title, scheduledFor: postTime.toISOString(), result };
  } catch (err) {
    console.error('[Social] ❌ Failed to schedule text post:', err?.response?.data || err.message);
    socialResult = { success: false, error: err.message };
  }

  // ── Instagram post — carousel images from Cloudinary ──
  let instagramResult = { success: false };
  try {
    const result = await schedulePost({
      caption,
      accountIds: INSTAGRAM_ACCOUNTS,
      type: 'post',
      scheduleDate: postTime,
      media: instagramMedia,
    });
    console.log(`[Social] ✅ Instagram carousel scheduled for ${postTime.toISOString()} — "${title}"`);
    instagramResult = { success: true, title, scheduledFor: postTime.toISOString(), slides: todayImages.length, result };
  } catch (err) {
    console.error('[Social] ❌ Failed to schedule Instagram carousel:', err?.response?.data || err.message);
    instagramResult = { success: false, error: err.message };
  }

  // ── Blog post (English, published same day) ──
  const blogResult = await createDailyBlog(title, caption);

  return { social: socialResult, instagram: instagramResult, blog: blogResult };
}

// Schedule today's story at 7pm EST
async function runDailyStory() {
  console.log('[Social] Running daily story scheduler...');

  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const template = STORY_TEMPLATES[dayIndex >= 0 ? dayIndex : new Date().getDay()];

  // Schedule for 7pm EST today (00:00 UTC next day = midnight = 7pm EST when UTC-5)
  // 7pm EST = 23:00 UTC (during EDT/UTC-4) or 00:00 UTC+1day (during EST/UTC-5)
  // Using 23:00 UTC as a safe default (works for EDT Apr-Nov)
  const storyTime = new Date();
  storyTime.setUTCHours(23, 0, 0, 0);
  if (storyTime < new Date()) {
    storyTime.setDate(storyTime.getDate() + 1);
  }

  try {
    const result = await schedulePost({
      caption: template.text,
      accountIds: STORY_ACCOUNTS,
      type: 'story',
      scheduleDate: storyTime,
    });
    console.log(`[Social] ✅ Story scheduled for ${storyTime.toISOString()} — "${template.cta}"`);
    return { success: true, cta: template.cta, scheduledFor: storyTime.toISOString(), result };
  } catch (err) {
    console.error('[Social] ❌ Failed to schedule story:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// Send weekly content summary email to Jose every Monday
async function sendWeeklySummaryEmail(weekPosts) {
  const subject = `📅 JRZ Marketing — Resumen de contenido semanal (semana del ${new Date().toLocaleDateString('es-ES')})`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';
  const postRows = (weekPosts || []).map(p => `
    <tr>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#333; font-weight:600;">${p.day}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#555;">${p.title || 'AI-generated'}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:${p.success ? '#16a34a' : '#dc2626'}; font-weight:700;">${p.success ? '✅ Programado' : '❌ Error'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; color:#0a0a0a; }
    .wrap { padding:40px 20px; }
    .container { max-width:600px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .header img { height:44px; }
    .badge { background:#0a0a0a; padding:0 40px 20px; text-align:center; }
    .badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:32px 40px 40px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:24px; font-weight:800; color:#fff; line-height:1.2; margin-bottom:12px; }
    .hero p { font-size:14px; color:rgba(255,255,255,0.5); }
    .body { padding:32px 40px; }
    .body p { font-size:15px; color:#333; line-height:1.8; margin-bottom:20px; }
    table { width:100%; border-collapse:collapse; border-radius:12px; overflow:hidden; background:#f9f9f9; }
    th { background:#0a0a0a; color:#fff; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; padding:12px 16px; text-align:left; }
    .size-guide { background:#f0f7ff; border-left:4px solid #0a0a0a; padding:16px 20px; border-radius:0 8px 8px 0; margin:24px 0; }
    .size-guide h3 { font-size:13px; font-weight:700; color:#0a0a0a; margin-bottom:8px; }
    .size-guide p { font-size:12px; color:#555; line-height:1.7; }
    .footer { background:#0a0a0a; padding:24px 40px; text-align:center; }
    .footer img { height:24px; opacity:0.6; margin-bottom:12px; }
    .footer p { font-size:11px; color:rgba(255,255,255,0.2); }
  </style>
</head>
<body><div class="wrap"><div class="container">
  <div class="header"><img src="${logoUrl}" alt="JRZ Marketing"></div>
  <div class="badge"><span>📅 Resumen Semanal — Contenido Programado</span></div>
  <div class="hero">
    <h1>Tu semana está lista.<br>Armando programó todo. 🤖</h1>
    <p>Aquí el resumen de posts y stories programados para esta semana.</p>
  </div>
  <div class="body">
    <p>Jose, esto es lo que está programado para publicarse automáticamente esta semana en Instagram, Facebook, LinkedIn, YouTube y Google Business:</p>
    <table>
      <thead><tr><th>Día</th><th>Contenido</th><th>Estado</th></tr></thead>
      <tbody>${postRows || '<tr><td colspan="3" style="padding:16px;text-align:center;color:#999;">Sin datos esta semana</td></tr>'}</tbody>
    </table>

    <div class="size-guide" style="margin-top:28px;">
      <h3>📐 Guía de tamaños para imágenes (cuando agregues fotos en GHL)</h3>
      <p>
        <strong>Instagram Feed:</strong> 1080×1080px (cuadrado) · 1080×1350px (4:5 retrato)<br>
        <strong>Instagram Story:</strong> 1080×1920px<br>
        <strong>Facebook Post:</strong> 1200×630px (horizontal) · 1080×1080px (cuadrado)<br>
        <strong>LinkedIn:</strong> 1200×627px (horizontal) · 1080×1080px (cuadrado)<br>
        <strong>YouTube Community:</strong> 1280×720px<br>
        <strong>Google Business:</strong> 720×540px mínimo
      </p>
    </div>

    <div class="size-guide" style="margin-top:16px; background:#fff8e1; border-left-color:#f59e0b;">
      <h3>📝 Límites de caracteres por plataforma</h3>
      <p>
        Instagram: 2,200 chars · Facebook: sin límite práctico · LinkedIn: 3,000 chars<br>
        YouTube Community: 500 chars · Google Business: 1,500 chars<br>
        <strong>⚠️ Nota:</strong> Para carruseles con imágenes — agrégalas directamente en GHL Planner.
      </p>
    </div>

    <div class="size-guide" style="margin-top:16px; background:#f0fdf4; border-left-color:#16a34a;">
      <h3>🎵 Nota sobre música (Spotify)</h3>
      <p>Instagram y Facebook permiten agregar música de su biblioteca nativa al publicar Reels/Stories. Esto no se puede hacer por API — agrégala directamente en la app cuando publiques o edita el post en GHL antes de que salga.</p>
    </div>
  </div>
  <div class="footer">
    <img src="${logoUrl}" alt="JRZ Marketing">
    <p>&copy; 2026 JRZ Marketing · Automatización de contenido por Armando AI</p>
  </div>
</div></div></body></html>`;

  try {
    await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages',
      { type: 'Email', contactId: OWNER_CONTACT_ID, subject, html },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
    );
    console.log('[Social] Weekly summary email sent to Jose.');
  } catch (err) {
    console.error('[Social] Failed to send weekly summary:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// WEBHOOK — ARMANDO DM HANDLER
// ═══════════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Incoming webhook:', JSON.stringify(payload, null, 2));

    const messageBody =
      payload.body ||
      payload.message?.body ||
      payload.messageBody ||
      payload.customData?.body ||
      '';

    const contactId =
      payload.contactId ||
      payload.contact_id ||
      payload.contact?.id ||
      payload.customData?.contactId ||
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
      payload.customData?.messageType ||
      payload.customData?.['messageType\t'] ||
      '';

    const contactName =
      payload.fullName ||
      payload.full_name ||
      payload.contactName ||
      payload.firstName ||
      payload.first_name ||
      payload.customData?.fullName ||
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

    if (foundPhone || foundEmail) {
      await updateGHLContact(contactId, foundPhone, foundEmail);
    }

    const hasBothData = !!(foundPhone && foundEmail);
    const hasAnyData  = !!(foundPhone || foundEmail);
    if (hasBothData) {
      await tagContact(contactId, ['armando-interested', 'qualified-lead', 'hot-lead']);
    } else if (hasAnyData) {
      await tagContact(contactId, ['armando-interested', 'qualified-lead']);
    } else if (leadQuality === 'interested') {
      await tagContact(contactId, ['armando-interested']);
    }

    if (foundEmail && !thankYouEmailSent.has(contactId)) {
      thankYouEmailSent.add(contactId);
      console.log(`Sending thank-you email to contact ${contactId}...`);
      await sendThankYouEmail(contactId, contactName);
    }

    if (hasAnyData && !alertEmailSent.has(contactId)) {
      alertEmailSent.add(contactId);
      console.log(`Sending hot-lead alert for contact ${contactId}...`);
      await sendHotLeadAlertEmail(contactName, foundPhone, foundEmail, sendType);
    }

    await sendGHLReply(contactId, reply, sendType);
    if (messageId) repliedMessageIds.add(messageId);
    console.log('Reply sent successfully.');

    res.status(200).json({ status: 'ok', reply, leadQuality, sentiment, foundPhone, foundEmail, messageNumber: msgCount });
  } catch (error) {
    console.error('Webhook error:', error?.response?.data || error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA CRON ENDPOINTS (manual triggers + internal scheduler)
// ═══════════════════════════════════════════════════════════

// Manual trigger: POST /cron/daily-post
app.post('/cron/daily-post', async (_req, res) => {
  try {
    const result = await runDailyPost();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('/cron/daily-post error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: POST /cron/daily-story
app.post('/cron/daily-story', async (_req, res) => {
  try {
    const result = await runDailyStory();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('/cron/daily-story error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: POST /cron/weekly-summary
app.post('/cron/weekly-summary', async (req, res) => {
  try {
    await sendWeeklySummaryEmail(req.body.weekPosts || []);
    res.json({ status: 'ok', message: 'Weekly summary email sent.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Status check: GET /social/status
app.get('/social/status', (_req, res) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const { script, index } = getTodaysScript();
  res.json({
    status: 'Social Media Automation — ACTIVE',
    currentTime_EST: now,
    todaysScript: { index: index + 1, title: script.title },
    totalPrewrittenScripts: CAROUSEL_SCRIPTS.length,
    dailyPostTime: '8:00 AM EST',
    dailyStoryTime: '7:00 PM EST',
    platforms: Object.keys(SOCIAL_ACCOUNTS),
    storyPlatforms: ['instagram', 'facebook'],
  });
});

app.get('/', (_req, res) => {
  res.json({
    status: 'Armando is online 🤖',
    name: 'Armando Rivas',
    age: 22,
    from: 'Caracas, Venezuela 🇻🇪',
    agency: 'JRZ Marketing',
    mission: 'DM lead capture + autonomous social media posting 7 days/week',
    socialMedia: 'Instagram · Facebook · LinkedIn · YouTube · Google Business',
    postsPerDay: '1 carousel (8am EST) + 1 story (7pm EST)',
  });
});

// ═══════════════════════════════════════════════════════════
// INTERNAL CRON — checks every 2 minutes if it's time to post
// Carousel: every day at 7:00am EST
// Story:    every day at 6:30pm EST
// Summary:  every Monday at 7:05am EST
// ═══════════════════════════════════════════════════════════
let lastPostDate    = null;
let lastStoryDate   = null;
let lastSummaryDate = null;

setInterval(async () => {
  try {
    const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = nowEST.toISOString().split('T')[0];
    const hour   = nowEST.getHours();
    const minute = nowEST.getMinutes();
    const dayOfWeek = nowEST.getDay(); // 0=Sun, 1=Mon

    // Daily carousel post at 7:00am EST (window: 7:00–7:04)
    if (hour === 7 && minute < 5 && lastPostDate !== today) {
      lastPostDate = today;
      await runDailyPost();

      // Monday: also collect 7-day schedule and email summary
      if (dayOfWeek === 1 && lastSummaryDate !== today) {
        lastSummaryDate = today;
        // Build a simple week preview for the email
        const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const weekPosts = CAROUSEL_SCRIPTS.slice(0, 7).map((s, i) => ({
          day: days[i],
          title: s.title,
          success: true,
        }));
        await sendWeeklySummaryEmail(weekPosts);
      }
    }

    // Daily story at 6:30pm EST (window: 18:30–18:34)
    if (hour === 18 && minute >= 30 && minute < 35 && lastStoryDate !== today) {
      lastStoryDate = today;
      await runDailyStory();
    }

  } catch (err) {
    console.error('[Cron] Internal scheduler error:', err.message);
  }
}, 2 * 60 * 1000); // Every 2 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Armando Rivas is online — JRZ Marketing 🇻🇪`);
  console.log(`Social Media: 7 days/week · Carousel 8am EST · Story 7pm EST`);
  console.log(`Platforms: Instagram · Facebook · LinkedIn · YouTube · Google Business`);
});
