# 🚀 Deployment Guide - ANDY RCH

## Critical Fix Applied ✅

**Issue**: Users could access dashboard without login (demo mode) and Google login wasn't showing user info properly.

**Solution**: 
1. Removed demo/guest mode completely
2. All protected pages now require authentication
3. Fixed session cookie configuration for production deployment
4. Added proper trust proxy settings for hosted platforms

---

## Required Environment Variables

When deploying to **Heroku**, **Railway**, **Render**, or any hosting platform, you **MUST** set these environment variables:

### 1. Database Configuration
```bash
DATABASE_URL=postgresql://username:password@hostname:5432/database_name
```
**Note**: Most hosting platforms provide this automatically when you add a PostgreSQL addon.

### 2. Session Secret (CRITICAL!) 🔐
```bash
SESSION_SECRET=your-super-secret-random-string-here
```
**How to generate a secure secret:**
```bash
# On Linux/Mac:
openssl rand -base64 32

# On Windows PowerShell:
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### 3. Google OAuth Configuration 🔑
```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=https://your-domain.com/api/auth/google/callback
```

**How to get Google OAuth credentials:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable "Google+ API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Application type: "Web application"
6. Add Authorized redirect URIs:
   - `http://localhost:3000/api/auth/google/callback` (for local testing)
   - `https://your-domain.com/api/auth/google/callback` (for production)
7. Copy Client ID and Client Secret

### 4. Application Settings
```bash
NODE_ENV=production
PORT=3000
RATE_LIMIT_PER_DAY=12
```

---

## Deployment Steps

### For Heroku 🟣

1. **Create Heroku App**
   ```bash
   heroku create your-app-name
   ```

2. **Add PostgreSQL**
   ```bash
   heroku addons:create heroku-postgresql:essential-0
   ```

3. **Set Environment Variables**
   ```bash
   heroku config:set SESSION_SECRET="your-secret-here"
   heroku config:set GOOGLE_CLIENT_ID="your-client-id"
   heroku config:set GOOGLE_CLIENT_SECRET="your-secret"
   heroku config:set GOOGLE_CALLBACK_URL="https://your-app-name.herokuapp.com/api/auth/google/callback"
   heroku config:set NODE_ENV="production"
   heroku config:set RATE_LIMIT_PER_DAY="12"
   ```

4. **Deploy**
   ```bash
   git push heroku main
   ```

5. **Update Google OAuth Redirect URI**
   - Go to Google Cloud Console
   - Add `https://your-app-name.herokuapp.com/api/auth/google/callback`

### For Railway 🚂

1. **Create New Project**
   - Connect your GitHub repo
   - Railway will auto-detect Node.js

2. **Add PostgreSQL**
   - Click "New" → "Database" → "PostgreSQL"
   - Railway will auto-set DATABASE_URL

3. **Set Environment Variables**
   - Go to your service → "Variables" tab
   - Add all variables listed above

4. **Deploy**
   - Push to GitHub, Railway auto-deploys

### For Render 🎨

1. **Create New Web Service**
   - Connect your GitHub repo
   - Build Command: `npm install`
   - Start Command: `npm start`

2. **Add PostgreSQL**
   - Create new PostgreSQL instance
   - Copy the Internal Database URL
   - Add as `DATABASE_URL` in web service

3. **Set Environment Variables**
   - Go to "Environment" tab
   - Add all variables listed above

4. **Deploy**
   - Render will auto-deploy

---

## Testing Authentication

After deployment:

1. **Visit your deployed URL**
   - Homepage should load normally (public)

2. **Try to access dashboard without login**
   - Go to `/reactch`
   - Should redirect to `/login` ✅

3. **Click "Continue with Google"**
   - Should redirect to Google
   - Select your account
   - Should redirect back to `/reactch` with your info ✅

4. **Verify user info displays**
   - Your name should appear (not "Guest User")
   - Your avatar should show
   - Balance should show 100 coins (welcome bonus)
   - All stats should load

5. **Test logout**
   - Click profile → Logout
   - Should redirect to login page
   - Trying to access `/reactch` should redirect to login ✅

---

## Troubleshooting

### Issue: "Authentication failed" after Google login
**Cause**: GOOGLE_CALLBACK_URL doesn't match Google Cloud Console settings
**Fix**: Ensure the callback URL in Google Console matches your deployed domain exactly

### Issue: Session not persisting (keeps logging out)
**Cause**: SESSION_SECRET not set or cookies not working
**Fix**: 
1. Verify SESSION_SECRET is set in environment variables
2. Ensure your domain uses HTTPS (required for secure cookies)
3. Check browser console for cookie errors

### Issue: Database connection errors
**Cause**: DATABASE_URL incorrect or database not accessible
**Fix**: 
1. Verify DATABASE_URL is set correctly
2. Check database is running and accessible
3. Look at server logs for specific error messages

### Issue: "Guest User" still showing
**Cause**: Browser cache or old localStorage
**Fix**: 
1. Clear browser cache and localStorage
2. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
3. Try in incognito/private window

---

## Security Checklist ✅

Before going live:

- [ ] SESSION_SECRET is set to a strong random value
- [ ] Google OAuth credentials are configured correctly
- [ ] DATABASE_URL is using SSL in production
- [ ] NODE_ENV is set to "production"
- [ ] All environment variables are kept secret (not committed to git)
- [ ] HTTPS is enabled on your domain
- [ ] Rate limiting is configured appropriately

---

## Support

If you encounter any issues:
1. Check server logs for errors
2. Verify all environment variables are set
3. Test Google OAuth callback URL
4. Clear browser cache and try in incognito mode

**Need help?** Contact support via WhatsApp: +1 (305) 697-8303
