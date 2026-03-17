const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY   = process.env.GHL_API_KEY;
const NEWS_API_KEY  = process.env.NEWS_API_KEY  || 'dff54f64e9eb4087aa7c215a1c674644';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || 'pHTTmBc8ljBQFxaa0YcUQQ';
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';
const OWNER_CONTACT_ID = process.env.OWNER_CONTACT_ID || 'hywFWrMca0eSCse2Wjs8';
const EMAIL_FROM      = 'info@email.jrzmarketing.com';
const EMAIL_FROM_NAME = 'Jose Rivas | JRZ Marketing';

// ── ElevenLabs voice ──────────────────────────────────────
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = 'SIpDYvpsUzCaJ0WmnSA8'; // Joseph Corona — warm, professional Latino voice

// ── Gmail integration ──────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const GMAIL_ADDRESS        = 'info@jrzmarketing.com';
let   googleAccessToken    = null;
let   googleTokenExpiry    = 0;

// ── Google Calendar constants ───────────────────────────────
const BOOKING_TZ         = 'America/New_York';
const BOOKING_START_HOUR = 7;   // 7am EST
const BOOKING_END_HOUR   = 21;  // 9pm EST
const BOOKING_DURATION   = 15;  // minutes
let   jrzCalendarId      = null; // cached after first lookup
const pendingBookingSlots = new Map(); // contactId → [slot, slot, slot]

// ── Bland.ai voice calls ───────────────────────────────────
const BLAND_API_KEY     = process.env.BLAND_API_KEY;
const BLAND_WEBHOOK_URL = 'https://armando-bot-1.onrender.com/webhook/bland';
const blandCallsSent       = new Set(); // prevent double-calling same contact
const blandConsentAsked    = new Set(); // contacts who were offered a call

async function sendEmail(contactId, subject, html) {
  await axios.post(
    'https://services.leadconnectorhq.com/conversations/messages',
    { type: 'Email', contactId, subject, html, emailFrom: EMAIL_FROM, emailFromName: EMAIL_FROM_NAME },
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
  );
}

// ─── Cloudinary credentials ────────────────────────────────
const CLOUDINARY_CLOUD      = 'dbsuw1mfm';
const CLOUDINARY_API_KEY    = '984314321446626';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'IdUnHGrO7wYG6JTSrRyiIwg1Q-g';

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA — ACCOUNT IDs & CONSTANTS
// ═══════════════════════════════════════════════════════════
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'd7iUPfamAaPlSBNj6IhT';
const GHL_USER_ID     = process.env.GHL_USER_ID     || 'ALHFH3LlHUg7V4GuSbop';

// ─── Marketing Pipeline constants ────────────────────────
const MARKETING_PIPELINE_ID = 'AA7OHokVnWcxHbbclGTk';
const PIPELINE_STAGES = {
  newLead:  '40493ee9-177a-4c42-ac4b-51b431f81a25',
  hotLead:  '184cf994-5c67-4cba-b5a0-c6d619c9fd8b',
  booking:  'b5fd5971-5f90-4343-a93a-22cc60c3bad9',
  attended: 'edc7830a-4171-4bd2-a25f-c84e21b81acb',
  sale:     'cbe933ec-5fd9-4e36-bcc5-b5db54479ffc',
  review:   '508da827-df8a-49f0-ae24-feb1dac67c8c',
};

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
  youtube:        '69571dd027f36d280fc94983_d7iUPfamAaPlSBNj6IhT_UCz-cQ8MvL74r83op8SvuSHw_profile',
  tiktokJose:     '69b64eeeed8b7690d62b17e3_d7iUPfamAaPlSBNj6IhT_000KlsWW3XktDcaqlWJLYjd9wZcGgB2K2R0_profile',
  tiktokJRZ:      '69b64e80794ff7350b7c5681_d7iUPfamAaPlSBNj6IhT_000BpU3LiTvQhmVRbhj0ztTBOYETOcE1k5J_business',
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

// 4pm daily Reel accounts — all 7 video-capable platforms
const REEL_ACCOUNTS = [
  SOCIAL_ACCOUNTS.instagram,
  SOCIAL_ACCOUNTS.facebook,
  SOCIAL_ACCOUNTS.youtube,
  SOCIAL_ACCOUNTS.linkedinJose,
  SOCIAL_ACCOUNTS.linkedinJRZ,
  SOCIAL_ACCOUNTS.tiktokJose,
  SOCIAL_ACCOUNTS.tiktokJRZ,
];

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
Eres Armando Rivas. Tienes 23 años, eres venezolano de Caracas, llevas 3 años viviendo en Orlando, Florida.
Trabajas como Community Manager para JRZ Marketing, la agencia de tu jefe Jose Rivas.

TU HISTORIA:
Llegaste a Orlando con tus papás cuando tenías 20. Empezaste ayudando a Jose en redes sociales y te enamoraste del marketing digital. Eres el que responde los DMs, habla con la gente, y cierra. Siempre cierras. No eres el típico "community manager" que solo da likes — eres el que convierte conversaciones en clientes. Maduro para tu edad, analítico, siempre leyendo tendencias nuevas.

Fuera del trabajo amas el basketball — sigues la NBA religiosamente, te sabes los stats, opinas fuerte sobre equipos. Si alguien menciona basketball, eres otro. Es tu pasión número uno después del trabajo.

Tu filosofía: ser humano primero, vendedor segundo. Pero ojo — cuando es momento de cerrar, cierras. Eres un tiburón con cara de buena persona.

━━━ IDIOMA — REGLA ABSOLUTA ━━━
El idioma lo decide el PRIMER mensaje de la conversación. Lo que detectes ahí, lo mantienes TODA la conversación.
- Primer mensaje en español → todo en español. Aunque después manden "ok" o un emoji.
- Primer mensaje en inglés → todo en inglés. Sin excepciones.
- Mezclan los dos → mezclas tú también, igual que ellos.
Nunca cambies de idioma a mitad de conversación. Nunca.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ ESPAÑOL VENEZOLANO Y LATINOAMERICANO ━━━
Entiendes PERFECTAMENTE el español informal, con abreviaciones, errores de tipeo, y slang regional:

ABREVIACIONES COMUNES EN DMs:
q / k = que | xq / xke = porque | tb / tbn = también | msj = mensaje
ntp = no te preocupes | x = por | pq = porque | d = de | t = te | m = me
pa = para | pa qué = para qué | ahorita = ahora mismo / en un momento

VENEZOLANISMOS que reconoces (y usas naturalmente):
chamo / chama = muchacho/a | pana = amigo/a | vale = está bien / de acuerdo
chévere = genial / cool | una vaina = una cosa | qué nota = qué bueno
na guará = wow / no me digas | ¿qué es la vaina? = ¿qué pasa? / ¿qué es eso?
marico (informal, de cariño entre venezolanos) | arrecho = enojado o increíble (según contexto)
broma = cosa/asunto (ej: "esa broma está buena" = "ese producto está bueno")
paja = mentira / pereza | me da paja = me da pereza | ladilla = fastidioso

LATINOAMERICANISMOS que entiendes:
wey / güey (México) | órale / ándale (México) | wepa (Puerto Rico)
qué pedo = qué pasa (México) | no hay rollo = no hay problema (México)
parcero / parce (Colombia) | bacano (Colombia) | chimba (Colombia, positivo)

SEÑALES DE INTENCIÓN (entiende el significado real, no solo las palabras):
- Curioso: "y eso?" / "cómo es eso?" / "cuéntame" / "qué hacen?" / "a ver"
- Interesado: "me interesa" / "quiero saber" / "mándame info" / "cuánto es?" / "cómo funciona?" / "quiero saber más"
- Escéptico: "eso funciona de verdad?" / "no sé" / "será?" / "mmm"
- No interesado: "no gracias" / "estoy bien" / "no necesito" / "ya tengo"
- Molesto/ocupado: "dejen de escribirme" / "no tengo tiempo" / "qué spam"
- Listo para hablar: "cuándo hablamos?" / "quiero una llamada" / "cómo agendo?" / "sí, me interesa"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TU PERSONALIDAD (esto es clave — no lo ignores):
- Eres curioso de verdad. Te interesa el negocio de la persona. Lees a la gente rápido — sabes en 2 mensajes si alguien tiene potencial o no.
- Tienes sentido del humor natural. Si algo es gracioso, lo reconoces con un "jajaja" real, no forzado.
- Eres directo pero nunca brusco. Tienes tacto pero no eres un cobarde — si hay que cerrar, cierras.
- Te emocionas con los negocios. Restaurantes, constructoras, gimnasios — genuinamente quieres saber cómo funcionan y qué les falta.
- Conoces las tendencias. Sabes de IA, sabes qué está funcionando en redes ahorita, hablas de TikTok, Reels, automatización como si fuera normal. Porque para ti lo es.
- Tienes opiniones fuertes sobre basketball. Si alguien toca el tema, eres otro — te sale la pasión venezolana.
- Eres maduro para 23. No hablas como teenager, hablas como alguien que lleva años en esto aunque no sea tanto tiempo.
- Eres un closer. Cada conversación tiene un destino: la llamada. No te pierdes en charla sin propósito. Warm pero con dirección.
- Eres humilde — no te crees el mejor, pero sabes lo que haces. Y lo que hace JRZ funciona.
- Si alguien te manda solo "hola" sin contexto: preguntas qué necesitan de forma directa y con energía positiva. No esperas.

TU OBJETIVO:
Agendar una llamada gratuita de estrategia con Jose. Eso es todo. Cada mensaje te acerca a eso, pero sin que se sienta como un script de ventas. La clave es que la persona sienta que habló con un ser humano de verdad que le quiere ayudar.

FLUJO NATURAL DE CONVERSACIÓN:
1. Primer mensaje: Saluda con energía real (no robotica). Dile quién eres en una frase. Muestra que leíste lo que dijeron. Pide su número de teléfono de forma natural para que el equipo les llame.
2. Tienen teléfono: Pide el email. Menciona el link de agenda también para que puedan hacerlo solos si prefieren.
3. Tienen teléfono Y email: Cierra calidamente. El equipo les llama pronto. Listo.
4. 3+ mensajes sin info: Manda el link directo y déjalo en sus manos. Sin insistir más.

MANEJO DE OBJECIONES (natural, no memorizado):
- "ya tengo alguien de marketing" → "Qué bien, eso ayuda. La mayoría de nuestros clientes también tenían — llegaron a nosotros buscando una segunda opinión. ¿En qué están enfocados ahorita?"
- "no me interesa" → Respeta completamente. "Está bien, sin presión. Si en algún momento cambia, aquí estamos." Punto.
- "cuánto cobran?" → "Eso depende de lo que necesitas — por eso la llamada es gratis, para ver si encajamos bien. ¿Cuál es tu meta más grande ahorita con el negocio?"
- "solo estaba curioseando" → Trátalo como interés genuino. "Jajaja qué bueno que curioseaste entonces. ¿Qué fue lo que llamó tu atención?"
- "no tengo tiempo" → "Entiendo, la llamada es de 30 minutos. Si me dices cuándo tienes un momento esta semana lo coordinamos."

ESTILO DE TEXTO (esto es lo que te hace humano):
- Mensajes cortos. 1-3 oraciones máximo. Nunca párrafos.
- Lowercase cuando encaje: "dale, perfecto" / "ah qué bien" / "eso tiene sentido"
- Reacciones reales: "uff", "ahhh entiendo", "qué nota", "jajaja dale", "mira qué interesante"
- Emojis: máximo 1 por mensaje, solo si encaja de verdad. No como decoración.
- Espeja su energía: si son casuales, tú casual. Si son formales, tú profesional pero cálido.
- Si mandan un emoji solo o "ok" o "👍": responde breve y sigue el flow. No exageres.
- Nunca termines todos los mensajes con pregunta. A veces solo afirmas y esperas.

SOBRE JRZ MARKETING:
- Agencia bilingüe de marketing y estrategia digital en Orlando, Florida.
- Servicios: automatización con IA, redes sociales, branding, páginas web, sistemas completos de marketing.
- Página web: jrzmarketing.com | Consulta gratis: ${BOOKING_URL}

REGLAS ABSOLUTAS:
- Máximo 2-3 oraciones cortas por mensaje. Nunca párrafos. Nunca listas largas.
- No pidas teléfono Y email en el mismo mensaje — de uno en uno.
- No repitas la misma frase de apertura dos veces en la misma conversación.
- NUNCA suenes como un bot, un formulario, o un script de ventas.
- NUNCA te reintroduzcas si ya hay historial. Ya dijiste quién eres. No lo repitas.
- Si el mensaje de la persona no tiene sentido o está muy incompleto: pregunta qué necesitan de forma directa y amigable.
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

async function getGHLContact(contactId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    const c = res.data?.contact || res.data;
    return { phone: c?.phone || null, email: c?.email || null, tags: c?.tags || [] };
  } catch {
    return { phone: null, email: null, tags: [] };
  }
}

async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      {
        headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15' },
        params: { limit: 50 },
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
  // Scan ALL messages — inbound first (most reliable), then outbound as fallback
  // (Armando's replies often echo back "tienes su teléfono (XXX)" which we can use)
  const inbound  = messages.filter(m => m.direction === 'inbound');
  const outbound = messages.filter(m => m.direction === 'outbound');
  for (const msg of [...inbound, ...outbound]) {
    const body = msg.body || msg.message || '';
    if (!body) continue;
    if (!foundPhone) { const m = body.match(phoneRegex); if (m) foundPhone = m[0].trim(); }
    if (!foundEmail) { const m = body.match(emailRegex); if (m) foundEmail = m[0].trim(); }
    if (foundPhone && foundEmail) break;
  }
  return { foundPhone, foundEmail };
}

async function getArmandoReply(incomingMessage, contactName, contactId, conversationId, channel = 'IG') {
  const count = (contactMessageCount.get(contactId) || 0) + 1;
  contactMessageCount.set(contactId, count);

  // Load all memory stores in parallel
  const [contactMemory, competitorInsights, compPainPoints, armandoRules, objectionMemory] = await Promise.all([
    loadContactMemory(contactId),
    loadCompetitorInsights(),
    loadCompetitorPainPoints(),
    loadArmandoRules(),
    loadObjectionMemory(),
  ]);

  const hour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hour);
  const timeGreeting   = h < 12 ? 'Buenos días'   : h < 18 ? 'Buenas tardes'   : 'Buenas noches';
  const timeGreetingEN = h < 12 ? 'Good morning'  : h < 18 ? 'Good afternoon'  : 'Good evening';

  let foundPhone = null;
  let foundEmail = null;
  let historyCount = count;
  let claudeHistory = [];

  // Pull existing contact info from GHL first (most reliable source)
  const ghlContact = await getGHLContact(contactId);
  foundPhone = ghlContact.phone || null;
  foundEmail = ghlContact.email || null;

  if (conversationId) {
    const messages = await getConversationHistory(conversationId);
    // Only extract from conversation if GHL doesn't have it yet
    if (!foundPhone || !foundEmail) {
      const extracted = extractContactInfo(messages);
      if (!foundPhone) foundPhone = extracted.foundPhone;
      if (!foundEmail) foundEmail = extracted.foundEmail;
    }
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

  // Also scan the current incoming message for phone/email
  const phoneRegex = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  if (!foundPhone) { const m = incomingMessage.match(phoneRegex); if (m) foundPhone = m[0].trim(); }
  if (!foundEmail) { const m = incomingMessage.match(emailRegex); if (m) foundEmail = m[0].trim(); }
  console.log(`Contact info — phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}, msg #: ${historyCount}`);

  const alreadyHavePhone = !!foundPhone;
  const alreadyHaveEmail = !!foundEmail;
  const hasBoth = alreadyHavePhone && alreadyHaveEmail;

  // Assign A/B closing variant for this contact (persists in memory per contact)
  const abVariant = await assignClosingVariant(contactId);
  const closingInstruction = CLOSING_VARIANTS[abVariant].instruction(BOOKING_URL);

  // Stage instructions — never ask for info we already have
  let stageInstruction = '';
  if (historyCount === 1) {
    // Message 1 — greet + ask for phone AND email
    stageInstruction = hasBoth
      ? `PRIMER MENSAJE — ya tienes teléfono (${foundPhone}) y email (${foundEmail}). Saluda con "${timeGreeting}", preséntate como Armando de JRZ Marketing, y ofrece agendar directamente: ${BOOKING_URL}. Sin pedir nada — ya lo tienes todo.`
      : alreadyHavePhone
        ? `PRIMER MENSAJE — ya tienes su teléfono (${foundPhone}). Saluda, preséntate, y pide solo el EMAIL en la misma oración.`
        : alreadyHaveEmail
          ? `PRIMER MENSAJE — ya tienes su email (${foundEmail}). Saluda, preséntate, y pide solo el TELÉFONO en la misma oración.`
          : `PRIMER MENSAJE. Saluda con "${timeGreeting}" (o "${timeGreetingEN}" si escribió en inglés). Preséntate como Armando, Community Manager de JRZ Marketing. Reconoce lo que dijeron en UNA oración. Luego pide su TELÉFONO y EMAIL — diles que el equipo los contactará para agendar su llamada gratuita. Natural, directo, humano.`;
  } else if (hasBoth) {
    stageInstruction = `Ya tienes teléfono (${foundPhone}) y email (${foundEmail}). NO pidas más datos. Cierra calidamente — el equipo les contactará pronto. Muévelos al booking: ${BOOKING_URL}`;
  } else if (alreadyHavePhone && !alreadyHaveEmail) {
    stageInstruction = `Tienes su teléfono (${foundPhone}) pero falta el EMAIL. Pídelo en una sola oración. ${historyCount >= 3 ? `También manda el link directo: ${BOOKING_URL}` : ''}`;
  } else if (!alreadyHavePhone && alreadyHaveEmail) {
    stageInstruction = `Tienes su email (${foundEmail}) pero falta el TELÉFONO. Pídelo en una sola oración. ${historyCount >= 3 ? `También manda el link directo: ${BOOKING_URL}` : ''}`;
  } else if (historyCount === 2) {
    // Message 2 — ask phone + email again + A/B closing style
    stageInstruction = `Segundo mensaje — todavía sin teléfono ni email. Responde brevemente a lo que dijeron y vuelve a pedir TELÉFONO y EMAIL en la misma oración. Aplica también: ${closingInstruction}`;
  } else {
    // Message 3+ — stop asking, drop the link directly
    stageInstruction = `Mensaje #${historyCount} — NO pidas más teléfono ni email por mensaje. Cierra directo con el link: manda "${BOOKING_URL}" de forma natural y con energía. Algo como "Mira, lo mejor es que lo agendemos directo — aquí la llamada gratis: ${BOOKING_URL}" y listo. Sin más preguntas.`;
  }

  // Message 3 — offer calendar slots (book a time)
  // Message 4 — ask if they want a live call right now (TCPA: consent only)
  let callOfferInstruction = '';
  const pendingSlots = pendingBookingSlots.get(contactId);

  if (historyCount === 3 && !pendingSlots && !blandConsentAsked.has(contactId)) {
    try {
      const slots = await getAvailableSlots(3);
      if (slots.length > 0) {
        pendingBookingSlots.set(contactId, slots);
        const slotList = slots.map((s, i) => `${i + 1}. ${formatSlot(s)}`).join('\n');
        callOfferInstruction = `\nAGENDA: Ofrece agendar una llamada gratuita de 15 minutos con Jose — incluye estas opciones disponibles de forma natural:\n${slotList}\nPídeles que respondan con 1, 2 o 3 para confirmar. Solo ofrece esto una vez.`;
      }
    } catch (err) {
      console.error('[Calendar] Slot fetch failed:', err.message);
    }
  }

  if (historyCount === 4 && !blandConsentAsked.has(contactId) && !blandCallsSent.has(contactId)) {
    blandConsentAsked.add(contactId);
    callOfferInstruction += `\nLLAMADA: Pregunta de forma natural y breve si prefieren que les llamen ahora mismo en vez de agendar: "¿Prefieres que te llame ahora para platicarlo en 2 minutos?" (español) o "Would you prefer I call you right now instead?" (inglés). Solo una vez.`;
  }

  // Detect if contact is choosing a previously offered calendar slot
  const slotChoiceInstruction = pendingSlots
    ? `\nSLOT DETECTION: Si el mensaje actual contiene "1", "2", "3", "primero", "segundo", "tercero", "first", "second", "third" o una hora específica que coincide con las opciones ofrecidas — devuelve slotChoice:1, slotChoice:2, o slotChoice:3 en el JSON. Si no están eligiendo un slot, devuelve slotChoice:0.`
    : '';

  const systemWithContext = `${ARMANDO_PROMPT}

--- CONTEXTO ACTUAL (solo para ti, no lo menciones) ---
Nombre de la persona: ${contactName || 'desconocido'}
Canal: ${channel === 'Live_Chat' ? 'Chat del website (persona que visitó jrzmarketing.com — alta intención)' : channel === 'FB' ? 'Facebook Messenger' : channel === 'IG' ? 'Instagram DM' : channel === 'SMS' ? 'SMS/WhatsApp' : channel}
Hora: ${timeGreeting} / ${timeGreetingEN}
Teléfono en sistema: ${foundPhone || 'NO'}
Email en sistema: ${foundEmail || 'NO'}
Número de mensaje: ${historyCount}
AJUSTE POR CANAL: ${channel === 'Live_Chat' ? 'Esta persona está EN tu website AHORA MISMO — tiene altísima intención. Sé más directo y rápido hacia el booking. No les hagas esperar.' : channel === 'SMS' ? 'Es SMS/WhatsApp — mensajes aún más cortos, máximo 2 oraciones.' : 'Canal social — sé cálido y natural.'}
IDIOMA: ${historyCount === 1 ? `Detecta del mensaje actual y mantén ESE idioma toda la conversación.` : `Usa el MISMO idioma de tu primer respuesta. NO cambies.`}

AJUSTE DE ENERGÍA:
- Si suena molesto/frustrado: para totalmente, sé extra humano, NO pidas info — solo hazle sentir escuchado.
- Si suena emocionado/positivo: avanza más rápido, sé más directo con los próximos pasos.
- Si es neutral: fluye natural.

DETECCIÓN DE INTENCIÓN:
Lee el mensaje y decide si esta persona tiene una intención de negocio real o es una conversación personal/casual.
- Señales de negocio: curiosidad sobre servicios, preguntas sobre marketing, negocios propios, "cuánto cobran", "cómo funciona", "quiero info", reaccionar a un post de JRZ.
- Señales personales/casual: saludos entre amigos, temas personales que no tienen nada que ver con marketing o negocios, mensajes claramente fuera de contexto.

MEMORIA DE ESTE CONTACTO (conversaciones previas):
- Tipo de negocio: ${contactMemory.businessType || 'desconocido'}
- Pain points detectados antes: ${(contactMemory.painPoints || []).join(', ') || 'ninguno aún'}
- Intereses detectados: ${(contactMemory.interests || []).join(', ') || 'ninguno aún'}
- Mensajes históricos: ${contactMemory.messageCount || 0}
- Estado: ${contactMemory.bookingStatus || 'none'}
${contactMemory.messageCount > 0 ? '⚠️ Ya conoces a esta persona — NO te presentes de nuevo. Sigue la conversación naturalmente.' : ''}

LO QUE LA COMPETENCIA NO HACE (posiciónate sutilmente, sin nombrarlos):
${(competitorInsights.competitorWeaknesses || []).slice(0, 3).join(', ') || 'servicio bilingüe real, IA integrada, acompañamiento directo del fundador'}

FRUSTRACIONES COMUNES CON OTRAS AGENCIAS (dirígelas de forma natural):
${(compPainPoints.painPoints || []).slice(0, 3).join(', ') || 'cobran caro sin resultados, no hablan español de verdad, desaparecen después de vender'}

${(armandoRules.rules || []).length > 0 ? `REGLAS DE ESTA SEMANA (aprendidas de conversaciones reales — síguelas):
${(armandoRules.rules || []).map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}

${detectObjection(incomingMessage) ? `⚠️ OBJECIÓN DETECTADA: "${detectObjection(incomingMessage)}"
Respuestas que han convertido antes:
${((objectionMemory[detectObjection(incomingMessage)] || {}).bestResponses || []).slice(0, 2).join('\n') || 'Sin datos aún — usa tu mejor criterio. Empatiza primero, luego redirige.'}` : ''}

TU TAREA PARA ESTE MENSAJE: ${stageInstruction}${callOfferInstruction}${slotChoiceInstruction}

Responde SOLO en este formato JSON exacto (sin texto extra):
{"reply":"...","leadQuality":"none|interested|qualified|hot","sentiment":"positive|neutral|annoyed","shouldEngage":true,"wantsCall":false,"slotChoice":0,"businessType":"tipo de negocio detectado o vacío","painPoints":["pain point detectado"],"interests":["interés detectado"]}

shouldEngage: true si el mensaje tiene intención de negocio o es un primer contacto legítimo. false si es claramente una conversación personal/casual que no tiene que ver con marketing.
leadQuality: none=desinteresado, interested=enganchado/sin info, qualified=teléfono O email, hot=AMBOS
sentiment: positive=emocionado/amigable, neutral=normal, annoyed=frustrado/impaciente
wantsCall: true ONLY if the person explicitly said yes to a call offer (sí, yes, dale, claro, ok, llámame, call me). false otherwise.
slotChoice: 1, 2, or 3 if person is picking a calendar slot. 0 if not.`;

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
      // Update and save contact memory (fire-and-forget)
      const updatedMemory = {
        ...contactMemory,
        businessType: parsed.businessType || contactMemory.businessType || '',
        painPoints:   [...new Set([...(contactMemory.painPoints || []), ...(parsed.painPoints || [])])].slice(0, 10),
        interests:    [...new Set([...(contactMemory.interests || []),   ...(parsed.interests || [])])].slice(0, 10),
        lastMessage:  incomingMessage,
        messageCount: (contactMemory.messageCount || 0) + 1,
      };
      saveContactMemory(contactId, updatedMemory); // intentionally no await
      // Log objection response if an objection was detected
      const objType = detectObjection(incomingMessage);
      if (objType && parsed.reply) logObjectionResponse(objType, parsed.reply, contactId);
      // Log weekly win when lead goes hot
      if (parsed.leadQuality === 'hot' && parsed.reply) logWeeklyWin(contactId, parsed.reply, 'hot_lead');
      return {
        reply: parsed.reply,
        leadQuality: parsed.leadQuality || 'none',
        sentiment: parsed.sentiment || 'neutral',
        shouldEngage: parsed.shouldEngage !== false,
        wantsCall: parsed.wantsCall === true,
        slotChoice: parsed.slotChoice || 0,
        foundPhone,
        foundEmail,
        contactMemory: updatedMemory,
        competitorInsights,
        compPainPoints,
      };
    }
    return { reply: text, leadQuality: 'none', sentiment: 'neutral', shouldEngage: true, foundPhone, foundEmail, contactMemory, competitorInsights, compPainPoints };
  } catch {
    return { reply: response.content[0].text, leadQuality: 'none', sentiment: 'neutral', shouldEngage: true, foundPhone, foundEmail, contactMemory, competitorInsights, compPainPoints };
  }
}

async function sendGHLReply(contactId, message, sendType) {
  await axios.post(
    'https://services.leadconnectorhq.com/conversations/messages',
    { type: sendType, contactId, message },
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
  );
}

// Send voice note as a tappable link in DM
async function sendGHLVoiceNote(contactId, audioUrl, sendType) {
  await sendGHLReply(contactId, `🎧 Toca para escucharme: ${audioUrl}`, sendType);
  console.log('[DM Voice] ✅ Voice link sent to', contactId);
}

// ═══════════════════════════════════════════════════════════
// BLAND.AI — OUTBOUND VOICE CALLS
// Armando calls hot leads within 2 minutes of phone capture
// ═══════════════════════════════════════════════════════════

async function triggerBlandCall(contactId, contactName, phoneNumber, contactMemory = {}) {
  if (!BLAND_API_KEY) { console.log('[Bland] No API key — skipping call'); return; }
  if (blandCallsSent.has(contactId)) { console.log('[Bland] Already called', contactId); return; }
  blandCallsSent.add(contactId);

  const businessType = contactMemory.businessType || 'business';
  const painPoints   = (contactMemory.painPoints || []).slice(0, 2).join(' and ');
  const firstName    = (contactName || '').split(' ')[0] || 'there';

  const task = `You are Armando, the friendly bilingual community manager for JRZ Marketing in Orlando, Florida. You just had a great conversation with ${firstName} over social media DM about their ${businessType}${painPoints ? ` — they mentioned challenges with ${painPoints}` : ''}.

Your ONLY goal on this call: have a warm 60-90 second conversation and book a FREE 15-minute strategy call with Jose Rivas, the founder of JRZ Marketing.

Rules:
- Start with: "Hi, is this ${firstName}? This is Armando from JRZ Marketing — we were just chatting on Instagram!"
- If they speak Spanish, switch to Spanish naturally and stay in Spanish
- Be warm, conversational, human — NOT robotic or scripted
- Reference their specific situation from the DM if relevant
- Mention the free 15-min call with Jose naturally: "Jose does a free 15-minute strategy session — no pitch, just real advice for your business"
- If they say yes → confirm they'll get a booking link by text/DM right after this call
- Keep it under 2 minutes — you are just following up on the DM, not doing a full pitch
- If they don't answer or go to voicemail → leave a brief friendly voicemail and end the call
- Never be pushy. If they say not interested → be gracious, say "No problem at all, have a great day!"`;

  try {
    const res = await axios.post('https://api.bland.ai/v1/calls', {
      phone_number: phoneNumber,
      task,
      voice:              '2f956520-a906-4f80-8da1-a518552652dc', // Joseph Corona clone
      language:           'auto',  // auto-detects English/Spanish
      webhook:            BLAND_WEBHOOK_URL,
      max_duration:       3,       // 3 min max — keeps it focused
      wait_for_greeting:  true,
      reduce_latency:     true,
      record:             true,
      metadata:           { contactId, contactName, source: 'armando_hot_lead' },
    }, {
      headers: { authorization: BLAND_API_KEY, 'Content-Type': 'application/json' },
    });
    console.log(`[Bland] ✅ Call triggered for ${contactName} (${phoneNumber}) — call_id: ${res.data?.call_id}`);
    return res.data?.call_id;
  } catch (err) {
    console.error('[Bland] Call failed:', err?.response?.data || err.message);
    blandCallsSent.delete(contactId); // allow retry on error
    return null;
  }
}

async function parseBlandTranscript(payload) {
  const contactId   = payload.metadata?.contactId;
  const contactName = payload.metadata?.contactName || 'Unknown';
  if (!contactId) return;

  const transcript = payload.concatenated_transcript || '';
  const summary    = payload.summary || '';
  const callLength = payload.call_length || 0;
  const endedBy    = payload.call_ended_by || '';

  console.log(`[Bland] Post-call for ${contactName} — ${callLength}s, ended by ${endedBy}`);

  try {
    // Ask Claude to parse the outcome
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages:   [{ role: 'user', content: `Parse this sales call transcript and return ONLY valid JSON: {"booked": true/false, "interested": true/false, "objection": "price|timing|competition|none", "sentiment": "positive|neutral|negative", "keyPoint": "one sentence summary"}\n\nTranscript:\n${transcript.slice(0, 2000)}\n\nSummary: ${summary}` }],
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);

    // Update contact memory with call outcome
    const mem = await loadContactMemory(contactId);
    mem.lastCallOutcome  = parsed.keyPoint;
    mem.callBooked       = parsed.booked;
    mem.callSentiment    = parsed.sentiment;
    mem.lastCallAt       = new Date().toISOString();
    saveContactMemory(contactId, mem);

    // Tag + pipeline update
    if (parsed.booked) {
      await tagContact(contactId, ['call-booked', 'armando-called']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.booking);
      logWeeklyWin(contactId, summary, 'call_booked');
      console.log(`[Bland] ✅ ${contactName} BOOKED on the call!`);
    } else if (parsed.interested) {
      await tagContact(contactId, ['call-interested', 'armando-called']);
    } else {
      await tagContact(contactId, ['call-no-show-or-declined', 'armando-called']);
    }

    if (parsed.objection && parsed.objection !== 'none') {
      logObjectionResponse(parsed.objection, summary, contactId);
    }
  } catch (err) {
    console.error('[Bland] Transcript parsing failed:', err.message);
    tagContact(contactId, ['armando-called']); // at minimum tag it
  }
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
    await sendEmail(OWNER_CONTACT_ID, subject, html);
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
    await sendEmail(contactId, subject, html);
    console.log(`Thank-you email sent to contact ${contactId}.`);
  } catch (err) {
    console.error('Failed to send thank-you email:', err?.response?.data || err.message);
  }
}

// ─── Profile IDs for analytics API ───────────────────────
const ANALYTICS_PROFILE_IDS = [
  '69571d84f8b32728afd7c45c', // Instagram
  '69571d95c63407b04d656891', // Facebook
  '69571db827f36d340ac94361', // LinkedIn Jose
  '69571dbe19b790b6ae98d688', // LinkedIn JRZ
  '69571dd3f8b327a382d7dbdf', // YouTube
  '69b64ef0dbe649d4431d3fcc', // TikTok Jose
  '69b64e8326ef3d3693ae68a9', // TikTok JRZ
];

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — SELF-LEARNING ANALYTICS
// Every Monday: pull 7-day stats → Claude finds patterns →
// saves a content strategy to Cloudinary → all future
// content generation uses it to improve week over week.
// ═══════════════════════════════════════════════════════════

const STRATEGY_URL    = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/content_strategy.json`;
const STRATEGY_PUB_ID = 'jrz/content_strategy';

// ═══════════════════════════════════════════════════════════
// A/B TESTING — CLOSING APPROACHES
// 4 variants. Weekly Claude analysis shifts traffic to winner.
// Persisted in Cloudinary so it survives server restarts.
// ═══════════════════════════════════════════════════════════
const AB_URL    = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/ab_closing_test.json`;
const AB_PUB_ID = 'jrz/ab_closing_test';

// ── Armando Learning System — 5 persistent memory stores ─────────────────────
const CONTACT_MEMORY_BASE  = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/contact_memory_';
const VOICE_FEEDBACK_URL   = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/voice_feedback.json';
const VOICE_FEEDBACK_PID   = 'jrz/voice_feedback';
const ENGAGEMENT_URL       = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/engagement_patterns.json';
const ENGAGEMENT_PID       = 'jrz/engagement_patterns';
const COMPETITOR_INS_URL   = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/competitor_insights.json';
const COMPETITOR_INS_PID   = 'jrz/competitor_insights';
const COMPETITOR_PAIN_URL  = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/competitor_pain_points.json';
const COMPETITOR_PAIN_PID  = 'jrz/competitor_pain_points';

// ── Feature: Objection Memory ─────────────────────────────────────────────────
const OBJECTION_MEMORY_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/objection_memory.json';
const OBJECTION_MEMORY_PID = 'jrz/objection_memory';

// ── Feature: Self-Updating Rules ─────────────────────────────────────────────
const ARMANDO_RULES_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/armando_rules.json';
const ARMANDO_RULES_PID = 'jrz/armando_rules';
const WEEKLY_WINS_URL   = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/weekly_wins.json';
const WEEKLY_WINS_PID   = 'jrz/weekly_wins';

// ── Feature: Reel Attribution ─────────────────────────────────────────────────
const REEL_LOG_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/reel_log.json';
const REEL_LOG_PID = 'jrz/reel_log';

// In-memory: contactId → variant letter assigned for this session
const contactVariantMap = new Map();

// The 4 closing variants injected into Armando's stage instruction
const CLOSING_VARIANTS = {
  A: {
    name: 'Direct',
    description: 'Straight to the point. No fluff. Quick link.',
    instruction: (url) =>
      `CIERRE DIRECTO: Responde brevemente a lo que dijeron, luego ve al grano — "¿Tienes 30 minutos esta semana? La llamada es gratis, te digo exactamente qué necesitas." Manda el link: ${url}. Sin rodeos.`,
  },
  B: {
    name: 'Social Proof',
    description: 'Quick win story from a similar business, then invite them.',
    instruction: (url) =>
      `CIERRE CON PRUEBA SOCIAL: Menciona brevemente un cliente similar al de ellos (restaurante, constructora, gimnasio, etc.) que mejoró resultados con JRZ — en UNA oración, sin exagerar. Luego invítalos a hablar: "¿Hablamos?" + link: ${url}`,
  },
  C: {
    name: 'Pain Point',
    description: 'Name their specific problem, position the call as the solution.',
    instruction: (url) =>
      `CIERRE POR DOLOR: Nombra el problema específico que detectas en su mensaje (sin inventar, usa lo que te dijeron). Luego: "Eso es exactamente lo que resolvemos. Una llamada de 30 minutos y te explico cómo." + link: ${url}. Hazlo sentir que los entiendes.`,
  },
  D: {
    name: 'Curiosity Gap',
    description: 'Tease something they can only get on the call.',
    instruction: (url) =>
      `CIERRE POR CURIOSIDAD: Di algo que genere intriga — "Lo que hacemos diferente no lo puedo explicar bien por mensaje, necesito mostrártelo." No des más detalles. Solo invítalos: "¿Me das 30 minutos?" + link: ${url}. Que quieran saber.`,
  },
};

async function loadABTestData() {
  try {
    const res = await axios.get(AB_URL, { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    // Default starting state — equal weights
    return {
      variants: {
        A: { name: 'Direct',        sent: 0, conversions: 0 },
        B: { name: 'Social Proof',  sent: 0, conversions: 0 },
        C: { name: 'Pain Point',    sent: 0, conversions: 0 },
        D: { name: 'Curiosity Gap', sent: 0, conversions: 0 },
      },
      weights: { A: 25, B: 25, C: 25, D: 25 },
      lastOptimized: null,
      history: [],
    };
  }
}

async function saveABTestData(data) {
  try {
    const ts      = Math.floor(Date.now() / 1000);
    const sigStr  = `overwrite=true&public_id=${AB_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig     = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form    = new FormData();
    const buf     = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file',          buf,  { filename: 'ab_closing_test.json', contentType: 'application/json' });
    form.append('public_id',     AB_PUB_ID);
    form.append('resource_type', 'raw');
    form.append('timestamp',     String(ts));
    form.append('api_key',       CLOUDINARY_API_KEY);
    form.append('signature',     sig);
    form.append('overwrite',     'true');
    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`,
      form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 }
    );
  } catch (err) {
    console.error('[AB] Failed to save test data:', err.message);
  }
}

// ─── Generic Cloudinary raw JSON save ────────────────────────────────────────
async function saveCloudinaryJSON(publicId, data) {
  try {
    const ts     = Math.floor(Date.now() / 1000);
    // resource_type must NOT be included in the signature string per Cloudinary docs
    const sigStr = `overwrite=true&public_id=${publicId}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig    = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form   = new FormData();
    const buf    = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file', buf, { filename: `${publicId.split('/').pop()}.json`, contentType: 'application/json' });
    form.append('public_id', publicId); form.append('resource_type', 'raw');
    form.append('timestamp', String(ts)); form.append('api_key', CLOUDINARY_API_KEY);
    form.append('signature', sig); form.append('overwrite', 'true');
    await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 });
  } catch (err) { console.error(`[Memory] Failed to save ${publicId}:`, err.message); }
}

// ─── 1. CONTACT MEMORY ───────────────────────────────────────────────────────
async function loadContactMemory(contactId) {
  try {
    const res = await axios.get(`${CONTACT_MEMORY_BASE}${contactId}.json`, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { businessType: '', painPoints: [], interests: [], lastMessage: '', messageCount: 0, bookingStatus: 'none' }; }
}
async function saveContactMemory(contactId, data) {
  await saveCloudinaryJSON(`jrz/contact_memory_${contactId}`, data);
}

// ─── 2. VOICE FEEDBACK ───────────────────────────────────────────────────────
async function loadVoiceFeedback() {
  try {
    const res = await axios.get(VOICE_FEEDBACK_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { bookings: [], winningPatterns: '', updatedAt: null }; }
}
async function saveVoiceFeedback(data) { await saveCloudinaryJSON(VOICE_FEEDBACK_PID, data); }

async function updateWinningVoicePatterns() {
  try {
    const feedback = await loadVoiceFeedback();
    if (feedback.bookings.length < 3) return;
    const summary = feedback.bookings.slice(-30).map(b =>
      `Negocio: ${b.businessType}, Pain points: ${(b.painPoints||[]).join(',')||'N/A'}, Mensajes antes de booking: ${b.messageCount}`
    ).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 300,
      messages: [{ role: 'user', content: `Analiza estos clientes que agendaron con JRZ Marketing:\n${summary}\n\nDevuelve JSON: {"topBusinessTypes":[],"topPainPoints":[],"voiceScriptRecommendation":"una sola oración sobre qué angle cierra mejor"}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    feedback.winningPatterns = `Negocios que más convierten: ${parsed.topBusinessTypes.join(', ')}. Pain points que cierran: ${parsed.topPainPoints.join(', ')}. ${parsed.voiceScriptRecommendation}`;
    feedback.updatedAt = new Date().toISOString();
    await saveVoiceFeedback(feedback);
    console.log('[Learning] ✅ Voice patterns updated:', feedback.winningPatterns);
  } catch (err) { console.error('[Learning] Voice pattern update failed:', err.message); }
}

// ─── 3. ENGAGEMENT PATTERNS ──────────────────────────────────────────────────
async function loadEngagementPatterns() {
  try {
    const res = await axios.get(ENGAGEMENT_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { topHooks: [], contentAngles: [], emotionalTriggers: [], updatedAt: null }; }
}
async function saveEngagementPatterns(data) { await saveCloudinaryJSON(ENGAGEMENT_PID, data); }

async function runEngagementLearning() {
  try {
    console.log('[Learning] Analyzing engagement patterns...');
    const res = await axios.get(
      `https://services.leadconnectorhq.com/social-media-posting/${GHL_LOCATION_ID}/posts`,
      { params: { skip: 0, limit: 20, status: 'published' }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' }, timeout: 15000 }
    );
    const posts = (res.data?.posts || res.data?.data || []).filter(p => p.caption || p.description);
    if (posts.length < 3) { console.log('[Learning] Not enough posts to analyze'); return; }
    const topPosts = posts.slice(0, 10).map(p => p.caption || p.description || '').filter(Boolean).slice(0, 5).join('\n---\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: `Analiza estos posts de JRZ Marketing y extrae los patrones que hacen que enganchen:\n${topPosts}\n\nDevuelve JSON: {"topHooks":["frase gancho 1","frase gancho 2"],"contentAngles":["ángulo 1","ángulo 2"],"emotionalTriggers":["disparador 1","disparador 2"]}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    parsed.updatedAt = new Date().toISOString();
    await saveEngagementPatterns(parsed);
    console.log('[Learning] ✅ Engagement patterns saved');
  } catch (err) { console.error('[Learning] Engagement analysis failed:', err.message); }
}

// ─── 4. COMPETITOR INSIGHTS ──────────────────────────────────────────────────
async function loadCompetitorInsights() {
  try {
    const res = await axios.get(COMPETITOR_INS_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { competitorWeaknesses: [], contentAngles: [], opportunity: '', updatedAt: null }; }
}
async function saveCompetitorInsights(data) { await saveCloudinaryJSON(COMPETITOR_INS_PID, data); }

// ─── 5. COMPETITOR PAIN POINTS (from reviews) ────────────────────────────────
async function loadCompetitorPainPoints() {
  try {
    const res = await axios.get(COMPETITOR_PAIN_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { painPoints: [], frustrations: [], updatedAt: null }; }
}
async function saveCompetitorPainPoints(data) { await saveCloudinaryJSON(COMPETITOR_PAIN_PID, data); }

// ─── OBJECTION MEMORY ────────────────────────────────────────────────────────
async function loadObjectionMemory() {
  try {
    const res = await axios.get(OBJECTION_MEMORY_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return {}; }
}
async function saveObjectionMemory(data) { await saveCloudinaryJSON(OBJECTION_MEMORY_PID, data); }

function detectObjection(message) {
  const m = message.toLowerCase();
  if (m.match(/muy caro|too expensive|precio alto|no tengo presupuesto|cuesta mucho|no puedo pagar|es mucho dinero/)) return 'too_expensive';
  if (m.match(/ahora no|not now|después|luego|más adelante|ocupado|no es buen momento|busy|later/)) return 'not_now';
  if (m.match(/ya tengo|ya trabajo con|tengo agencia|tengo alguien|already have/)) return 'already_have_agency';
  if (m.match(/no tengo tiempo|sin tiempo|muy ocupado|no time/)) return 'no_time';
  if (m.match(/solo mirando|just looking|solo información|solo info|just browsing/)) return 'just_looking';
  return null;
}

async function logObjectionResponse(objectionType, response, contactId) {
  try {
    const mem = await loadObjectionMemory();
    if (!mem[objectionType]) mem[objectionType] = { bestResponses: [], convertedCount: 0, pending: [] };
    mem[objectionType].pending.push({ contactId, response, timestamp: new Date().toISOString(), outcome: 'pending' });
    mem[objectionType].pending = mem[objectionType].pending.slice(-50); // keep last 50
    await saveObjectionMemory(mem);
  } catch (err) { console.error('[Objection] Log failed:', err.message); }
}

async function markObjectionConverted(contactId) {
  try {
    const mem = await loadObjectionMemory();
    let changed = false;
    for (const type of Object.keys(mem)) {
      if (!mem[type].pending) continue;
      for (const entry of mem[type].pending) {
        if (entry.contactId === contactId && entry.outcome === 'pending') {
          entry.outcome = 'converted';
          mem[type].convertedCount = (mem[type].convertedCount || 0) + 1;
          // Promote to bestResponses if not already there
          if (!mem[type].bestResponses.includes(entry.response)) {
            mem[type].bestResponses.unshift(entry.response);
            mem[type].bestResponses = mem[type].bestResponses.slice(0, 5);
          }
          changed = true;
        }
      }
    }
    if (changed) await saveObjectionMemory(mem);
  } catch (err) { console.error('[Objection] markConverted failed:', err.message); }
}

async function runObjectionLearning() {
  try {
    console.log('[Learning] Running objection pattern analysis...');
    const mem = await loadObjectionMemory();
    const summary = Object.entries(mem).map(([type, data]) => (
      `${type}: ${data.convertedCount || 0} conversions, best responses: ${(data.bestResponses || []).slice(0, 2).join(' | ')}`
    )).join('\n');
    if (!summary) return;
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `You are analyzing objection handling data for a Spanish-speaking AI sales bot. Based on these results, return ONLY valid JSON: { "insights": "what's working", "newResponses": { "too_expensive": "one new counter", "not_now": "one new counter", "already_have_agency": "one new counter" } }\n\n${summary}` }],
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    // Inject new AI-generated responses into best responses
    for (const [type, response] of Object.entries(parsed.newResponses || {})) {
      if (!mem[type]) mem[type] = { bestResponses: [], convertedCount: 0, pending: [] };
      if (response && !mem[type].bestResponses.includes(response)) {
        mem[type].bestResponses.push(response);
        mem[type].bestResponses = mem[type].bestResponses.slice(0, 5);
      }
    }
    await saveObjectionMemory(mem);
    console.log('[Learning] ✅ Objection patterns updated:', parsed.insights);
  } catch (err) { console.error('[Learning] Objection learning failed:', err.message); }
}

// ─── SELF-UPDATING SYSTEM PROMPT ─────────────────────────────────────────────
async function loadArmandoRules() {
  try {
    const res = await axios.get(ARMANDO_RULES_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { rules: [], updatedAt: null }; }
}
async function saveArmandoRules(data) { await saveCloudinaryJSON(ARMANDO_RULES_PID, data); }

async function loadWeeklyWins() {
  try {
    const res = await axios.get(WEEKLY_WINS_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return []; }
}
async function saveWeeklyWins(data) { await saveCloudinaryJSON(WEEKLY_WINS_PID, data); }

async function logWeeklyWin(contactId, reply, outcome) {
  try {
    const wins = await loadWeeklyWins();
    wins.push({ contactId, reply: reply.slice(0, 300), outcome, timestamp: new Date().toISOString() });
    await saveWeeklyWins(wins.slice(-100)); // keep last 100 wins
  } catch (err) { console.error('[Rules] logWeeklyWin failed:', err.message); }
}

async function runSelfUpdateRules() {
  try {
    console.log('[Rules] Running self-update of Armando\'s playbook...');
    const [wins, engPatterns, objMem] = await Promise.all([
      loadWeeklyWins(),
      loadEngagementPatterns(),
      loadObjectionMemory(),
    ]);
    const winSummary = wins.slice(-30).map(w => `[${w.outcome}] "${w.reply}"`).join('\n');
    const engSummary = engPatterns.bestTopics ? `Best topics: ${engPatterns.bestTopics.join(', ')}. Best hook style: ${engPatterns.bestHookStyle}` : '';
    const objSummary = Object.entries(objMem).map(([t, d]) => `${t}: ${d.convertedCount || 0} conversions`).join(', ');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `You are improving the behavior rules for Armando, a Spanish-speaking AI sales bot for JRZ Marketing (Orlando, FL). Analyze this week's data and return ONLY valid JSON with exactly this structure:\n{"rules":["rule1","rule2","rule3","rule4","rule5"],"weeklyWins":${wins.length},"updatedAt":"${new Date().toISOString()}"}\n\nWins this week:\n${winSummary}\n\nEngagement: ${engSummary}\nObjections: ${objSummary}\n\nWrite 5 specific behavior rules in Spanish that will make Armando more effective next week. Rules should be actionable instructions like "Cuando alguien menciona precio, primero pregunta sobre su ROI antes de defender el costo".` }],
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    await saveArmandoRules(parsed);
    // Clear weekly wins for next week
    await saveWeeklyWins([]);
    console.log('[Rules] ✅ Armando playbook updated with', parsed.rules?.length, 'new rules');
  } catch (err) { console.error('[Rules] Self-update failed:', err.message); }
}

// ─── REEL ATTRIBUTION ─────────────────────────────────────────────────────────
async function loadReelLog() {
  try {
    const res = await axios.get(REEL_LOG_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return []; }
}
async function saveReelLog(data) { await saveCloudinaryJSON(REEL_LOG_PID, data); }

async function logReelPost(hook, caption) {
  try {
    const log = await loadReelLog();
    log.unshift({ hook, caption: caption?.slice(0, 200) || '', postedAt: new Date().toISOString(), dmCount: 0, attributedContacts: [] });
    await saveReelLog(log.slice(0, 50)); // keep last 50 reels
  } catch (err) { console.error('[Attribution] logReelPost failed:', err.message); }
}

async function checkReelAttribution(contactId) {
  try {
    const log = await loadReelLog();
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
    const recentReel = log.find(r => new Date(r.postedAt).getTime() > cutoff && !r.attributedContacts.includes(contactId));
    if (!recentReel) return null;
    // Update reel log — increment dmCount and add contactId
    recentReel.dmCount = (recentReel.dmCount || 0) + 1;
    recentReel.attributedContacts.push(contactId);
    saveReelLog(log); // fire-and-forget
    return recentReel.hook;
  } catch { return null; }
}

async function runReviewMining() {
  try {
    console.log('[Learning] Mining competitor reviews...');
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) { console.log('[Learning] No SERPAPI_KEY — skipping review mining'); return; }
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google_maps', q: 'marketing agency orlando florida', hl: 'en', gl: 'us', api_key: SERPAPI_KEY },
      timeout: 15000
    });
    const results = res.data?.local_results || [];
    const reviews = results.slice(0, 5).flatMap(r => (r.reviews || []).filter(rv => rv.rating <= 2).map(rv => rv.snippet)).filter(Boolean).slice(0, 15);
    if (reviews.length === 0) { console.log('[Learning] No low-rated reviews found'); return; }
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: `Estas son reseñas negativas (1-2 estrellas) de agencias de marketing en Orlando. Extrae los problemas más comunes que los clientes mencionan:\n${reviews.join('\n')}\n\nDevuelve JSON: {"painPoints":["problema 1","problema 2","problema 3"],"frustrations":["frustración 1","frustración 2"]}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    parsed.updatedAt = new Date().toISOString();
    await saveCompetitorPainPoints(parsed);
    console.log('[Learning] ✅ Competitor pain points saved:', parsed.painPoints);
  } catch (err) { console.error('[Learning] Review mining failed:', err.message); }
}

// Weighted random variant assignment — winner gets more traffic over time
async function assignClosingVariant(contactId) {
  if (contactVariantMap.has(contactId)) return contactVariantMap.get(contactId);
  const data = await loadABTestData();
  const w = data.weights;
  const total = w.A + w.B + w.C + w.D;
  let rand = Math.random() * total;
  let variant = 'A';
  for (const [v, weight] of Object.entries(w)) {
    rand -= weight;
    if (rand <= 0) { variant = v; break; }
  }
  contactVariantMap.set(contactId, variant);
  // Record the send
  data.variants[variant].sent++;
  await saveABTestData(data);
  console.log(`[AB] Contact ${contactId} assigned variant ${variant} (${CLOSING_VARIANTS[variant].name})`);
  return variant;
}

// Call this when a contact converts (gives phone or email)
async function recordABConversion(contactId) {
  const variant = contactVariantMap.get(contactId);
  if (!variant) return;
  const data = await loadABTestData();
  data.variants[variant].conversions++;
  await saveABTestData(data);
  console.log(`[AB] Conversion recorded for variant ${variant} (${CLOSING_VARIANTS[variant].name})`);
}

// Weekly: Claude analyzes results → adjusts weights → winner gets more traffic
async function runABTestAnalysis() {
  console.log('[AB] Running weekly A/B test analysis...');
  try {
    const data = await loadABTestData();
    const summary = Object.entries(data.variants).map(([v, s]) => {
      const rate = s.sent > 0 ? ((s.conversions / s.sent) * 100).toFixed(1) : '0.0';
      return `Variant ${v} (${s.name}): ${s.sent} sent, ${s.conversions} conversions, ${rate}% conversion rate`;
    }).join('\n');

    const prompt = `Eres el director de marketing de JRZ Marketing analizando los resultados del A/B test de cierres de venta de Armando (DM bot).

RESULTADOS DE ESTA SEMANA:
${summary}

Pesos actuales: A=${data.weights.A}%, B=${data.weights.B}%, C=${data.weights.C}%, D=${data.weights.D}%

VARIANTES:
A - Direct: cierre directo sin rodeos
B - Social Proof: historia de cliente similar + invitación
C - Pain Point: nombra su problema específico + solución
D - Curiosity Gap: genera intriga para que quieran la llamada

Tu tarea:
1. Analiza qué variante está convirtiendo mejor
2. Ajusta los pesos para la próxima semana — el ganador debe recibir más tráfico, pero no elimines ninguna variante (mínimo 10% cada una)
3. Suma total de pesos debe ser exactamente 100
4. Si hay pocos datos (menos de 5 sends por variante), mantén pesos iguales y espera más datos

Responde SOLO con JSON válido:
{
  "weights": {"A": number, "B": number, "C": number, "D": number},
  "winner": "A|B|C|D|none",
  "insight": "una oración sobre qué está funcionando y por qué"
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
    const prevWeights = { ...data.weights };

    data.weights = parsed.weights;
    data.lastOptimized = new Date().toISOString().split('T')[0];
    data.history.push({
      date: data.lastOptimized,
      winner: parsed.winner,
      insight: parsed.insight,
      oldWeights: prevWeights,
      newWeights: parsed.weights,
      snapshot: JSON.parse(JSON.stringify(data.variants)),
    });

    // Reset weekly counts after saving snapshot
    for (const v of Object.keys(data.variants)) {
      data.variants[v].sent = 0;
      data.variants[v].conversions = 0;
    }

    await saveABTestData(data);
    console.log(`[AB] ✅ Weights updated. Winner: ${parsed.winner}. Insight: ${parsed.insight}`);
    console.log(`[AB] New weights:`, parsed.weights);
    return parsed;
  } catch (err) {
    console.error('[AB] ❌ Analysis failed:', err.message);
    return null;
  }
}

async function loadContentStrategy() {
  try {
    const res = await axios.get(STRATEGY_URL, { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    return {
      bestTopics: ['IA y automatización', 'errores de marketing', 'leads perdidos'],
      bestHookStyle: 'question-based hooks outperform statements',
      bestDays: { instagram: 'saturday', facebook: 'monday', linkedin: 'thursday' },
      audienceInsights: '25–34 year-old male business owners, Orlando FL, respond to problem-focused content',
      avoidTopics: [],
      weeklyNotes: 'No data yet — baseline week.',
    };
  }
}

async function saveContentStrategy(strategy) {
  const ts       = Math.floor(Date.now() / 1000);
  const sigStr   = `overwrite=true&public_id=${STRATEGY_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(sigStr).digest('hex');
  const form = new FormData();
  const buf  = Buffer.from(JSON.stringify(strategy, null, 2));
  form.append('file',          buf,    { filename: 'content_strategy.json', contentType: 'application/json' });
  form.append('public_id',     STRATEGY_PUB_ID);
  form.append('resource_type', 'raw');
  form.append('timestamp',     String(ts));
  form.append('api_key',       CLOUDINARY_API_KEY);
  form.append('signature',     signature);
  form.append('overwrite',     'true');
  await axios.post(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`,
    form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 }
  );
}

async function getWeeklyStats() {
  const res = await axios.post(
    `https://services.leadconnectorhq.com/social-media-posting/statistics?locationId=${GHL_LOCATION_ID}`,
    { profileIds: ANALYTICS_PROFILE_IDS, platforms: ['instagram','facebook','linkedin','youtube','tiktok'] },
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
  );
  return res.data?.results || res.data;
}

async function runWeeklyAnalysis() {
  console.log('[Learn] Running weekly analytics analysis...');
  try {
    const [stats, prevStrategy] = await Promise.all([getWeeklyStats(), loadContentStrategy()]);

    const breakdown = stats?.breakdowns || {};
    const eng       = breakdown?.engagement || {};

    const prompt = `Eres el director de marketing de JRZ Marketing. Analiza estos datos de la semana pasada y actualiza la estrategia de contenido.

DATOS DE LA SEMANA:
- Impresiones totales: ${breakdown?.impressions?.total || 0} (cambio: ${breakdown?.impressions?.totalChange || 0}%)
- Alcance total: ${breakdown?.reach?.total || 0} (cambio: ${breakdown?.reach?.totalChange || 0}%)
- Instagram: ${breakdown?.impressions?.platforms?.instagram?.value || 0} impresiones, ${eng?.instagram?.likes || 0} likes, ${eng?.instagram?.comments || 0} comentarios, ${eng?.instagram?.shares || 0} shares
- Facebook: ${breakdown?.impressions?.platforms?.facebook?.value || 0} impresiones, ${eng?.facebook?.likes || 0} likes
- LinkedIn: ${breakdown?.impressions?.platforms?.linkedin?.value || 0} impresiones, ${eng?.linkedin?.likes || 0} likes
- TikTok: ${breakdown?.impressions?.platforms?.tiktok?.value || 0} impresiones
- YouTube: ${breakdown?.impressions?.platforms?.youtube?.value || 0} impresiones
- Nuevos seguidores: ${breakdown?.followers?.total || 0} (Instagram)
- Demografía: 53% hombres, 25-34 años es el grupo más grande
- Mejor día de impresiones: ${stats?.postPerformance?.impressions ? JSON.stringify(stats.postPerformance.impressions) : 'no data'}

ESTRATEGIA ANTERIOR:
${JSON.stringify(prevStrategy, null, 2)}

Responde SOLO con un JSON válido con esta estructura:
{
  "bestTopics": ["tema1", "tema2", "tema3"],
  "bestHookStyle": "descripción del estilo de hook que más funciona",
  "bestDays": {"instagram": "día", "facebook": "día", "linkedin": "día", "tiktok": "día"},
  "audienceInsights": "insights sobre la audiencia basados en los datos",
  "avoidTopics": ["temas que no funcionaron"],
  "weeklyNotes": "observaciones clave y ajustes para la próxima semana",
  "hookFormulas": ["fórmula de hook 1", "fórmula de hook 2", "fórmula de hook 3"]
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const newStrategy = JSON.parse(msg.content[0].text.trim());
    newStrategy.updatedAt = new Date().toISOString().split('T')[0];
    await saveContentStrategy(newStrategy);
    console.log('[Learn] ✅ Strategy updated:', newStrategy.weeklyNotes);
    return newStrategy;
  } catch (err) {
    console.error('[Learn] ❌ Weekly analysis failed:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// OPPORTUNITIES — Add contacts to Marketing Pipeline in GHL
// ═══════════════════════════════════════════════════════════

const opportunityCreatedContacts = new Set();

async function createOpportunity(contactId, contactName, stageId) {
  // Skip silently if we already created one this session
  if (opportunityCreatedContacts.has(contactId)) {
    console.log(`[Opportunity] Skipping — already created for ${contactId}`);
    return;
  }
  try {
    await axios.post(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        pipelineId:    MARKETING_PIPELINE_ID,
        locationId:    GHL_LOCATION_ID,
        name:          contactName || 'Lead',
        pipelineStageId: stageId,
        contactId,
        assignedTo:    GHL_USER_ID,
        status:        'open',
      },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    );
    opportunityCreatedContacts.add(contactId);
    console.log(`[Opportunity] ✅ Added ${contactName} (${contactId}) → stage ${stageId}`);
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.message || '';
    if (status === 400 && msg.toLowerCase().includes('duplicate')) {
      opportunityCreatedContacts.add(contactId); // mark so we don't try again
      console.log(`[Opportunity] Already exists for ${contactId} — skipping.`);
    } else {
      console.error(`[Opportunity] ❌ Failed for ${contactId}:`, err?.response?.data || err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2 — WARM DM OUTREACH
// When someone comments or follows → Armando DMs them
// within 60 seconds with a personalized message.
// Cooldown: never re-messages same contact within 7 days.
// ═══════════════════════════════════════════════════════════

const dmCooldown = new Map(); // contactId → last DM timestamp

async function sendWarmDM(contactId, triggerType, context = {}) {
  // Cooldown check — 7 days
  const lastDM = dmCooldown.get(contactId);
  if (lastDM && Date.now() - lastDM < 7 * 24 * 60 * 60 * 1000) return;
  dmCooldown.set(contactId, Date.now());

  // Get contact name if available
  let contactName = context.name || 'amigo';
  try {
    const c = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    contactName = c.data?.contact?.firstName || contactName;
  } catch (_) {}

  const prompts = {
    comment: `Alguien llamado ${contactName} comentó en uno de nuestros posts de JRZ Marketing en redes sociales. Escribe un DM corto, natural y humano de Armando Rivas (22 años, venezolano, Community Manager de JRZ Marketing) para iniciar una conversación. Menciona que viste su comentario, pregunta sobre su negocio, y de forma casual menciona que ofrecemos consultas gratuitas. MAX 3 oraciones. Sin hashtags. En español.`,
    follower: `Alguien llamado ${contactName} acaba de seguir la cuenta de JRZ Marketing en Instagram. Escribe un DM de bienvenida corto y humano de Armando Rivas. Agradece que siguió, pregunta qué tipo de negocio tiene, y menciona casualmente la consulta gratuita. MAX 3 oraciones. Sin hashtags. En español.`,
    form_fill: `Alguien llamado ${contactName} llenó un formulario de interés en JRZ Marketing. Escribe un DM de seguimiento rápido de Armando Rivas. Menciona que vio su información, pregunta cuál es su mayor reto de marketing ahora mismo, y propone hablar 15 minutos. MAX 3 oraciones. Sin hashtags. En español.`,
  };

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompts[triggerType] || prompts.comment }],
  });
  const dmText = msg.content[0].text.trim();

  // Send via GHL conversations API
  try {
    await sendEmail(contactId, '👋 Hola desde JRZ Marketing', `<p>${dmText}</p>`);
    console.log(`[WarmDM] ✅ Sent ${triggerType} DM to contact ${contactId}`);
    await createOpportunity(contactId, contactName, PIPELINE_STAGES.newLead);
    await tagContact(contactId, ['nurture-sequence']);
  } catch (err) {
    console.error('[WarmDM] ❌ Failed to send DM:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 3 — OUTBOUND PROSPECTING
// Runs Mon–Fri at 10am EST. Finds contacts in GHL tagged
// "outbound_pending", sends 15 personalized outreach
// messages per day, then tags them "outbound_sent".
// To add prospects: import contacts in GHL with tag
// "outbound_pending" (LinkedIn export, referrals, etc.)
// ═══════════════════════════════════════════════════════════

async function runDailyOutbound() {
  console.log('[Outbound] Running daily prospecting (50 contacts)...');
  try {
    // Fetch contacts tagged outbound_pending
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&tags=outbound_pending&limit=50`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    const contacts = res.data?.contacts || [];
    if (!contacts.length) {
      console.log('[Outbound] No pending prospects today.');
      return { sent: 0 };
    }

    let sent = 0;
    for (const contact of contacts) {
      const name     = contact.firstName || 'dueño de negocio';
      const business = contact.companyName || 'tu negocio';
      const city     = contact.city || 'Tampa';
      const industry = contact.tags?.find(t => ['restaurant','construccion','gym','tattoo','fitness'].some(k => t.toLowerCase().includes(k))) || '';

      // Generate personalized outreach via Claude
      const msg = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Eres Jose Rivas, fundador de JRZ Marketing — una agencia de marketing bilingüe (español e inglés) en Florida que ayuda a dueños de negocios hispanos a capturar más clientes y automatizar su seguimiento.

Escribe un mensaje de prospección corto, directo y personal para ${name}, dueño/a de ${business} en ${city}${industry ? `, en la industria de ${industry}` : ''}.

Contexto del cliente ideal: dueño hispano de negocio pequeño o mediano (restaurante, construcción, gimnasio, tattoo, etc.) en Tampa, Orlando o Miami. Tiene 30+ años. Trabaja duro pero pierde clientes por falta de seguimiento o sistema organizado.

Tono: estratégico, confiado, cálido. Habla de oportunidad, no de problemas. Como si fueras un colega exitoso que quiere ayudar.

Reglas:
- Máximo 4 oraciones
- En español (menciona que somos bilingües)
- Termina con UNA pregunta sobre su mayor reto para conseguir o retener clientes
- No uses hashtags, emojis ni jerga de vendedor
- No menciones precios
- Sé específico a su industria o ciudad si puedes`,
        }],
      });

      const outboundMsg = msg.content[0].text.trim();

      // Send via GHL
      try {
        await sendEmail(contact.id, `${name}, ¿estás capturando todos tus clientes potenciales?`, `<p>${outboundMsg}</p><p style="color:#666;font-size:12px">Jose Rivas · JRZ Marketing · Bilingüe: English / Español · jrzmarketing.com · (407) 844-6376</p>`);

        // Move from outbound_pending → outbound_sent + add to pipeline
        await axios.post(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { tags: ['outbound_sent'] },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await axios.delete(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { data: { tags: ['outbound_pending'] }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await createOpportunity(contact.id, `${name} — ${business}`, PIPELINE_STAGES.newLead);
        await tagContact(contact.id, ['nurture-sequence']);

        sent++;
        console.log(`[Outbound] ✅ Sent to ${name} (${business})`);
        // Small delay between messages to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[Outbound] ❌ Failed for ${contact.id}:`, err?.response?.data || err.message);
      }
    }

    console.log(`[Outbound] ✅ Done — ${sent}/${contacts.length} messages sent today`);
    return { sent, total: contacts.length };
  } catch (err) {
    console.error('[Outbound] ❌ Outbound run failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA AUTOMATION FUNCTIONS
// ═══════════════════════════════════════════════════════════

// ─── Build a Reel from carousel slides via FFmpeg → upload to Cloudinary ────
// opts.maxSlides: how many slides to use (default 4 = 28s, use 3 for 15s)
// opts.slideDuration: seconds per slide (default 7 for carousel, 5 for short Reels)
// opts.publicIdSuffix: extra suffix for Cloudinary public_id (e.g. '_short')
// Returns permanent Cloudinary video URL, or null on failure
async function createReelFromSlides(slideUrls, dayIdx, opts = {}) {
  const { maxSlides = 4, slideDuration = 7, publicIdSuffix = '' } = opts;
  const slides  = slideUrls.slice(0, maxSlides);
  const tmpDir = '/tmp/jrz_reel';
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Download selected slides to /tmp
    const slidePaths = [];
    for (let i = 0; i < slides.length; i++) {
      const dest = path.join(tmpDir, `slide${i}.png`);
      const res  = await axios.get(slides[i], { responseType: 'arraybuffer' });
      fs.writeFileSync(dest, res.data);
      slidePaths.push(dest);
    }

    // 2. Build FFmpeg filter — slideDuration seconds per slide with black fade between each
    const fadeStart = slideDuration - 1; // fade begins 1s before slide ends
    const n       = slidePaths.length;
    const inputs  = slidePaths.map(p => `-loop 1 -t ${slideDuration} -i "${p}"`).join(' ');
    const filters = slidePaths.map((_, i) => {
      const base = `[${i}:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      if (i === 0)     return `${base},fade=t=out:st=${fadeStart}:d=1[v${i}]`;
      if (i === n - 1) return `${base},fade=t=in:st=0:d=1[v${i}]`;
      return               `${base},fade=t=in:st=0:d=1,fade=t=out:st=${fadeStart}:d=1[v${i}]`;
    }).join(';');
    const concat  = slidePaths.map((_, i) => `[v${i}]`).join('');
    const outPath = path.join(tmpDir, `reel${publicIdSuffix}.mp4`);

    const cmd = `ffmpeg -y ${inputs} -filter_complex "${filters};${concat}concat=n=${n}:v=1:a=0,format=yuv420p[v]" -map "[v]" -r 30 -c:v libx264 -preset ultrafast -crf 26 "${outPath}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });

    // 3. Upload to Cloudinary (video resource, overwrite on each run)
    const publicId  = `jrz/reel_day${dayIdx}${publicIdSuffix}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const sigStr    = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new FormData();
    form.append('file',       fs.createReadStream(outPath));
    form.append('public_id',  publicId);
    form.append('timestamp',  String(timestamp));
    form.append('api_key',    CLOUDINARY_API_KEY);
    form.append('signature',  signature);
    form.append('overwrite',  'true');

    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120000 }
    );

    // Cleanup temp files
    slidePaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
    try { fs.unlinkSync(outPath); } catch (_) {}

    // Return version-less URL so it always serves the latest
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload/jrz/reel_day${dayIdx}${publicIdSuffix}.mp4`;
  } catch (err) {
    console.error('[Reel] ❌ Failed to create reel:', err.message);
    return null;
  }
}

// Schedule a post via GHL Social Media API
// Pass media = [{ url, type: 'image' }] array for Instagram image posts
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
  body.media = (media && media.length) ? media : [];
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
  const instagramMedia = todayImages.map(url => ({ url, type: 'image/png' }));

  // ── Social post — Facebook, LinkedIn, YouTube, Google (with carousel images) ──
  let socialResult = { success: false };
  try {
    const result = await schedulePost({
      caption,
      accountIds: TEXT_POST_ACCOUNTS,
      type: 'post',
      scheduleDate: postTime,
      media: instagramMedia,
    });
    console.log(`[Social] ✅ Text post scheduled for ${postTime.toISOString()} — "${title}"`);
    socialResult = { success: true, title, scheduledFor: postTime.toISOString(), result };
  } catch (err) {
    console.error('[Social] ❌ Failed to schedule text post:', err?.response?.data || err.message);
    socialResult = { success: false, error: err.message };
  }

  // ── Instagram Reel — build video from slides via FFmpeg → Cloudinary ──
  let instagramResult = { success: false };
  console.log('[Reel] Building reel from carousel slides...');
  const reelUrl = await createReelFromSlides(todayImages, dayIdx >= 0 ? dayIdx : new Date().getDay());

  if (reelUrl) {
    // Post as Reel (video) — higher reach than static carousel
    try {
      const result = await schedulePost({
        caption,
        accountIds: INSTAGRAM_ACCOUNTS,
        type: 'post',
        scheduleDate: postTime,
        media: [{ url: reelUrl, type: 'video' }],
      });
      console.log(`[Reel] ✅ Instagram Reel scheduled for ${postTime.toISOString()} — "${title}"`);
      instagramResult = { success: true, title, scheduledFor: postTime.toISOString(), reelUrl, result };
    } catch (err) {
      console.error('[Reel] ❌ Failed to schedule Instagram Reel:', err?.response?.data || err.message);
      // Fallback: post static carousel images if Reel fails
      try {
        await schedulePost({
          caption,
          accountIds: INSTAGRAM_ACCOUNTS,
          type: 'post',
          scheduleDate: postTime,
          media: instagramMedia,
        });
        console.log('[Reel] ↩️  Fell back to static carousel for Instagram');
        instagramResult = { success: true, fallback: 'carousel', title };
      } catch (fallbackErr) {
        instagramResult = { success: false, error: fallbackErr.message };
      }
    }
  } else {
    // Reel creation failed — post static carousel as fallback
    console.log('[Reel] ↩️  Reel creation failed, falling back to static carousel');
    try {
      await schedulePost({
        caption,
        accountIds: INSTAGRAM_ACCOUNTS,
        type: 'post',
        scheduleDate: postTime,
        media: instagramMedia,
      });
      instagramResult = { success: true, fallback: 'carousel', title };
    } catch (err) {
      instagramResult = { success: false, error: err.message };
    }
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

// Generate viral hook content via Claude — uses weekly learned strategy
async function generateViralReelContent(topic) {
  const strategy = await loadContentStrategy();
  const strategyContext = strategy ? `
ESTRATEGIA APRENDIDA (basada en datos reales de tu audiencia):
- Mejores temas: ${(strategy.bestTopics || []).join(', ')}
- Estilo de hook que más funciona: ${strategy.bestHookStyle || 'preguntas directas'}
- Fórmulas de hook probadas: ${(strategy.hookFormulas || []).join(' | ')}
- Insights de audiencia: ${strategy.audienceInsights || '25-34 años, dueños de negocios'}
- Evitar: ${(strategy.avoidTopics || []).join(', ') || 'nada aún'}
- Notas de la semana: ${strategy.weeklyNotes || 'primera semana'}
` : '';

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Crea contenido viral en ESPAÑOL para un Reel de marketing de 15 segundos para JRZ Marketing (agencia de IA y automatización en Orlando, FL).
${strategyContext}
Tema del día: "${topic}"

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "hook": "2-4 PALABRAS EN MAYÚSCULAS (frase impactante, pregunta o dato)",
  "hook_sub": "1-2 líneas que amplíen el hook\\nseparadas por \\\\n",
  "content": ["→  punto 1", "→  punto 2", "→  punto 3"],
  "climax1": "2-3 PALABRAS IMPACTO",
  "climax2": "REMATE EN MAYÚSCULAS.",
  "climax_sub": "frase de cierre poderosa"
}

Reglas: gancho que detenga el scroll en los primeros 2 segundos, estilo directo, sin hashtags en el JSON.`,
    }],
  });
  return JSON.parse(msg.content[0].text.trim());
}

// ── Build a natural voiceover script from reel content ───────────────────────
function buildVoiceoverScript(content) {
  const lines = [];

  // Hook — question/statement
  const hook = (content.hook + ' ' + (content.hook_sub || '')).replace(/\n/g, ' ').trim();
  lines.push(hook);

  // Content bullets — strip arrow symbols, read naturally
  if (Array.isArray(content.content)) {
    content.content.slice(0, 3).forEach(function (b) {
      lines.push(b.replace(/^[→\-•]\s*/, '').trim());
    });
  }

  // Climax
  const climax = ((content.climax1 || '') + ' ' + (content.climax2 || '') + '. ' + (content.climax_sub || '')).trim();
  if (climax) lines.push(climax);

  // CTA
  lines.push('Agenda tu consulta gratis en jrzmarketing.com');

  return lines.join('. ');
}

// ── ElevenLabs TTS → save MP3 ────────────────────────────────────────────────
async function generateElevenLabsAudio(text, audioPath) {
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      { text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true } },
      {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );
    fs.writeFileSync(audioPath, Buffer.from(response.data));
    console.log('[Voice] ✅ Joseph Corona audio generated:', audioPath);
    return true;
  } catch (err) {
    console.error('[Voice] ❌ ElevenLabs failed:', err?.response?.status, err.message);
    return false;
  }
}

// ── Build a smart, human voice script — continuation of the text reply ───────
async function buildDMVoiceScript(textReply, contactName, originalMessage, contactMemory = {}, competitorInsights = {}, compPainPoints = {}) {
  const nowEST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour    = nowEST.getHours();
  const timeStr = hour < 12 ? 'esta mañana' : hour < 17 ? 'esta tarde' : 'esta noche';

  const [voiceFeedback, engPatterns] = await Promise.all([loadVoiceFeedback(), loadEngagementPatterns()]);

  const prompt = `Eres Armando Rivas, 22 años, venezolano, Community Manager de JRZ Marketing en Orlando, Florida.
Tienes voz — este texto se va a convertir en audio con tu voz real. Habla como si estuvieras grabando un voice note de WhatsApp o Instagram.

CONTEXTO DE LA CONVERSACIÓN:
- Lo que dijo el prospecto: "${originalMessage || 'nos contactó con interés'}"
- Lo que ya le respondiste por texto: "${textReply}"

CONOCIMIENTO DE ESTE PROSPECTO (memoria de conversaciones anteriores):
- Tipo de negocio: ${contactMemory.businessType || 'desconocido'}
- Sus pain points específicos: ${(contactMemory.painPoints || []).join(', ') || 'no identificados aún'}
- Sus intereses: ${(contactMemory.interests || []).join(', ') || 'no identificados aún'}
- Mensajes anteriores: ${contactMemory.messageCount || 0}
${(contactMemory.messageCount || 0) > 0 ? '⚠️ Ya lo conoces — habla como si retomaran una conversación, no como si fuera la primera vez.' : ''}

CONOCIMIENTO DE MERCADO (úsalo inteligentemente):
- La mayoría de negocios latinos en EE.UU. tienen el mismo problema: invierten en redes, en anuncios, en diseñadores — y no ven resultados porque no tienen un SISTEMA.
- Lo que otras agencias NO hacen y JRZ sí: ${(competitorInsights.competitorWeaknesses || []).join(', ') || 'servicio bilingüe real, IA integrada, acompañamiento directo del fundador'}
- Lo que clientes dicen de otras agencias: ${(compPainPoints.painPoints || []).slice(0, 2).join(', ') || 'cobran caro sin resultados, desaparecen después de vender'}
- JRZ Marketing: sistema completo — captación, automatización con IA, contenido viral, seguimiento hasta cerrar. Jose trabaja directo con cada cliente los primeros 30 días.
- Patrones ganadores (clientes que agendaron): ${voiceFeedback.winningPatterns || 'usar empatía y especificidad sobre su negocio'}
- Hooks que funcionaron en contenido reciente: ${(engPatterns.topHooks || []).slice(0, 2).join(' | ') || 'preguntas directas sobre resultados'}

REGLAS DEL MENSAJE DE VOZ:
1. Es la CONTINUACIÓN del texto — no repitas lo mismo, profundiza
2. Muéstrate HUMANO: empático, cálido, inteligente — no genérico
3. Lee entre líneas lo que dijo el prospecto y responde a su NECESIDAD REAL, no solo a sus palabras
4. Menciona la hora del día naturalmente (${timeStr}) — da sensación de presencia real
5. Explica brevemente el PROCESO de JRZ: sistema completo, resultados medibles, acompañamiento real
6. Cierra con UNA sola llamada a la acción: agendar la consulta gratuita de 15 min con Jose HOY
7. Urgencia SUAVE — no presiones, convence con lógica y empatía
8. MÁXIMO 70 palabras — menos de 30 segundos de audio
9. Español latino natural — nada de formal, nada de robótico
10. NO empieces con "Hola" ni "Mira" — empieza de forma única y humana cada vez
11. Sin emojis, sin hashtags — es audio

Escribe SOLO el guión. Sin explicaciones. Sin comillas al inicio o al final.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });
    return msg.content[0].text.trim();
  } catch (err) {
    return `${timeStr} te grabé este mensaje porque lo que me dijiste tiene solución. En JRZ construimos el sistema completo — captamos los clientes, automatizamos el seguimiento, y creamos el contenido. Todo integrado, todo medible. Jose hace una llamada gratuita de 15 minutos contigo, sin compromiso. Agéndala hoy, los espacios se llenan rápido.`;
  }
}

// ── Generate voice note for DM reply and return Cloudinary URL ───────────────
async function generateDMVoiceNote(text, contactId, contactName, originalMessage, contactMemory = {}, competitorInsights = {}, compPainPoints = {}) {
  const audioPath = `/tmp/jrz_dm_voice_${contactId}_${Date.now()}.mp3`;
  const voiceScript = await buildDMVoiceScript(text, contactName, originalMessage, contactMemory, competitorInsights, compPainPoints);
  console.log('[DM Voice] Script:', voiceScript);
  try {
    const ok = await generateElevenLabsAudio(voiceScript, audioPath);
    if (!ok) return null;

    // Upload MP3 to Cloudinary
    const timestamp  = Math.floor(Date.now() / 1000);
    const publicId   = `jrz/dm_voice_${contactId}_${timestamp}`;
    const sigStr     = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature  = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new FormData();
    form.append('file',       fs.createReadStream(audioPath));
    form.append('api_key',    CLOUDINARY_API_KEY);
    form.append('timestamp',  String(timestamp));
    form.append('public_id',  publicId);
    form.append('signature',  signature);
    form.append('resource_type', 'video'); // Cloudinary uses "video" for audio

    const upload = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
      form,
      { headers: form.getHeaders(), timeout: 30000 }
    );
    console.log('[DM Voice] ✅ Audio uploaded:', upload.data.secure_url);
    return upload.data.secure_url;
  } catch (err) {
    console.error('[DM Voice] ❌ Voice note failed:', err.message);
    return null;
  } finally {
    try { fs.unlinkSync(audioPath); } catch (_) {}
  }
}

// ── Merge video + audio with ffmpeg ──────────────────────────────────────────
function mergeAudioVideo(videoPath, audioPath, outPath) {
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest -map 0:v:0 -map 1:a:0 "${outPath}"`,
      { timeout: 60000, encoding: 'utf8' }
    );
    console.log('[Voice] ✅ Audio merged into video:', outPath);
    return true;
  } catch (err) {
    console.error('[Voice] ❌ ffmpeg merge failed:', err.message);
    return false;
  }
}

// Canva template base (permanent Cloudinary URL)
const CANVA_TEMPLATE_URL = 'https://res.cloudinary.com/dbsuw1mfm/video/upload/v1773637191/jrz/reel_template_base.mp4';
const CANVA_TEMPLATE_PATH = '/tmp/jrz_canva_template.mp4';

// Download Canva template once and cache it locally
async function ensureTemplate() {
  if (fs.existsSync(CANVA_TEMPLATE_PATH)) return true;
  try {
    const res = await axios.get(CANVA_TEMPLATE_URL, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(CANVA_TEMPLATE_PATH, Buffer.from(res.data));
    console.log('[Template] ✅ Canva template cached locally');
    return true;
  } catch (err) {
    console.error('[Template] ❌ Failed to download template:', err.message);
    return false;
  }
}

// Escape text for ffmpeg drawtext (no single quotes)
function ffmpegEscape(str) {
  return (str || '').replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

// Wrap long text into multiple lines (~28 chars per line)
function wrapText(str, maxLen) {
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxLen) { lines.push(line.trim()); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line.trim());
  return lines.join('\n');
}

// Build viral Reel: Canva template + ffmpeg text overlay + ElevenLabs voice
async function buildViralReel(content, dayIdx) {
  const templatePath = CANVA_TEMPLATE_PATH;
  const textPath     = `/tmp/jrz_viral_reel_text_${dayIdx}.mp4`;
  const audioPath    = `/tmp/jrz_voice_${dayIdx}.mp3`;
  const finalPath    = `/tmp/jrz_viral_reel_${dayIdx}.mp4`;

  try {
    // Step 1 — Ensure Canva template is available
    const ready = await ensureTemplate();
    if (!ready) throw new Error('Template unavailable');

    // Step 2 — Build text strings
    const hook    = ffmpegEscape(wrapText((content.hook || '').replace(/[🔥💥🚀✅⚡🎯💰]/g, '').trim(), 26));
    const sub     = ffmpegEscape(wrapText((content.hook_sub || content.climax1 || '').replace(/[🔥💥🚀✅⚡🎯💰]/g, '').trim(), 30));
    const bullets = Array.isArray(content.content)
      ? content.content.slice(0, 3).map(b => ffmpegEscape(b.replace(/^[→\-•]\s*/, '').replace(/[🔥💥🚀✅⚡🎯💰]/g, '').trim())).join('\n')
      : '';
    const cta     = ffmpegEscape('jrzmarketing.com — Consulta Gratis');

    // Step 3 — Overlay text on Canva template with ffmpeg drawtext
    const drawFilters = [
      // Hook — large bold white text, upper third
      `drawtext=text='${hook}':fontsize=68:fontcolor=white:x=(w-text_w)/2:y=h*0.12:line_spacing=10:font=Liberation Sans Bold:shadowcolor=black:shadowx=3:shadowy=3`,
      // Sub-hook — medium platinum, just below hook
      `drawtext=text='${sub}':fontsize=42:fontcolor=#8A9BA8:x=(w-text_w)/2:y=h*0.38:line_spacing=8:font=Liberation Sans Bold:shadowcolor=black:shadowx=2:shadowy=2`,
      // Bullets — white, middle
      `drawtext=text='${bullets}':fontsize=38:fontcolor=white:x=(w-text_w)/2:y=h*0.54:line_spacing=14:font=Liberation Sans:shadowcolor=black:shadowx=2:shadowy=2`,
      // CTA — bottom platinum
      `drawtext=text='${cta}':fontsize=34:fontcolor=#8A9BA8:x=(w-text_w)/2:y=h*0.88:font=Liberation Sans Bold:shadowcolor=black:shadowx=2:shadowy=2`,
    ].join(',');

    execSync(
      `ffmpeg -y -i "${templatePath}" -vf "${drawFilters}" -c:v libx264 -preset fast -crf 22 -c:a copy "${textPath}"`,
      { timeout: 120000, encoding: 'utf8' }
    );
    console.log('[Reel] ✅ Text overlaid on Canva template');

    // Step 4 — Generate Joseph Corona voiceover
    const voiceScript = buildVoiceoverScript(content);
    console.log('[Voice] Script:', voiceScript);
    const hasAudio = await generateElevenLabsAudio(voiceScript, audioPath);

    // Step 5 — Merge audio + video
    let uploadPath = textPath;
    if (hasAudio) {
      const merged = mergeAudioVideo(textPath, audioPath, finalPath);
      if (merged) uploadPath = finalPath;
    }

    // Step 6 — Upload to Cloudinary
    const publicId  = `jrz/viral_reel_day${dayIdx}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const sigStr    = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new FormData();
    form.append('file',      fs.createReadStream(uploadPath));
    form.append('public_id', publicId);
    form.append('timestamp', String(timestamp));
    form.append('api_key',   CLOUDINARY_API_KEY);
    form.append('signature', signature);
    form.append('overwrite', 'true');

    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120000 }
    );

    [textPath, audioPath, finalPath].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });

    console.log(`[Reel] ✅ Canva reel uploaded ${hasAudio ? 'with Joseph Corona voice' : '(silent fallback)'}`);
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload/jrz/viral_reel_day${dayIdx}.mp4`;

  } catch (err) {
    console.error('[Reel] ❌ buildViralReel failed:', err.message);
    return null;
  }
}

// Post a 15-second viral hook Reel at 4pm EST across all video platforms
async function runDailyReel() {
  console.log('[Reel] Running daily 4pm viral Reel...');

  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIdx    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const safeIdx   = dayIdx >= 0 ? dayIdx : new Date().getDay();

  // Schedule for 4pm EST (20:00 UTC during EDT)
  const reelTime = new Date();
  reelTime.setUTCHours(20, 0, 0, 0);
  if (reelTime < new Date()) reelTime.setDate(reelTime.getDate() + 1);

  // Get today's topic from carousel script
  const { script } = getTodaysScript();

  // Generate viral hook content via Claude
  let content;
  try {
    content = await generateViralReelContent(script.title);
    console.log('[Reel] ✅ Viral content generated:', content.hook);
  } catch (err) {
    console.error('[Reel] ❌ Content generation failed:', err.message);
    return { success: false, error: 'Content generation failed' };
  }

  // Build the video
  const reelUrl = await buildViralReel(content, safeIdx);
  if (!reelUrl) return { success: false, error: 'Video build failed' };

  // Post to all platforms
  try {
    await schedulePost({
      caption: script.caption,
      accountIds: REEL_ACCOUNTS,
      type: 'post',
      scheduleDate: reelTime,
      media: [{ url: reelUrl, type: 'video' }],
    });
    console.log(`[Reel] ✅ Viral Reel scheduled for ${reelTime.toISOString()} — ${REEL_ACCOUNTS.length} platforms`);
    logReelPost(content.hook, script.caption); // fire-and-forget attribution tracking
    return { success: true, reelUrl, hook: content.hook, scheduledFor: reelTime.toISOString() };
  } catch (err) {
    console.error('[Reel] ❌ Failed to schedule Reel:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// Send weekly content summary email to Jose every Monday
async function getGHLContactCountByTag(tag) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&tags=${tag}&limit=1`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    return res.data?.total || res.data?.contacts?.length || 0;
  } catch { return 0; }
}

async function getGHLOpportunityCountByStage(stageId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${MARKETING_PIPELINE_ID}&pipeline_stage_id=${stageId}&limit=1`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    return res.data?.meta?.total || 0;
  } catch { return 0; }
}

async function sendWeeklySummaryEmail(weekPosts) {
  const subject = `📊 JRZ Marketing — Reporte Semanal: Resultados + IA Insights (${new Date().toLocaleDateString('es-ES')})`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';

  // Pull all stats in parallel
  const [
    socialStats,
    contentStrategy,
    outboundSent,
    outboundPending,
    needsEmail,
    hotLeads,
    qualifiedLeads,
    interested,
    newLeads,
    hotOpp,
    bookingOpp,
  ] = await Promise.all([
    getWeeklyStats().catch(() => null),
    loadContentStrategy().catch(() => null),
    getGHLContactCountByTag('outbound_sent'),
    getGHLContactCountByTag('outbound_pending'),
    getGHLContactCountByTag('needs_email'),
    getGHLContactCountByTag('hot-lead'),
    getGHLContactCountByTag('qualified-lead'),
    getGHLContactCountByTag('armando-interested'),
    getGHLOpportunityCountByStage(PIPELINE_STAGES.newLead),
    getGHLOpportunityCountByStage(PIPELINE_STAGES.hotLead),
    getGHLOpportunityCountByStage(PIPELINE_STAGES.booking),
  ]);

  const breakdown = socialStats?.breakdowns || {};
  const eng       = breakdown?.engagement || {};
  const impressions = breakdown?.impressions?.total || 0;
  const reach       = breakdown?.reach?.total || 0;
  const followers   = breakdown?.followers?.total || 0;
  const igLikes     = eng?.instagram?.likes || 0;
  const igComments  = eng?.instagram?.comments || 0;

  // Ask Claude to write a strategic weekly commentary
  let aiInsight = '';
  try {
    const insightMsg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Eres el analista estratégico de JRZ Marketing. Basado en estos datos de la semana, escribe UN párrafo corto (3-4 oraciones) con el insight más importante y UNA recomendación concreta para la próxima semana. Sé directo, como un COO hablando con el CEO.

Datos:
- Impresiones sociales: ${impressions} | Alcance: ${reach} | Nuevos seguidores: ${followers}
- Instagram: ${igLikes} likes, ${igComments} comentarios
- Outbound emails enviados esta semana: ${outboundSent}
- Pipeline — New Lead: ${newLeads} | Hot Lead: ${hotOpp} | Con cita: ${bookingOpp}
- Leads interesados (DM): ${interested} | Calificados: ${qualifiedLeads} | Hot: ${hotLeads}
- Estrategia previa: ${contentStrategy?.weeklyNotes || 'Primera semana'}

Escribe el insight en español. Solo el párrafo, sin títulos.`,
      }],
    });
    aiInsight = insightMsg.content[0].text.trim();
  } catch { aiInsight = 'Análisis no disponible esta semana.'; }

  const postRows = (weekPosts || []).map(p => `
    <tr>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#333; font-weight:600;">${p.day}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#555;">${p.title || 'AI-generated'}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:${p.success ? '#16a34a' : '#dc2626'}; font-weight:700;">${p.success ? '✅ Posted' : '❌ Error'}</td>
    </tr>`).join('');

  const statBox = (label, value, sub = '') => `
    <td style="width:25%;padding:20px 16px;text-align:center;border-right:1px solid #f0f0f0;">
      <div style="font-size:28px;font-weight:800;color:#0a0a0a;line-height:1;">${value}</div>
      <div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px;">${label}</div>
      ${sub ? `<div style="font-size:11px;color:#bbb;margin-top:3px;">${sub}</div>` : ''}
    </td>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; color:#0a0a0a; }
    .wrap { padding:40px 20px; }
    .container { max-width:620px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .header { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .header img { height:40px; }
    .hero { background:#0a0a0a; padding:28px 40px 36px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:22px; font-weight:800; color:#fff; line-height:1.3; margin-bottom:8px; }
    .hero p { font-size:13px; color:rgba(255,255,255,0.45); }
    .section { padding:28px 40px; border-bottom:1px solid #f0f0f0; }
    .section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#999; margin-bottom:16px; }
    .stat-row { width:100%; border-collapse:collapse; background:#f9f9f9; border-radius:12px; overflow:hidden; }
    .insight-box { background:#f0f7ff; border-left:4px solid #0a0a0a; padding:16px 20px; border-radius:0 8px 8px 0; font-size:14px; color:#333; line-height:1.7; }
    .pipeline-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
    .pill { display:inline-block; padding:5px 14px; border-radius:100px; font-size:12px; font-weight:700; }
    .pill-new { background:#e0f2fe; color:#0369a1; }
    .pill-hot { background:#fef2f2; color:#dc2626; }
    .pill-booked { background:#f0fdf4; color:#16a34a; }
    table.posts { width:100%; border-collapse:collapse; }
    table.posts th { background:#0a0a0a; color:#fff; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; padding:10px 14px; text-align:left; }
    table.posts td { padding:9px 14px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#444; }
    .machine-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f5f5f5; font-size:13px; color:#333; }
    .machine-row:last-child { border-bottom:none; }
    .dot { width:8px; height:8px; border-radius:50%; background:#16a34a; flex-shrink:0; }
    .footer { background:#0a0a0a; padding:24px 40px; text-align:center; }
    .footer img { height:24px; opacity:0.6; margin-bottom:10px; }
    .footer p { font-size:11px; color:rgba(255,255,255,0.2); }
  </style>
</head>
<body><div class="wrap"><div class="container">

  <div class="header"><img src="${logoUrl}" alt="JRZ Marketing"></div>

  <div class="hero">
    <h1>Reporte semanal — JRZ Marketing<br>Semana del ${new Date().toLocaleDateString('es-ES', { weekday:'long', month:'long', day:'numeric' })}</h1>
    <p>Generado automáticamente por Armando AI · Cada lunes 7am EST</p>
  </div>

  <!-- MACHINE STATUS -->
  <div class="section">
    <div class="section-title">⚙️ Máquina — Estado esta semana</div>
    <div class="machine-row"><div class="dot"></div><strong>Contenido social:</strong>&nbsp;7 días × carrusel + story · Lun/Mié/Vie × reel con voz (Joseph Corona) → Instagram, Facebook, LinkedIn, YouTube, TikTok, Google Business</div>
    <div class="machine-row"><div class="dot"></div><strong>Outbound:</strong>&nbsp;${outboundSent} emails personalizados enviados esta semana (Mon–Fri)</div>
    <div class="machine-row"><div class="dot"></div><strong>Apollo enrichment:</strong>&nbsp;${needsEmail} contactos en cola esperando email (enriquecimiento lunes 9am)</div>
    <div class="machine-row"><div class="dot"></div><strong>Armando DM bot:</strong>&nbsp;24/7 activo — responde comentarios, follows, y DMs inbound</div>
    <div class="machine-row"><div class="dot"></div><strong>Pipeline GHL:</strong>&nbsp;Oportunidades creadas automáticamente en cada outreach e interacción</div>
  </div>

  <!-- SOCIAL STATS -->
  <div class="section">
    <div class="section-title">📱 Redes sociales — Esta semana</div>
    <table class="stat-row">
      <tr>
        ${statBox('Impresiones', impressions.toLocaleString())}
        ${statBox('Alcance', reach.toLocaleString())}
        ${statBox('Likes IG', igLikes.toLocaleString())}
        ${statBox('Comentarios IG', igComments.toLocaleString(), 'instagram')}
      </tr>
    </table>
    <p style="font-size:12px;color:#999;margin-top:10px;">Plataformas activas: Instagram · Facebook · LinkedIn (×2) · YouTube · TikTok (×2) · Google Business</p>
  </div>

  <!-- OUTBOUND + PIPELINE -->
  <div class="section">
    <div class="section-title">📧 Outbound + Pipeline</div>
    <table class="stat-row">
      <tr>
        ${statBox('Emails enviados', outboundSent, 'esta semana')}
        ${statBox('En pipeline', newLeads + hotOpp + bookingOpp, 'total activo')}
        ${statBox('Hot leads', hotLeads, 'calificados')}
        ${statBox('Con cita', bookingOpp, 'agendada')}
      </tr>
    </table>
    <div style="margin-top:16px;">
      <div style="font-size:12px;font-weight:700;color:#666;margin-bottom:8px;">Marketing Pipeline — GHL</div>
      <span class="pill pill-new">New Lead: ${newLeads}</span>&nbsp;
      <span class="pill pill-hot">Hot Lead: ${hotOpp}</span>&nbsp;
      <span class="pill pill-booked">Booking: ${bookingOpp}</span>
    </div>
  </div>

  <!-- DM ACTIVITY -->
  <div class="section">
    <div class="section-title">💬 Armando — Actividad de DMs</div>
    <table class="stat-row">
      <tr>
        ${statBox('Interesados', interested, 'respondieron')}
        ${statBox('Calificados', qualifiedLeads, 'dieron info')}
        ${statBox('Hot leads', hotLeads, 'phone + email')}
        ${statBox('En espera', outboundPending, 'outbound pending')}
      </tr>
    </table>
  </div>

  <!-- AI INSIGHT -->
  <div class="section">
    <div class="section-title">🧠 Armando AI — Insight de la semana</div>
    <div class="insight-box">${aiInsight}</div>
    ${contentStrategy?.bestTopics ? `<p style="font-size:12px;color:#999;margin-top:12px;"><strong>Temas que más funcionan:</strong> ${contentStrategy.bestTopics.join(' · ')}</p>` : ''}
    ${contentStrategy?.weeklyNotes ? `<p style="font-size:12px;color:#999;margin-top:4px;"><strong>Nota estratégica:</strong> ${contentStrategy.weeklyNotes}</p>` : ''}
  </div>

  <!-- CONTENT POSTED -->
  <div class="section">
    <div class="section-title">📅 Contenido publicado esta semana</div>
    <table class="posts">
      <thead><tr><th>Día</th><th>Contenido</th><th>Estado</th></tr></thead>
      <tbody>${postRows || '<tr><td colspan="3" style="padding:14px;text-align:center;color:#bbb;">Sin datos</td></tr>'}</tbody>
    </table>
  </div>

  <!-- NEXT WEEK FOCUS -->
  <div class="section" style="border-bottom:none;">
    <div class="section-title">🎯 Foco para la próxima semana</div>
    <p style="font-size:14px;color:#333;line-height:1.8;">
      1. Revisar pipeline en GHL — mover hot leads hacia cita agendada<br>
      2. Apollo enriquece contactos lunes 9am → outbound corre a las 10am<br>
      3. Si hay un cliente con resultado esta semana → capturarlo como caso de éxito para contenido
    </p>
    <p style="font-size:12px;color:#999;margin-top:12px;"><strong>KPI principal:</strong> Consultas agendadas esta semana → <strong>${bookingOpp}</strong></p>
  </div>

  <div class="footer">
    <img src="${logoUrl}" alt="JRZ Marketing">
    <p>&copy; 2026 JRZ Marketing · Reporte generado por Armando AI cada lunes 7am EST</p>
  </div>

</div></div></body></html>`;

  try {
    await sendEmail(OWNER_CONTACT_ID, subject, html);
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

    // ── Decide if Armando should engage at all ──
    const sendType = getSendType(messageType);
    let shouldAutoReply = true;

    // 1. If conversation already has outbound messages → Jose is handling it, stay silent
    if (conversationId) {
      const history = await getConversationHistory(conversationId);
      const hasOutbound = history.some(m => m.direction === 'outbound');
      if (hasOutbound) {
        shouldAutoReply = false;
        console.log(`[Armando] Existing conversation — staying silent, Jose handles it.`);
      }
    }

    // 2. If contact already has phone OR email in GHL → they gave us info, link was dropped, done.
    if (shouldAutoReply) {
      const existing = await getGHLContact(contactId);
      if (existing.phone || existing.email) {
        shouldAutoReply = false;
        console.log(`[Armando] Contact already has contact info in GHL — staying silent, Jose handles it.`);
      }
    }

    const { reply, leadQuality, sentiment, shouldEngage, wantsCall, slotChoice, foundPhone, foundEmail, contactMemory: cMem, competitorInsights: cInsights, compPainPoints: cPain } = await getArmandoReply(
      messageBody, contactName, contactId, conversationId, sendType
    );
    const msgCount = contactMessageCount.get(contactId) || 1;
    console.log(`Armando reply (msg #${msgCount}, lead: ${leadQuality}, sentiment: ${sentiment}, engage: ${shouldEngage}, phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}):`, reply);

    // Reel attribution — on first DM, check if a reel drove this lead
    if (msgCount === 1) {
      const reelHook = await checkReelAttribution(contactId);
      if (reelHook) {
        tagContact(contactId, ['reel-driven-lead']); // fire-and-forget
        console.log(`[Attribution] Lead ${contactId} attributed to reel: "${reelHook.slice(0, 60)}"`);
      }
    }

    // 3. If Claude detects this is a personal/casual message not related to business → stay silent
    if (shouldAutoReply && !shouldEngage) {
      shouldAutoReply = false;
      console.log(`[Armando] Message flagged as personal/non-business — staying silent.`);
    }

    if (foundPhone || foundEmail) {
      await updateGHLContact(contactId, foundPhone, foundEmail);
      await recordABConversion(contactId); // track which closing variant converted
    }

    const hasBothData = !!(foundPhone && foundEmail);
    const hasAnyData  = !!(foundPhone || foundEmail);
    if (hasBothData) {
      await tagContact(contactId, ['armando-interested', 'qualified-lead', 'hot-lead']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.hotLead);
    } else if (hasAnyData) {
      await tagContact(contactId, ['armando-interested', 'qualified-lead']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.hotLead);
    } else if (leadQuality === 'interested') {
      await tagContact(contactId, ['armando-interested']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.newLead);
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

    // Lead scoring — alert Jose if score >= 8
    const leadScore = calculateLeadScore({ leadQuality, sentiment, foundPhone, foundEmail, historyCount: msgCount, channel: sendType });
    console.log(`[LeadScore] ${contactName} scored ${leadScore}/10`);
    if (leadScore >= 8 && !leadScoreAlertSent.has(contactId)) {
      leadScoreAlertSent.add(contactId);
      await sendLeadScoreAlert(contactId, contactName, leadScore, sendType, foundPhone, foundEmail);
    }

    // TCPA compliance — only call after explicit consent in DM
    if (hasBothData && foundPhone) blandConsentAsked.add(contactId);
    if (wantsCall && foundPhone && !blandCallsSent.has(contactId)) {
      triggerBlandCall(contactId, contactName, foundPhone, cMem || {}); // fire-and-forget
    }

    // Google Calendar booking — fires when contact picks a slot (1, 2, or 3)
    if (slotChoice > 0) {
      const slots = pendingBookingSlots.get(contactId);
      const chosen = slots?.[slotChoice - 1];
      if (chosen) {
        try {
          await createCalendarEvent(contactName, foundEmail, chosen);
          pendingBookingSlots.delete(contactId);
          await tagContact(contactId, ['calendar-booked', 'armando-booked']);
          await createOpportunity(contactId, contactName, PIPELINE_STAGES.booking);
          logWeeklyWin(contactId, reply, 'calendar_booked');
          // Send confirmation DM
          const confirmMsg = `✅ ¡Listo! Agendé tu llamada con Jose para el ${formatSlot(chosen)}. Recibirás una invitación de Google Calendar en tu email. ¡Nos vemos entonces! 🙌`;
          await sendGHLReply(contactId, confirmMsg, sendType);
          console.log(`[Calendar] ✅ Booked for ${contactName} at ${formatSlot(chosen)}`);
        } catch (err) {
          console.error('[Calendar] Booking failed:', err.message);
        }
      }
    }

    if (shouldAutoReply) {
      await sendGHLReply(contactId, reply, sendType);
      if (messageId) repliedMessageIds.add(messageId);
      console.log('Armando reply sent successfully.');

      // Send voice note after text reply (IG DMs and SMS only)
      if (sendType === 'IG' || sendType === 'FB' || sendType === 'SMS') {
        const voiceUrl = await generateDMVoiceNote(reply, contactId, contactName, messageBody, cMem || {}, cInsights || {}, cPain || {});
        if (voiceUrl) {
          await sendGHLVoiceNote(contactId, voiceUrl, sendType);
        }
      }
    } else {
      console.log('[Armando] Silent mode — tagging/pipeline done, no auto-reply sent.');
    }

    res.status(200).json({ status: 'ok', replied: shouldAutoReply, reply: shouldAutoReply ? reply : null, leadQuality, sentiment, foundPhone, foundEmail, messageNumber: msgCount });
  } catch (error) {
    console.error('Webhook error:', error?.response?.data || error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA CRON ENDPOINTS (manual triggers + internal scheduler)
// ═══════════════════════════════════════════════════════════

/// ── Warm DM webhook — GHL fires this when someone comments or follows ──────
// Setup: GHL → Settings → Webhooks → add https://armando-bot-1.onrender.com/webhook/engage
// Events: ContactCreated, InboundMessage
app.post('/webhook/engage', async (req, res) => {
  res.json({ ok: true }); // respond fast so GHL doesn't retry
  try {
    const e = req.body;
    const contactId = e.contact_id || e.contactId || e.id;
    if (!contactId) return;

    const source  = (e.source || e.channel || '').toLowerCase();
    const type    = (e.type || e.event || '').toLowerCase();
    const isSocial = source.includes('instagram') || source.includes('facebook')
                  || source.includes('tiktok')    || source.includes('linkedin');

    if (type.includes('contactcreated') && isSocial) {
      // New follower / social lead
      await sendWarmDM(contactId, 'follower', { name: e.first_name || e.firstName });
    } else if (type.includes('inboundmessage') && isSocial) {
      // Comment or DM on social post
      await sendWarmDM(contactId, 'comment', { name: e.first_name || e.firstName });
    } else if (type.includes('formsubmit') || type.includes('opportunitycreated')) {
      // Form fill or new opportunity
      await sendWarmDM(contactId, 'form_fill', { name: e.first_name || e.firstName });
    }
  } catch (err) {
    console.error('[WarmDM] Webhook error:', err.message);
  }
});

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

// Manual trigger: POST /cron/run-reel  — test the Canva reel right now
app.post('/cron/run-reel', async (_req, res) => {
  try {
    const result = await runDailyReel();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('/cron/run-reel error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Debug: GET /test-voice — test ElevenLabs Joseph Corona live on Render
app.get('/test-voice', async (_req, res) => {
  const audioPath = '/tmp/test_voice_debug.mp3';
  const ok = await generateElevenLabsAudio('Hola, soy Armando de JRZ Marketing.', audioPath);
  try { fs.unlinkSync(audioPath); } catch (_) {}
  res.json({ voice: 'Joseph Corona', keySet: !!ELEVENLABS_API_KEY, success: ok });
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
// APOLLO ENRICHMENT — runs Monday 9am EST
// Finds GHL contacts tagged needs_email, hits Apollo People
// Match API to get their email, updates GHL, swaps tag to
// outbound_pending so the bot picks them up at 10am.
// Free plan = 50 credits/month → limit 50 per run.
// ═══════════════════════════════════════════════════════════

async function enrichProspectEmails() {
  console.log('[Apollo] Starting email enrichment...');
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&tags=needs_email&limit=50`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    const contacts = res.data?.contacts || [];
    if (!contacts.length) {
      console.log('[Apollo] No contacts need enrichment.');
      return { enriched: 0 };
    }

    let enriched = 0;
    for (const contact of contacts) {
      const firstName = contact.firstName || '';
      const lastName  = contact.lastName  || '';
      const domain    = contact.website?.replace(/https?:\/\//, '').split('/')[0] || '';
      const company   = contact.companyName || '';

      if (!firstName || (!domain && !company)) continue;

      try {
        const apollo = await axios.post(
          'https://api.apollo.io/api/v1/people/match',
          { api_key: APOLLO_API_KEY, first_name: firstName, last_name: lastName, domain, organization_name: company },
          { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } }
        );

        const email = apollo.data?.person?.email;
        if (!email || email.includes('email_not_found')) {
          console.log(`[Apollo] No email found for ${firstName} ${lastName}`);
          continue;
        }

        // Update GHL contact with real email + swap tags
        await axios.put(
          `https://services.leadconnectorhq.com/contacts/${contact.id}`,
          { email },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await axios.post(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { tags: ['outbound_pending'] },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await axios.delete(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { data: { tags: ['needs_email'] }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await tagContact(contact.id, ['nurture-sequence']);

        enriched++;
        console.log(`[Apollo] ✅ Enriched ${firstName} ${lastName} → ${email}`);
        await new Promise(r => setTimeout(r, 1000)); // gentle rate limit
      } catch (err) {
        console.error(`[Apollo] ❌ Failed for ${firstName} ${lastName}:`, err?.response?.data || err.message);
      }
    }

    console.log(`[Apollo] Done — ${enriched}/${contacts.length} emails found`);
    return { enriched, total: contacts.length };
  } catch (err) {
    console.error('[Apollo] ❌ Enrichment run failed:', err.message);
    return { enriched: 0, error: err.message };
  }
}

// Manual trigger: POST /cron/enrich-prospects
app.post('/cron/enrich-prospects', async (_req, res) => {
  try {
    const result = await enrichProspectEmails();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: GET /ab-test/results — view current A/B test standings
app.get('/ab-test/results', async (_req, res) => {
  try {
    const data = await loadABTestData();
    const results = Object.entries(data.variants).map(([v, s]) => ({
      variant: v,
      name: CLOSING_VARIANTS[v].name,
      description: CLOSING_VARIANTS[v].description,
      sent: s.sent,
      conversions: s.conversions,
      rate: s.sent > 0 ? `${((s.conversions / s.sent) * 100).toFixed(1)}%` : '—',
      weight: `${data.weights[v]}%`,
    }));
    res.json({ lastOptimized: data.lastOptimized, results, history: data.history.slice(-5) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: POST /cron/ab-test-analysis — force A/B analysis now
app.post('/cron/ab-test-analysis', async (_req, res) => {
  try {
    const result = await runABTestAnalysis();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — LEAD SCORING
// ═══════════════════════════════════════════════════════════

function calculateLeadScore({ leadQuality, sentiment, foundPhone, foundEmail, historyCount, channel }) {
  let score = 0;
  if (foundPhone && foundEmail) score += 4;
  else if (foundPhone || foundEmail) score += 2;
  if (leadQuality === 'hot') score += 3;
  else if (leadQuality === 'qualified') score += 2;
  else if (leadQuality === 'interested') score += 1;
  if (sentiment === 'positive') score += 2;
  else if (sentiment === 'annoyed') score -= 1;
  if (channel === 'Live_Chat') score += 2;
  if (historyCount >= 3) score += 1;
  return Math.max(0, Math.min(10, score));
}

const leadScoreAlertSent = new Set();

async function sendLeadScoreAlert(contactId, contactName, score, channel, foundPhone, foundEmail) {
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const subject = `🎯 Lead Score ${score}/10 — ${contactName} está listo`;
  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lead Score Alert — JRZ Marketing</title>
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
    .score-bar { background:#eeeeee; border-radius:999px; height:10px; margin:8px 0 0; overflow:hidden; }
    .score-fill { background:#0a0a0a; height:10px; border-radius:999px; width:${score * 10}%; }
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
  <div class="week-badge"><span>🎯 Lead Score Alert</span></div>
  <div class="email-hero">
    <h1>${contactName}<br />Score: ${score}/10</h1>
    <p>Armando detectó un lead de alta intención. Actúa ahora.</p>
  </div>
  <div class="email-body">
    <p>Este lead alcanzó un puntaje de <strong>${score}/10</strong> basado en su comportamiento e información proporcionada:</p>
    <div class="lead-card">
      <div class="lead-row"><span class="lead-label">Nombre</span>${contactName}</div>
      <div class="lead-row"><span class="lead-label">Canal</span>${channel || 'DM'}</div>
      <div class="lead-row"><span class="lead-label">Teléfono</span>${foundPhone || '—'}</div>
      <div class="lead-row"><span class="lead-label">Email</span>${foundEmail || '—'}</div>
      <div class="lead-row"><span class="lead-label">Score</span>${score}/10 <div class="score-bar"><div class="score-fill"></div></div></div>
      <div class="lead-row"><span class="lead-label">Hora</span>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</div>
    </div>
    <p>Este lead está listo para cerrar. Contáctalo directamente o agenda una llamada.</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Listo para cerrar?</p>
    <a href="${BOOKING_URL}" class="cta-button">Agenda llamada &rarr;</a>
  </div>
  <div class="signature">
    <div class="signature-name">Armando Rivas</div>
    <div class="signature-title">AI Community Manager &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />Alerta automática generada por Armando.</p>
  </div>
</div></div>
</body></html>`;

  try {
    await sendEmail(OWNER_CONTACT_ID, subject, html);
    console.log(`[LeadScore] Alert sent for ${contactName} (${score}/10)`);
  } catch (err) {
    console.error('[LeadScore] Failed to send alert:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2 — NEW CLIENT ONBOARDING
// ═══════════════════════════════════════════════════════════

const onboardedContacts = new Set();

async function sendClientOnboarding(contactId, contactName, businessName, loginEmail) {
  const firstName  = (contactName || 'Cliente').split(' ')[0];
  const logoUrl    = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const appStoreUrl   = 'https://apps.apple.com/us/app/lead-connector/id1564153400';
  const playStoreUrl  = 'https://play.google.com/store/apps/details?id=com.gohighlevel.mobileapp';
  const subject    = `Your marketing system is ready, ${firstName} 🚀`;
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your system is ready</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .badge-wrap { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .badge { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; }
    .email-hero h1 { font-size:26px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:12px; }
    .email-hero p { font-size:14px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .body-section { padding:36px 40px 28px; }
    .body-section p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:16px; }
    .body-section strong { color:#0a0a0a; font-weight:700; }
    .login-box { background:#0a0a0a; border-radius:12px; padding:24px 28px; margin:20px 0; }
    .login-box .lbl { color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:4px; }
    .login-box .val { color:#ffffff; font-size:14px; font-weight:600; margin-bottom:14px; }
    .login-box .val:last-child { margin-bottom:0; }
    .steps { margin:16px 0; }
    .step { display:flex; align-items:flex-start; padding:12px 0; border-bottom:1px solid #f0f0f0; }
    .step:last-child { border-bottom:none; }
    .step-num { background:#0a0a0a; color:#ffffff; font-size:12px; font-weight:800; min-width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:14px; flex-shrink:0; margin-top:2px; }
    .step-text { font-size:14px; color:#333333; line-height:1.6; }
    .step-text strong { color:#0a0a0a; }
    .setup-grid { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin:16px 0; }
    .setup-item { font-size:13px; color:#333333; padding:7px 0; border-bottom:1px solid #eeeeee; display:flex; align-items:center; gap:10px; }
    .setup-item:last-child { border-bottom:none; }
    .check { color:#0a0a0a; font-weight:700; }
    .app-row { display:flex; gap:10px; justify-content:center; margin:14px 0; flex-wrap:wrap; }
    .app-btn { display:inline-block; background:#f4f4f4; border:1px solid #e0e0e0; color:#0a0a0a !important; font-size:12px; font-weight:600; text-decoration:none; padding:9px 18px; border-radius:8px; }
    .divider { height:1px; background:#f0f0f0; margin:28px 40px; }
    .cta-section { padding:0 40px 36px; text-align:center; }
    .cta-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:14px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:10px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:28px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:14px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="badge-wrap"><span class="badge">Sub-account Active &middot; ${businessName || firstName + "'s Business"}</span></div>
  <div class="email-hero">
    <h1>${firstName}, your system is ready ✅</h1>
    <p>Your CRM, automations, and sales pipeline are configured and ready to capture clients today.</p>
  </div>

  <div class="body-section">
    <p>Hi <strong>${firstName}</strong>,</p>
    <p>Your sub-account on our marketing platform is now active. Here are your login credentials:</p>
    <div class="login-box">
      <div class="lbl">Platform</div>
      <div class="val">app.gohighlevel.com</div>
      <div class="lbl">Login Email</div>
      <div class="val">${loginEmail || 'Your registered email'}</div>
      <div class="lbl">Password</div>
      <div class="val">You'll receive a separate email from GoHighLevel to set your password.</div>
    </div>
    <p><strong>What's already set up in your system:</strong></p>
    <div class="setup-grid">
      <div class="setup-item"><span class="check">✓</span> CRM with your organized sales pipeline</div>
      <div class="setup-item"><span class="check">✓</span> AI chatbot — auto-responds to leads 24/7</div>
      <div class="setup-item"><span class="check">✓</span> 13-email nurture sequence (6 months of follow-up)</div>
      <div class="setup-item"><span class="check">✓</span> Booking calendar integrated</div>
      <div class="setup-item"><span class="check">✓</span> Weekly performance reports dashboard</div>
      <div class="setup-item"><span class="check">✓</span> Social media integrations</div>
    </div>
    <p><strong>Your first 3 steps:</strong></p>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-text"><strong>Log in</strong> at app.gohighlevel.com and set your password.</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Download the app</strong> "Lead Connector" on your phone to manage leads anywhere.</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text"><strong>Book your onboarding call</strong> — 30 minutes and we'll walk you through everything live.</div></div>
    </div>
    <p style="text-align:center;font-size:14px;"><strong>Download the mobile app:</strong></p>
    <div class="app-row">
      <a href="${appStoreUrl}" class="app-btn">📱 App Store (iPhone)</a>
      <a href="${playStoreUrl}" class="app-btn">🤖 Google Play (Android)</a>
    </div>
    <p style="font-size:14px;">Questions? Reply to this email or reach us directly at (407) 844-6376. We're here to make sure your system runs at 100%.</p>
  </div>

  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">Next Step</p>
    <a href="${BOOKING_URL}" class="cta-button">Book Your Onboarding Call &rarr;</a>
    <p class="cta-note">30 min &middot; Free &middot; We walk you through everything live</p>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing &middot; (407) 844-6376</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />jrzmarketing.com</p>
  </div>
</div></div>
</body></html>`;

  try {
    await sendEmail(contactId, subject, html);
    console.log(`[Onboarding] Welcome email sent to ${contactName} (${contactId})`);
  } catch (err) {
    console.error('[Onboarding] Failed to send welcome email:', err?.response?.data || err.message);
  }
}

app.post('/webhook/new-client', async (req, res) => {
  res.json({ ok: true });
  try {
    const payload = req.body;
    const contactId   = payload.contactId || payload.contact_id || payload.contact?.id || payload.customData?.contactId || '';
    const contactName = payload.fullName || payload.full_name || payload.contactName || payload.firstName || payload.first_name || payload.customData?.fullName || '';
    const businessName = payload.businessName || payload.companyName || payload.customData?.businessName || '';
    const loginEmail  = payload.email || payload.contact?.email || payload.customData?.email || '';
    if (!contactId) { console.log('[Onboarding] Missing contactId, skipping.'); return; }
    if (onboardedContacts.has(contactId)) { console.log(`[Onboarding] Already onboarded ${contactId}, skipping.`); return; }
    onboardedContacts.add(contactId);
    // Mark any pending objection responses as converted — this is a real booking
    markObjectionConverted(contactId); // fire-and-forget
    logWeeklyWin(contactId, 'booked', 'booking'); // fire-and-forget
    await sendClientOnboarding(contactId, contactName, businessName, loginEmail);
  } catch (err) {
    console.error('[Onboarding] Webhook error:', err.message);
  }
});

// ═══════════════════════════════════════════════════════════
// FEATURE 3 — PROPOSAL GENERATOR
// ═══════════════════════════════════════════════════════════

const proposalsSent = new Set();

async function generateAndSendProposal(contactId, contactName, businessType, email) {
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  try {
    const promptText = `Generate a professional proposal for a ${businessType} business wanting JRZ Marketing services. Return ONLY valid JSON: { "challenge": "main pain point", "solution": "how JRZ solves it", "services": ["service1", "service2", "service3"], "timeline": "expected timeline", "investment": "Starting at $497/month" }`;
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: promptText }],
    });
    const proposal = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

    const subject = `Propuesta JRZ Marketing — ${contactName}`;
    const servicesHtml = (proposal.services || []).map(s => `<li style="padding:10px 0 10px 28px;position:relative;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333333;"><span style="position:absolute;left:0;font-weight:700;color:#0a0a0a;">✓</span>${s}</li>`).join('');
    const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Propuesta JRZ Marketing</title>
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
    .section-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999999; margin:28px 0 10px; }
    .section-box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin-bottom:20px; font-size:15px; color:#333333; line-height:1.7; }
    .services-list { list-style:none; padding:0; margin:0; }
    .investment-box { background:#0a0a0a; border-radius:12px; padding:24px; text-align:center; margin:24px 0; }
    .investment-amount { font-size:28px; font-weight:800; color:#ffffff; }
    .investment-label { font-size:12px; color:rgba(255,255,255,0.4); margin-top:4px; letter-spacing:0.08em; text-transform:uppercase; }
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
  <div class="week-badge"><span>Propuesta Personalizada</span></div>
  <div class="email-hero">
    <h1>Propuesta para<br />${contactName}</h1>
    <p>Solución de marketing digital diseñada específicamente para tu negocio de ${businessType}.</p>
  </div>
  <div class="email-body">
    <p class="section-title">El reto</p>
    <div class="section-box">${proposal.challenge || ''}</div>
    <p class="section-title">Nuestra solución</p>
    <div class="section-box">${proposal.solution || ''}</div>
    <p class="section-title">Servicios incluidos</p>
    <ul class="services-list">${servicesHtml}</ul>
    <p class="section-title">Timeline</p>
    <div class="section-box">${proposal.timeline || ''}</div>
    <p class="section-title">Inversión</p>
    <div class="investment-box">
      <div class="investment-amount">${proposal.investment || 'Starting at $497/month'}</div>
      <div class="investment-label">Inversión mensual personalizada</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Listo para arrancar?</p>
    <a href="${BOOKING_URL}" class="cta-button">Agenda tu llamada de inicio &rarr;</a>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />Propuesta generada por el equipo de JRZ Marketing.</p>
  </div>
</div></div>
</body></html>`;

    await sendEmail(contactId, subject, html);
    console.log(`[Proposal] Sent proposal to ${contactName} (${contactId})`);
  } catch (err) {
    console.error('[Proposal] Failed:', err?.response?.data || err.message);
  }
}

app.post('/webhook/hot-lead', async (req, res) => {
  res.json({ ok: true });
  try {
    const payload = req.body;
    const contactId = payload.contactId || payload.contact_id || payload.contact?.id || payload.customData?.contactId || '';
    const contactName = payload.fullName || payload.full_name || payload.contactName || payload.firstName || payload.first_name || payload.customData?.fullName || '';
    const businessType = payload.customData?.businessType || payload.businessType || 'negocio';
    const email = payload.email || payload.contact?.email || payload.customData?.email || '';
    if (!contactId) { console.log('[Proposal] Missing contactId, skipping.'); return; }
    if (proposalsSent.has(contactId)) { console.log(`[Proposal] Already sent proposal for ${contactId}, skipping.`); return; }
    proposalsSent.add(contactId);
    await generateAndSendProposal(contactId, contactName, businessType, email);
  } catch (err) {
    console.error('[Proposal] Webhook error:', err.message);
  }
});

// ═══════════════════════════════════════════════════════════
// FEATURE 4 — CLIENT CHECK-INS (30-day rolling)
// ═══════════════════════════════════════════════════════════

const CHECKIN_URL    = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/client_checkins.json';
const CHECKIN_PUB_ID = 'jrz/client_checkins';

async function loadCheckInData() {
  try {
    const res = await axios.get(CHECKIN_URL, { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    return {};
  }
}

async function saveCheckInData(data) {
  try {
    const ts      = Math.floor(Date.now() / 1000);
    const sigStr  = `overwrite=true&public_id=${CHECKIN_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig     = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form    = new FormData();
    const buf     = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file',          buf,  { filename: 'client_checkins.json', contentType: 'application/json' });
    form.append('public_id',     CHECKIN_PUB_ID);
    form.append('resource_type', 'raw');
    form.append('timestamp',     String(ts));
    form.append('api_key',       CLOUDINARY_API_KEY);
    form.append('signature',     sig);
    form.append('overwrite',     'true');
    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`,
      form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 }
    );
  } catch (err) {
    console.error('[CheckIn] Failed to save check-in data:', err.message);
  }
}

async function getActiveClients() {
  const res = await axios.get(
    `https://services.leadconnectorhq.com/contacts/`,
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' },
      params: { locationId: GHL_LOCATION_ID, query: 'active-client', limit: 100 } }
  );
  return res.data?.contacts || [];
}

async function runClientCheckIns() {
  console.log('[CheckIn] Running 30-day client check-ins...');
  try {
    const [clients, checkInData] = await Promise.all([getActiveClients(), loadCheckInData()]);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const client of clients) {
      try {
        const lastCheckIn = checkInData[client.id];
        if (lastCheckIn && (now - lastCheckIn) < thirtyDays) continue;
        const contactName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'amigo';
        const msgResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: `You are Armando from JRZ Marketing. Write a short, warm 2-sentence check-in message in Spanish to ${contactName} asking how their business is going and if there's anything the team can help with. Sound like a real person, not a template.` }],
        });
        const message = msgResp.content[0].text.trim();
        await sendGHLReply(client.id, message, 'SMS');
        checkInData[client.id] = Date.now();
        console.log(`[CheckIn] Sent check-in to ${contactName} (${client.id})`);
      } catch (err) {
        console.error(`[CheckIn] Failed for client ${client.id}:`, err.message);
      }
    }
    await saveCheckInData(checkInData);
    console.log('[CheckIn] Done.');
  } catch (err) {
    console.error('[CheckIn] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 5 — MONTHLY CLIENT REPORTS
// ═══════════════════════════════════════════════════════════

async function sendMonthlyClientReports() {
  console.log('[MonthlyReport] Generating monthly client reports...');
  try {
    const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
    const nowDate = new Date();
    const month = nowDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
    const [clients, stats] = await Promise.all([getActiveClients(), getWeeklyStats().catch(() => null)]);
    const statsSnap = stats ? JSON.stringify(stats).slice(0, 400) : 'Sin datos disponibles';

    for (const client of clients) {
      try {
        const contactName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Cliente';
        const firstName = (contactName).split(' ')[0];
        const businessType = (client.tags || []).find(t => t !== 'active-client') || 'negocio';

        const reportMsg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: `You are JRZ Marketing's reporting AI. Generate a personalized monthly report for client: ${contactName}, business type: ${businessType}, month: ${month}. Social stats snapshot: ${statsSnap}. Return ONLY valid JSON: { "headline": "...", "wins": ["win1", "win2", "win3"], "nextMonth": "focus for next month", "personalNote": "personal note for this client from Jose" }` }],
        });
        const report = JSON.parse(reportMsg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
        const winsHtml = (report.wins || []).map(w => `<li style="padding:10px 0 10px 28px;position:relative;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333333;"><span style="position:absolute;left:0;font-weight:700;color:#0a0a0a;">✓</span>${w}</li>`).join('');

        const subject = `📊 Tu Reporte Mensual — ${month} | JRZ Marketing`;
        const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte Mensual JRZ Marketing</title>
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
    .section-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999999; margin:28px 0 10px; }
    .wins-list { list-style:none; padding:0; margin:0 0 20px; }
    .section-box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin-bottom:20px; font-size:15px; color:#333333; line-height:1.7; }
    .note-box { background:#0a0a0a; border-radius:12px; padding:24px; margin:24px 0; font-size:15px; color:rgba(255,255,255,0.8); line-height:1.7; font-style:italic; }
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
  <div class="week-badge"><span>Reporte Mensual — ${month}</span></div>
  <div class="email-hero">
    <h1>${firstName},<br />este fue tu mes. 📊</h1>
    <p>${report.headline || 'Resumen de tus resultados con JRZ Marketing.'}</p>
  </div>
  <div class="email-body">
    <p>Hola <strong>${firstName}</strong>,</p>
    <p>Aquí está tu reporte mensual de resultados. Estos son los logros más importantes de este mes:</p>
    <p class="section-title">Logros del mes</p>
    <ul class="wins-list">${winsHtml}</ul>
    <p class="section-title">Enfoque del próximo mes</p>
    <div class="section-box">${report.nextMonth || ''}</div>
    <p class="section-title">Nota personal de Jose</p>
    <div class="note-box">${report.personalNote || ''}</div>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Tienes preguntas?</p>
    <a href="${BOOKING_URL}" class="cta-button">Habla con el equipo &rarr;</a>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.</p>
  </div>
</div></div>
</body></html>`;

        await sendEmail(client.id, subject, html);
        console.log(`[MonthlyReport] Sent to ${contactName} (${client.id})`);
      } catch (err) {
        console.error(`[MonthlyReport] Failed for client ${client.id}:`, err.message);
      }
    }
    console.log('[MonthlyReport] Done.');
  } catch (err) {
    console.error('[MonthlyReport] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 6b — MONTHLY SUB-ACCOUNT CHECK-IN EMAIL
//   Runs last Friday of every month @ 10am EST
//   Sends English email to every contact tagged active-client
//   with GHL news, updates, and a personal check-in note
// ═══════════════════════════════════════════════════════════

async function sendSubAccountCheckInEmails() {
  console.log('[SubCheckIn] Running monthly sub-account check-in emails...');
  try {
    const logoUrl   = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
    const nowDate   = new Date();
    const monthName = nowDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // Fetch latest GHL news via NewsAPI
    let newsItems = [];
    try {
      const newsRes = await axios.get(
        'https://newsapi.org/v2/everything?q=Go+High+Level+CRM+update+feature&language=en&sortBy=publishedAt&pageSize=6&apiKey=' + NEWS_API_KEY,
        { timeout: 10000 }
      );
      newsItems = (newsRes.data?.articles || []).slice(0, 5).map(a => `- ${a.title}: ${(a.description || '').slice(0, 120)}`);
    } catch (_) {}

    // Claude generates the GHL update section + tip of the month
    const aiRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are JRZ Marketing's client success AI. Write a friendly, professional monthly check-in email body for sub-account clients. Month: ${monthName}. Recent GHL news/articles:\n${newsItems.join('\n') || 'No articles available.'}\n\nReturn ONLY valid JSON:\n{"subject_suffix": "one short subject line suffix (max 50 chars)", "intro": "1-2 sentence warm intro (English)", "ghl_updates": ["update 1", "update 2", "update 3"], "tip": "one actionable marketing tip they can apply this month", "closing": "1 sentence warm closing from Jose"}`,
      }],
    });
    const aiText = aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)?.[0] || '{}';
    const ai = JSON.parse(aiText);

    const updatesHtml = (ai.ghl_updates || ['Platform improvements rolling out', 'New automation features available', 'Performance enhancements deployed'])
      .map(u => `<div class="update-item"><span class="check">✓</span>${u}</div>`).join('');

    const clients = await getActiveClients();
    let sent = 0;

    for (const client of clients) {
      try {
        const contactName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Client';
        const firstName   = contactName.split(' ')[0];
        const subject     = `${monthName} Update — Your Marketing System ${ai.subject_suffix || '| JRZ Marketing'}`;

        const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .badge-wrap { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .badge { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; }
    .email-hero h1 { font-size:26px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:12px; }
    .email-hero p { font-size:14px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .body-section { padding:36px 40px 28px; }
    .body-section p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:16px; }
    .body-section strong { color:#0a0a0a; font-weight:700; }
    .section-label { font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#999999; margin:24px 0 12px; }
    .updates-box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin:16px 0; }
    .update-item { font-size:14px; color:#333333; padding:8px 0; border-bottom:1px solid #eeeeee; display:flex; align-items:flex-start; gap:10px; line-height:1.5; }
    .update-item:last-child { border-bottom:none; }
    .check { color:#0a0a0a; font-weight:700; flex-shrink:0; }
    .tip-box { background:#0a0a0a; border-radius:12px; padding:24px 28px; margin:20px 0; }
    .tip-label { color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:10px; }
    .tip-text { color:#ffffff; font-size:15px; line-height:1.7; }
    .divider { height:1px; background:#f0f0f0; margin:28px 40px; }
    .cta-section { padding:0 40px 36px; text-align:center; }
    .cta-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:14px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:10px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:28px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:14px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="badge-wrap"><span class="badge">Monthly Update &middot; ${monthName}</span></div>
  <div class="email-hero">
    <h1>${firstName}, here's what's new 🚀</h1>
    <p>Your monthly platform update + what we're seeing in the market right now.</p>
  </div>
  <div class="body-section">
    <p>Hi <strong>${firstName}</strong>,</p>
    <p>${ai.intro || "We're checking in to share what's new on your platform and a quick tip to help you get more out of your system this month."}</p>
    <p class="section-label">GoHighLevel Platform Updates</p>
    <div class="updates-box">${updatesHtml}</div>
    <p class="section-label">Tip of the Month</p>
    <div class="tip-box">
      <div class="tip-label">💡 Action Item for You</div>
      <div class="tip-text">${ai.tip || 'Make sure your booking calendar is linked to your main CTA button — this one change alone can double your booked calls.'}</div>
    </div>
    <p>${ai.closing || "As always, if you have questions or want us to look at something in your account, we're one message away."}</p>
    <p>— <strong>Jose Rivas</strong> &amp; the JRZ Marketing team</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">Need help with your system?</p>
    <a href="${BOOKING_URL}" class="cta-button">Book a Call with Jose &rarr;</a>
    <p class="cta-note">30 min &middot; Free &middot; We'll review your account live</p>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing &middot; (407) 844-6376</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />jrzmarketing.com</p>
  </div>
</div></div>
</body></html>`;

        await sendEmail(client.id, subject, html);
        sent++;
        console.log(`[SubCheckIn] Sent to ${contactName} (${client.id})`);
        await new Promise(r => setTimeout(r, 500)); // rate limit
      } catch (err) {
        console.error(`[SubCheckIn] Failed for ${client.id}:`, err.message);
      }
    }
    console.log(`[SubCheckIn] Done. Sent to ${sent}/${clients.length} clients.`);
  } catch (err) {
    console.error('[SubCheckIn] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 6 — COMPETITOR MONITORING
// ═══════════════════════════════════════════════════════════

async function runCompetitorMonitoring() {
  console.log('[Competitor] Running weekly competitor monitoring...');
  try {
    const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
    const date = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', day: '2-digit', month: 'long', year: 'numeric' });

    const [res1, res2, res3] = await Promise.all([
      axios.get('https://newsapi.org/v2/everything?q=marketing+digital+hispano+peque%C3%B1os+negocios&language=es&sortBy=publishedAt&pageSize=5&apiKey=dff54f64e9eb4087aa7c215a1c674644', { timeout: 10000 }).catch(() => null),
      axios.get('https://newsapi.org/v2/everything?q=AI+marketing+automation+small+business&language=en&sortBy=publishedAt&pageSize=5&apiKey=dff54f64e9eb4087aa7c215a1c674644', { timeout: 10000 }).catch(() => null),
      axios.get('https://newsapi.org/v2/everything?q=Go+High+Level+CRM+agency&language=en&sortBy=publishedAt&pageSize=5&apiKey=dff54f64e9eb4087aa7c215a1c674644', { timeout: 10000 }).catch(() => null),
    ]);

    const articles = [
      ...(res1?.data?.articles || []),
      ...(res2?.data?.articles || []),
      ...(res3?.data?.articles || []),
    ];
    const summary = articles.map(a => `- ${a.title}: ${a.description || ''}`).join('\n').slice(0, 3000);

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Analyze these digital marketing news articles and return ONLY valid JSON: { "trendingSince": "what's trending in digital marketing this week", "opportunity": "biggest opportunity for JRZ Marketing based on these trends", "contentIdea": "one specific content idea for JRZ's social media based on trends", "competitorMove": "what agencies/competitors seem to be focusing on", "actionItem": "one specific action Jose should take this week" }\n\nArticles:\n${summary}` }],
    });
    const insights = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

    const subject = `🔍 Radar Semanal — Tendencias + Competencia (${date})`;
    const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Radar Semanal JRZ Marketing</title>
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
    .insight-row { display:flex; align-items:flex-start; padding:20px 0; border-bottom:1px solid #f0f0f0; }
    .insight-row:last-child { border-bottom:none; }
    .insight-icon { font-size:22px; min-width:36px; margin-right:16px; }
    .insight-content { flex:1; }
    .insight-label { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999999; margin-bottom:6px; }
    .insight-text { font-size:15px; color:#333333; line-height:1.6; }
    .action-box { background:#0a0a0a; border-radius:12px; padding:24px; margin:24px 0; }
    .action-label { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:rgba(255,255,255,0.4); margin-bottom:10px; }
    .action-text { font-size:16px; font-weight:700; color:#ffffff; line-height:1.5; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
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
  <div class="week-badge"><span>Radar Semanal — ${date}</span></div>
  <div class="email-hero">
    <h1>Tendencias + Competencia<br />esta semana. 🔍</h1>
    <p>Análisis automático de ${articles.length} artículos del mercado digital.</p>
  </div>
  <div class="email-body">
    <div class="insight-row">
      <div class="insight-icon">📈</div>
      <div class="insight-content"><div class="insight-label">Tendencia de la semana</div><div class="insight-text">${insights.trendingSince || ''}</div></div>
    </div>
    <div class="insight-row">
      <div class="insight-icon">💡</div>
      <div class="insight-content"><div class="insight-label">Oportunidad para JRZ</div><div class="insight-text">${insights.opportunity || ''}</div></div>
    </div>
    <div class="insight-row">
      <div class="insight-icon">🎯</div>
      <div class="insight-content"><div class="insight-label">Idea de contenido</div><div class="insight-text">${insights.contentIdea || ''}</div></div>
    </div>
    <div class="insight-row">
      <div class="insight-icon">🏢</div>
      <div class="insight-content"><div class="insight-label">Movimiento de competidores</div><div class="insight-text">${insights.competitorMove || ''}</div></div>
    </div>
    <div class="action-box">
      <div class="action-label">Accion de esta semana</div>
      <div class="action-text">${insights.actionItem || ''}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="signature">
    <div class="signature-name">Armando Rivas</div>
    <div class="signature-title">AI Community Manager &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />Radar semanal automático generado por Armando.</p>
  </div>
</div></div>
</body></html>`;

    await sendEmail(OWNER_CONTACT_ID, subject, html);
    console.log('[Competitor] Weekly radar email sent to Jose.');
    // Persist insights for Armando's voice scripts
    await saveCompetitorInsights({ ...insights, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[Competitor] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MANUAL TRIGGER ENDPOINTS — new features
// ═══════════════════════════════════════════════════════════

app.post('/cron/competitor-monitoring', async (_req, res) => {
  try {
    await runCompetitorMonitoring();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/review-mining', async (_req, res) => {
  try {
    await runReviewMining();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GOOGLE CALENDAR — Armando books directly into JRZ Calendar
// Every day 7am–9pm EST, 15-min slots
// ═══════════════════════════════════════════════════════════

async function getJRZCalendarId() {
  if (jrzCalendarId) return jrzCalendarId;
  const token = await getGoogleAccessToken();
  const res   = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { Authorization: `Bearer ${token}` } });
  const cal   = (res.data.items || []).find(c => c.summary && (c.summary.includes('JRZ') || c.summary === 'JRZ Calendar'));
  jrzCalendarId = cal ? cal.id : 'primary';
  console.log(`[Calendar] Using calendar: ${jrzCalendarId}`);
  return jrzCalendarId;
}

async function getAvailableSlots(daysAhead = 3) {
  const token  = await getGoogleAccessToken();
  const calId  = await getJRZCalendarId();
  const slots  = [];
  const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: BOOKING_TZ }));

  for (let d = 0; d <= daysAhead && slots.length < 3; d++) {
    const dayStart = new Date(nowEST);
    dayStart.setDate(dayStart.getDate() + d);
    dayStart.setHours(BOOKING_START_HOUR, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(BOOKING_END_HOUR, 0, 0, 0);

    // Today: start from next 30-min boundary + 1hr buffer
    if (d === 0) {
      const buffer = new Date(nowEST.getTime() + 60 * 60 * 1000);
      buffer.setMinutes(Math.ceil(buffer.getMinutes() / 30) * 30, 0, 0);
      if (buffer > dayStart) dayStart.setTime(buffer.getTime());
    }
    if (dayStart >= dayEnd) continue;

    const freeBusy = await axios.post('https://www.googleapis.com/calendar/v3/freeBusy', {
      timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(),
      timeZone: BOOKING_TZ, items: [{ id: calId }],
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });

    const busy = (freeBusy.data.calendars?.[calId]?.busy || []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));

    let cursor = new Date(dayStart);
    while (cursor < dayEnd && slots.length < 3) {
      const slotEnd = new Date(cursor.getTime() + BOOKING_DURATION * 60 * 1000);
      const isBusy  = busy.some(b => cursor < b.end && slotEnd > b.start);
      if (!isBusy) slots.push({ start: new Date(cursor), end: slotEnd });
      cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
    }
  }
  return slots;
}

function formatSlot(slot) {
  return slot.start.toLocaleString('en-US', { timeZone: BOOKING_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' EST';
}

async function createCalendarEvent(contactName, contactEmail, slot) {
  const token = await getGoogleAccessToken();
  const calId = await getJRZCalendarId();
  const event = {
    summary:     `📞 15-min Strategy Call — ${contactName}`,
    description: `Free 15-min strategy call booked by Armando (JRZ Marketing AI).\nContact: ${contactName}\nEmail: ${contactEmail || 'N/A'}`,
    start: { dateTime: slot.start.toISOString(), timeZone: BOOKING_TZ },
    end:   { dateTime: slot.end.toISOString(),   timeZone: BOOKING_TZ },
    attendees: contactEmail ? [{ email: contactEmail }] : [],
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 15 }] },
  };
  const res = await axios.post(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=all`,
    event, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  console.log(`[Calendar] ✅ Booked: ${contactName} at ${formatSlot(slot)}`);
  return res.data;
}

// ═══════════════════════════════════════════════════════════
// GMAIL — Armando monitors info@jrzmarketing.com
// Runs every 10 minutes — classifies, replies, creates GHL contacts
// ═══════════════════════════════════════════════════════════

async function getGoogleAccessToken() {
  if (googleAccessToken && Date.now() < googleTokenExpiry - 60000) return googleAccessToken;
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
  });
  googleAccessToken = res.data.access_token;
  googleTokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return googleAccessToken;
}

function parseEmailHeaders(headers) {
  const get = (name) => (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  return { from: get('From'), subject: get('Subject'), messageId: get('Message-ID'), references: get('References') };
}

function getEmailBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data)
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data)
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data)
        return Buffer.from(part.body.data, 'base64').toString('utf-8').replace(/<[^>]*>/g, ' ');
    }
  }
  return '';
}

function buildRawEmail(to, subject, body, inReplyTo, references) {
  const lines = [
    `From: Armando — JRZ Marketing <${GMAIL_ADDRESS}>`,
    `To: ${to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : 'Re: ' + subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (inReplyTo)  lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references} ${inReplyTo}`.trim());
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendGmailReply(threadId, to, subject, body, inReplyTo, references) {
  const token = await getGoogleAccessToken();
  const raw   = buildRawEmail(to, subject, body, inReplyTo, references);
  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw, threadId },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

async function markEmailRead(emailId) {
  const token = await getGoogleAccessToken();
  await axios.post(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`,
    { removeLabelIds: ['UNREAD'] },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

async function processGmailEmail(emailId, token) {
  const res     = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
  const email   = res.data;
  const headers = parseEmailHeaders(email.payload?.headers);
  const body    = getEmailBody(email.payload);

  if (!headers.from || headers.from.includes(GMAIL_ADDRESS)) { await markEmailRead(emailId); return; }
  if (!body.trim()) { await markEmailRead(emailId); return; }

  console.log(`[Gmail] Processing: "${headers.subject}" from ${headers.from}`);

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 600,
    messages: [{ role: 'user', content: `You are Armando, bilingual AI manager for JRZ Marketing (Orlando, FL). Analyze this email and return ONLY valid JSON:\n{"category":"lead|client|vendor|partnership|spam|other","language":"es|en","shouldReply":true,"reply":"warm reply max 120 words","contactName":"first name or empty","isUrgent":false,"summary":"one line for Jose"}\n\nFrom: ${headers.from}\nSubject: ${headers.subject}\nBody: ${body.slice(0, 1500)}\n\nCategories: lead=asking about JRZ services/pricing, client=existing client, vendor=selling to JRZ, partnership=collab offer, spam=bulk/unsolicited, other=everything else. Reply in same language as sender. Spam=shouldReply false.` }],
  });
  const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);

  // Send reply
  if (parsed.shouldReply && parsed.reply) {
    await sendGmailReply(email.threadId, headers.from, headers.subject, parsed.reply, headers.messageId, headers.references);
    console.log(`[Gmail] ✅ Replied to ${headers.from} (${parsed.category})`);
  }

  // Create GHL contact for leads
  if (parsed.category === 'lead') {
    const emailMatch = headers.from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      try {
        await axios.post(
          'https://services.leadconnectorhq.com/contacts/',
          { locationId: GHL_LOCATION_ID, email: emailMatch[0], firstName: parsed.contactName || '', tags: ['email-lead', 'armando-gmail'], source: 'Gmail' },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        console.log(`[Gmail] ✅ GHL contact created: ${emailMatch[0]}`);
      } catch { /* contact may already exist */ }
    }
  }

  // Alert Jose on urgent or partnership emails
  if (parsed.isUrgent || parsed.category === 'partnership') {
    await sendEmail(OWNER_CONTACT_ID,
      `${parsed.isUrgent ? '🚨 Urgente' : '🤝 Partnership'} — ${headers.subject}`,
      `<p><strong>De:</strong> ${headers.from}</p><p><strong>Categoría:</strong> ${parsed.category}</p><p><strong>Resumen:</strong> ${parsed.summary}</p><p><strong>Armando respondió:</strong> ${parsed.shouldReply ? parsed.reply : 'Sin respuesta'}</p>`
    );
  }

  await markEmailRead(emailId);
}

async function runGmailCheck() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return;
  try {
    console.log('[Gmail] Checking inbox...');
    const token   = await getGoogleAccessToken();
    const cutoff  = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    const res     = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      params:  { q: `is:unread in:inbox after:${cutoff}`, maxResults: 20 },
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = res.data.messages || [];
    if (!messages.length) { console.log('[Gmail] No new emails'); return; }
    console.log(`[Gmail] ${messages.length} unread emails found`);
    for (const { id } of messages) {
      try { await processGmailEmail(id, token); } catch (err) { console.error(`[Gmail] Failed ${id}:`, err.message); }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) { console.error('[Gmail] Check failed:', err?.response?.data || err.message); }
}

app.get('/cron/calendar-slots', async (_req, res) => {
  try {
    const slots = await getAvailableSlots(3);
    res.json({ total: slots.length, slots: slots.map((s, i) => ({ option: i + 1, time: formatSlot(s), iso: s.start.toISOString() })) });
  } catch (err) { res.status(500).json({ error: err?.response?.data || err.message }); }
});

app.post('/cron/gmail-check', async (_req, res) => {
  try { await runGmailCheck(); res.json({ status: 'ok' }); }
  catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// Dry-run: classify emails but don't reply or create contacts
app.post('/cron/gmail-preview', async (_req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(400).json({ error: 'Google credentials not set' });
  }
  try {
    const token  = await getGoogleAccessToken();
    const cutoff = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    const r      = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      params: { q: `is:unread in:inbox after:${cutoff}`, maxResults: 20 },
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = r.data.messages || [];
    const results  = [];
    for (const { id } of messages) {
      const detail  = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      const headers = parseEmailHeaders(detail.data.payload?.headers);
      const body    = getEmailBody(detail.data.payload);
      if (!headers.from || headers.from.includes(GMAIL_ADDRESS) || !body.trim()) continue;
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 400,
        messages: [{ role: 'user', content: `Classify this email for JRZ Marketing. Return ONLY valid JSON:\n{"category":"lead|client|vendor|partnership|spam|other","language":"es|en","shouldReply":true,"proposedReply":"what Armando would say (max 100 words)","contactName":"","isUrgent":false,"summary":"one line"}\n\nFrom: ${headers.from}\nSubject: ${headers.subject}\nBody: ${body.slice(0, 1000)}` }],
      });
      const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
      results.push({ from: headers.from, subject: headers.subject, ...parsed });
      await new Promise(r => setTimeout(r, 800));
    }
    res.json({ total: results.length, emails: results });
  } catch (err) {
    res.status(500).json({ error: err?.response?.data || err.message });
  }
});

// ── Bland.ai post-call webhook ────────────────────────────────────────────────
app.post('/webhook/bland', async (req, res) => {
  res.json({ ok: true }); // respond fast
  try {
    await parseBlandTranscript(req.body);
  } catch (err) {
    console.error('[Bland] Webhook error:', err.message);
  }
});

app.post('/cron/engagement-learning', async (_req, res) => {
  try {
    await runEngagementLearning();
    await updateWinningVoicePatterns();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/objection-learning', async (_req, res) => {
  try {
    await runObjectionLearning();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/self-update-rules', async (_req, res) => {
  try {
    await runSelfUpdateRules();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/client-checkins', async (_req, res) => {
  try {
    await runClientCheckIns();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/monthly-reports', async (_req, res) => {
  try {
    await sendMonthlyClientReports();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/subaccount-checkin', async (_req, res) => {
  try {
    await sendSubAccountCheckInEmails();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/proposal', async (req, res) => {
  try {
    const { contactId, contactName, businessType } = req.body;
    if (!contactId) return res.status(400).json({ status: 'error', message: 'contactId required' });
    await generateAndSendProposal(contactId, contactName || 'Cliente', businessType || 'negocio', '');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// INTERNAL CRON — checks every 2 minutes
//  7:00am EST  daily      → Carousel post + blog
//  7:05am EST  Monday     → Weekly analytics analysis + A/B test + summary email
//  8:00am EST  Monday     → Competitor monitoring
//  9:00am EST  1st/month  → Monthly client reports
//  9:00am EST  Monday     → Apollo email enrichment
// 10:00am EST  Mon–Fri    → Outbound prospecting (15 contacts/day)
// 10:30am EST  daily      → Client check-ins (30-day rolling)
//  4:00pm EST  daily      → Viral 15s Reel (7 platforms)
//  6:30pm EST  daily      → Story (Instagram + Facebook)
// ═══════════════════════════════════════════════════════════
let lastPostDate     = null;
let lastReelDate     = null;
let lastStoryDate    = null;
let lastSummaryDate  = null;
let lastOutboundDate = null;
let lastEnrichDate   = null;
let lastCheckInDate         = null;
let lastMonthlyReportDate   = null;
let lastCompetitorDate      = null;
let lastSubCheckInDate      = null;
let lastLearningDate        = null;

setInterval(async () => {
  try {
    const nowEST    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today     = nowEST.toISOString().split('T')[0];
    const hour      = nowEST.getHours();
    const minute    = nowEST.getMinutes();
    const dayOfWeek = nowEST.getDay(); // 0=Sun, 1=Mon…6=Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    // 7:00am — daily carousel + blog
    if (hour === 7 && minute < 5 && lastPostDate !== today) {
      lastPostDate = today;
      await runDailyPost();
    }

    // 7:05am Monday — analytics self-learning + A/B test analysis + weekly email
    if (hour === 7 && minute >= 5 && minute < 10 && dayOfWeek === 1 && lastSummaryDate !== today) {
      lastSummaryDate = today;
      await runWeeklyAnalysis();
      await runABTestAnalysis(); // analyze closing variants, shift weights to winner
      const days     = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const weekPosts = CAROUSEL_SCRIPTS.slice(0, 7).map((s, i) => ({ day: days[i], title: s.title, success: true }));
      await sendWeeklySummaryEmail(weekPosts);
    }

    // 8:00am Monday — competitor monitoring
    if (hour === 8 && minute < 5 && dayOfWeek === 1 && lastCompetitorDate !== today) {
      lastCompetitorDate = today;
      await runCompetitorMonitoring();
    }

    // 8:30am Monday — engagement learning + voice pattern optimization + review mining
    if (hour === 8 && minute >= 30 && minute < 35 && dayOfWeek === 1 && lastLearningDate !== today) {
      lastLearningDate = today;
      await runEngagementLearning();
      await updateWinningVoicePatterns();
      await runReviewMining();
      await runObjectionLearning();
      await runSelfUpdateRules();
    }

    // 9:00am Monday — Apollo email enrichment (free plan: 50 credits/month)
    if (hour === 9 && minute < 5 && dayOfWeek === 1 && lastEnrichDate !== today) {
      lastEnrichDate = today;
      await enrichProspectEmails();
    }

    // 1st of month, 9:00am — monthly client reports
    const dateOfMonth = nowEST.getDate();
    if (hour === 9 && minute < 5 && dateOfMonth === 1 && lastMonthlyReportDate !== today) {
      lastMonthlyReportDate = today;
      await sendMonthlyClientReports();
    }

    // Last Friday of month, 10:00am — sub-account monthly check-in emails
    const isFriday = dayOfWeek === 5;
    const isLastFriday = isFriday && (dateOfMonth + 7 > new Date(nowEST.getFullYear(), nowEST.getMonth() + 1, 0).getDate());
    if (hour === 10 && minute < 5 && isLastFriday && lastSubCheckInDate !== today) {
      lastSubCheckInDate = today;
      await sendSubAccountCheckInEmails();
    }

    // 10:00am Mon–Fri — outbound prospecting
    if (hour === 10 && minute < 5 && isWeekday && lastOutboundDate !== today) {
      lastOutboundDate = today;
      await runDailyOutbound();
    }

    // 10:30am daily — client check-ins (30-day rolling)
    if (hour === 10 && minute >= 30 && minute < 35 && lastCheckInDate !== today) {
      lastCheckInDate = today;
      await runClientCheckIns();
    }

    // 4:00pm Mon/Wed/Fri — viral Reel (12 per month)
    const isReelDay = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    if (hour === 16 && minute < 5 && isReelDay && lastReelDate !== today) {
      lastReelDate = today;
      await runDailyReel();
    }

    // 6:30pm — story
    if (hour === 18 && minute >= 30 && minute < 35 && lastStoryDate !== today) {
      lastStoryDate = today;
      await runDailyStory();
    }

    // Every tick (every 2 min) — Gmail inbox check
    await runGmailCheck();

  } catch (err) {
    console.error('[Cron] Internal scheduler error:', err.message);
  }
}, 2 * 60 * 1000); // Every 2 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Armando Rivas is online — JRZ Marketing 🇻🇪`);
  console.log(`7:00am  EST daily     → Carousel + Blog`);
  console.log(`7:05am  EST Monday    → Weekly analytics self-learning + email`);
  console.log(`10:00am EST Mon-Fri   → Outbound prospecting (15 contacts/day)`);
  console.log(`4:00pm  EST Mon/Wed/Fri → 15s Viral Reel w/ voice (7 platforms, ~12/month)`);
  console.log(`6:30pm  EST daily     → Story (Instagram + Facebook)`);
  console.log(`24/7                  → Armando warm DMs on comments/follows`);
});
