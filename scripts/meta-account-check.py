"""
Meta Ads — Account Access Check
Tests if our token has access to ad account 1035800180536697
Run: python3 meta-account-check.py
"""

import json
import urllib.request
import urllib.parse

TOKEN = "EAAYoO6CtmWIBRcM6kzros5N1TAsFEk33ScEEftheh0ujD4EQAfwiTrueZAOMI6VyxTs5CqZBngaWzBeCiO5G5YkgU6cvN2UZB99fZCNpdizL9SsOkY5sAsd73klROfDjZA2tRZAoGMgFKSIR2MkJoyxQPsjMDK7hqWAKvZAzesyqyb9EuTrLCz9tEoIccFgrhwcW8fY0Of3IJwU0ACU1fLJRUx96lc5pxZAxXtR1bIv8SJvDYrmQSVfKsZAn1KbE3qeaWZB1ZCRsjaSIFQtGFU5FPCs"
TARGET_ACCOUNT = "2821114714910503"
BASE = "https://graph.facebook.com/v20.0"

def meta_get(path, params={}):
    params["access_token"] = TOKEN
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        return None, json.loads(e.read())

print("\nMeta Ads — Retry Access: act_1035800180536697")
print("=" * 52)

# Step 1: Quick token check
data, err = meta_get("me", {"fields": "id,name"})
if not data:
    print(f"Token invalid: {err}")
    exit(1)
print(f"Token OK — {data.get('name')}\n")

# Step 2: Try to access the target account with full fields
print(f"Accessing act_{TARGET_ACCOUNT}...")
data2, err2 = meta_get(f"act_{TARGET_ACCOUNT}", {
    "fields": "id,name,account_status,currency,timezone_name,amount_spent,balance,disable_reason,business"
})

if data2:
    status_map = {1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW",
                  8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE",
                  101: "CLOSED", 201: "ANY_ACTIVE", 202: "ANY_CLOSED"}
    status = status_map.get(data2.get("account_status"), str(data2.get("account_status")))
    spent  = int(data2.get("amount_spent", 0)) / 100
    balance = int(data2.get("balance", 0)) / 100
    biz = data2.get("business", {})

    print(f"\n  ACCESS GRANTED")
    print(f"  Name:      {data2.get('name', 'N/A')}")
    print(f"  Status:    {status}")
    print(f"  Currency:  {data2.get('currency', 'N/A')}")
    print(f"  Timezone:  {data2.get('timezone_name', 'N/A')}")
    print(f"  Spent:     ${spent:,.2f}")
    print(f"  Balance:   ${balance:,.2f}")
    if biz:
        print(f"  Business:  {biz.get('name', 'N/A')} (ID: {biz.get('id', 'N/A')})")

    # Step 3: Pull active campaigns
    print(f"\nPulling campaigns...")
    data3, err3 = meta_get(f"act_{TARGET_ACCOUNT}/campaigns", {
        "fields": "id,name,status,objective,daily_budget,lifetime_budget,spend_cap",
        "limit": "20"
    })
    if data3:
        camps = data3.get("data", [])
        print(f"  Found {len(camps)} campaign(s):")
        for c in camps:
            db = int(c.get("daily_budget", 0)) / 100
            budget_str = f"${db:.2f}/day" if db > 0 else "lifetime budget"
            print(f"  [{c.get('status')}] {c.get('name')}")
            print(f"           ID: {c.get('id')} | {c.get('objective')} | {budget_str}")
    else:
        print(f"  No campaigns or error: {err3}")

else:
    code = err2.get("error", {}).get("code") if err2 else "?"
    msg  = err2.get("error", {}).get("message") if err2 else str(err2)
    print(f"\n  NO ACCESS — Error {code}")
    print(f"  {msg}")
    print(f"\n  Client still needs to assign our Business Manager (1207013326889345)")
    print(f"  to their ad account from their Business Manager settings.")

print("\n" + "=" * 52)
