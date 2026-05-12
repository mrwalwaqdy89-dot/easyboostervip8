# Security Note for Test Scripts

## ⚠️ Important Security Information

### Test Scripts Credentials
The test scripts (`test-ban-api.js`, `test-ban-simple.js`) use credentials from `config.js`:
- Admin username and password
- These are for **testing purposes only**
- In production, credentials should be changed from defaults

### API Keys in Config
The `config.js` file contains:
- OpenRouter API key (line 41)
- Google OAuth credentials (lines 20-21)
- Database connection string (line 14)

### Security Recommendations for Production:

1. **Change Default Admin Credentials**
   - The admin dashboard allows changing username and password
   - Navigate to Admin Settings → Change Credentials
   - New credentials are stored securely in the database

2. **Direct Configuration in config.js**
   - All settings are now configured directly in `config.js`
   - Example:
   ```javascript
   apiKey: 'your-api-key-here'
   ```
   - Ensure `config.js` is properly secured
   - Consider using environment variables for additional security layers if needed

3. **Exclude Sensitive Files**
   - Add `config.js` to `.gitignore` if using custom credentials
   - Use `config.example.js` as template for team members

4. **Rotate API Keys Regularly**
   - OpenRouter API key can be updated via admin dashboard
   - WhatsApp backend token can be updated via admin dashboard

5. **Database Credentials**
   - Use connection pooling with SSL in production
   - Rotate database passwords periodically
   - Use read-only credentials where possible

### Current Setup:
- ✅ Test scripts use config values for convenience
- ✅ Admin credentials can be changed via dashboard (stored in DB)
- ✅ API keys can be updated via admin dashboard
- ⚠️ Default credentials should be changed before production deployment

### For Developers:
When contributing or testing:
1. Copy `config.js` to `config.local.js` (add to .gitignore)
2. Use your own test credentials in the local file
3. Never commit real production credentials

---

**Note**: The test scripts are designed for development and testing. In a production environment, use proper secret management solutions like:
- Environment variables
- Secret management services (AWS Secrets Manager, Azure Key Vault, etc.)
- Configuration management tools
