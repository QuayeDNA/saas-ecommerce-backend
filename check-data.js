import mongoose from "mongoose";
import Order from "./src/models/Order.js";
import CommissionRecord from "./src/models/CommissionRecord.js";

async function checkData() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/saas-ecommerce"
    );

    console.log("=== ORDER STATUS BREAKDOWN ===");
    const orderStatuses = await Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    console.log("Order statuses:", orderStatuses);

    console.log("\n=== RECENT ORDERS ===");
    const recentOrders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("createdBy", "fullName email userType");
    console.log("Recent orders count:", recentOrders.length);
    recentOrders.forEach((order, index) => {
      console.log(
        `${index + 1}. ${order.orderNumber} - ${order.status} - ${
          order.total
        } - ${order.createdBy?.fullName || "Unknown"} (${
          order.createdBy?.userType || "Unknown"
        })`
      );
    });

    console.log("\n=== PENDING ORDERS WITH ITEMS ===");
    const pendingOrders = await Order.find({ status: "pending" })
      .limit(5)
      .populate("createdBy", "fullName email userType");
    console.log("Pending orders count:", pendingOrders.length);
    pendingOrders.forEach((order, index) => {
      console.log(
        `${index + 1}. ${order.orderNumber} - Items: ${
          order.items?.length || 0
        } - Created by: ${order.createdBy?.fullName || "Unknown"}`
      );
      if (order.items && order.items.length > 0) {
        order.items.forEach((item, itemIndex) => {
          console.log(
            `   Item ${itemIndex + 1}: ${item.processingStatus} - ${
              item.customerPhone
            }`
          );
        });
      }
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkData();
