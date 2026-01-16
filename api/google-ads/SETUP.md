# Google Ads Integration Setup Guide

## Overview
This system connects to your Google Ads MCC account, syncs data to Supabase, and displays it in custom dashboards.

## Prerequisites

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., "Hyder Media Ads Dashboard")
3. Enable the **Google Ads API**:
   - Go to APIs & Services > Library
   - Search for "Google Ads API"
   - Click Enable

4. Create OAuth 2.0 Credentials:
   - Go to APIs & Services > Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: **Web application**
   - Name: "Hyder Media Ads Dashboard"
   - Authorized redirect URIs:
     - `https://hyder.me/api/google-ads/callback`
     - `http://localhost:3000/api/google-ads/callback` (for testing)
   - Save the **Client ID** and **Client Secret**

5. Configure OAuth Consent Screen:
   - Go to APIs & Services > OAuth consent screen
   - User Type: External (or Internal if using Google Workspace)
   - Add scopes: `https://www.googleapis.com/auth/adwords`
   - Add test users (your email) if in testing mode

### 2. Google Ads Developer Token

1. Go to [Google Ads](https://ads.google.com/)
2. Navigate to your MCC account
3. Go to Tools & Settings > Setup > API Center
4. Apply for a developer token (or use existing one)
5. Note: Test accounts have immediate access; production requires approval

### 3. Environment Variables

Add these to your Vercel project (or .env.local):

```env
# Google Ads API
GOOGLE_ADS_CLIENT_ID=your_oauth_client_id
GOOGLE_ADS_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token
GOOGLE_ADS_REDIRECT_URI=https://hyder.me/api/google-ads/callback

# Your MCC (Manager) Account ID (without dashes)
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890

# Supabase (existing)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
```

## Database Schema

Run the SQL in `schema.sql` in your Supabase SQL editor to create the necessary tables.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/google-ads/auth` | GET | Initiates OAuth flow |
| `/api/google-ads/callback` | GET | OAuth callback handler |
| `/api/google-ads/accounts` | GET | List all accessible accounts |
| `/api/google-ads/sync` | POST | Trigger data sync for an account |
| `/api/google-ads/campaigns` | GET | Get campaign data |
| `/api/google-ads/keywords` | GET | Get keyword data |
| `/api/google-ads/search-terms` | GET | Get search terms report |

## Data Sync Schedule

The system can sync data:
- **Manual**: Trigger via dashboard button
- **Scheduled**: Set up Vercel Cron or external scheduler to call `/api/google-ads/sync`

Recommended sync frequency:
- Campaign/Ad Group data: Daily
- Search terms: Daily or weekly
- Real-time metrics: Not recommended (API quotas)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Dashboard     │────▶│  Vercel API      │────▶│  Supabase   │
│   (Frontend)    │◀────│  (Serverless)    │◀────│  (Database) │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Google Ads API  │
                        │  (MCC + Clients) │
                        └──────────────────┘
```

## Security Notes

- OAuth tokens are stored encrypted in Supabase
- Service key is only used server-side
- Client dashboards only see aggregated data
- Row Level Security (RLS) restricts data access by user
