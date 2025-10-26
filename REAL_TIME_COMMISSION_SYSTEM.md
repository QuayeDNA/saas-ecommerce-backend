# Real-Time Commission System

## Overview

The commission system has been completely overhauled from a batch processing model to a real-time tracking system. This provides better transparency for agents and super admins, with commissions accumulating throughout the month as orders are completed.

---

## System Architecture

### Old System (Deprecated)

- **Manual Generation**: Super admin clicks "Generate Monthly" button
- **Batch Processing**: All commissions calculated at month-end
- **Complex Workflow**: Generate → Archive → Expire jobs
- **Limited Visibility**: Agents can't see earnings until month-end
- **Multiple Jobs**: 3 separate cron jobs (generation, archival, cleanup)

### New System (Current)

- **Automatic Real-Time**: Commissions update immediately when orders complete
- **Continuous Accumulation**: Running totals visible throughout the month
- **Simple Workflow**: Real-time updates → Auto-finalize on 1st of month → Pay/Reject
- **Full Transparency**: Agents see earnings accumulate in real-time
- **Single Job**: One finalization job on 1st of month

---

## Key Components

### 1. Database Model (`CommissionRecord.js`)

**New Fields Added**:

```javascript
{
  isFinal: {
    type: Boolean,
    default: false,
    index: true,
    // Marks whether this record has been finalized at month-end
  },
  finalizedAt: {
    type: Date,
    // Timestamp when the record was finalized
  }
}
```

**Record States**:

- `isFinal: false` - Current month's accumulating commission (real-time)
- `isFinal: true` - Previous month's finalized commission (ready for payment)

---

### 2. Commission Service (`commissionService.js`)

#### New Methods

**`updateCommissionRealTime(orderId)`**

- Triggered automatically when an order is completed
- Finds or creates the current month's commission record for the agent
- Adds the order's commission to the running total
- Sends WebSocket updates to agent and super admins
- Returns the updated commission record

**`finalizeMonthCommissions()`**

- Runs on 1st of each month via cron job
- Marks all previous month's records as `isFinal: true`
- Sets `finalizedAt` timestamp
- Sends notifications to agents and super admins
- Returns finalization results (count, total amounts)

**`getCurrentMonthStatistics(tenantId, agentId)`** (Updated)

- Now filters for `isFinal: false` to show only current month's accumulating commissions
- Provides real-time statistics for dashboards

---

### 3. Order Service (`orderService.js`)

**Integration Point**: When an order is completed

```javascript
// Real-time commission update on order completion
if (order.status === "completed" && order.createdBy) {
  await commissionService.updateCommissionRealTime(order._id);
}
```

**Replaced Logic**:

- ❌ Old: Check if commission exists → Calculate full month → Create if missing
- ✅ New: Always update/create real-time record → Accumulate totals

---

### 4. WebSocket Service (`websocketService.js`)

**New Events**:

1. **`commission_updated`** - Real-time commission accumulation

   ```javascript
   {
     type: "commission_updated",
     commission: {
       _id: string,
       amount: number,
       totalOrders: number,
       totalRevenue: number,
       status: string,
       periodStart: Date,
       periodEnd: Date
     }
   }
   ```

2. **`commission_finalized`** - Month-end finalization
   ```javascript
   {
     type: "commission_finalized",
     commission: {
       _id: string,
       amount: number,
       status: string,
       month: string
     }
   }
   ```

**Recipients**:

- Agent: Receives their own commission updates
- Super Admins: Receive all commission updates across all agents

---

### 5. Commission Finalization Job (`commissionFinalization.js`)

**Schedule**: `1 0 1 * *` (00:01 AM on the 1st of every month)
**Timezone**: Africa/Accra (Ghana)

**What It Does**:

1. Finds all non-finalized commissions from the previous month
2. Marks them as `isFinal: true` and sets `finalizedAt`
3. Sends notifications to agents with their finalized amounts
4. Notifies super admins of total pending payments
5. Logs finalization results

**Manual Trigger**:

```javascript
import commissionFinalizationJob from "./src/jobs/commissionFinalization.js";

const result = await commissionFinalizationJob.runManually();
```

---

## Commission Flow

### Real-Time Accumulation (Throughout the Month)

```
1. Customer places order
   ↓
2. Agent processes order
   ↓
3. Order status changes to "completed"
   ↓
4. orderService.js triggers commission update
   ↓
5. commissionService.updateCommissionRealTime()
   ├─ Find/create current month record (isFinal: false)
   ├─ Calculate commission for this order
   ├─ Add to running totals
   ├─ Save updated record
   └─ Send WebSocket updates
   ↓
6. Agent sees updated commission immediately on dashboard
   ↓
7. Super admin sees running totals in real-time
```

### Month-End Finalization (1st of Each Month)

```
1. Cron job triggers at 00:01 AM on 1st
   ↓
2. commissionFinalizationJob.start()
   ↓
3. commissionService.finalizeMonthCommissions()
   ├─ Find all previous month records (isFinal: false)
   ├─ Update to isFinal: true, finalizedAt: now
   ├─ Send notifications to agents
   └─ Notify super admins of totals
   ↓
4. Agents see "Finalized - Pending Payment" for previous month
   ↓
5. Super admin can now Pay or Reject each commission
   ↓
6. New month starts with fresh isFinal: false records
```

---

## Dashboard Views

### Agent Dashboard (Wallet Page)

**Current Month (isFinal: false)**:

- Shows real-time accumulating commission
- Updates live as orders complete
- Label: "Current Month Earnings"
- Status: "Accumulating"

**Previous Month (isFinal: true, status: pending)**:

- Shows finalized amount awaiting payment
- Label: "Pending Payment"
- Status: "Pending Approval"

**Previous Month (isFinal: true, status: paid)**:

- Shows paid commission
- Label: "Paid"
- Status: "Completed"

### Super Admin Dashboard

**Statistics Card**:

- Total Current Month: Sum of all isFinal: false records
- Total Pending Payment: Sum of all isFinal: true, status: pending
- Total Paid This Month: Sum of recently paid commissions
- Active Agents: Count of agents with current month earnings

**Commission List**:

- Real-time updates via WebSocket
- Filter by isFinal status
- Actions: Pay / Reject (only for isFinal: true records)

---

## WebSocket Integration

### Frontend Setup

```typescript
// Listen for commission updates
socket.on("commission_updated", (data) => {
  // Update commission display in real-time
  updateCommissionState(data.commission);
});

// Listen for finalization
socket.on("commission_finalized", (data) => {
  // Show notification about month-end finalization
  showNotification(`Commission finalized: GHS ${data.commission.amount}`);
  refreshCommissionData();
});
```

---

## API Endpoints

### Get Current Month Statistics

```
GET /api/commissions/statistics
```

Returns only `isFinal: false` records (current month's real-time data)

### Get All Commissions (Paginated)

```
GET /api/commissions?page=1&limit=10&status=pending&isFinal=true
```

Filters:

- `isFinal=false` - Current month accumulating
- `isFinal=true` - Finalized records (previous months)
- `status=pending|paid|rejected`

### Pay Commission

```
POST /api/commissions/:id/pay
```

Only works for `isFinal: true` records

### Reject Commission

```
POST /api/commissions/:id/reject
```

Only works for `isFinal: true` records

---

## Migration from Old System

### Deprecated Jobs (Removed)

1. ❌ `commissionGeneration.js` - No longer needed (real-time instead)
2. ❌ `commissionArchival.js` - Replaced by finalization
3. ❌ `commissionCleanup.js` - No longer needed

### New Job

✅ `commissionFinalization.js` - Single job for month-end processing

### Database Cleanup

All old commission records were cleared on [date] to start fresh with the new system.

---

## Benefits

### For Agents

- ✅ See earnings accumulate in real-time
- ✅ Better transparency throughout the month
- ✅ Instant feedback when orders complete
- ✅ No waiting until month-end to see commissions

### For Super Admins

- ✅ Monitor commission accumulation across all agents
- ✅ Real-time statistics and insights
- ✅ Simpler workflow (no manual generation)
- ✅ Reduced complexity (one job instead of three)

### Technical

- ✅ Fewer scheduled jobs
- ✅ Simpler codebase
- ✅ Real-time WebSocket updates
- ✅ Better user experience
- ✅ Easier to maintain and debug

---

## Testing

### Test Real-Time Updates

1. Create and complete an order as an agent
2. Check agent dashboard - commission should update immediately
3. Check super admin dashboard - should show updated totals
4. Verify WebSocket events are fired

### Test Month-End Finalization

```javascript
// Run manually for testing
import commissionFinalizationJob from "./src/jobs/commissionFinalization.js";
const result = await commissionFinalizationJob.runManually();
console.log(result);
```

Expected:

- Previous month records marked as `isFinal: true`
- Notifications sent to agents and admins
- Current month starts fresh with `isFinal: false`

---

## Troubleshooting

### Commission not updating in real-time

1. Check if order status is "completed"
2. Verify orderService.js is calling updateCommissionRealTime()
3. Check WebSocket connection
4. Review server logs for errors

### Month-end finalization not running

1. Verify cron job is started: `commissionFinalizationJob.start()` in app.js
2. Check job schedule: `1 0 1 * *`
3. Verify timezone: Africa/Accra
4. Run manually to test: `commissionFinalizationJob.runManually()`

### Statistics showing wrong values

1. Ensure `isFinal: false` filter is applied for current month
2. Check date range calculations
3. Verify commission records are being created correctly

---

## Future Enhancements

- [ ] Add commission projections based on current month performance
- [ ] Weekly commission summaries via email
- [ ] Commission leaderboards for agents
- [ ] Detailed commission breakdown by product/provider
- [ ] Export commission reports (PDF/CSV)
- [ ] Custom commission rates per agent
- [ ] Tiered commission rates based on performance

---

## References

- **Model**: `src/models/CommissionRecord.js`
- **Service**: `src/services/commissionService.js`
- **Order Integration**: `src/services/orderService.js`
- **WebSocket**: `src/services/websocketService.js`
- **Job**: `src/jobs/commissionFinalization.js`
- **App**: `app.js` (job initialization)
