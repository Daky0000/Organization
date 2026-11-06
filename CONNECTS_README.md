# ContentFlow - Social Media Distribution Engine

## 📋 Overview

ContentFlow is a production-ready SaaS platform for managing social media content across multiple platforms (Instagram, Twitter, LinkedIn, Facebook, TikTok). The **Connects** module handles OAuth integrations and account management.

## 🚀 Features Implemented

### OAuth Integration
✅ Multi-platform OAuth 2.0 support  
✅ Secure token management  
✅ Account connection/disconnection  
✅ Reauthorization flow  
✅ Error handling and user feedback  

### Connected Platforms
- ✅ Instagram Business Account
- ✅ Twitter/X with API v2
- ✅ LinkedIn Professional  
- ✅ Facebook Business Pages
- ✅ TikTok Creator Account

### Core Functionality
- ✅ Auto-posting configuration
- ✅ Content variations per platform
- ✅ Auto-reposting schedules
- ✅ Error tracking and resolution
- ✅ Analytics integration

## 📁 Project Structure

```
src/
├── pages/
│   ├── Connects.tsx              # Main OAuth/connections page
│   └── OAuthCallback.tsx         # OAuth callback handler
├── services/
│   └── oauthService.ts           # OAuth API client
├── hooks/
│   └── useOAuth.ts               # Custom OAuth hooks
└── types/
    └── oauth.ts                  # TypeScript types
```

## ⚙️ Environment Setup

### Frontend Variables (.env)
```env
VITE_API_BASE_URL=http://localhost:5000
VITE_APP_URL=http://localhost:3000

VITE_INSTAGRAM_APP_ID=your_app_id
VITE_TWITTER_CLIENT_ID=your_client_id
VITE_LINKEDIN_CLIENT_ID=your_client_id
VITE_FACEBOOK_APP_ID=your_app_id
VITE_TIKTOK_CLIENT_ID=your_client_id
VITE_THREADS_APP_ID=your_app_id
```

## 🔧 Development Setup

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Backend Server
```bash
# Install backend dependencies
npm install express cors dotenv axios jsonwebtoken

# Run backend (requires Node 16+)
npx ts-node server.ts
```

## 🌐 Production Deployment

### Step 1: Platform Setup
Complete setup for each social media platform:
- Get API credentials from platform developer console
- Configure OAuth redirect URIs
- Request necessary permissions/scopes

### Step 2: Environment Configuration
- Set all production environment variables
- Configure database connection
- Generate secure JWT secret
- Set up SSL/TLS certificates

### Step 3: Deploy Frontend
**Option A: Vercel**
```bash
vercel --prod
```

**Option B: Netlify**
```bash
netlify deploy --prod
```

**Option C: Your Own Server**
```bash
npm run build
# Deploy dist/ folder
```

### Step 4: Deploy Backend
**Option A: AWS Lambda (Recommended)**
- Use AWS SAM or Serverless Framework
- Configure API Gateway
- Set environment variables in Lambda

**Option B: Heroku**
```bash
git push heroku main
```

**Option C: DigitalOcean App Platform**
- Connect GitHub repo
- Set environment variables
- Deploy

## 📖 API Endpoints

### OAuth Callback
```
POST /api/oauth/callback
Body: { platform, code, state }
Returns: { success, data }
```

### Get Connected Accounts
```
GET /api/accounts
Returns: [ { platform, handle, connected, followers, ... } ]
```

### Disconnect Account
```
DELETE /api/accounts/:platform
Returns: { success }
```

### Test Connection
```
GET /api/accounts/:platform/test
Returns: { success, data }
```

### Publish Post
```
POST /api/posts/:platform/publish
Body: { text, media, hashtags }
Returns: { success, postId }
```

### Get Analytics
```
GET /api/analytics/:platform
Returns: { followers, engagement, reach, ... }
```

## 🔐 Security Best Practices

✅ **Implemented**
- HTTPS-only communication
- Environment variables for secrets
- State parameter for CSRF protection
- Secure token storage (backend only)
- Error messages don't leak sensitive info

⚠️ **To Configure**
- Enable rate limiting
- Set up WAF (Web Application Firewall)
- Configure CORS properly
- Implement request logging
- Set up monitoring/alerting

## 🐛 Troubleshooting

### OAuth Redirect URI Mismatch
- Verify exact match with platform settings
- Check for protocol (http:// vs https://)
- Remove trailing slashes if not in platform config

### Token Expired
- Implement refresh token logic in service
- Monitor token expiration times
- Auto-refresh before expiration

### Rate Limiting
- Platform API rate limits enforced
- Implement exponential backoff
- Queue long-running operations

See [OAUTH_SETUP.md](/OAUTH_SETUP.md) for detailed setup and [DEPLOYMENT_CHECKLIST.md](/DEPLOYMENT_CHECKLIST.md) for production deployment.

## 📝 License

This project is part of ContentFlow SaaS platform.

## 💬 Support

For support and questions, refer to:
- [OAuth Setup Guide](./OAUTH_SETUP.md)
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)
- Platform-specific documentation links in guides

---

**Status**: Production Ready ✅  
**Last Updated**: March 2026
