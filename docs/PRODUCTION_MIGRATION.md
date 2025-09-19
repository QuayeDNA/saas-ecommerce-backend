# Production Database Migration Guide

## Reception Status Migration

This guide explains how to run the reception status migration on production databases.

### What This Migration Does

The reception status migration updates all existing completed orders to have `receptionStatus: "received"` instead of the default `"not_received"`. This ensures that:

1. All completed orders are correctly marked as "received" by default
2. New orders automatically get "received" status when completed
3. Users can still report delivery issues to change status to "not_received"

### Running the Migration

#### Option 1: Using npm scripts (Recommended)

```bash
# For development environment
npm run migrate:reception-status

# For production environment
npm run migrate:reception-status:prod
```

#### Option 2: Direct execution

```bash
# Development
node src/scripts/migrateReceptionStatus.js

# Production (set NODE_ENV)
NODE_ENV=production node src/scripts/migrateReceptionStatus.js
```

#### Option 3: Manual deployment on production server

1. SSH into your production server
2. Navigate to your application directory
3. Ensure environment variables are set (NODE_ENV=production)
4. Run the migration:

```bash
cd /path/to/your/app
npm run migrate:reception-status:prod
```

### Safety Precautions

⚠️ **IMPORTANT**: Always backup your production database before running migrations!

The migration script includes:

- Environment detection (warns for production)
- Current status distribution logging
- Sample order verification
- Clear success/failure reporting

### Expected Output

```bash
Starting reception status migration...
Environment: PRODUCTION
Database URI: mongodb+srv://AnansE:****@mongodbcluster.kjbxxoj.mongodb.net/saas-ecommerce

⚠️  WARNING: You are about to run this migration on PRODUCTION database!
This will update ALL completed orders to have receptionStatus = 'received'
Make sure you have a backup before proceeding.

Connected to MongoDB
Found X completed orders to migrate
Current reception status distribution: { not_received: X, undefined: Y }
Migration completed. Updated X orders
Sample migrated orders:
Order ORD-XXXX: status=completed, receptionStatus=received
...

✅ Production migration completed successfully!
Please verify the changes in your production application.
```

### Verification

After running the migration:

1. Check your application - all completed orders should show "received" status
2. Verify that new completed orders still get "received" status automatically
3. Test that user reports can change status to "not_received"
4. Confirm admin dropdown works for status management

### Rollback (If Needed)

If you need to rollback, you can manually update orders back to "not_received":

```javascript
// In MongoDB shell or via script
db.orders.updateMany(
  { status: "completed", receptionStatus: "received" },
  { $set: { receptionStatus: "not_received" } }
);
```

### Troubleshooting

- **Migration fails**: Check database connectivity and permissions
- **No orders updated**: Verify there are completed orders in the database
- **Wrong environment**: Ensure NODE_ENV is set correctly
- **Connection timeout**: Check network connectivity to MongoDB Atlas
