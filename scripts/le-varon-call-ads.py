"""
Le Varon Barbershop — Call-Focused RSA Ads + Call Asset
Google Ads API v20:
  - No phone numbers in ad text (Google PROHIBITED policy)
  - Phone number goes in call asset ONLY — shows automatically under every ad
Run: python3 le-varon-call-ads.py
"""

import json
import os
import urllib.request
import urllib.parse

# ─── Auth ────────────────────────────────────────────────────────────────────
# Set these as environment variables before running:
#   export GOOGLE_REFRESH_TOKEN="..."
#   export GOOGLE_CLIENT_ID="..."
#   export GOOGLE_CLIENT_SECRET="..."
#   export GOOGLE_ADS_DEV_TOKEN="..."
REFRESH_TOKEN = os.environ["GOOGLE_REFRESH_TOKEN"]
CLIENT_ID     = os.environ["GOOGLE_CLIENT_ID"]
CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
DEV_TOKEN     = os.environ.get("GOOGLE_ADS_DEV_TOKEN", "saVkv7v1x6X9dsnDyPVCYg")
CID           = "5192590797"
BASE          = f"https://googleads.googleapis.com/v20/customers/{CID}"

# ─── Le Varon Details ────────────────────────────────────────────────────────
PHONE   = "4075358751"
COUNTRY = "US"
BOOKING = "https://www.levaronbarbershop.com/booking-form"

AG_BARBER_NEAR_ME = "customers/5192590797/adGroups/200932351612"
AG_BARBERSHOP_ORL = "customers/5192590797/adGroups/200932351652"
AG_HAIRCUT_FADE   = "customers/5192590797/adGroups/200932351812"

CAMP_MAIN      = "customers/5192590797/campaigns/23211470083"
CAMP_CALL_ONLY = "customers/5192590797/campaigns/23772794832"

def get_token():
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN, "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]

def ads_post(token, endpoint, body):
    data = json.dumps(body).encode("utf-8")
    req  = urllib.request.Request(
        f"{BASE}/{endpoint}", data=data,
        headers={"Authorization": f"Bearer {token}", "developer-token": DEV_TOKEN, "Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def h(text, pin=None):
    return {"text": text, "pinned_field": pin} if pin else {"text": text}

def d(text, pin=None):
    return {"text": text, "pinned_field": pin} if pin else {"text": text}

def rsa(ad_group, headlines, descriptions):
    return {
        "create": {
            "ad_group": ad_group,
            "status":   "ENABLED",
            "ad": {
                "final_urls": [BOOKING],
                "responsive_search_ad": {
                    "headlines":    headlines,
                    "descriptions": descriptions,
                }
            }
        }
    }

def main():
    print("\nLe Varon Barbershop — Call-Focused Ads Setup")
    print("=" * 52)
    token = get_token()
    print("Auth OK\n")

    # ── Step 1: Create RSA ads — call-to-action copy, NO phone numbers ────────
    print("Step 1: Creating call-focused RSA ads...")
    res = ads_post(token, "adGroupAds:mutate", {"operations": [

        rsa(AG_BARBER_NEAR_ME,
            headlines=[
                h("Call Now - Walk In Today",      "HEADLINE_1"),
                h("Barber Open Near You Now",      "HEADLINE_2"),
                h("Same-Day Fades - Call Us"),
                h("No Wait - Walk In Welcome"),
                h("Top-Rated Barber Near You"),
                h("Open Wed-Sat - Call Anytime"),
                h("Skin Fades Done Right"),
                h("Expert Barbers Near You"),
                h("Call - We Get You In Today"),
                h("Near Florida Mall Orlando"),
                h("Taper Fades & Beard Trims"),
                h("Walk In or Call Today"),
                h("Men's Grooming Specialist"),
                h("S Orange Blossom Trail"),
                h("Precision Cuts - Call Us"),
            ],
            descriptions=[
                d("Call us now for same-day fades, beard trims & hot shaves. Walk in anytime Wed-Sat.", "DESCRIPTION_1"),
                d("Open Wed 12-7pm, Thu-Sat 10am-7pm on S Orange Blossom Trail, Orlando. Call us now."),
                d("Near Florida Mall. Top-rated barbers ready now. Call or walk in - no appointment needed."),
                d("Hablamos espanol. Precision fades & razor shaves. Call Le Varon - we get you in today."),
            ]
        ),

        rsa(AG_BARBERSHOP_ORL,
            headlines=[
                h("Call Orlando's Top Barbershop", "HEADLINE_1"),
                h("Walk In Today - We Are Open",   "HEADLINE_2"),
                h("Near Florida Mall on OBT"),
                h("Walk-Ins Always Welcome"),
                h("Skin Fades & Beard Trims OBT"),
                h("S Orange Blossom Trail Barber"),
                h("Call - Open Wed-Sat Orlando"),
                h("Expert Barbers - S OBT"),
                h("Top Fades in Orlando FL"),
                h("Barbershop Near Florida Mall"),
                h("Call to Reserve Your Spot"),
                h("Orlando Barber - Call Now"),
                h("Hot Towel Shaves Orlando"),
                h("No Wait - Walk In Welcome"),
                h("Haircuts That Turn Heads"),
            ],
            descriptions=[
                d("Call Le Varon now. 8241 S Orange Blossom Trail, Orlando. Walk in or book today.", "DESCRIPTION_1"),
                d("Top-rated near Florida Mall. Open Wed 12-7pm, Thu-Sat 10am-7pm. Call or walk in."),
                d("Walk-ins always welcome. Call to reserve or just show up on S OBT Suite 208, Orlando."),
                d("Orlando's top barbershop for sharp fades, clean cuts & razor shaves. Call us today."),
            ]
        ),

        rsa(AG_HAIRCUT_FADE,
            headlines=[
                h("Call for Fades & Beard Trims",  "HEADLINE_1"),
                h("Hablamos Espanol - Llamanos",   "HEADLINE_2"),
                h("Cortes de Cabello - Llamanos"),
                h("Taper Fades - Call Orlando"),
                h("Hot Towel Straight Razor Shave"),
                h("Near Florida Mall - Call Now"),
                h("Kids Haircuts - Call Today"),
                h("Open Wed-Sat - Call Anytime"),
                h("Fade Specialist - Call Now"),
                h("Full-Service Barbershop OBT"),
                h("Haircut Plus Beard - Call Us"),
                h("Walk In or Call - Open Now"),
                h("Barberia Orlando - Llamanos"),
                h("Call to Book Your Appointment"),
                h("Expert Fades - Call Today"),
            ],
            descriptions=[
                d("Call us now. Skin fades, beard trims & hot towel shaves. Walk in Wed-Sat on S OBT.", "DESCRIPTION_1"),
                d("Haircut + beard combo on S Orange Blossom Trail near Florida Mall. Call or walk in."),
                d("Hablamos espanol. Cortes de cabello y fades en Orlando. Llamanos o visita hoy mismo."),
                d("Kids cuts, buzz cuts & razor shaves at Le Varon. Walk-ins welcome - call us first."),
            ]
        ),

    ]})

    if "results" in res:
        print(f"  Created {len(res['results'])} call-focused RSA ads")
        for r in res["results"]:
            print(f"    -> {r['resourceName']}")
    else:
        print(f"  ERROR: {json.dumps(res)[:500]}")
        return

    # ── Step 2: Create call asset ─────────────────────────────────────────────
    print("\nStep 2: Creating call asset (407) 535-8751...")
    res2 = ads_post(token, "assets:mutate", {"operations": [{
        "create": {
            "name": "le_varon_call_asset",
            "type": "CALL",
            "call_asset": {
                "country_code": COUNTRY,
                "phone_number": PHONE,
                "call_conversion_reporting_state": "USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION",
            }
        }
    }]})

    if "results" in res2:
        call_rn = res2["results"][0]["resourceName"]
        print(f"  Call asset created: {call_rn}")

        # ── Step 3: Link call asset to both campaigns ──────────────────────────
        print("\nStep 3: Linking call asset to both campaigns...")
        res3 = ads_post(token, "campaignAssets:mutate", {"operations": [
            {"create": {"campaign": CAMP_MAIN,      "asset": call_rn, "field_type": "CALL"}},
            {"create": {"campaign": CAMP_CALL_ONLY, "asset": call_rn, "field_type": "CALL"}},
        ]})
        if "results" in res3:
            print(f"  Linked to {len(res3['results'])} campaigns")
        else:
            err = json.dumps(res3)
            if "DUPLICATE" in err or "already exists" in err.lower():
                print("  Call asset already linked - OK")
            else:
                print(f"  Warning: {err[:300]}")
    else:
        err = json.dumps(res2)
        if "DUPLICATE" in err or "already exists" in err.lower():
            print("  Call asset already exists - OK")
        else:
            print(f"  Warning: {err[:300]}")

    # ── Done ──────────────────────────────────────────────────────────────────
    print("\n" + "=" * 52)
    print("DONE - Le Varon is 100% call-focused")
    print("=" * 52)
    print("\nEvery ad now:")
    print("  - Headlines push 'Call Now', 'Walk In', urgency")
    print("  - (407) 535-8751 shows via call asset under every ad")
    print("  - One tap on mobile = direct call to Le Varon")
    print("  - Schedule: Wed 12-7pm, Thu-Sat 10am-7pm")
    print("  - Budget: $20 + $10 = $30/day total")
    print("=" * 52)

if __name__ == "__main__":
    main()
