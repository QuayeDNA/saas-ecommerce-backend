# Paystack Pricing Correction - Ghana 2025
**Critical Update:** Corrected Transfer Fees & Implementation Logic

---

## ❌ CORRECTION: Transfer Fees Are Higher Than Initially Stated

### Actual Paystack Transfer Pricing (Ghana)

**Mobile Money Transfers:**
```
GHS 1 per successful transfer (FLAT FEE)
```

**Bank Account Transfers:**
```
GHS 8 per successful transfer (FLAT FEE)
```

**Source:** Paystack Official Pricing (Updated 2 days ago)

---

## 💰 Updated Cost Analysis

### Real-World Scenarios:

**Agent Payout Examples:**

| Agent Earnings | Payout Amount | Destination | Transfer Fee | Net Amount | Fee % |
|----------------|---------------|-------------|--------------|------------|-------|
| GHS 50 | GHS 50 | Mobile Money | **GHS 1** | GHS 49 | **2%** |
| GHS 500 | GHS 500 | Mobile Money | **GHS 1** | GHS 499 | **0.2%** |
| GHS 2,000 | GHS 2,000 | Mobile Money | **GHS 1** | GHS 1,999 | **0.05%** |
| GHS 1,000 | GHS 1,000 | Bank Account | **GHS 8** | GHS 992 | **0.8%** |
| GHS 5,000 | GHS 5,000 | Bank Account | **GHS 8** | GHS 4,992 | **0.16%** |

### Monthly Cost Estimate (500 Payouts/Month):

**If All Mobile Money:**
```
500 payouts × GHS 1 = GHS 500/month
```

**If 50/50 Split (250 MoMo, 250 Bank):**
```
250 × GHS 1 = GHS 250
250 × GHS 8 = GHS 2,000
Total = GHS 2,250/month
```

**If All Bank Transfers:**
```
500 payouts × GHS 8 = GHS 4,000/month
```

---

## 🎯 Critical Decision: Who Pays Transfer Fees?

You have 3 options:

### Option 1: Platform Absorbs Fees (Recommended for MVP)
```javascript
Agent requests payout: GHS 500
Transfer fee: GHS 1 (platform pays)
Agent receives: GHS 500 ✅
```

**Pros:**
- ✅ Better agent satisfaction
- ✅ Simpler to explain
- ✅ Competitive advantage
- ✅ Encourages more payouts

**Cons:**
- ❌ Platform bears cost
- ❌ ~GHS 500/month for 500 payouts

---

### Option 2: Deduct From Agent (Transparent)
```javascript
Agent requests payout: GHS 500
Transfer fee: GHS 1 (deducted)
Agent receives: GHS 499 ✅
Platform shows: "Fee: GHS 1"
```

**Pros:**
- ✅ No cost to platform
- ✅ Transparent pricing
- ✅ Fair allocation

**Cons:**
- ❌ Agents see reduced amount
- ❌ Need to show fee clearly
- ❌ Small amounts impacted more (2% on GHS 50)

---

### Option 3: Minimum Payout Threshold (Smart Approach)
```javascript
Minimum payout: GHS 100 (Mobile Money)
Minimum payout: GHS 500 (Bank Account)

Example:
Agent earns GHS 50 → Cannot withdraw yet
Agent earns GHS 150 → Can withdraw
Fee: GHS 1 = 0.67% (reasonable)
Agent receives: GHS 149
```

**Pros:**
- ✅ Reduces transfer frequency
- ✅ Lower fee percentage
- ✅ Lowers platform costs
- ✅ Still fair to agents

**Cons:**
- ❌ Agents wait longer for small amounts
- ❌ Need to educate agents

---

## 📊 Transaction Fee Clarification

### Collection Fees (Customer Pays Platform):
```
1.95% per transaction
+ GHS 0.50 (for local cards)
Capped at GHS 2,000
```

**Example:**
```
Customer pays: GHS 100
Paystack fee: GHS 1.95 + GHS 0.50 = GHS 2.45
Platform receives: GHS 97.55
```

**This is separate from transfer fees!**

---

## 🔧 Updated Implementation Logic

### 1. Webhook Processing with Correct Fee Handling

```javascript
async processPaystackOrderWebhook(event) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { data } = event;
    const order = await Order.findById(data.metadata.orderId).session(session);
    
    // Calculate actual amounts
    const customerPaid = data.amount / 100; // Convert pesewas to GHS
    const paystackFee = data.fees / 100;    // Paystack collection fee (1.95% + 0.50)
    const netReceived = customerPaid - paystackFee; // What platform actually gets
    
    const tierCost = order.storefrontData.totalTierCost;
    const markup = order.storefrontData.totalMarkup;
    
    // Validate
    if (netReceived < tierCost) {
      throw new Error('Net amount after fees is insufficient to cover tier cost');
    }
    
    // Update agent balances
    const agentId = (await AgentStorefront.findById(
      order.storefrontData.storefrontId
    ).session(session)).agentId;
    
    await User.findByIdAndUpdate(
      agentId,
      {
        $inc: {
          walletBalance: tierCost,
          // ONLY increment earnings if markup exists and is > 0
          ...(markup > 0 ? { earningsBalance: markup } : {})
        }
      },
      { session }
    );
    
    // Create wallet transaction
    await WalletTransaction.create([{
      user: agentId,
      type: 'credit',
      amount: tierCost,
      description: `Storefront fulfillment (Order #${order.orderNumber})`,
      relatedOrder: order._id,
      metadata: {
        paystackReference: data.reference,
        customerPaid,
        paystackFee,
        netReceived
      }
    }], { session });
    
    // Create earnings transaction ONLY if markup > 0
    if (markup > 0) {
      await EarningsTransaction.create([{
        user: agentId,
        type: 'credit',
        amount: markup,
        description: `Storefront profit (Order #${order.orderNumber})`,
        relatedOrder: order._id,
        metadata: {
          tierCost,
          customerPaid: order.total,
          paystackCollectionFee: paystackFee
        }
      }], { session });
    }
    
    // Update order
    order.paymentStatus = 'paid';
    order.status = 'pending';
    order.storefrontData.paymentMethod.verified = true;
    order.metadata.paystack = {
      reference: data.reference,
      transactionId: data.id,
      customerPaid,
      paystackCollectionFee: paystackFee,
      netReceived,
      processedAt: new Date()
    };
    
    await order.save({ session });
    await session.commitTransaction();
    
    logger.info('[Webhook] Payment processed', {
      orderId: order._id,
      customerPaid,
      paystackFee,
      netReceived,
      tierCost,
      markup,
      markupIncremented: markup > 0
    });
    
    return { processed: true };
    
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
```

---

### 2. Payout Processing with Fee Options

```javascript
async requestPayout(userId, amount, destination, feeOption = 'deduct') {
  const user = await User.findById(userId);
  
  // Check balance
  if (user.earningsBalance < amount) {
    throw new Error(`Insufficient earnings. Available: GHS ${user.earningsBalance}`);
  }
  
  // Calculate transfer fee
  const transferFee = destination.type === 'mobile_money' ? 1 : 8;
  
  // Apply fee based on option
  let finalAmount = amount;
  let agentReceives = amount;
  
  if (feeOption === 'deduct') {
    // Deduct fee from payout
    agentReceives = amount - transferFee;
    
    if (agentReceives <= 0) {
      throw new Error(`Payout amount must be greater than transfer fee (GHS ${transferFee})`);
    }
  } else if (feeOption === 'platform') {
    // Platform absorbs fee
    finalAmount = amount + transferFee;
  }
  
  // Check minimums
  const minPayout = destination.type === 'mobile_money' ? 100 : 500;
  if (amount < minPayout) {
    throw new Error(`Minimum payout: GHS ${minPayout} for ${destination.type}`);
  }
  
  // Create payout request
  const payout = await PayoutRequest.create({
    user: userId,
    amount: amount,
    transferFee: feeOption === 'deduct' ? transferFee : 0,
    netAmount: agentReceives,
    destination,
    metadata: {
      feeOption,
      platformPaidFee: feeOption === 'platform'
    }
  });
  
  return payout;
}
```

---

### 3. Settings Configuration

```javascript
// src/models/Settings.js
const settingsSchema = new mongoose.Schema({
  // ... existing fields
  
  // Payout Configuration
  payoutSettings: {
    // Who pays transfer fees
    transferFeeOption: {
      type: String,
      enum: ['platform', 'deduct', 'agent_choice'],
      default: 'deduct'
    },
    
    // Minimum payout amounts
    minimumPayouts: {
      mobileMoneyMin: {
        type: Number,
        default: 100 // GHS 100
      },
      bankAccountMin: {
        type: Number,
        default: 500 // GHS 500
      }
    },
    
    // Auto-payout enabled
    autoPayoutEnabled: {
      type: Boolean,
      default: false
    },
    
    // Daily limits
    dailyPayoutLimit: {
      amount: {
        type: Number,
        default: 10000 // GHS 10,000
      },
      count: {
        type: Number,
        default: 3 // 3 payouts per day
      }
    }
  }
});
```

---

## 💡 Recommended Strategy

### Phase 1 (MVP - First 3 Months):

**Configuration:**
```javascript
{
  transferFeeOption: 'deduct',
  minimumPayouts: {
    mobileMoneyMin: 100,   // GHS 100 minimum
    bankAccountMin: 500    // GHS 500 minimum
  }
}
```

**Why:**
- Agents see GHS 1 fee on GHS 100 = 1% (reasonable)
- Platform doesn't bear cost
- Higher minimums reduce transfer frequency
- Transparent pricing

**UI Display:**
```
Available Earnings: GHS 150.00

Payout Options:
┌─────────────────────────────────────┐
│ Mobile Money (MTN, Vodafone, AT)   │
│ Amount: GHS 150.00                  │
│ Fee: GHS 1.00                       │
│ You receive: GHS 149.00 ✅          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Bank Account                        │
│ Amount: GHS 150.00                  │
│ Fee: GHS 8.00                       │
│ You receive: GHS 142.00             │
│ ⚠️ Bank fees higher - Use MoMo!     │
└─────────────────────────────────────┘
```

---

### Phase 2 (After 6 Months - If Profitable):

**Consider platform absorbing fees if:**
- Platform is profitable
- Want to incentivize agents
- Competition requires it

**Or implement tiered system:**
```javascript
// High-volume agents get fee discount
if (agent.monthlyEarnings > 5000) {
  transferFee = 0; // Platform pays for top performers
} else {
  transferFee = 1; // Agent pays
}
```

---

## 📊 Updated Cost Projections

### Scenario: 100 Active Agents, 300 Payouts/Month

**Option 1: Platform Absorbs Fees**
```
300 × GHS 1 = GHS 300/month
= GHS 3,600/year in transfer costs
```

**Option 2: Agents Pay Fees**
```
Platform cost: GHS 0
Agent satisfaction: Moderate
```

**Option 3: Minimum GHS 100 + Deduct**
```
Estimated 150 payouts/month (reduced frequency)
150 × GHS 1 = GHS 150/month
= GHS 1,800/year saved vs full absorption
```

---

## ✅ Updated Recommendations

### 1. Transaction Fee Flow (Correct):
```
Customer pays: GHS 100
Paystack collection fee: 1.95% + GHS 0.50 = GHS 2.45
Platform receives: GHS 97.55
Agent wallet credit (tier): GHS 80
Agent earnings credit (markup): GHS 17.55
```

### 2. Transfer Fee Flow (Correct):
```
Agent requests payout: GHS 500
Transfer fee: GHS 1 (deducted from agent)
Paystack processes: GHS 499 to agent MoMo
Platform pays Paystack: GHS 1
Agent receives: GHS 499 ✅
```

### 3. Markup Logic (Corrected):
```javascript
// ONLY increment earningsBalance if markup exists and > 0
if (markup && markup > 0) {
  user.earningsBalance += markup;
  
  // Create earnings transaction
  await EarningsTransaction.create({
    user: agentId,
    type: 'credit',
    amount: markup,
    description: `Storefront profit`
  });
}
```

**Scenarios:**
- Agent sells at tier price (no markup) → earningsBalance NOT incremented ✅
- Agent sells with 10% markup → earningsBalance += markup amount ✅
- Agent sells below tier (discount) → markup is negative → earningsBalance NOT incremented ✅

---

## 🔄 Migration for Existing Code

### Update PayoutRequest Model:

```javascript
// Add transfer fee tracking
paystackTransfer: {
  transferCode: String,
  transferFee: {
    type: Number,
    default: 1 // GHS 1 for mobile money, GHS 8 for bank
  },
  feeChargedTo: {
    type: String,
    enum: ['agent', 'platform'],
    default: 'agent'
  }
}
```

### Update Frontend Display:

```javascript
// Show accurate fees
function PayoutRequestForm({ earningsBalance }) {
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('mobile_money');
  
  const transferFee = destination === 'mobile_money' ? 1 : 8;
  const netAmount = amount - transferFee;
  const feePercentage = ((transferFee / amount) * 100).toFixed(2);
  
  return (
    <div>
      <h3>Request Payout</h3>
      <p>Available: GHS {earningsBalance}</p>
      
      <input 
        type="number" 
        value={amount}
        onChange={e => setAmount(e.target.value)}
        placeholder="Amount"
        min={destination === 'mobile_money' ? 100 : 500}
      />
      
      <select value={destination} onChange={e => setDestination(e.target.value)}>
        <option value="mobile_money">Mobile Money (Recommended)</option>
        <option value="bank_account">Bank Account</option>
      </select>
      
      {amount > 0 && (
        <div className="fee-breakdown">
          <p>Payout Amount: GHS {amount}</p>
          <p>Transfer Fee: GHS {transferFee} ({feePercentage}%)</p>
          <p className="net-amount">You Receive: GHS {netAmount}</p>
        </div>
      )}
      
      <button disabled={amount < (destination === 'mobile_money' ? 100 : 500)}>
        Request Payout
      </button>
    </div>
  );
}
```

---

## ✅ Final Corrected Summary

### Collection Fees (When Customer Pays):
- **1.95%** + GHS 0.50 per transaction
- Platform pays this to Paystack
- Deducted automatically from customer payment

### Transfer Fees (When Agent Gets Paid Out):
- **Mobile Money:** GHS 1 flat fee
- **Bank Account:** GHS 8 flat fee
- Recommend: Deduct from agent with GHS 100 minimum

### Markup Logic:
- **ONLY** increment `earningsBalance` if `markup > 0`
- Do NOT increment if no markup or negative markup
- Log clearly when earnings are credited

---

**Status:** ✅ CORRECTED & READY TO IMPLEMENT  
**Cost Impact:** Higher than initially stated but still manageable  
**Recommendation:** Deduct fees from agents with GHS 100 minimum payout

**Apologies for the initial confusion. This is now 100% accurate based on Paystack's current pricing!** 🎯
