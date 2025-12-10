# Database Management Scripts

## Copy Production Database to Local

This directory contains scripts to safely copy your production database to your local development environment.

## Prerequisites

1. **MongoDB running locally** on `mongodb://localhost:27017`
2. **Node.js** installed (v18 or higher)
3. **mongoose** package (already installed in parent project)

## Usage

### Quick Start - Copy Production to Local

From the backend directory, run:

```bash
cd saas-ecommerce-backend
node scripts/copy-prod-to-local.js
```

This will:

1. ✅ Connect to your production MongoDB Atlas database
2. ✅ Download all collections and documents
3. ✅ Save a timestamped backup to `scripts/backups/`
4. ✅ Clear your local database
5. ✅ Restore the production data to local
6. ✅ Verify the restoration

### What Gets Copied

All collections including:

- `users` - All user accounts and agents
- `orders` - All order data
- `commissionrecords` - All commission records
- `settings` - Global settings
- `wallets` - Wallet balances and transactions
- `notifications` - Notification history
- And all other collections in the database

### Safety Features

- ✅ **Backup First**: Creates a backup file before any operations
- ✅ **Local Only**: Only modifies your local database, production stays untouched
- ✅ **Timestamped Backups**: Each backup has a unique timestamp
- ✅ **Verification**: Verifies the restoration was successful
- ✅ **Error Handling**: Stops on errors to prevent partial restoration

### Backup Location

Backups are saved to:

```
saas-ecommerce-backend/scripts/backups/backup-YYYY-MM-DDTHH-MM-SS-mmmZ.json
```

### Database Configuration

The script uses these database URIs:

**Production (Read Only)**:

```
mongodb+srv://XXXXX:XXXXXXXXX@mongodbcluster.XXXXXXXX.XXXXXXXXXXXX
```

**Local (Will be overwritten)**:

```
mongodb://localhost:27017/saas-ecommerce-dev
```

> **Note**: The local database is named `saas-ecommerce-dev` to avoid accidentally connecting to it instead of production.

### Important Warnings

⚠️ **WARNING**: This script will **COMPLETELY OVERWRITE** your local database!

- Any existing data in your local database will be deleted
- The script creates a backup first, but be careful
- This only affects your LOCAL database
- Production database is never modified (read-only access)

### Update Your .env File

After copying, update your `.env` file to use the local database:

```bash
# For local development with production data copy
DBURI=mongodb://localhost:27017/saas-ecommerce-dev
NODE_ENV=development
```

### Troubleshooting

#### Error: "Cannot connect to local MongoDB"

**Solution**: Make sure MongoDB is running locally:

```bash
# Windows
net start MongoDB

# macOS/Linux
sudo systemctl start mongod
```

#### Error: "Cannot connect to production database"

**Solution**: Check your internet connection and Atlas credentials

#### Error: "ENOSPC: no space left on device"

**Solution**: Free up disk space. Large databases require significant storage.

#### Script hangs during backup

**Solution**: Large databases take time. Wait for completion. Check your internet speed.

### Re-running the Script

You can run this script multiple times safely. Each run:

- Creates a new backup with a unique timestamp
- Completely refreshes your local database with latest production data
- Keeps all previous backups (delete old ones manually if needed)

### Manual Backup Cleanup

Old backups can be deleted manually:

```bash
cd saas-ecommerce-backend/scripts/backups
# Review backups
ls

# Delete old backups (keep recent ones)
rm backup-2025-01-01*.json
```

### Restoring from a Specific Backup

If you need to restore from a specific backup file instead of pulling from production:

1. Modify the `copy-prod-to-local.js` script
2. Comment out the `backupProductionData()` call
3. Load your desired backup file
4. Run the restore

Or contact the development team for a restore script.

## Best Practices

1. ✅ **Regular Copies**: Copy production data weekly or when testing new features
2. ✅ **Keep Backups**: Don't delete recent backups (keep at least 3)
3. ✅ **Test First**: Test your changes on local before deploying to production
4. ✅ **Separate Databases**: Always use different database names for local vs production
5. ✅ **Document Changes**: Note what you're testing when you copy production data

## Need Help?

If you encounter issues:

1. Check the error message carefully
2. Ensure MongoDB is running locally
3. Verify your internet connection
4. Check the backup file was created successfully
5. Contact the development team with the error message

---

**Last Updated**: January 2025
**Version**: 1.0
