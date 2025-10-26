import mongoose from "mongoose";
import CommissionRecord from "./src/models/CommissionRecord.js";
import Order from "./src/models/Order.js";
import User from "./src/models/User.js";

async function checkCommissionSystem() {
  try {
    await mongoose.connect(
      process.env.DBURI || "mongodb://localhost:27017/saas-ecommerce-dev"
    );

    console.log("=== COMMISSION RECORDS ===");
    const commissions = await CommissionRecord.find({})
      .sort({ createdAt: -1 })
      .limit(10);
    console.log("Total commission records:", commissions.length);

    commissions.forEach((c, i) => {
      console.log(
        `${i + 1}. Agent: ${c.agentId} | Amount: ${c.amount} | Orders: ${
          c.totalOrders
        } | Revenue: ${c.totalRevenue} | Status: ${c.status} | isFinal: ${
          c.isFinal
        } | Created: ${c.createdAt}`
      );
    });

    console.log("\n=== CURRENT MONTH COMMISSIONS (isFinal: false) ===");
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const currentMonthCommissions = await CommissionRecord.find({
      periodStart: { $gte: startOfMonth },
      periodEnd: { $lte: endOfMonth },
      isFinal: false,
    });

    console.log(
      "Current month non-final commissions:",
      currentMonthCommissions.length
    );
    currentMonthCommissions.forEach((c, i) => {
      console.log(
        `${i + 1}. Agent: ${c.agentId} | Amount: ${c.amount} | Orders: ${
          c.totalOrders
        } | Revenue: ${c.totalRevenue}`
      );
    });

    console.log("\n=== RECENT COMPLETED ORDERS ===");
    const recentCompletedOrders = await Order.find({ status: "completed" })
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate("createdBy", "fullName email userType");

    recentCompletedOrders.forEach((order, i) => {
      console.log(
        `${i + 1}. ${order.orderNumber} | ${order.total} | Agent: ${
          order.createdBy?.fullName
        } (${order.createdBy?.userType}) | Completed: ${
          order.processingCompletedAt
        }`
      );
    });
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkCommissionSystem();
