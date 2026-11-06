# Quick Start Guide - Connects Module

## 🎯 5-Minute Setup

### 1. Frontend - Local Development
```bash
# Install dependencies
npm install

# Create .env.local file (already created)
# Update with your OAuth credentials from platform developer consoles

# Start dev server
npm run dev
# Visit http://localhost:3000
```

### 2. Backend Setup
```bash
# Option A: Use existing Node environment
npm install express cors dotenv axios jsonwebtoken

# Option B: Install backend dependencies
cd backend  # (if using separate folder)
npm install -f server-package.json

# Start backend
npx ts-node server.ts
# Backend running at http://localhost:5000
```

### 3. Test OAuth Flow
1. Navigate to Connects page
2. Click "Connect" on any platform  
3. Authorize in platform redirect
4. Should return to app with success message

## 🚀 Deployment (Choose One)

### Deploy to Vercel (Recommended)
```bash
# Frontend
npm i -g vercel
vercel --prod

# Backend (if using Vercel Functions)
# Create /api directory with handler functions
```

### Deploy to Heroku
```bash
# Frontend + Backend
git init
git add .
git commit -m "Initial commit"
heroku create your-app-name
git push heroku main
heroku config:set VITE_API_BASE_URL=https://your-app.herokuapp.com
```

### Deploy to AWS
- Frontend: CloudFront + S3
- Backend: Lambda + API Gateway
- Database: RDS or DynamoDB

## 📋 Pre-Deployment Checklist

- [ ] All OAuth credentials obtained
- [ ] Redirect URIs configured on each platform
- [ ] .env file has production URLs
- [ ] HTTPS enabled on all endpoints
- [ ] CORS configured correctly
- [ ] Database set up and tested
- [ ] Backend health check passing
- [ ] Frontend builds without errors
- [ ] OAuth flow tested end-to-end

## 🔧 Platform-Specific Setup

### Instagram
1. [Meta Developer](https://developers.facebook.com)
2. Create App → Business
3. Add Instagram Product
4. Configure OAuth Redirect URIs
5. Copy App ID

### Twitter
1. [Twitter Developer](https://developer.twitter.com)
2. Create Project
3. Set OAuth 2.0 → On
4. Add Redirect URLs
5. Copy Client ID

### LinkedIn
1. [LinkedIn Developers](https://www.linkedin.com/developers)
2. Create App
3. Request Sign In with LinkedIn product
4. Configure OAuth settings
5. Copy Client ID

### Facebook
1. [Facebook Developer](https://developers.facebook.com)
2. Create App → Business
3. Add Facebook Login
4. Configure OAuth URIs
5. Copy App ID

### TikTok
1. [TikTok Developer](https://developer.tiktok.com)
2. Create App
3. Enable OAuth
4. Configure Redirect URLs
5. Copy Client Key

## 🧪 Testing Checklist

- [ ] Can connect Instagram
- [ ] Can connect Twitter
- [ ] Can connect LinkedIn
- [ ] Can connect Facebook
- [ ] Can connect TikTok
- [ ] Can disconnect accounts
- [ ] Disconnecting and reconnecting works
- [ ] Error messages display correctly
- [ ] Loading states work
- [ ] Mobile responsive

## 📊 Monitoring

### Key Metrics
- OAuth success rate
- Average response time
- Error frequency
- Token refresh rate
- User retention

### Tools
- Sentry for error tracking
- DataDog for monitoring
- Google Analytics for user behavior
- Platform-specific analytics

## 🆘 Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Invalid redirect URI | Verify exact match in platform settings, check HTTP vs HTTPS |
| Token expired | Implement automatic token refresh |
| Rate limit | Add exponential backoff with retry logic |
| CORS error | Check CORS configuration on backend |
| Database connection | Verify connection string and network access |
| Missing credentials | Ensure all .env variables are set |

## 📞 Next Steps

1. **Customize**: Update UI/branding as needed
2. **Integrate**: Add to your existing dashboard
3. **Scale**: Set up database and caching
4. **Monitor**: Implement error tracking and analytics
5. **Secure**: Review security checklist

---

For detailed setup, see [OAUTH_SETUP.md](./OAUTH_SETUP.md)  
For production deployment, see [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)
