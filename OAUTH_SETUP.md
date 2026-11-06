# OAuth Integration Setup Guide

## Overview
This document outlines the setup required to make the Connects page fully functional with social media OAuth integrations.

## Prerequisites
- Node.js 16+ for backend
- AWS account (or alternative hosting)
- Social media developer accounts (Instagram, Twitter, LinkedIn, Facebook, TikTok)

## Frontend Setup

### 1. Environment Variables
Create or update `.env` file with your OAuth credentials:

```
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_APP_URL=https://yourdomain.com

# Instagram
VITE_INSTAGRAM_APP_ID=your_app_id
VITE_INSTAGRAM_REDIRECT_URI=https://yourdomain.com/auth/instagram/callback

# Twitter
VITE_TWITTER_CLIENT_ID=your_client_id
VITE_TWITTER_REDIRECT_URI=https://yourdomain.com/auth/twitter/callback

# LinkedIn
VITE_LINKEDIN_CLIENT_ID=your_client_id
VITE_LINKEDIN_REDIRECT_URI=https://yourdomain.com/auth/linkedin/callback

# Facebook
VITE_FACEBOOK_APP_ID=your_app_id
VITE_FACEBOOK_REDIRECT_URI=https://yourdomain.com/auth/facebook/callback

# TikTok
VITE_TIKTOK_CLIENT_ID=your_client_id
VITE_TIKTOK_REDIRECT_URI=https://yourdomain.com/auth/tiktok/callback

# Threads
VITE_THREADS_APP_ID=your_app_id
VITE_THREADS_REDIRECT_URI=https://yourdomain.com/auth/threads/callback
```

### 2. Build for Production
```bash
npm run build
```

## Backend Setup

### 1. Install Dependencies
```bash
npm install express cors dotenv axios jsonwebtoken
npm install -D typescript ts-node @types/express @types/node
```

### 2. Environment Variables (.env)
```
BACKEND_PORT=5000
VITE_APP_URL=https://yourdomain.com

# API Secrets (NEVER expose in frontend)
INSTAGRAM_APP_SECRET=your_secret
TWITTER_CLIENT_SECRET=your_secret
LINKEDIN_CLIENT_SECRET=your_secret
FACEBOOK_APP_SECRET=your_secret
TIKTOK_CLIENT_SECRET=your_secret
THREADS_APP_SECRET=your_secret

# Database
DATABASE_URL=your_database_url

# JWT
JWT_SECRET=your_jwt_secret_key
```

### 3. Run Backend Locally
```bash
npx ts-node server.ts
```

## Platform-Specific Setup

### Instagram
1. Go to [Meta Developer Console](https://developers.facebook.com)
2. Create a new app (Business type)
3. Add Instagram Product
4. Configure OAuth Redirect URIs
5. Copy App ID and App Secret

### Twitter
1. Go to [Twitter Developer Portal](https://developer.twitter.com)
2. Create a new project
3. Set up OAuth 2.0 with PKCE
4. Add Redirect URLs
5. Copy Client ID and Client Secret

### LinkedIn
1. Go to [LinkedIn Developers](https://www.linkedin.com/developers)
2. Create a new app
3. Request Sign In with LinkedIn
4. Authorized redirect URLs
5. Copy Client ID and Client Secret

### Facebook
1. Go to [Facebook Developer Console](https://developers.facebook.com)
2. Create a new app
3. Add Facebook Login product
4. Configure Valid OAuth Redirect URIs
5. Copy App ID and App Secret

### TikTok
1. Go to [TikTok Developer](https://developer.tiktok.com)
2. Create a new app
3. Set up OAuth
4. Configure Redirect URLs
5. Copy Client Key and Client Secret

## Deployment Options

### Option 1: Vercel + AWS Lambda

**Frontend (Vercel):**
```bash
npm i -g vercel
vercel --prod
```

**Backend (AWS Lambda):**
Use AWS SAM or Serverless Framework to deploy the server.

### Option 2: Heroku

**Backend:**
```bash
heroku create your-oauth-backend
git push heroku main
```

### Option 3: DigitalOcean App Platform

1. Connect GitHub repository
2. Set environment variables
3. Deploy

## Security Considerations

### ✅ Do's
- Store all API secrets on server only
- Use HTTPS for all OAuth redirects
- Implement CSRF protection with state parameter
- Use JWT for user authentication
- Encrypt sensitive data in database
- Validate all incoming requests
- Implement rate limiting

### ❌ Don'ts
- Never expose API secrets in frontend
- Don't store user passwords
- Don't bypass HTTPS
- Don't trust user input
- Don't commit `.env` files

## Database Schema

### Users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Connected Accounts
```sql
CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  platform VARCHAR(50),
  handle VARCHAR(255),
  access_token TEXT ENCRYPTED,
  refresh_token TEXT ENCRYPTED,
  followers VARCHAR(50),
  connected_at TIMESTAMP,
  expires_at TIMESTAMP,
  UNIQUE(user_id, platform)
);
```

### Posts
```sql
CREATE TABLE posts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  content TEXT,
  platforms VARCHAR(255)[],
  status VARCHAR(50),
  published_at TIMESTAMP,
  created_at TIMESTAMP
);
```

## Testing

### Test OAuth Flow Locally
1. Start both frontend and backend
2. Click "Connect" on any platform
3. You should be redirected to the platform's login
4. After authorization, you'll return to `/auth/{platform}/callback`
5. Connection should be stored in database

### Test Publishing
1. Create a test post
2. Select platforms to publish
3. Verify post appears on connected accounts

## Monitoring & Debugging

### Logs
Check server logs for OAuth errors:
```bash
tail -f logs/error.log
```

### Error Handling
- Check database connection
- Verify API credentials
- Validate redirect URIs match exactly
- Check rate limits
- Verify JWT tokens

## Maintenance

### Tasks
- [ ] Rotate API keys monthly
- [ ] Monitor OAuth token expiration
- [ ] Update social media API versions
- [ ] Clean up old database records
- [ ] Review security logs

### Troubleshooting

**"Invalid redirect URI"**
- Ensure redirect URI matches exactly in platform settings
- Check for trailing slashes and protocols

**"Token expired"**
- Implement refresh token logic
- Store token expiration time
- Refresh before expiration

**"Rate limit exceeded"**
- Implement exponential backoff
- Add request queuing
- Monitor usage

## Next Steps

1. Deploy frontend to Vercel/Netlify
2. Deploy backend to AWS/Heroku/DigitalOcean
3. Configure custom domain
4. Set up SSL certificate
5. Configure DNS
6. Test complete flow
7. Monitor in production

For more help, visit the [OAuth 2.0 Specification](https://tools.ietf.org/html/rfc6749)
