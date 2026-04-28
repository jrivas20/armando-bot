import json
import urllib.request
import urllib.error
import random

random.seed(42)

LOCATION_ID = "Q6FIvQ5WitCeq9wyXZ3L"
API_KEY = "pit-12dce5dd-f4b0-4348-a3e8-e887beaf07e4"
URL = "https://services.leadconnectorhq.com/emails/builder"

COLOR_PHOTOS = [
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e55ec6d12658aad49.jpeg",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e55ec6d12658aad4b.jpeg",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e2790d9aa14b72fdb.jpeg",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e55ec6d12658aad4f.jpeg",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4df7bfdb83df3281d9.jpeg",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4ed98d84290c6b8f45.jpeg",
]

COLOR_VIDEOS = [
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cff5ebf27de34e1d3e.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cf91452c30c25bb1b4.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cf3d9f7a33e41ccbf4.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cfa64a04ba15e8221d.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cfa5d3efc6ded6f27d.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cfebf1a6084338eb7f.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d6802af7bfdb83df33399f.mov",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67c523dd00cb232a19f7c.mp4",
    "https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67c52f5ebf27de34d2318.mp4",
]

def photo_block(url, alt="Luis Farrera Tattoo — Color Realism NYC"):
    return f"""<tr><td style="padding:0 0 2px;">
      <img src="{url}" alt="{alt}" width="600" style="display:block;width:100%;height:auto;max-height:420px;object-fit:cover;background:#111;">
    </td></tr>"""

def two_photo_block(url1, url2):
    return f"""<tr>
      <td width="299" style="padding:0 1px 2px 0;vertical-align:top;">
        <img src="{url1}" alt="Luis Farrera Color Tattoo NYC" width="299" style="display:block;width:100%;height:auto;max-height:300px;object-fit:cover;background:#111;">
      </td>
      <td width="299" style="padding:0 0 2px 1px;vertical-align:top;">
        <img src="{url2}" alt="Luis Farrera Color Realism" width="299" style="display:block;width:100%;height:auto;max-height:300px;object-fit:cover;background:#111;">
      </td>
    </tr>"""

def video_block(video_url, thumb_url):
    return f"""<tr><td style="padding:0;position:relative;">
      <a href="{video_url}" target="_blank" style="display:block;position:relative;text-decoration:none;">
        <img src="{thumb_url}" alt="Watch the Reel — Luis Farrera Tattoo" width="600" style="display:block;width:100%;height:auto;max-height:380px;object-fit:cover;background:#111;filter:brightness(.75);">
        <table cellpadding="0" cellspacing="0" width="100%" style="position:absolute;top:0;left:0;height:100%;">
          <tr><td align="center" style="vertical-align:middle;">
            <table cellpadding="0" cellspacing="0">
            <tr><td style="background:rgba(0,0,0,.45);border:1px solid rgba(207,169,71,.6);padding:14px 28px;text-align:center;">
              <div style="font-family:Arial,sans-serif;font-size:18px;color:#f4f1eb;margin-bottom:4px;">&#9654;</div>
              <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#e2c66f;">Watch the Reel</div>
            </td></tr>
            </table>
          </td></tr>
        </table>
      </a>
    </td></tr>"""

def build_media_blocks(photos, video, video_thumb):
    used = random.randint(1, 2)
    selected_photos = random.sample(photos, min(used, len(photos)))
    blocks = ""
    if len(selected_photos) == 2:
        blocks += f'<table width="600" cellpadding="0" cellspacing="0" style="width:100%;">{two_photo_block(selected_photos[0], selected_photos[1])}</table>'
    else:
        blocks += f'<table width="600" cellpadding="0" cellspacing="0" style="width:100%;">{photo_block(selected_photos[0])}</table>'
    blocks += f'<table width="600" cellpadding="0" cellspacing="0" style="width:100%;">{video_block(video, video_thumb)}</table>'
    return blocks

def base_html(eyebrow, headline, subline, body_paragraphs, cta_text, cta_url, photos, video, video_thumb):
    # Build body rows
    para_rows = ""
    for i, p in enumerate(body_paragraphs):
        bottom_pad = "20px" if i < len(body_paragraphs)-1 else "30px"
        if p.startswith("QUOTE:"):
            text = p[6:]
            para_rows += f"""<tr><td style="padding:0 40px {bottom_pad};">
              <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="border-left:2px solid #cfa947;padding-left:18px;font-family:Georgia,serif;font-size:17px;line-height:1.75;font-style:italic;color:rgba(244,241,235,.72);">{text}</td>
              </tr></table>
            </td></tr>"""
        else:
            para_rows += f'<tr><td style="padding:0 40px {bottom_pad};font-family:Arial,sans-serif;font-size:15px;line-height:1.85;color:rgba(255,255,255,.78);">{p}</td></tr>'

    # Build media HTML
    media_html = build_media_blocks(photos, video, video_thumb)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;1,300&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>
body{{margin:0;padding:0;background:#050505;-webkit-text-size-adjust:100%;}}
table{{border-spacing:0;border-collapse:collapse;}}
td{{padding:0;margin:0;}}
img{{border:0;display:block;max-width:100%;}}
a{{text-decoration:none;}}
@media only screen and (max-width:600px){{
  .em-wrap{{padding:0!important;}}
  .em-container{{width:100%!important;}}
  .em-hero-title{{font-size:32px!important;}}
  .em-pad{{padding-left:20px!important;padding-right:20px!important;}}
  .em-two-col td{{display:block!important;width:100%!important;padding:0 0 2px!important;}}
  .em-two-col td img{{max-height:260px!important;}}
}}
</style>
</head>
<body style="margin:0;padding:0;background:#050505;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#050505;">
<tr><td class="em-wrap" align="center" style="padding:24px 16px;">

<table class="em-container" width="600" cellpadding="0" cellspacing="0" role="presentation" style="background:#050505;max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td class="em-pad" style="padding:26px 40px;background:#050505;border-bottom:1px solid rgba(255,255,255,.07);">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td>
        <div style="font-family:Arial Black,Arial,sans-serif;font-size:16px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#f4f1eb;">LUIS FARRERA</div>
        <div style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(244,241,235,.35);margin-top:4px;">Tattoo Artist &nbsp;&middot;&nbsp; Soho, New York</div>
      </td>
      <td align="right" style="vertical-align:middle;">
        <a href="https://luisfarreratattoo.com/book-now" style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#e2c66f;border:1px solid rgba(207,169,71,.4);padding:8px 14px;">Book Now</a>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- GOLD LINE -->
  <tr><td style="height:1px;background:linear-gradient(to right,#cfa947,rgba(207,169,71,0));font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- HERO -->
  <tr><td class="em-pad" style="padding:40px 40px 32px;background:#080808;">
    <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#e2c66f;margin-bottom:14px;">
      <span style="display:inline-block;width:22px;height:1px;background:#cfa947;vertical-align:middle;margin-right:8px;"></span>{eyebrow}
    </div>
    <div class="em-hero-title" style="font-family:Arial Black,Arial,sans-serif;font-size:42px;line-height:.92;letter-spacing:1px;text-transform:uppercase;color:#f4f1eb;margin:0 0 16px;">{headline}</div>
    <div style="font-family:Georgia,serif;font-size:18px;line-height:1.65;font-weight:300;font-style:italic;color:rgba(244,241,235,.55);margin:0;">{subline}</div>
  </td></tr>

  <!-- SEPARATOR -->
  <tr><td style="height:1px;background:rgba(255,255,255,.05);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- MEDIA — photos + video -->
  <tr><td style="padding:0;background:#0a0a0a;">
    {media_html}
  </td></tr>

  <!-- SEPARATOR -->
  <tr><td style="height:1px;background:rgba(255,255,255,.05);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- BODY COPY -->
  <tr><td style="padding-top:32px;background:#050505;"></td></tr>
  {para_rows}

  <!-- CTA BUTTON -->
  <tr><td class="em-pad" style="padding:8px 40px 40px;text-align:center;background:#050505;">
    <table cellpadding="0" cellspacing="0" align="center">
    <tr><td>
      <a href="{cta_url}" style="display:inline-block;padding:15px 38px;border:1px solid #cfa947;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#e2c66f;background:transparent;">{cta_text}</a>
    </td></tr>
    </table>
  </td></tr>

  <!-- SEPARATOR -->
  <tr><td style="height:1px;background:rgba(255,255,255,.05);font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- SIGNATURE -->
  <tr><td class="em-pad" style="padding:28px 40px;background:#050505;">
    <div style="font-family:Georgia,serif;font-size:21px;font-style:italic;color:#e2c66f;margin-bottom:5px;">Luis Farrera</div>
    <div style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(244,241,235,.35);">Color &amp; Black/Gray Realism &nbsp;&middot;&nbsp; Soho, NYC</div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06);">
      <a href="https://luisfarreratattoo.com/" style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(244,241,235,.38);text-decoration:none;margin-right:18px;">Website</a>
      <a href="https://luisfarreratattoo.com/portfolio" style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(244,241,235,.38);text-decoration:none;margin-right:18px;">Portfolio</a>
      <a href="https://luisfarreratattoo.com/book-now" style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(244,241,235,.38);text-decoration:none;">Book Now</a>
    </div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td class="em-pad" style="padding:20px 40px 28px;background:#020202;border-top:1px solid rgba(255,255,255,.05);text-align:center;">
    <div style="font-family:Arial,sans-serif;font-size:11px;color:rgba(244,241,235,.28);margin-bottom:10px;">132 Crosby St 4th Floor &nbsp;&middot;&nbsp; Soho, New York, NY 10012</div>
    <div style="font-family:Arial,sans-serif;font-size:10px;color:rgba(244,241,235,.2);">
      &copy; 2026 Luis Farrera Tattoo. All rights reserved.<br>
      <a href="{{{{unsubscribe_link}}}}" style="color:rgba(244,241,235,.22);text-decoration:underline;">Unsubscribe</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""

EMAILS = [
    {"name":"LF - Month 01 - Welcome","subject":"Welcome to Luis Farrera Tattoo","eyebrow":"Welcome","headline":"WHERE YOUR<br>CONCEPT<br>COMES TO LIFE","subline":"Color realism. Black and gray. Custom from the first conversation.","body":["Welcome. We are glad you found us.","My name is Luis Farrera. I am a tattoo artist based in Soho, New York, and I have spent years perfecting one thing — bringing concepts to life through bold, vibrant, lasting work.","QUOTE:Every piece I create is custom. No flash sheets. No templates. Just your idea, refined through conversation, and executed with everything I have.","Over the next few months I will be sharing everything I know about tattooing — how to choose the right design, how to keep your work looking sharp for life, and a look behind the art.","If you are ready to book or just have a question, reply to this email anytime."],"cta":"View the Portfolio","cta_url":"https://luisfarreratattoo.com/"},
    {"name":"LF - Month 02 - Color vs Black and Gray","subject":"Color vs Black and Gray — What Nobody Tells You","eyebrow":"The Craft","headline":"COLOR VS<br>BLACK &amp; GRAY","subline":"The honest answer most artists will not give you.","body":["People ask me all the time: should I go color or black and gray?","Black and gray is timeless. It ages predictably. It works on virtually every skin tone. It is the safe choice — and there is nothing wrong with that.","QUOTE:Color is different. Color is alive. When it is done right, a color tattoo does not just sit on your skin — it draws people in.","Color requires the right pigments, precise layering, and an understanding of how your specific skin tone interacts with each shade. If you are unsure which direction serves your concept best, reply here."],"cta":"See the Work","cta_url":"https://luisfarreratattoo.com/portfolio"},
    {"name":"LF - Month 03 - Choosing Your Design","subject":"How to Choose a Tattoo Design You Will Love for Life","eyebrow":"Design Guidance","headline":"CHOOSING A<br>DESIGN THAT<br>LASTS","subline":"What actually matters when picking your concept.","body":["The biggest mistake people make when choosing a tattoo is selecting a design based on what looks good on someone else's skin.","Your skin tone determines which colors will pop. Placement affects longevity. Scale matters for detail — intricate work needs room to breathe.","QUOTE:Bring inspiration, not expectations. The goal is a piece made for your body — not a replica of someone else's tattoo.","Before any session, we talk. I want to understand what the concept means to you and what you want to feel when you look at it ten years from now."],"cta":"Start the Conversation","cta_url":"https://luisfarreratattoo.com/book-now"},
    {"name":"LF - Month 04 - Behind the Process","subject":"What Happens Before You Ever Sit in the Chair","eyebrow":"Behind the Work","headline":"BEFORE YOU<br>SIT IN THE<br>CHAIR","subline":"The preparation most clients never see.","body":["Most clients see the final result. Very few see what goes into getting there.","Before every session I study the reference — the shapes, the color relationships, how light moves through the subject. Then I sketch. Not to copy, but to translate.","QUOTE:I plan the entire color palette before mixing a single drop of ink. The order in which colors go down matters more than most people realize.","By the time you sit in my chair, I already know exactly what I am doing. That preparation is what separates a tattoo that looks good in a photo from one that turns heads for life."],"cta":"Book Your Session","cta_url":"https://luisfarreratattoo.com/book-now"},
    {"name":"LF - Month 05 - Aftercare","subject":"How to Keep Your Tattoo Vibrant for Years","eyebrow":"Aftercare","headline":"HOW TO<br>PROTECT YOUR<br>INVESTMENT","subline":"What you do after the session determines how it looks in a decade.","body":["A tattoo is an investment. How you care for it in the first few weeks — and the years after — determines how it looks ten years from now.","The first two weeks are critical. Keep the area clean and moisturized. Let the skin flake off naturally. Do not pick or scratch — pulling skin off removes color.","QUOTE:Sun is the enemy of color. UV light breaks down pigment faster than anything else. SPF 50 or higher, every time the tattoo sees sun. This is not optional.","Touch-ups every five to ten years are standard for any color tattoo. Take care of your tattoo and it will take care of you."],"cta":"View the Portfolio","cta_url":"https://luisfarreratattoo.com/portfolio"},
    {"name":"LF - Month 06 - Styles Explained","subject":"Neo Traditional, Realism, Watercolor — Which Style Is Right for You","eyebrow":"Style Guide","headline":"FINDING<br>YOUR STYLE","subline":"Color tattooing is not one thing. Here is how to tell them apart.","body":["Color tattooing is a family of styles. Each one has its own rules, its own aesthetic, and its own demands on the artist.","Neo Traditional uses bold outlines and rich saturated color. Color realism aims to make the tattoo look like a photograph on skin.","QUOTE:When color realism is done right, it is genuinely breathtaking — but it requires an artist who has mastered light, shadow, and seamless blending.","Botanical and floral color work has seen a massive rise in 2026 and remains one of my strongest areas. Not sure which direction fits your concept? Reply here."],"cta":"See All Styles","cta_url":"https://luisfarreratattoo.com/portfolio"},
    {"name":"LF - Month 07 - First Session","subject":"Your First Session — What to Expect, Start to Finish","eyebrow":"The Session","headline":"WHAT TO<br>EXPECT AT<br>YOUR SESSION","subline":"From the moment you arrive to the moment you leave.","body":["Whether this is your first tattoo or your fifteenth, walking into a new studio comes with questions. Here is exactly what a session with me looks like.","We start with a conversation. I want to make sure the design feels right before anything touches your skin. If adjustments are needed, we make them.","QUOTE:I work methodically. Color tattooing is not fast, and I will not rush it. My only goal is that you leave with something extraordinary.","When we finish, I walk you through aftercare. You leave with written instructions and my contact information. If you have questions during healing, I am reachable."],"cta":"Book Your Consultation","cta_url":"https://luisfarreratattoo.com/book-now"},
    {"name":"LF - Month 08 - Skin Tone","subject":"How Your Skin Tone Changes Everything About Your Tattoo","eyebrow":"Skin &amp; Color","headline":"YOUR SKIN<br>IS PART OF<br>THE TATTOO","subline":"The most important thing most artists never explain.","body":["Your skin tone is not a background for the tattoo. It is part of the tattoo.","On lighter skin, a wide range of colors show up with high contrast. On medium skin, warm colors — oranges, reds, rich golds — come alive in a way they cannot on lighter skin.","QUOTE:On deeper skin tones, bold and highly saturated colors are the move. The right palette on deeper skin produces some of the most striking tattoos I have ever created.","I factor all of this in before we begin. The color palette I recommend for you is built around your skin — not just your concept."],"cta":"Book a Consultation","cta_url":"https://luisfarreratattoo.com/book-now"},
    {"name":"LF - Month 09 - Touch-Ups","subject":"Touch-Ups Are Not a Sign of a Bad Tattoo","eyebrow":"Longevity","headline":"THE TRUTH<br>ABOUT<br>TOUCH-UPS","subline":"What fading really means — and what to do about it.","body":["I want to clear something up that causes unnecessary anxiety.","Needing a touch-up does not mean your tattoo was done poorly. It means you have living, breathing, changing skin — and that skin has been doing its job.","QUOTE:Most color tattoos benefit from a touch-up somewhere between five and ten years. This is not a flaw in the work. It is how pigment in skin behaves over time.","Keep it out of direct sun, always use SPF 50 or higher, moisturize daily. If you have a piece that has faded and you want it restored, reach out."],"cta":"View the Portfolio","cta_url":"https://luisfarreratattoo.com/portfolio"},
    {"name":"LF - Month 10 - Story Behind the Work","subject":"The Piece I Am Most Proud Of","eyebrow":"Behind the Art","headline":"THE PIECE<br>THAT CHANGED<br>EVERYTHING","subline":"What I am actually trying to do with every client.","body":["A client came to me with a photograph of a flower her grandmother used to grow in her garden. She did not want a copy of the photo. She wanted to feel something when she looked at it.","We spent two consultations getting the concept right. The composition changed three times. The color palette went through four versions.","QUOTE:What came out of that session was not just a tattoo. It was a translation of a memory into something permanent.","That is what I am trying to do with every client. Not reproduce something. Translate something. Reply here and let us start that conversation."],"cta":"Start Your Concept","cta_url":"https://luisfarreratattoo.com/book-now"},
    {"name":"LF - Month 11 - Large Pieces","subject":"Thinking About a Sleeve or Large Piece? Read This First","eyebrow":"Large Scale Work","headline":"PLANNING A<br>SLEEVE OR<br>LARGE PIECE","subline":"What you need to know before committing to something large scale.","body":["Large color work — sleeves, back pieces, chest panels — is some of the most rewarding tattooing there is. It is also the most demanding.","Plan the full composition before you start. The most common mistake is beginning without a complete plan and trying to fill in the gaps later. We map everything out before the first session.","QUOTE:A high quality color sleeve is typically four to eight sessions. Each session runs three to six hours. This is not something that gets rushed.","Give your skin two to four weeks minimum between sessions on the same area. If you are thinking about large scale work, the best time to start the conversation is now."],"cta":"Book a Consultation","cta_url":"https://luisfarreratattoo.com/book-now"},
    {"name":"LF - Month 12 - Year End","subject":"One Year Later — Thank You for Being Part of This","eyebrow":"One Year","headline":"THANK YOU<br>FOR BEING<br>PART OF THIS","subline":"A note from Luis — one year in.","body":["It has been a year since you first connected with Luis Farrera Tattoo.","Whether you have already sat in the chair or you are still thinking about your first piece — I want you to know I appreciate you being here.","QUOTE:I do not chase trends. I do not rush work. I show up fully prepared for every session and give every client something they will be proud of for life.","If you are ready to move forward — your first tattoo, a new piece, or restoring something that has faded — I would love to work with you. Reply to this email and let us start the conversation."],"cta":"Book Your Session","cta_url":"https://luisfarreratattoo.com/book-now"},
]

def create_template(email_data):
    photos = random.sample(COLOR_PHOTOS, 2)
    video = random.choice(COLOR_VIDEOS)
    video_thumb = random.choice(COLOR_PHOTOS)

    html = base_html(
        eyebrow=email_data["eyebrow"],
        headline=email_data["headline"],
        subline=email_data["subline"],
        body_paragraphs=email_data["body"],
        cta_text=email_data["cta"],
        cta_url=email_data["cta_url"],
        photos=photos,
        video=video,
        video_thumb=video_thumb,
    )

    payload = json.dumps({
        "locationId": LOCATION_ID,
        "type": "html",
        "name": email_data["name"],
        "title": email_data["subject"],
        "html": html
    }).encode("utf-8")

    req = urllib.request.Request(URL, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Version", "2021-07-28")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            return {"name": email_data["name"], "id": body.get("id"), "status": "created"}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        return {"name": email_data["name"], "status": "error", "detail": err[:200]}
    except Exception as e:
        return {"name": email_data["name"], "status": "error", "detail": str(e)}

print("Building and uploading 12 Luis Farrera email templates...\n")
results = []
for i, email in enumerate(EMAILS, 1):
    result = create_template(email)
    results.append(result)
    ok = result["status"] == "created"
    print(f"{'✓' if ok else '✗'} [{i:02d}/12] {email['name']} | ID: {result.get('id','N/A')}")

print(f"\n--- DONE: {len([r for r in results if r['status']=='created'])}/12 created ---")
failed = [r for r in results if r["status"] != "created"]
if failed:
    print("FAILED:")
    for f in failed:
        print(f"  {f['name']}: {f.get('detail','')}")
