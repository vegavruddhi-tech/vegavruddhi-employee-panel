const webpush = require('web-push');
const UserSubscription = require('../models/UserSubscription');

// Configure VAPID details
if (process.env.PUBLIC_VAPID_KEY && process.env.PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(
    'mailto:saurabh@vegavruddhi.com',
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY
  );
  console.log('✅ Web Push VAPID keys configured successfully');
} else {
  console.warn('⚠️ Web Push VAPID keys not configured in environment variables');
}

/**
 * Send push notification to a specific user (linked by user ID)
 * @param {string} userId - User ID (mongoose ObjectId)
 * @param {string} title - Notification title
 * @param {string} body - Notification description
 * @param {string} url - Route to navigate to when clicked
 */
async function sendPushToUser(userId, title, body, url = '/dashboard') {
  try {
    const subscriptions = await UserSubscription.find({ userId: String(userId) });
    if (!subscriptions.length) return;

    const payload = JSON.stringify({ title, body, url });

    const promises = subscriptions.map(sub => {
      return webpush.sendNotification(sub.subscription, payload)
        .catch(err => {
          // If the push service returns 404 or 410, subscription has expired, delete from DB
          if (err.statusCode === 404 || err.statusCode === 410) {
            console.log(`🗑️ Removing expired subscription: ${sub.subscription.endpoint}`);
            return UserSubscription.deleteOne({ _id: sub._id });
          }
          console.error('Push delivery error:', err.message);
        });
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('Error sending push to user:', err.message);
  }
}

/**
 * Send push notification to users by their email addresses (ideal for meeting invitees)
 * @param {string[]} emails - Array of email strings
 * @param {string} title - Notification title
 * @param {string} body - Notification description
 * @param {string} url - Route to navigate to when clicked
 */
async function sendPushToEmails(emails, title, body, url = '/dashboard') {
  try {
    const normalized = emails.map(e => String(e).toLowerCase().trim()).filter(Boolean);
    if (!normalized.length) return;

    const subscriptions = await UserSubscription.find({ userEmail: { $in: normalized } });
    if (!subscriptions.length) return;

    const payload = JSON.stringify({ title, body, url });

    const promises = subscriptions.map(sub => {
      return webpush.sendNotification(sub.subscription, payload)
        .catch(err => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            console.log(`🗑️ Removing expired subscription: ${sub.subscription.endpoint}`);
            return UserSubscription.deleteOne({ _id: sub._id });
          }
          console.error('Push delivery error:', err.message);
        });
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('Error sending push to emails:', err.message);
  }
}

module.exports = {
  sendPushToUser,
  sendPushToEmails
};
