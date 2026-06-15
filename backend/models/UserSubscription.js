const mongoose = require('mongoose');

const UserSubscriptionSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Store employee/user ID (from req.user.id)
  userEmail: { type: String, required: true }, // Store user email to lookup subscriptions by email (essential for meeting participants)
  subscription: {
    endpoint: { type: String, required: true },
    expirationTime: { type: Number, default: null },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    }
  }
}, { timestamps: true });

// Ensure compound index to avoid duplicate subscription endpoints per user
UserSubscriptionSchema.index({ userId: 1, 'subscription.endpoint': 1 }, { unique: true });

module.exports = mongoose.model('UserSubscription', UserSubscriptionSchema);
