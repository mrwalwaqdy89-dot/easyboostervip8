# Backup & Restore Feature Documentation

## Overview

The Backup & Restore feature allows administrators to create full database backups and restore from backup files. This is essential for:
- Data migration (e.g., moving to a different PostgreSQL server)
- Disaster recovery
- Testing and development
- Creating snapshots before major changes

## Features

### What's Included in Backups

All data is backed up in JSON format, including:

1. **Users** (including banned users)
   - User accounts with Google OAuth data
   - Ban status (`is_banned`, `banned_at`)
   - Balance and plan information
   - IP addresses and login history

2. **Transactions**
   - All coin purchases and spending
   - Payment history with proofs
   - Admin adjustments

3. **Auto React Channels**
   - Active and expired subscriptions
   - Channel information and emojis

4. **Requests**
   - All reaction request history
   - Channel metadata

5. **Rate Limits**
   - Rate limiting data for users, IPs, and channels

6. **Statistics**
   - System statistics and counters

7. **AI Chat History**
   - User chat conversations with AI assistant

8. **Site Settings**
   - Maintenance mode
   - WhatsApp API tokens
   - Other configuration

9. **Notifications**
   - User notifications

### What's NOT Included

- **Session data** - Excluded for security reasons (users will need to log in again after restore)

## How to Use

### Creating a Backup

1. Navigate to Admin Dashboard → **Backup & Restore** tab
2. Click **"Refresh Database Info"** to see current database statistics
3. Review the table counts to ensure all data is present
4. Click **"Create & Download Backup"** button
5. A JSON file will be downloaded to your computer
   - Filename format: `easybooster-backup-YYYY-MM-DDTHH-MM-SS-mmmZ.json`
   - File contains all database data in JSON format

**Best Practices:**
- Create regular backups (daily/weekly recommended)
- Store backups in multiple secure locations
- Test restore process periodically
- Create a backup before major system changes

### Restoring from Backup

⚠️ **CRITICAL WARNING**: Restoring from backup will **PERMANENTLY DELETE ALL CURRENT DATA** and replace it with backup data. This action **CANNOT BE UNDONE**.

**Before Restoring:**
1. **Create a backup of current data first!**
2. Ensure you have the correct backup file
3. Verify all users are logged out
4. Plan for downtime during restore

**Restore Process:**
1. Navigate to Admin Dashboard → **Backup & Restore** tab
2. Click **"Choose File"** and select your backup JSON file
3. Click **"Validate Backup"** to check file integrity
4. Review the validation results:
   - ✅ Green = Valid backup, safe to restore
   - ❌ Red = Invalid backup, do not proceed
5. If valid, click **"Restore Database"**
6. Confirm the operation:
   - First confirmation dialog
   - Type "RESTORE" (all caps) to proceed
7. Wait for restore to complete (may take several minutes)
8. Page will refresh automatically when done

**After Restore:**
- All users will need to log in again (sessions are not restored)
- Verify data integrity
- Check that banned users maintain their ban status
- Test critical functionality

## API Endpoints

### GET /api/admin/backup/create
Creates and downloads a complete database backup.

**Authentication:** Admin only

**Response:**
```json
{
  "metadata": {
    "version": "1.0",
    "backupDate": "2025-12-17T15:30:00.000Z",
    "appName": "ANDY RCH - EasyBooster",
    "databaseType": "PostgreSQL"
  },
  "tables": {
    "users": {
      "rowCount": 42,
      "data": [...]
    },
    "transactions": {
      "rowCount": 156,
      "data": [...]
    }
    // ... other tables
  }
}
```

### GET /api/admin/backup/info
Returns current database statistics without creating a backup.

**Authentication:** Admin only

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRows": 500,
    "tables": {
      "users": 42,
      "transactions": 156,
      "auto_react_channels": 12,
      ...
    },
    "timestamp": "2025-12-17T15:30:00.000Z"
  }
}
```

### POST /api/admin/backup/validate
Validates a backup file without restoring it.

**Authentication:** Admin only

**Request:** Multipart form-data with `backupFile` field

**Response:**
```json
{
  "success": true,
  "valid": true,
  "message": "Backup file is valid. Ready to restore 500 records.",
  "data": {
    "errors": [],
    "warnings": [],
    "tableStats": {
      "users": 42,
      "transactions": 156,
      ...
    },
    "metadata": {
      "version": "1.0",
      "backupDate": "2025-12-17T15:30:00.000Z"
    }
  }
}
```

### POST /api/admin/backup/restore
Restores database from backup file.

**Authentication:** Admin only

**Request:** Multipart form-data with `backupFile` field

**Response:**
```json
{
  "success": true,
  "message": "Successfully restored 500 records from backup",
  "data": {
    "restoredTables": {
      "users": 42,
      "transactions": 156,
      ...
    },
    "totalRestored": 500,
    "backupDate": "2025-12-17T15:30:00.000Z"
  }
}
```

## Database Implementation

### Backup Process

The backup process:
1. Connects to PostgreSQL database
2. Iterates through all tables (except `session`)
3. Executes `SELECT * FROM table_name` for each table
4. Stores data in JSON format with metadata
5. Returns complete backup as downloadable JSON

**Tables backed up:**
- `users`, `transactions`, `auto_react_channels`, `requests`, `rate_limits`, `statistics`, `ai_chat_history`, `site_settings`, `notifications`

### Restore Process

The restore process uses PostgreSQL transactions for safety:

```sql
BEGIN;
  -- Disable triggers
  ALTER TABLE table_name DISABLE TRIGGER ALL;
  
  -- Clear existing data
  TRUNCATE TABLE table_name CASCADE;
  
  -- Insert backup data
  INSERT INTO table_name (...) VALUES (...);
  
  -- Reset sequences
  SELECT setval(pg_get_serial_sequence('table_name', 'id'), ...);
  
  -- Re-enable triggers
  ALTER TABLE table_name ENABLE TRIGGER ALL;
COMMIT; -- or ROLLBACK on error
```

**Safety features:**
- Automatic rollback on any error
- Triggers disabled during restore
- Sequences reset after data insertion
- Foreign key constraints handled properly
- Transaction-based atomicity

## Security Considerations

1. **Admin-only access**: All endpoints require admin authentication
2. **File validation**: Backup files are validated before restore
3. **No session restoration**: Session data is never backed up
4. **File size limits**: 50MB maximum for backup uploads
5. **Confirmation required**: Multi-level confirmation for restore
6. **Error handling**: Comprehensive error handling throughout

## Troubleshooting

### Backup Creation Fails
- **Check database connection**: Ensure PostgreSQL is accessible
- **Check permissions**: Admin account must be logged in
- **Check disk space**: Ensure enough space for backup file

### Backup Validation Fails
- **Check file format**: Must be valid JSON
- **Check file structure**: Must have `metadata` and `tables` sections
- **Check file size**: Must be under 50MB
- **Re-download backup**: File may be corrupted

### Restore Fails
- **Check validation first**: Always validate before restoring
- **Check database connection**: Must have stable connection
- **Check foreign keys**: Some tables depend on others
- **Check sequences**: Auto-increment IDs must be reset properly
- **Check logs**: Server console shows detailed error messages

### After Restore Issues
- **Users can't log in**: Sessions are not restored, users must log in again
- **Missing data**: Check if all tables were in backup file
- **Duplicate IDs**: Sequences may not have reset properly
- **Foreign key errors**: Related tables may be out of sync

## Best Practices

1. **Regular backups**: Schedule daily or weekly backups
2. **Multiple locations**: Store backups in different physical locations
3. **Test restores**: Periodically test restore process in development
4. **Before changes**: Always backup before major system changes
5. **Document backups**: Keep a log of when backups were created
6. **Secure storage**: Protect backup files (they contain sensitive user data)
7. **Verify after restore**: Always verify data integrity after restore

## Future Enhancements

Potential improvements for future versions:
- Automated scheduled backups
- Backup encryption
- Incremental backups (only changed data)
- Backup compression
- Remote backup storage (S3, Google Drive, etc.)
- Selective table restore
- Backup comparison tool
- Email notifications for backup completion

## Support

For issues or questions about the Backup & Restore feature:
- Check server logs for detailed error messages
- Verify database connection is stable
- Ensure admin credentials are correct
- Review this documentation
- Contact system administrator

---

**Version:** 1.0  
**Last Updated:** December 2025  
**Compatible with:** PostgreSQL, Express, Node.js
