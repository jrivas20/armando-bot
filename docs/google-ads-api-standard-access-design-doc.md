# JRZ Marketing — Google Ads API Design Documentation
## Standard Access Application

**Developer Token:** saVkv7v1x6X9dsnDyPVCYg
**MCC Account ID:** 646-514-4890
**Company:** JRZ Marketing
**Website:** https://jrzmarketing.com
**Contact:** info@jrzmarketing.com

---

## 1. Application Overview

JRZ Marketing is a digital marketing agency serving 10+ small business clients across Central Florida. We built an internal automation platform called **armando-bot**, a Node.js/Express server deployed on Render (https://armando-bot-1.onrender.com), that uses the Google Ads API to:

- Pull campaign performance data for client reporting
- Read Google Local Services Ads leads to automatically create CRM contacts
- Monitor keyword performance and budget pacing

---

## 2. Why Standard Access Is Required

We need Standard Access to read the following field on the `local_services_lead` resource:

```
local_services_lead.contact_details.consumer_name
local_services_lead.contact_details.phone_number
local_services_lead.contact_details.email
```

**Current behavior with Basic Access:** These fields return UNRECOGNIZED_FIELD errors in GAQL queries. We can retrieve lead IDs, type, and status, but not the actual contact information needed to create a CRM record.

**Why this data is needed:** When a potential customer calls through Google Local Services Ads, our system needs to capture their name and phone number to automatically create a contact in the client's GoHighLevel CRM account and assign it to the correct pipeline stage. Without the contact details, the lead is lost unless manually looked up in the LSA dashboard.

---

## 3. Data Flow

```
Google Local Services Ads (Lead comes in)
         ↓
Google Ads API — local_services_lead GAQL query
(runs every 30 minutes via armando-bot cron)
         ↓
armando-bot processes new lead IDs
(deduplication via Cloudinary stored snapshot)
         ↓
GoHighLevel CRM API
POST /contacts/ — creates contact with name + phone
POST /opportunities/ — adds to "New Lead" pipeline stage
Tag: google-local-services
         ↓
Client (Cooney Homes) sees new lead in their CRM
Sales team follows up within minutes
```

---

## 4. API Resources Used

| Resource | Access Level Needed | Purpose |
|----------|-------------------|---------|
| `local_services_lead.id` | Basic | Deduplication |
| `local_services_lead.lead_type` | Basic | Phone vs message classification |
| `local_services_lead.lead_status` | Basic | Active/archived filter |
| `local_services_lead.creation_date_time` | Basic | Date of lead |
| `local_services_lead.contact_details.consumer_name` | **Standard** | CRM contact first/last name |
| `local_services_lead.contact_details.phone_number` | **Standard** | CRM contact phone number |
| `local_services_lead.contact_details.email` | **Standard** | CRM contact email |
| `campaign` | Basic | Performance reporting |
| `ad_group` | Basic | Performance reporting |
| `keyword_view` | Basic | Keyword reporting |

---

## 5. Client Accounts Managed

Our MCC (646-514-4890) manages the following client accounts:

- **2819805815** — Cooney Homes (Primary LSA account — Standard Access needed for this account)
- **6765394474** — JR Paver Sealing And More
- **5192590797** — Le Varon Barbershop
- **3715464560** — Tiger Tattoos

All accounts are owned and managed exclusively by JRZ Marketing on behalf of each business client.

---

## 6. Data Privacy and Security

- **No data sharing:** Lead contact information (name, phone, email) is used exclusively to create CRM contacts in the client's GoHighLevel account. Data is never sold, shared, or transferred to any third party.
- **No data storage beyond CRM:** Contact details retrieved from the API are immediately written to the client's GHL CRM and not stored independently in any database or file.
- **Deduplication only:** The only persistent storage is a list of processed lead IDs (no PII) stored in Cloudinary to prevent duplicate CRM entries.
- **Access control:** The armando-bot server is private, accessible only to JRZ Marketing staff. All API keys are stored as environment variables in Render's encrypted secret store.
- **HTTPS only:** All API communication is over HTTPS/TLS.

---

## 7. Technical Stack

- **Language:** Node.js (Express.js)
- **Deployment:** Render.com (Standard plan, always-on)
- **Google Ads API Version:** v20
- **Authentication:** OAuth 2.0 with refresh token
- **CRM Integration:** GoHighLevel API v2021-07-28
- **Cron Schedule:** Every 30 minutes (lead sync), daily (reporting)

---

## 8. Compliance

- We comply with the Google Ads API Terms of Service
- We comply with Google's data handling and privacy requirements
- Contact data retrieved is used solely for the purpose of timely lead follow-up by the business that generated the lead
- We do not use the API to scrape, aggregate, or resell any data

---

*Prepared by JRZ Marketing — May 2026*
