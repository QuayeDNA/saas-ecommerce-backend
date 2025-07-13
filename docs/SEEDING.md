# Package Seeding System

This document explains how the package seeding system works and how to use it.

## Overview

The seeding system automatically populates the database with initial package and bundle data for all major Ghanaian mobile network providers (MTN, TELECEL, AirtelTigo, GLO). This ensures that agents have access to data bundles immediately when they start using the system.

## What Gets Seeded

### Providers
- **MTN Ghana** - Leading telecommunications provider
- **Telecel Ghana** - Reliable mobile network
- **AirtelTigo** - Fast and reliable network
- **GLO Ghana** - Affordable mobile services

### Package Groups
For each provider, the following package groups are created:
- **Daily Data Plans** - 24-hour data bundles
- **Weekly Data Plans** - 7-day data bundles
- **Monthly Data Plans** - 30-day data bundles

### Data Bundles
Comprehensive bundle data including:

#### Daily Bundles (24 hours)
- 50MB bundles (GHS 0.70 - 1.00)
- 100MB bundles (GHS 1.30 - 2.00)
- 250MB bundles (GHS 3.20 - 4.00)
- 500MB bundles (MTN only, GHS 7.00)

#### Weekly Bundles (7 days)
- 1GB bundles (GHS 7.50 - 10.00)
- 2GB bundles (GHS 14.00 - 18.00)

#### Monthly Bundles (30 days)
- 5GB bundles (GHS 28.00 - 35.00)
- 10GB bundles (MTN only, GHS 65.00)

## Features Included

Each bundle includes:
- **Data Volume**: MB/GB amounts
- **Validity Period**: Hours, days, weeks, or months
- **Pricing**: Ghanaian Cedi (GHS)
- **Features**: Social media, WhatsApp, email, streaming, gaming, video calls
- **Categories**: Daily, weekly, monthly
- **Tags**: For easy filtering and search

## Automatic Seeding

The system automatically checks for and seeds data when:
1. **Application Startup**: Every time the server starts
2. **First Agent Login**: When an agent first accesses the system
3. **Database Migration**: When the data structure changes

## Manual Seeding Commands

### Check Seeding Status
```bash
npm run seed:check
```
This command checks if seeding is needed and reports the current status.

### Force Seeding
```bash
npm run seed
```
This command forces a complete reseeding of all data (removes existing data first).

## Seeding Process

1. **Database Connection**: Connects to MongoDB
2. **Structure Check**: Checks for old data structures and removes them
3. **Provider Seeding**: Creates all provider records
4. **Package Seeding**: Creates package group records
5. **Bundle Seeding**: Creates individual bundle records with proper references
6. **Validation**: Verifies all data was seeded correctly

## Data Structure Migration

The seeding system automatically handles:
- **Old Product Model**: Removes old product structure with packageItems
- **Old Package Model**: Removes old package structure with embedded items
- **New Structure**: Implements the new simplified Package and Bundle models

## Configuration

### Environment Variables
- `MONGODB_URI`: MongoDB connection string
- `NODE_ENV`: Environment (development/production)

### Database Collections
- `providers`: Provider information
- `packages`: Package groups
- `bundles`: Individual data bundles

## Troubleshooting

### Common Issues

1. **Connection Errors**
   - Check MongoDB connection string
   - Ensure MongoDB is running
   - Verify network connectivity

2. **Seeding Fails**
   - Check database permissions
   - Verify model schemas are correct
   - Check for duplicate bundle codes

3. **Partial Data**
   - Run `npm run seed` to force complete reseeding
   - Check logs for specific error messages

### Logs

The seeding process provides detailed logging:
- ✅ Success messages
- ⚠️ Warning messages
- ❌ Error messages
- 📊 Validation results

## Customization

### Adding New Providers
1. Add provider data to `providers` array in `seed-packages.js`
2. Add corresponding package groups
3. Add bundle data for the new provider
4. Update the expected providers list in `check-seeding.js`

### Modifying Bundle Data
1. Edit the `bundles` array in `seed-packages.js`
2. Update prices, features, or validity periods
3. Run `npm run seed` to apply changes

### Adding New Bundle Types
1. Add new bundle objects to the `bundles` array
2. Include all required fields (name, dataVolume, validity, price, etc.)
3. Ensure proper provider and category references

## Security Considerations

- Seeded data uses `tenantId: 'system'` for system-wide access
- All seeded data is marked as `isActive: true`
- Bundle codes are unique and follow a consistent pattern
- No sensitive information is included in seeded data

## Performance

- Seeding runs asynchronously during application startup
- Database operations are optimized with bulk inserts
- Validation checks ensure data integrity
- Minimal impact on application startup time 