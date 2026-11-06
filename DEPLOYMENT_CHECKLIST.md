# Production Deployment Checklist

## Pre-Deployment

### Frontend
- [ ] Update `VITE_API_BASE_URL` to production URL
- [ ] Run `npm build` and test distribution
- [ ] Verify all environment variables are set
- [ ] Check for console errors in browser DevTools
- [ ] Test OAuth flows with real credentials
- [ ] Verify redirect URIs match platform settings
- [ ] Test on multiple browsers
- [ ] Test responsive design on mobile

### Backend
- [ ] Set all environment variables on hosting platform
- [ ] Configure database connection string
- [ ] Set JWT_SECRET to strong random value
- [ ] Set up SSL/TLS certificate
- [ ] Configure CORS to only allow frontend domain
- [ ] Enable logging and monitoring
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Configure backup strategy for database

### Security
- [ ] Review `.gitignore` - no `.env` files committed
- [ ] Rotate all API keys/secrets
- [ ] Enable 2FA on all platform developer accounts
- [ ] Verify HTTPS is enforced everywhere
- [ ] Add security headers (CSP, X-Frame-Options, etc.)
- [ ] Implement rate limiting
- [ ] Set up WAF (Web Application Firewall)
- [ ] Review code for vulnerabilities

### Social Media Platforms
- [ ] Verify app is in production mode (not sandbox)
- [ ] Ensure redirect URIs are exactly correct
- [ ] Verify permissions are minimal (principle of least privilege)
- [ ] Add proper app description and logo
- [ ] Get app approved if required (Facebook, TikTok)
- [ ] Test OAuth flow with production credentials

## Deployment

### Frontend (Vercel/Netlify)
```bash
# Connect GitHub repo to Vercel
# Set environment variables in project settings
# Deploy
```

### Backend (AWS/Heroku/DigitalOcean)
```bash
# Deploy backend service
# Verify health endpoint: GET /health
# Check logs for startup errors
```

### Domain & DNS
- [ ] Point custom domain to CDN/hosting
- [ ] Verify SSL certificate
- [ ] Set up DNS records
- [ ] Wait for DNS propagation (24-48 hours)
- [ ] Test with custom domain

## Post-Deployment

### Testing
- [ ] Test each OAuth platform integration
- [ ] Verify posts publish correctly
- [ ] Check error handling
- [ ] Monitor API response times
- [ ] Test with actual user data
- [ ] Verify analytics are working
- [ ] Test error recovery

### Monitoring
- [ ] Set up uptime monitoring
- [ ] Configure log aggregation
- [ ] Set up alerts for errors
- [ ] Monitor database performance
- [ ] Track API usage and quota
- [ ] Monitor server resources

### Documentation
- [ ] Update README with production URLs
- [ ] Document how to add new platforms
- [ ] Create runbook for common issues
- [ ] Document API endpoints
- [ ] Add troubleshooting guide

## Scaling Requirements

### For Growth
- [ ] Database connection pooling
- [ ] Cache layer (Redis) for tokens
- [ ] CDN for static assets (already done if Vercel)
- [ ] API rate limiting and throttling
- [ ] Background job queue for long operations
- [ ] Database replication for high availability

### Performance Optimization
- [ ] Compress API responses
- [ ] Implement request caching
- [ ] Optimize database queries
- [ ] Use lazy loading for UI
- [ ] Minimize JavaScript bundle size
- [ ] Enable browser caching headers

## Compliance & Privacy

- [ ] GDPR compliance (data deletion, consent)
- [ ] Privacy policy updated
- [ ] Terms of service updated
- [ ] Data retention policy implemented
- [ ] Audit logs for compliance
- [ ] User consent for OAuth scopes

## Troubleshooting Production Issues

### OAuth Token Expired
```typescript
// Implement refresh token logic
if (error.code === 'token_expired') {
  const newToken = await refreshAccessToken(platform);
  // Retry original request
}
```

### Database Connection Issues
```typescript
// Implement connection pool and retry logic
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Rate Limiting
```typescript
// Implement exponential backoff
const delay = Math.pow(2, attemptNumber) * 1000;
await new Promise(resolve => setTimeout(resolve, delay));
```

## Rollback Plan

If deployment has critical issues:
1. Keep previous version available
2. Have database backup from before deployment
3. Document rollback procedure
4. Test rollback in staging first
5. Monitor closely after changes

## Success Criteria

- [ ] All OAuth flows work end-to-end
- [ ] No errors in browser console
- [ ] No errors in server logs
- [ ] API response time < 500ms
- [ ] Database queries optimized
- [ ] No security vulnerabilities
- [ ] User feedback positive
- [ ] Monitoring alerts configured
