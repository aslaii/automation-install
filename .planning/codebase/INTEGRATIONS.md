# Integrations

## External APIs

### Amazon Advertising API
- **Base URL:** `https://advertising-api.amazon.com`
- **Auth:** OAuth2 (client credentials + refresh token)
  - Token endpoint: `https://api.amazon.com/auth/o2/token`
  - Required credentials: `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET`, `AMAZON_ADS_REFRESH_TOKEN`, `AMAZON_ADS_PROFILE_ID`
- **Endpoints used:**
  - `POST /reporting/reports` — Request report generation
  - `GET /reporting/reports/{reportId}` — Poll report status
  - `GET {download_url}` — Download completed report
- **Report types:** Ad Spend, CTR, Clicks, Sales PPC, Units PPC
- **Pattern:** Create report → poll until ready → download gzipped data → decompress → parse → write to Google Sheets

### Amazon Selling Partner API (SP-API)
- **Auth:** OAuth2 + JWT assertion (custom LWA flow)
  - Token endpoint: `https://api.amazon.com/auth/o2/token` (separate credentials from Ads)
  - Required credentials: `AMAZON_SP_CLIENT_ID`, `AMAZON_SP_CLIENT_SECRET`, `AMAZON_SP_REFRESH_TOKEN`
  - JWT assertion built in Code node (`Build JWT Assertion`, 8523 chars)
- **Endpoints used:**
  - Report creation + polling + download (similar pattern to Ads API)
- **Report types:** BSR, FBA/FBM Stock, Sales Organic, Units Organic, Refunds, Reversal Reimbursements, FBA Per Unit Fulfillment Fees
- **Pattern:** Same async polling pattern as Ads API; some reports use TSV/CSV extraction

### Google Sheets API
- **Base URL:** `https://sheets.googleapis.com/v4`
- **Auth:** OAuth2 (service account JWT → access token)
  - Token endpoint: `https://oauth2.googleapis.com/token`
  - JWT assertion built via Code node
- **Endpoints used:**
  - `GET /spreadsheets/{id}/values/{range}` — Read existing sheet data (SKU mapping, column headers)
  - `POST /spreadsheets/{id}/values:batchUpdate` — Write metric data to sheets
- **Spreadsheet:** Referenced as `✅SPREADSHEET_ID` in "Set Credentials" node
- **Sheet names:** Referenced as `✅SHEET_NAME` (e.g., "MOBILITY")
- **Write pattern:** Read existing → compute deltas → batch update specific cells

## Authentication Flow

The orchestrator workflow mints all tokens centrally:
1. **Amazon Ads token** — `Mint Amazon Access Token` (HTTP POST to `/auth/o2/token`)
2. **Amazon SP token** — `Build JWT Assertion` → `Mint SP Access Token`
3. **Google token** — `Build JWT Assertion` (Google) → `Mint Google Access Token`
4. **Auth bundle** — `Attach Shared Auth Bundle` node packages all tokens + config for sub-workflows

Sub-workflows receive credentials via `executeWorkflowTrigger` input, avoiding credential duplication.

## Databases

None — all persistence is via Google Sheets.

## Webhooks

None — all workflows are triggered manually or via the orchestrator's `executeWorkflow` calls.

## Third-Party Services

| Service | Purpose | Connection |
|---------|---------|------------|
| Amazon Advertising API | PPC metrics retrieval | OAuth2 REST |
| Amazon SP-API | Seller/FBA metrics retrieval | OAuth2+JWT REST |
| Google Sheets | Data storage / dashboard | OAuth2 REST |
| Docker Hub | n8n base image | Container pull |
| GitHub (raw) | Installer + workflow distribution | HTTP download |
