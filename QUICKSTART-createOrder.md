# Quick Start Guide: Create Order Document Script

## TL;DR

```bash
cd saas-ecommerce-backend
npm run create-order
```

Follow the prompts, approve the generated order, and it's inserted into the database!

## What This Script Does

Creates test orders directly in MongoDB with:
- ✅ **Backdated timestamps** (1 week ago)
- ✅ **Random agent selection** (not admin/super_dealer)
- ✅ **No wallet deduction**
- ✅ **No commission calculation**
- ✅ **Full approval workflow**

## Quick Example Session

```
🚀 ORDER DOCUMENT GENERATOR
======================================================================

📊 Select Database Environment:
  1. Development (DEV)
  2. Production (PROD)

Enter your choice (1 or 2): 1

🔌 Connecting to DEV database...
✅ Connected to DEV database successfully!

📡 Available Providers:
  1. MTN Ghana (MTN)
  2. Telecel Ghana (TELECEL)
  3. AirtelTigo (AT)

Select provider (enter number): 1
✅ Selected: MTN Ghana (MTN)

📦 Available Bundles for MTN:
  1. 1GB - GHS 4.50 (7 days) - MTN Daily Bundles
  2. 2GB - GHS 9.00 (7 days) - MTN Daily Bundles
  3. 5GB - GHS 18.00 (30 days) - MTN Monthly Bundles
  4. 10GB - GHS 35.00 (30 days) - MTN Monthly Bundles

Select bundle (enter number): 4
✅ Selected: 10GB Data Bundle

Enter phone number to receive the bundle: 0241234567
✅ Phone Number: 0241234567

👤 Selected Random Agent:
   Name: John Doe
   Email: johndoe@example.com
   Type: agent
   Agent Code: AG0012

📅 Order will be created with date: 1/30/2026, 2:45:30 PM

======================================================================
📄 GENERATED ORDER DOCUMENT
======================================================================
Order Number:     ORD-M2K5L8-X9Y2Z1
Order Type:       single
Status:           pending
Created Date:     1/30/2026, 2:45:30 PM

--- Customer Info ---
Name:             John Doe
Email:            johndoe@example.com
Phone:            0241234567

--- Order Items ---
Item 1:
  Package:        10GB Data Bundle
  Provider:       MTN
  Data Volume:    10GB
  Validity:       30 days
  Unit Price:     GHS 35
  Quantity:       1
  Total Price:    GHS 35
  Phone Number:   0241234567

--- Pricing ---
Subtotal:         GHS 35
Tax:              GHS 0
Discount:         GHS 0
Total:            GHS 35

--- Payment ---
Payment Status:   pending
Payment Method:   wallet
======================================================================

Do you want to insert this order into the database? (yes/no): yes
✅ Order inserted successfully!
📝 Order ID: 65f8a9b1c2d3e4f5a6b7c8d9
📋 Order Number: ORD-M2K5L8-X9Y2Z1

✨ Order creation completed successfully!

👋 Disconnected from database. Goodbye!
```

## Common Use Cases

### 1. Testing Order Processing
Create orders to test your order processing workflow without affecting real wallets.

### 2. Commission Testing
Generate historical orders to test commission calculation and monthly summaries.

### 3. Demo Data
Quickly populate your database with sample orders for demos or presentations.

### 4. Development Testing
Create orders with specific bundles/providers to test edge cases.

## Tips & Tricks

### Cancel Anytime
Press `Ctrl+C` to safely exit the script at any time. Database connections are automatically cleaned up.

### Phone Number Formats
All these formats work:
- `0241234567`
- `+233241234567`  
- `0 24 123 4567`  
- `024-123-4567`

### Production Safety
Script requires double confirmation before connecting to production:
1. Select option 2 for production
2. Type `yes` to confirm production connection
3. Type `yes` again to insert the order

### Random Agent Selection
The script automatically:
- ✅ Selects only active agents
- ✅ Excludes super_admin and super_dealer
- ✅ Shows agent details before creating order
- ❌ Never picks deactivated users

## What Happens After?

The order is inserted with:
- ✅ Status: `pending`
- ✅ Payment Status: `pending`  
- ✅ Created Date: 7 days ago
- ❌ Wallet NOT deducted
- ❌ Commissions NOT calculated
- ❌ APIs NOT called

You can then:
1. Process the order manually through your admin panel
2. Test commission calculations
3. Update order status to test different states
4. Use for integration testing

## Troubleshooting

**"No active providers found"**
→ Check database has providers with `isActive: true`

**"No bundles found"**
→ Ensure bundles exist and are linked to packages

**"No eligible agents found"**
→ Create an agent account with `subscriptionStatus: 'active'`

**"Invalid phone number"**
→ Use Ghanaian format: 024XXXXXXX or +233XXXXXXXXX

## Environment Setup

Ensure `.env` file exists:

```env
DBURI=mongodb://localhost:27017/saas-ecommerce
PROD_DBURI=mongodb://your-prod-host/saas-ecommerce  # Optional
```

## Script Location

```
saas-ecommerce-backend/
└── src/
    └── scripts/
        ├── createOrderDocument.js          ← The script
        └── README-createOrderDocument.md   ← Full documentation
```

## Safety Features

✅ Production confirmation required  
✅ Preview before inserting  
✅ Validation at every step  
✅ Graceful error handling  
✅ Automatic cleanup on exit  

## Related Scripts

- `register-superadmin.js` - Create super admin users
- `syncMissingAgents.js` - Sync agent data
- `src/jobs/` - Background job scripts

## Need Help?

- Full Documentation: `src/scripts/README-createOrderDocument.md`
- Check logs for detailed error messages
- Verify MongoDB is running: `mongosh`
- Test connection: `npm run dev`

---

**Made with ❤️ for SaaS E-Commerce Platform**
